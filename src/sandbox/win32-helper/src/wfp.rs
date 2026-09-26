//! WFP 网络隔离 provision（T-P1-27 · D16，codex wfp.rs 语义的 Rust 对应
//! 实现——MIT 语义自研）。
//!
//! 结构：专用 OS 身份（本地账户，account.rs）+ WFP persistent 过滤器
//! （**按账户 SID 的出站 BLOCK**，ALE_USER_ID 条件）——"网络隔离需
//! OS 身份 + WFP；Job Object 只管进程生命周期，不够"。
//!
//! 幂等（codex delete-then-add 同款）：filter 按固定 key 先删后装，
//! provider/sublayer 容忍 FWP_E_ALREADY_EXISTS。probe 用
//! FwpmFilterGetByKey0 查在位性（engine open 需要管理员）。

use super::err::{HelperError, Result};
use super::grant::wide;
use std::ffi::c_void;
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
    FwpmEngineClose0, FwpmEngineOpen0, FwpmFilterAdd0, FwpmFilterDeleteByKey0, FwpmFilterGetByKey0,
    FwpmProviderAdd0, FwpmSubLayerAdd0, FWP_BYTE_BLOB, FWP_CONDITION_VALUE0, FWP_CONDITION_VALUE0_0,
    FWP_EMPTY, FWP_MATCH_EQUAL, FWP_SECURITY_DESCRIPTOR_TYPE, FWPM_ACTION0, FWPM_ACTION0_0,
    FWPM_DISPLAY_DATA0, FWPM_FILTER0, FWPM_FILTER0_0, FWPM_FILTER_CONDITION0, FWPM_PROVIDER0,
    FWPM_SUBLAYER0, FWPM_FILTER_FLAG_PERSISTENT, FWPM_PROVIDER_FLAG_PERSISTENT,
    FWPM_SUBLAYER_FLAG_PERSISTENT, FWP_ACTRL_MATCH_FILTER, FWP_VALUE0, FWP_VALUE0_0,
};
// windows-sys 0.48 缺失的微软固定值（0.49+ 才生成；值出处 MSDN）。
const FWP_ACTION_BLOCK: u32 = 0x0001_0005;
const FWP_E_ALREADY_EXISTS: u32 = 0x8032_000B;
const FWP_E_NOT_FOUND: u32 = 0x8032_0003;
use windows_sys::Win32::Security::Authorization::{
    BuildExplicitAccessWithNameW, BuildSecurityDescriptorW, EXPLICIT_ACCESS_W, GRANT_ACCESS,
};
use windows_sys::Win32::Security::LookupAccountNameW;
use windows_sys::Win32::System::Memory::LocalFree;

// ── 我方 WFP 命名空间（固定 GUID，persistent，卸载/探测按 key）──
const PROVIDER_KEY: windows_sys::core::GUID =
    guid(0xd98ab2a9, 0xaecb, 0x4fd0, [0xa6, 0x7d, 0xd1, 0x1b, 0x3f, 0xda, 0x2d, 0x86]);
const SUBLAYER_KEY: windows_sys::core::GUID =
    guid(0x22d778f6, 0x6e2e, 0x4b26, [0xaf, 0xc5, 0x97, 0x3f, 0x9d, 0x55, 0xb3, 0x8a]);
const FILTER_KEY: windows_sys::core::GUID =
    guid(0x73bbd344, 0x663c, 0x4e30, [0x9a, 0xd9, 0x52, 0xe0, 0xcd, 0xa1, 0x73, 0x86]);
/// FWPM_LAYER_ALE_AUTH_CONNECT_V4（微软固定层 GUID：出站连接授权）。
const LAYER_ALE_AUTH_CONNECT_V4: windows_sys::core::GUID =
    guid(0xc38d57d1, 0x05a7, 0x4c33, [0x90, 0x4f, 0x7f, 0xbc, 0xee, 0xe6, 0x0e, 0x82]);
/// FWPM_CONDITION_ALE_USER_ID（微软固定字段 GUID：按用户身份匹配）。
const FWPM_CONDITION_ALE_USER_ID: windows_sys::core::GUID =
    guid(0xaf7910cb, 0x3c30, 0x42e5, [0xb1, 0x4b, 0xe7, 0x5b, 0x1c, 0x8c, 0x8c, 0xa9]);

const fn guid(data1: u32, data2: u16, data3: u16, data4: [u8; 8]) -> windows_sys::core::GUID {
    windows_sys::core::GUID { data1, data2, data3, data4 }
}

const fn zero_guid() -> windows_sys::core::GUID {
    windows_sys::core::GUID { data1: 0, data2: 0, data3: 0, data4: [0; 8] }
}

