//! ACL 写授予（D10 grant 三件套，dsh acl.ts grantWrite 语义的 Rust 对应
//! 实现——MIT 语义自研，不摘 TS 代码）。
//!
//! 一次 SetNamedSecurityInfoW 同时应用两半：
//!   - DACL 半（SetEntriesInAclW 合并两条）：capability SID 的写 ACE
//!     （OI|CI 继承，mask = GRANT_MASK）+ Everyone 的 FILE_DELETE_CHILD
//!     deny（仅 CI——FILE_DELETE_CHILD 对文件无意义）；
//!   - SACL 半：Low（S-1-16-4096）no-write-up 强制标签 ACE（OI|CI），
//!     与降级后的 Low 令牌匹配，写检查才放行。
//!
//! 幂等：目录已带**完全一致**的 grant ACE、deny ACE 与 label 时跳过
//! （dsh exact-ACE skip 语义——重复 merge 会让 ACL 无限膨胀）。
//! 并发锁（dsh 的 per-path LockFileEx）不做：helper 单一请求，
//! 并发授予面记 LIMITATIONS（TS 侧串行调用）。
//!
//! windows-sys 0.48 类型约定：HANDLE/HLOCAL = isize（null = 0）、
//! PSID = *mut c_void、PACL = *mut ACL。

use super::err::{HelperError, Result};
use std::ffi::c_void;
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, WIN32_ERROR};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSidToSidW, DENY_ACCESS, EXPLICIT_ACCESS_W, GetNamedSecurityInfoW, GRANT_ACCESS,
    SetEntriesInAclW, SetNamedSecurityInfoW, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    AddMandatoryAce, CreateWellKnownSid, EqualSid, GetLengthSid, InitializeAcl, ACL,
};
use windows_sys::Win32::System::Memory::{LocalAlloc, LocalFree};

// ── 常量（dsh win32-abi.ts 同值）──
/// FILE_GENERIC_WRITE | DELETE | FILE_DELETE_CHILD，去标准写权位（dsh GRANT_MASK）。
pub const GRANT_MASK: u32 = (0x0012_0116u32 | 0x0001_0000u32 | 0x40u32) & !0x0002_0000u32;
pub const FILE_DELETE_CHILD: u32 = 0x0040;
pub const FILE_ALL_ACCESS: u32 = 0x001F_01FF;
pub const SUB_CONTAINERS_AND_OBJECTS_INHERIT: u32 = 0x3;
pub const CONTAINER_INHERIT_ACE: u32 = 0x2;
pub const SYSTEM_MANDATORY_LABEL_ACE_TYPE: u8 = 0x11;
pub const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
pub const ACCESS_DENIED_ACE_TYPE: u8 = 1;
pub const SYSTEM_MANDATORY_LABEL_NO_WRITE_UP: u32 = 0x1;
pub const ACL_REVISION: u32 = 2;
pub const DACL_SECURITY_INFORMATION: u32 = 0x4;
pub const LABEL_SECURITY_INFORMATION: u32 = 0x10;
pub const SE_FILE_OBJECT: i32 = 1;
pub const ERROR_SUCCESS: WIN32_ERROR = 0;
pub const SECURITY_MAX_SID_SIZE: usize = 68;
pub const WIN_WORLD_SID: i32 = 1;
pub const WIN_LOW_LABEL_SID: i32 = 66;
const LPTR: u32 = 0x40;

