//! helper 机制测试（cargo test）：Job 标志位机制面（D13）。
//!
//! 覆盖点：kill-on-close Job 构造后 LimitFlags 如实可查（防标志拼错/
//! 结构体布局错）——后代 breakaway disallow 与 KILL_ON_JOB_CLOSE 是
//! "活过父进程仍被管住"的机制前提。

#![cfg(windows)]

use windows_sys::Win32::System::JobObjects::{
    CreateJobObjectW, QueryInformationJobObject, SetInformationJobObject,
    JOBOBJECTINFOCLASS, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

#[test]
fn kill_on_close_job_limit_flags_roundtrip() {
    let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    assert_ne!(job, 0, "CreateJobObjectW 失败");
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let ok = unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation as JOBOBJECTINFOCLASS,
            &mut limits as *mut _ as *mut core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    assert_ne!(ok, 0, "SetInformationJobObject 失败");

    let mut readback: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        QueryInformationJobObject(
            job,
            JobObjectExtendedLimitInformation as JOBOBJECTINFOCLASS,
            &mut readback as *mut _ as *mut core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            std::ptr::null_mut(),
        )
    };
    assert_ne!(ok, 0, "QueryInformationJobObject 失败");
    // kill-on-close 在位；breakaway 两个标志位**不在**（disallow breakaway）。
    assert_eq!(readback.BasicLimitInformation.LimitFlags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE);
    const BREAKAWAY_OK: u32 = 0x0800;
    const SILENT_BREAKAWAY_OK: u32 = 0x1000;
    assert_eq!(readback.BasicLimitInformation.LimitFlags & BREAKAWAY_OK, 0);
    assert_eq!(readback.BasicLimitInformation.LimitFlags & SILENT_BREAKAWAY_OK, 0);
    unsafe { windows_sys::Win32::Foundation::CloseHandle(job) };
}
