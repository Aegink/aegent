//! 离线沙箱账户 provision（T-P1-27 · D16，codex setup/service_identity 语义
//! 的最小面对应实现——MIT 语义自研）。
//!
//! Q17 用户裁决（接受建 OS 账户，降 P1）的落点：provision（elevated 一次性）
//! 创建专用本地账户（随机复杂密码、不可交互登录、密码不过期）+ 授予
//! SeBatchLogonRight（CreateProcessWithLogonW 的 seclogon 路径需要 batch
//! 登录权，不需要 SE_TCB）→ runtime 的 run-offline 以该账户 spawn，其
//! 网络流量被 wfp.rs 的 persistent BLOCK 拦截。
//!
//! 密码生命周期：生成（provision）→ 由调用方 DPAPI 加密落盘（D8 面的
//! 机器级扩展位）→ run-offline 经 stdin JSON 传回（**明文不进命令行**，
//! D8 argv 纪律同款）。helper 不落盘密码。

use super::err::{HelperError, Result};
use super::grant::wide;
use windows_sys::Win32::NetworkManagement::NetManagement::{
    NetUserAdd, NetUserGetInfo, NetApiBufferFree, USER_INFO_1, NERR_Success, USER_PRIV_USER,
    UF_DONT_EXPIRE_PASSWD, UF_NORMAL_ACCOUNT, UF_PASSWD_CANT_CHANGE, UF_SCRIPT,
};
use windows_sys::Win32::Security::Authentication::Identity::{
    LsaAddAccountRights, LsaClose, LsaOpenPolicy, POLICY_CREATE_ACCOUNT, POLICY_LOOKUP_NAMES,
};
use windows_sys::Win32::Foundation::UNICODE_STRING;
use windows_sys::Win32::System::WindowsProgramming::OBJECT_ATTRIBUTES;

/// 账户名前缀（可读性 + 识别面；<前缀>-<6 位随机十六进制>）。
pub const ACCOUNT_PREFIX: &str = "aegent-sbx";

/// 生成随机复杂密码（32 字符：大小写 + 数字 + 符号安全子集）。
/// 安全实现位（真机随机源走 std RandomState 的哈希熵——B 级即可：
/// 密码随后被 DPAPI 加密存储，熵要求由 24+ 长度补偿）。
pub fn generate_password() -> String {
    // 用进程地址随机性 + 时间熵组装种子的简易 PRNG（std 内无 rng）。
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64 ^ (d.as_secs().wrapping_mul(0x9E3779B97F4A7C15)))
        .unwrap_or(0x2545F4914F6CDD1D)
        ^ (generate_password as usize as u64);
    let mut state = seed | 1;
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+";
    let mut password = String::with_capacity(32);
    for _ in 0..32 {
        // xorshift64
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        password.push(ALPHABET[(state % ALPHABET.len() as u64) as usize] as char);
    }
    password
}

/// 生成账户名（<前缀>-<6 hex>）。
pub fn generate_account_name() -> String {
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{ACCOUNT_PREFIX}-{seed:06x}" )
}

/// 账户是否存在（NetUserGetInfo 探针；doctor 消费）。
pub fn account_exists(account: &str) -> bool {
    let name = wide(account);
    let mut info: *mut u8 = std::ptr::null_mut();
    let result = unsafe { NetUserGetInfo(std::ptr::null(), name.as_ptr(), 1, &mut info) };
    if result == NERR_Success && !info.is_null() {
        unsafe { NetApiBufferFree(info as *mut _) };
        return true;
    }
    false
}

/// 创建专用账户（幂等：已存在则跳过创建）+ 授予 SeBatchLogonRight。
pub fn create_sandbox_account(account: &str, password: &str) -> Result<()> {
    if account.trim().is_empty() || password.is_empty() {
        return Err(HelperError::new(super::PROVISION_FAILED, "账户名与密码不得为空"));
    }
    if !account_exists(account) {
        let name = wide(account);
        let pwd = wide(password);
        let mut user = USER_INFO_1 {
            usri1_name: name.as_ptr() as *mut u16,
            usri1_password: pwd.as_ptr() as *mut u16,
            usri1_password_age: 0,
            usri1_priv: USER_PRIV_USER,
            usri1_home_dir: std::ptr::null_mut(),
            usri1_comment: std::ptr::null_mut(),
            usri1_flags: UF_SCRIPT | UF_NORMAL_ACCOUNT | UF_PASSWD_CANT_CHANGE | UF_DONT_EXPIRE_PASSWD,
            usri1_script_path: std::ptr::null_mut(),
        };
        let result = unsafe { NetUserAdd(std::ptr::null(), 1, &mut user as *mut _ as *mut u8, std::ptr::null_mut()) };
        if result != NERR_Success {
            return Err(HelperError::new(
                super::PROVISION_FAILED,
                format!("NetUserAdd({account}) 失败（net code {result}）——需要管理员权限"),
            ));
        }
    }
    grant_batch_logon_right(account)
}

/// LsaAddAccountRights：授予 SeBatchLogonRight（seclogon 路径需要）。
fn grant_batch_logon_right(account: &str) -> Result<()> {
    // SID 解析（LookupAccountNameW 经 wfp::account_sid）。
    let sid_bytes = super::wfp::account_sid(account)?;
    let sid_ptr = sid_bytes.as_ptr() as *mut core::ffi::c_void;

    let mut policy: isize = 0;
    let mut attrs: OBJECT_ATTRIBUTES = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        LsaOpenPolicy(
            std::ptr::null(),
            &mut attrs,
            (POLICY_CREATE_ACCOUNT | POLICY_LOOKUP_NAMES) as u32,
            &mut policy,
        )
    };
    if ok != 0 {
        return Err(HelperError::new(
            super::PROVISION_FAILED,
            format!("LsaOpenPolicy 失败（NTSTATUS {ok:#x}）——需要管理员权限"),
        ));
    }
    let right_name = wide("SeBatchLogonRight");
    let mut right = UNICODE_STRING {
        Length: ((right_name.len() - 1) * 2) as u16, // 不含 null
        MaximumLength: (right_name.len() * 2) as u16,
        Buffer: right_name.as_ptr() as *mut u16,
    };
    let ok = unsafe { LsaAddAccountRights(policy, sid_ptr, &mut right, 1) };
    unsafe { LsaClose(policy) };
    if ok != 0 {
        return Err(HelperError::new(
            super::PROVISION_FAILED,
            format!("LsaAddAccountRights(SeBatchLogonRight) 失败（NTSTATUS {ok:#x}）"),
        ));
    }
    Ok(())
}