fn empty_blob() -> FWP_BYTE_BLOB {
    FWP_BYTE_BLOB { size: 0, data: std::ptr::null_mut() }
}

fn empty_value() -> FWP_VALUE0 {
    FWP_VALUE0 { r#type: FWP_EMPTY, Anonymous: FWP_VALUE0_0 { uint8: 0 } }
}

/// 打开 WFP 引擎（provision/probe 都要；需要管理员）。
fn open_engine() -> Result<HANDLE> {
    let mut engine: HANDLE = 0;
    // RPC_C_AUTHN_WINNT = 10。
    let ok = unsafe { FwpmEngineOpen0(std::ptr::null(), 10, std::ptr::null(), std::ptr::null(), &mut engine) };
    if ok != 0 || engine == 0 {
        return Err(HelperError::new(
            super::PROVISION_FAILED,
            format!("FwpmEngineOpen0 失败（win32 code {ok:#x}）——需要管理员权限"),
        ));
    }
    Ok(engine)
}

fn close_engine(engine: HANDLE) {
    unsafe { FwpmEngineClose0(engine) };
}

/// 账户名 → SID 字节（LookupAccountNameW；账户须已存在）。
pub fn account_sid(account: &str) -> Result<Vec<u8>> {
    let name = wide(account);
    let mut sid_size = 0u32;
    let mut domain_size = 0u32;
    let mut sid_use = 0i32;
    // 第一次调用拿大小（预期失败 ERROR_INSUFFICIENT_BUFFER）。
    unsafe {
        LookupAccountNameW(
            std::ptr::null(),
            name.as_ptr(),
            std::ptr::null_mut(),
            &mut sid_size,
            std::ptr::null_mut(),
            &mut domain_size,
            &mut sid_use,
        );
    }
    if sid_size == 0 {
        return Err(HelperError::new(
            super::PROVISION_FAILED,
            format!(
                "LookupAccountNameW({account}) 失败——账户不存在（win32 code {}）",
                unsafe { windows_sys::Win32::Foundation::GetLastError() }
            ),
        ));
    }
    let mut sid = vec![0u8; sid_size as usize];
    let mut domain = vec![0u16; domain_size.max(1) as usize];
    let ok = unsafe {
        LookupAccountNameW(
            std::ptr::null(),
            name.as_ptr(),
            sid.as_mut_ptr() as *mut _,
            &mut sid_size,
            domain.as_mut_ptr(),
            &mut domain_size,
            &mut sid_use,
        )
    };
    if ok == 0 {
        return Err(HelperError::new(
            super::PROVISION_FAILED,
            format!("LookupAccountNameW({account}) 二次调用失败"),
        ));
    }
    Ok(sid)
}

/// provision 动作：账户已由 account.rs 创建 → WFP 三件套 persistent 安装。
/// 幂等：filter delete-then-add、provider/sublayer 容忍 already-exists。
pub fn provision_network_filters(account: &str) -> Result<String> {
    let sid = account_sid(account)?;
    let _ = sid; // SD 构造走账户名（BuildSecurityDescriptorW 内部解析）。
    let engine = open_engine()?;

    let provider_name = wide("aegent-sandbox-network");
    let provider = FWPM_PROVIDER0 {
        providerKey: PROVIDER_KEY,
        displayData: FWPM_DISPLAY_DATA0 {
            name: provider_name.as_ptr() as *mut _,
            description: std::ptr::null_mut(),
        },
        flags: FWPM_PROVIDER_FLAG_PERSISTENT,
        providerData: empty_blob(),
        serviceName: std::ptr::null_mut(),
    };
    let ok = unsafe { FwpmProviderAdd0(engine, &provider, std::ptr::null_mut()) };
    if ok != 0 && ok != FWP_E_ALREADY_EXISTS as u32 {
        close_engine(engine);
        return Err(HelperError::new(super::PROVISION_FAILED, format!("FwpmProviderAdd0 失败（{ok:#x}）")));
    }

    let sublayer = FWPM_SUBLAYER0 {
        subLayerKey: SUBLAYER_KEY,
        displayData: FWPM_DISPLAY_DATA0 {
            name: provider_name.as_ptr() as *mut _,
            description: std::ptr::null_mut(),
        },
        flags: FWPM_SUBLAYER_FLAG_PERSISTENT,
        providerKey: &PROVIDER_KEY as *const _ as *mut _,
        providerData: empty_blob(),
        weight: 0,
    };
    let ok = unsafe { FwpmSubLayerAdd0(engine, &sublayer, std::ptr::null_mut()) };
    if ok != 0 && ok != FWP_E_ALREADY_EXISTS as u32 {
        close_engine(engine);
        return Err(HelperError::new(super::PROVISION_FAILED, format!("FwpmSubLayerAdd0 失败（{ok:#x}）")));
    }

    let _ = unsafe { FwpmFilterDeleteByKey0(engine, &FILTER_KEY) }; // 不存在则忽略
    let ok = unsafe { install_filter(engine, account, &provider_name) };
    if ok != 0 {
        close_engine(engine);
        return Err(HelperError::new(super::PROVISION_FAILED, format!("FwpmFilterAdd0 失败（{ok:#x}）")));
    }
    close_engine(engine);
    Ok(format!("{account} 出站 BLOCK 已安装（layer ALE_AUTH_CONNECT_V4，persistent）"))
}

/// ALE_USER_ID 出站 BLOCK 过滤器：条件值 = 账户 owner 的自相对 SD
/// （BuildSecurityDescriptorW 构造，codex UserMatchCondition 同构）。
unsafe fn install_filter(engine: HANDLE, account: &str, provider_name: &Vec<u16>) -> u32 {
    let name_wide = wide(account);
    let mut access: EXPLICIT_ACCESS_W = unsafe { std::mem::zeroed() };
    unsafe {
        BuildExplicitAccessWithNameW(
            &mut access,
            name_wide.as_ptr() as *mut u16,
            FWP_ACTRL_MATCH_FILTER,
            GRANT_ACCESS,
            0,
        );
    }
    let mut sd: *mut c_void = std::ptr::null_mut();
    let mut sd_len = 0u32;
    let ok = unsafe {
        BuildSecurityDescriptorW(
            std::ptr::null(),
            std::ptr::null(),
            1,
            &access,
            0,
            std::ptr::null(),
            std::ptr::null_mut(),
            &mut sd_len,
            &mut sd,
        )
    };
    if ok != 0 {
        return ok;
    }
    let blob = FWP_BYTE_BLOB { size: sd_len, data: sd as *mut u8 };
    let conditions = [FWPM_FILTER_CONDITION0 {
        fieldKey: FWPM_CONDITION_ALE_USER_ID,
        matchType: FWP_MATCH_EQUAL,
        conditionValue: FWP_CONDITION_VALUE0 {
            r#type: FWP_SECURITY_DESCRIPTOR_TYPE,
            Anonymous: FWP_CONDITION_VALUE0_0 { sd: &blob as *const FWP_BYTE_BLOB as *mut _ },
        },
    }];
    let filter = FWPM_FILTER0 {
        filterKey: FILTER_KEY,
        displayData: FWPM_DISPLAY_DATA0 {
            name: provider_name.as_ptr() as *mut _,
            description: std::ptr::null_mut(),
        },
        flags: FWPM_FILTER_FLAG_PERSISTENT,
        providerKey: &PROVIDER_KEY as *const _ as *mut _,
        providerData: empty_blob(),
        layerKey: LAYER_ALE_AUTH_CONNECT_V4,
        subLayerKey: SUBLAYER_KEY,
        weight: empty_value(),
        numFilterConditions: conditions.len() as u32,
        filterCondition: conditions.as_ptr() as *mut _,
        action: FWPM_ACTION0 {
            r#type: FWP_ACTION_BLOCK,
            Anonymous: FWPM_ACTION0_0 { filterType: zero_guid() },
        },
        Anonymous: FWPM_FILTER0_0 { rawContext: 0 },
        reserved: std::ptr::null_mut(),
        filterId: 0,
        effectiveWeight: empty_value(),
    };
    let mut filter_id = 0u64;
    let result = unsafe { FwpmFilterAdd0(engine, &filter, std::ptr::null_mut(), &mut filter_id) };
    unsafe { LocalFree(sd as isize) };
    result
}

/// probe：filter 在位性（未装 → Ok(false)；engine 不可达 → 错误说明）。
pub fn probe_network_filter() -> Result<bool> {
    let engine = open_engine()?;
    let mut filter_ptr: *mut FWPM_FILTER0 = std::ptr::null_mut();
    let ok = unsafe { FwpmFilterGetByKey0(engine, &FILTER_KEY, &mut filter_ptr) };
    if !filter_ptr.is_null() {
        // FwpmFilterGetByKey0 返回的 filter 由调用方经 FwpmFreeMemory0 释放。
        unsafe { windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FwpmFreeMemory0(filter_ptr as *mut _) };
    }
    close_engine(engine);
    if ok == 0 {
        return Ok(true);
    }
    if ok == FWP_E_NOT_FOUND {
        return Ok(false);
    }
    Err(HelperError::new(
        super::PROVISION_FAILED,
        format!("FwpmFilterGetByKey0 失败（{ok:#x}）——需要管理员权限或引擎不可达"),
    ))
}