/// UTF-16 null 结尾（windows-sys 的 PCWSTR）。
pub fn wide(s: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

/// LocalAlloc 出的 SID 守卫（LocalFree 收尾；HLOCAL = isize）。
pub struct OwnedSid(pub isize);
impl OwnedSid {
    /// 作为 PSID 使用。
    pub fn ptr(&self) -> *mut c_void {
        self.0 as *mut c_void
    }
}
impl Drop for OwnedSid {
    fn drop(&mut self) {
        if self.0 != 0 {
            unsafe { LocalFree(self.0) };
        }
    }
}

/// 解析 SDDL 字符串 SID（ConvertStringSidToSidW，LocalAlloc 所有权归守卫）。
pub fn parse_sid(sddl: &str) -> Result<OwnedSid> {
    let wide_sid = wide(sddl);
    let mut sid: *mut c_void = std::ptr::null_mut();
    let ok = unsafe { ConvertStringSidToSidW(wide_sid.as_ptr(), &mut sid) };
    if ok == 0 || sid.is_null() {
        return Err(HelperError::new(
            super::GRANT_FAILED,
            format!("ConvertStringSidToSidW({sddl}) 失败（win32 code {}）", unsafe { GetLastError() }),
        ));
    }
    Ok(OwnedSid(sid as isize))
}

/// 建 well-known SID（栈缓冲拷出 LocalAlloc）。
pub fn well_known_sid(kind: i32) -> Result<OwnedSid> {
    let mut buf = [0u8; SECURITY_MAX_SID_SIZE];
    let mut size = SECURITY_MAX_SID_SIZE as u32;
    let ok = unsafe { CreateWellKnownSid(kind, std::ptr::null_mut(), buf.as_mut_ptr() as *mut c_void, &mut size) };
    if ok == 0 {
        return Err(HelperError::new(
            super::GRANT_FAILED,
            format!("CreateWellKnownSid({kind}) 失败（win32 code {}）", unsafe { GetLastError() }),
        ));
    }
    let alloc = unsafe { LocalAlloc(LPTR, size as usize) };
    if alloc == 0 {
        return Err(HelperError::new(super::GRANT_FAILED, "LocalAlloc(SID) 失败"));
    }
    unsafe { std::ptr::copy_nonoverlapping(buf.as_ptr(), alloc as *mut u8, size as usize) };
    Ok(OwnedSid(alloc))
}

/// 目录是否已带**完全一致**的 ACE（type/flags/mask/SID 逐项比对；
/// SID 内联在 ACE 的 offset 8 起，EqualSid 比对）。
fn has_exact_ace(acl: *const ACL, ace_type: u8, flags: u8, mask: u32, sid: *mut c_void) -> bool {
    if acl.is_null() {
        return false;
    }
    let base = acl as *const u8;
    // ACL 头：AclRevision@0, Sbz1@1, AclSize@2(u16), AceCount@4(u16)。
    let acl_size = unsafe { std::ptr::read(base.add(2) as *const u16) } as usize;
    let ace_count = unsafe { std::ptr::read(base.add(4) as *const u16) } as usize;
    if acl_size < 8 || acl_size > 1_048_576 {
        return false;
    }
    let mut offset = 8usize;
    for _ in 0..ace_count {
        let ace_type_at = unsafe { std::ptr::read(base.add(offset)) };
        let ace_size = unsafe { std::ptr::read(base.add(offset + 2) as *const u16) } as usize;
        if ace_size < 8 || offset + ace_size > acl_size {
            return false;
        }
        let ace_mask = unsafe { std::ptr::read(base.add(offset + 4) as *const u32) };
        let flags_at = unsafe { std::ptr::read(base.add(offset + 1)) };
        if ace_type_at == ace_type && flags_at == flags && ace_mask == mask {
            let ace_sid = unsafe { base.add(offset + 8) } as *mut c_void;
            if unsafe { EqualSid(ace_sid, sid) } != 0 {
                return true;
            }
        }
        offset += ace_size;
    }
    false
}

/// 当前 DACL/SACL（指针在 security descriptor 分配块内部——只 free 描述符，
/// 绝不单独 free ACL，dsh 分配契约）。
struct CurrentSecurity {
    dacl: *mut ACL,
    label: *mut ACL,
    descriptor: *mut c_void,
}

impl Drop for CurrentSecurity {
    fn drop(&mut self) {
        if !self.descriptor.is_null() {
            unsafe { LocalFree(self.descriptor as isize) };
        }
    }
}

fn read_current_security(path: &str) -> Result<CurrentSecurity> {
    let wide_path = wide(path);
    let mut owner: *mut c_void = std::ptr::null_mut();
    let mut group: *mut c_void = std::ptr::null_mut();
    let mut dacl: *mut ACL = std::ptr::null_mut();
    let mut label: *mut ACL = std::ptr::null_mut();
    let mut descriptor: *mut c_void = std::ptr::null_mut();
    let result = unsafe {
        GetNamedSecurityInfoW(
            wide_path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION,
            &mut owner,
            &mut group,
            &mut dacl,
            &mut label,
            &mut descriptor,
        )
    };
    if result != ERROR_SUCCESS {
        return Err(HelperError::new(
            super::GRANT_FAILED,
            format!("GetNamedSecurityInfoW({path}) 失败（win32 code {result}）"),
        ));
    }
    Ok(CurrentSecurity { dacl, label, descriptor })
}

/// 构造 Low no-write-up 强制标签 ACL（InitializeAcl + AddMandatoryAce）。
fn build_low_label_acl(low_label_sid: *mut c_void) -> Result<*mut ACL> {
    let sid_len = unsafe { GetLengthSid(low_label_sid) } as usize;
    let acl_len = (8 + 8 + sid_len) as u32; // ACL 头 + MANDATORY_ACE 头 + SID
    let acl = unsafe { LocalAlloc(LPTR, acl_len as usize) };
    if acl == 0 {
        return Err(HelperError::new(super::GRANT_FAILED, "LocalAlloc(label ACL) 失败"));
    }
    let acl = acl as *mut ACL;
    if unsafe { InitializeAcl(acl, acl_len, ACL_REVISION) } == 0 {
        unsafe { LocalFree(acl as isize) };
        return Err(HelperError::new(super::GRANT_FAILED, "InitializeAcl(label) 失败"));
    }
    if unsafe {
        AddMandatoryAce(
            acl,
            ACL_REVISION,
            SUB_CONTAINERS_AND_OBJECTS_INHERIT,
            SYSTEM_MANDATORY_LABEL_NO_WRITE_UP,
            low_label_sid,
        )
    } == 0
    {
        unsafe { LocalFree(acl as isize) };
        return Err(HelperError::new(super::GRANT_FAILED, "AddMandatoryAce 失败"));
    }
    Ok(acl)
}

fn trustee_sid(sid: *mut c_void) -> TRUSTEE_W {
    TRUSTEE_W {
        pMultipleTrustee: std::ptr::null_mut(),
        MultipleTrusteeOperation: 0,
        TrusteeForm: TRUSTEE_IS_SID,
        TrusteeType: TRUSTEE_IS_UNKNOWN,
        // TRUSTEE_IS_SID 时 ptstrName 装 SID 指针（PWSTR 类型位）。
        ptstrName: sid as *mut u16,
    }
}

/// grant 三件套：写 ACE + Everyone 的 FILE_DELETE_CHILD deny + Low 标签。
/// 幂等（exact 三件齐则跳过）；任何失败在返回前发生——绝不带半态授予。
pub fn grant_write(path: &str, sid_sddl: &str) -> Result<()> {
    let sid = parse_sid(sid_sddl)?;
    let world = well_known_sid(WIN_WORLD_SID)?;
    let low = well_known_sid(WIN_LOW_LABEL_SID)?;
    let current = read_current_security(path)?;

    if !current.dacl.is_null()
        && !current.label.is_null()
        && has_exact_ace(current.dacl, ACCESS_ALLOWED_ACE_TYPE, SUB_CONTAINERS_AND_OBJECTS_INHERIT as u8, GRANT_MASK, sid.ptr())
        && has_exact_ace(current.dacl, ACCESS_DENIED_ACE_TYPE, CONTAINER_INHERIT_ACE as u8, FILE_DELETE_CHILD, world.ptr())
        && has_exact_ace(current.label, SYSTEM_MANDATORY_LABEL_ACE_TYPE, SUB_CONTAINERS_AND_OBJECTS_INHERIT as u8, SYSTEM_MANDATORY_LABEL_NO_WRITE_UP, low.ptr())
    {
        // exact 三件已standing，跳过（防 ACL 膨胀）。
        return Ok(());
    }

    let entries = [
        EXPLICIT_ACCESS_W {
            grfAccessPermissions: FILE_DELETE_CHILD,
            grfAccessMode: DENY_ACCESS,
            grfInheritance: CONTAINER_INHERIT_ACE,
            Trustee: trustee_sid(world.ptr()),
        },
        EXPLICIT_ACCESS_W {
            grfAccessPermissions: GRANT_MASK,
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: SUB_CONTAINERS_AND_OBJECTS_INHERIT,
            Trustee: trustee_sid(sid.ptr()),
        },
    ];
    let mut merged: *mut ACL = std::ptr::null_mut();
    let merge_result = unsafe { SetEntriesInAclW(entries.len() as u32, entries.as_ptr(), current.dacl, &mut merged) };
    if merge_result != ERROR_SUCCESS {
        return Err(HelperError::new(
            super::GRANT_FAILED,
            format!("SetEntriesInAclW({path}) 失败（win32 code {merge_result}）"),
        ));
    }
    let label_acl = build_low_label_acl(low.ptr())?;
    // 描述符块（旧 DACL 在其中）在合并后已死——先 free 再 apply（dsh 同序）。
    drop(current);
    let wide_path = wide(path);
    let apply_result = unsafe {
        SetNamedSecurityInfoW(
            wide_path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            merged,
            label_acl,
        )
    };
    unsafe { LocalFree(merged as isize) };
    unsafe { LocalFree(label_acl as isize) };
    if apply_result != ERROR_SUCCESS {
        return Err(HelperError::new(
            super::GRANT_FAILED,
            format!("SetNamedSecurityInfoW({path}) 失败（win32 code {apply_result}）"),
        ));
    }
    Ok(())
}

/// CloseHandle 的 isize 便捷封装（HANDLE null = 0，关 0 跳过）。
pub(crate) fn close_handle(handle: isize) {
    if handle != 0 {
        unsafe { CloseHandle(handle) };
    }
}
