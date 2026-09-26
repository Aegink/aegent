//! 受限令牌构造（D6，dsh token.ts 语义的 Rust 对应实现——MIT 语义自研）。
//!
//! CreateRestrictedToken(DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED)
//! 不禁用任何 SID、不删任何特权，只加 restricting 清单（mode 决定）：
//!   - read-only：       [logon SID, Everyone]
//!   - workspace-write： [logon SID, Everyone, workspace SID, temp SID?]
//! WRITE_RESTRICTED 使受限检查（pass-2）只对**写**访问生效：读不受限；
//! 写 = 正常检查 && restricting 清单内的 SID 有 allow ACE。
//!
//! 两件收尾（全部 fail-closed，任何失败都在 spawn 前抛出）：
//!   1. 默认 DACL 合并 restricting 写 SID 的 FILE_ALL_ACCESS ACE——受限令牌
//!      新建对象（匿名管道等）的 DACL 不含 restricting SID，pass-2 会在
//!      对象创建时拒绝（孙进程 spawn EPERM）；read-only 下用 Everyone。
//!   2. 完整性降到 Low（S-1-16-4096）——与目录授予的 Low 标签匹配。
//!
//! windows-sys 0.48 类型约定：HANDLE = isize（null = 0）、PSID = *mut c_void。

use super::err::{HelperError, Result};
use super::grant::{parse_sid, well_known_sid, OwnedSid, FILE_ALL_ACCESS, WIN_LOW_LABEL_SID, WIN_WORLD_SID};
use std::ffi::c_void;
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError};
use windows_sys::Win32::Security::Authorization::{EXPLICIT_ACCESS_W, SetEntriesInAclW, TRUSTEE_W};
use windows_sys::Win32::Security::{
    CopySid, CreateRestrictedToken, GetLengthSid, GetTokenInformation, SetTokenInformation,
    SID_AND_ATTRIBUTES, TOKEN_DEFAULT_DACL, TOKEN_MANDATORY_LABEL,
};
use windows_sys::Win32::System::Memory::{LocalAlloc, LocalFree};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

pub const DISABLE_MAX_PRIVILEGE: u32 = 0x1;
pub const LUA_TOKEN: u32 = 0x4;
pub const WRITE_RESTRICTED: u32 = 0x8;
pub const TOKEN_QUERY: u32 = 0x0008;
pub const TOKEN_DUPLICATE: u32 = 0x0002;
pub const TOKEN_ADJUST_DEFAULT: u32 = 0x0080;
pub const TOKEN_ASSIGN_PRIMARY: u32 = 0x0001;
pub const SE_GROUP_LOGON_ID: u32 = 0xC000_0000;
pub const SE_GROUP_INTEGRITY: u32 = 0x0000_0020;
/// TOKEN_INFORMATION_CLASS 值：TokenGroups=2、TokenDefaultDacl=6、TokenIntegrityLevel=25。
pub const TOKEN_GROUPS_CLASS: i32 = 2;
pub const TOKEN_DEFAULT_DACL_CLASS: i32 = 6;
pub const TOKEN_INTEGRITY_LEVEL_CLASS: i32 = 25;
const LPTR: u32 = 0x40;

fn win32_fail(api: &str) -> HelperError {
    HelperError::new(super::TOKEN_FAILED, format!("{api} 失败（win32 code {}）", unsafe { GetLastError() }))
}

/// 打开当前进程令牌（GetCurrentProcess 伪句柄即可）。
fn open_current_process_token() -> Result<isize> {
    let process = unsafe { GetCurrentProcess() };
    let mut token: isize = 0;
    let ok = unsafe {
        OpenProcessToken(
            process,
            TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ADJUST_DEFAULT | TOKEN_ASSIGN_PRIMARY,
            &mut token,
        )
    };
    if ok == 0 || token == 0 {
        return Err(win32_fail("OpenProcessToken"));
    }
    Ok(token)
}

/// 找 logon SID（TokenGroups 里 SE_GROUP_LOGON_ID 属性者，S-1-5-5-x-y）。
fn find_logon_sid(token: isize) -> Result<OwnedSid> {
    let mut needed: u32 = 0;
    // 第一次调用按预期失败（ERROR_INSUFFICIENT_BUFFER）拿所需大小。
    unsafe {
        GetTokenInformation(token, TOKEN_GROUPS_CLASS, std::ptr::null_mut(), 0, &mut needed);
    }
    if needed == 0 {
        return Err(win32_fail("GetTokenInformation(TokenGroups) size"));
    }
    let mut buf = vec![0u8; needed as usize];
    let ok = unsafe {
        GetTokenInformation(token, TOKEN_GROUPS_CLASS, buf.as_mut_ptr() as *mut c_void, needed, &mut needed)
    };
    if ok == 0 {
        return Err(win32_fail("GetTokenInformation(TokenGroups)"));
    }
    // TOKEN_GROUPS { GroupCount: u32; _pad: u32; Groups: [SID_AND_ATTRIBUTES; N] }：
    // GroupCount 后有 4 字节 padding（PSID 8 字节对齐），Groups 从 offset 8 起；
    // SID_AND_ATTRIBUTES 16 字节（指针 8 + u32 4 + padding 4）。
    let count = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    let stride = 16usize;
    for index in 0..count {
        let offset = 8 + index * stride;
        if offset + stride > buf.len() {
            break;
        }
        let sid_ptr = usize::from_le_bytes(buf[offset..offset + 8].try_into().unwrap()) as *mut c_void;
        let attributes = u32::from_le_bytes(buf[offset + 8..offset + 12].try_into().unwrap());
        if sid_ptr.is_null() || attributes & SE_GROUP_LOGON_ID != SE_GROUP_LOGON_ID {
            continue;
        }
        let length = unsafe { GetLengthSid(sid_ptr) } as usize;
        let copy = unsafe { LocalAlloc(LPTR, length) };
        if copy == 0 {
            return Err(HelperError::new(super::TOKEN_FAILED, "LocalAlloc(logon SID) 失败"));
        }
        unsafe { CopySid(length as u32, copy as *mut c_void, sid_ptr) };
        return Ok(OwnedSid(copy));
    }
    Err(HelperError::new(super::TOKEN_FAILED, format!("令牌 {count} 个组里没有 logon SID")))
}

/// 默认 DACL 合并一条 FILE_ALL_ACCESS ACE（restricting 写 SID）。
fn set_default_dacl_grant(token: isize, sid: *mut c_void) -> Result<()> {
    let mut needed: u32 = 0;
    unsafe {
        GetTokenInformation(token, TOKEN_DEFAULT_DACL_CLASS, std::ptr::null_mut(), 0, &mut needed);
    }
    if needed == 0 {
        return Err(win32_fail("GetTokenInformation(TokenDefaultDacl) size"));
    }
    let mut buf = vec![0u8; needed as usize];
    let ok = unsafe {
        GetTokenInformation(token, TOKEN_DEFAULT_DACL_CLASS, buf.as_mut_ptr() as *mut c_void, needed, &mut needed)
    };
    if ok == 0 {
        return Err(win32_fail("GetTokenInformation(TokenDefaultDacl)"));
    }
    // TOKEN_DEFAULT_DACL { DefaultDacl: PACL }——结构体就是那个指针。
    let current_dacl =
        usize::from_le_bytes(buf[0..8].try_into().unwrap()) as *mut windows_sys::Win32::Security::ACL;
    if current_dacl.is_null() {
        return Err(HelperError::new(super::TOKEN_FAILED, "令牌没有默认 DACL 可扩展"));
    }
    let entry = EXPLICIT_ACCESS_W {
        grfAccessPermissions: FILE_ALL_ACCESS,
        grfAccessMode: 1, // GRANT_ACCESS
        grfInheritance: 0x3,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: std::ptr::null_mut(),
            MultipleTrusteeOperation: 0,
            TrusteeForm: 0, // TRUSTEE_IS_SID
            TrusteeType: 0, // TRUSTEE_IS_UNKNOWN
            // TRUSTEE_IS_SID 时 ptstrName 装 SID 指针（PWSTR 类型位）。
            ptstrName: sid as *mut u16,
        },
    };
    let mut merged: *mut windows_sys::Win32::Security::ACL = std::ptr::null_mut();
    let result = unsafe { SetEntriesInAclW(1, &entry, current_dacl, &mut merged) };
    if result != 0 {
        return Err(HelperError::new(
            super::TOKEN_FAILED,
            format!("SetEntriesInAclW(default DACL) 失败（win32 code {result}）"),
        ));
    }
    let info = TOKEN_DEFAULT_DACL { DefaultDacl: merged };
    let info_bytes = unsafe {
        std::slice::from_raw_parts(
            &info as *const TOKEN_DEFAULT_DACL as *const u8,
            std::mem::size_of::<TOKEN_DEFAULT_DACL>(),
        )
    };
    let ok = unsafe {
        SetTokenInformation(token, TOKEN_DEFAULT_DACL_CLASS, info_bytes.as_ptr() as *const c_void, info_bytes.len() as u32)
    };
    unsafe { LocalFree(merged as isize) };
    if ok == 0 {
        return Err(win32_fail("SetTokenInformation(TokenDefaultDacl)"));
    }
    Ok(())
}

/// 完整性降到 Low（S-1-16-4096）。
fn restrict_integrity(token: isize, low_sid: *mut c_void) -> Result<()> {
    let label = TOKEN_MANDATORY_LABEL {
        Label: SID_AND_ATTRIBUTES { Sid: low_sid, Attributes: SE_GROUP_INTEGRITY },
    };
    let bytes = unsafe {
        std::slice::from_raw_parts(
            &label as *const TOKEN_MANDATORY_LABEL as *const u8,
            std::mem::size_of::<TOKEN_MANDATORY_LABEL>(),
        )
    };
    let ok = unsafe {
        SetTokenInformation(token, TOKEN_INTEGRITY_LEVEL_CLASS, bytes.as_ptr() as *const c_void, bytes.len() as u32)
    };
    if ok == 0 {
        return Err(win32_fail("SetTokenInformation(TokenIntegrityLevel)"));
    }
    Ok(())
}

/// 构造 mode 选型的写受限令牌（主流程入口）。
///
/// 返回的令牌句柄所有权归调用方（CloseHandle 收尾）。
pub fn create_write_restricted(
    mode: super::Mode,
    workspace_sid_sddl: &str,
    temp_sid_sddl: Option<&str>,
) -> Result<isize> {
    let token = open_current_process_token()?;
    let logon = find_logon_sid(token)?;
    let world = well_known_sid(WIN_WORLD_SID)?;
    let low = well_known_sid(WIN_LOW_LABEL_SID)?;

    // restricting 清单按 mode 组装（dsh createRestrictedToken 语义）。
    // read-only：写 SID 清单为空——standing 的旧 grant ACE 因此保持惰性
    // （pass-2 只认清单内 SID）。
    let mut write_sids: Vec<OwnedSid> = Vec::new();
    if mode == super::Mode::WorkspaceWrite {
        write_sids.push(parse_sid(workspace_sid_sddl)?);
        if let Some(s) = temp_sid_sddl {
            write_sids.push(parse_sid(s)?);
        }
    }
    let mut restricting: Vec<SID_AND_ATTRIBUTES> = vec![
        SID_AND_ATTRIBUTES { Sid: logon.ptr(), Attributes: 0 },
        SID_AND_ATTRIBUTES { Sid: world.ptr(), Attributes: 0 },
    ];
    for s in &write_sids {
        restricting.push(SID_AND_ATTRIBUTES { Sid: s.ptr(), Attributes: 0 });
    }

    let mut new_token: isize = 0;
    let ok = unsafe {
        CreateRestrictedToken(
            token,
            DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED,
            0,
            std::ptr::null(),
            0,
            std::ptr::null(),
            restricting.len() as u32,
            restricting.as_ptr(),
            &mut new_token,
        )
    };
    if ok == 0 || new_token == 0 {
        return Err(win32_fail("CreateRestrictedToken"));
    }

    // 收尾两件（默认 DACL + Low 完整性）；失败即销毁令牌报错——绝不
    // 带着未降级/默认 DACL 缺失的令牌 spawn。
    let default_grant_sid: *mut c_void = if let Some(first) = write_sids.first() {
        first.ptr()
    } else {
        world.ptr()
    };
    if let Err(e) = set_default_dacl_grant(new_token, default_grant_sid) {
        unsafe { CloseHandle(new_token) };
        return Err(e);
    }
    if let Err(e) = restrict_integrity(new_token, low.ptr()) {
        unsafe { CloseHandle(new_token) };
        return Err(e);
    }
    Ok(new_token)
}
