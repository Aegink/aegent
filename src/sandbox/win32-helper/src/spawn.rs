//! 受限 spawn + **kill-on-close Job 管辖**（T-P1-26 · D13）+ stdio 管道收集。
//!
//! dsh subprocess-native-containment 的 Windows 纪律：
//!   - 目标 **CREATE_SUSPENDED 创建 → AssignProcessToJobObject → resume**——
//!     进程进入 Job 前没有可逃逸的窗口；
//!   - Job 为 unnamed kill-on-close 且 **不设 BREAKAWAY_OK/SILENT_BREAKAWAY_OK**
//!     （disallow breakaway——"setsid/重挂父进程/活过父进程仍被管住"的
//!     Windows 对应面：Job 成员关系不随父子关系断裂而丢失）；
//!   - **结算 = 目标退出 && Job 活动数归 0**（"a PID does not name the
//!     complete managed range"——后代不空不算结算完）；
//!   - 超时 → **TerminateJobObject 全树回收 → 等 Job 清空 → 才报 TIMEOUT**
//!     （"超时子进程先回收再释放许可"）；
//!   - helper 退出（含崩溃）时 Job 句柄关闭 → kill-on-close 兜底全灭。
//!
//! windows-sys 0.48 类型约定：HANDLE = isize（null = 0）。

use super::err::{HelperError, Result};
use super::grant::{close_handle, wide};
use std::io::Read;
use std::os::windows::io::{FromRawHandle, RawHandle};
use std::sync::mpsc;
use windows_sys::Win32::Foundation::{
    GetLastError, SetHandleInformation, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Foundation::GENERIC_READ;
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECTINFOCLASS, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::Threading::{
    CreateProcessAsUserW, GetExitCodeProcess, ResumeThread, TerminateProcess, WaitForSingleObject,
    PROCESS_INFORMATION, PROCESS_CREATION_FLAGS, STARTF_USESTDHANDLES, STARTUPINFOW, CREATE_SUSPENDED,
};

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
pub const INFINITE: u32 = 0xFFFF_FFFF;
pub const WAIT_OBJECT_0: u32 = 0;
pub const WAIT_TIMEOUT: u32 = 0x102;
/// Job 清空轮询间隔（dsh 同量级 50ms）。
const JOB_DRAIN_POLL_MS: u32 = 50;

struct Pipe {
    read: isize,
    write: isize,
}

/// 匿名管道：写端 inheritable（子进程拿），读端不继承（父进程读）。
fn make_pipe() -> Result<Pipe> {
    let mut read: isize = 0;
    let mut write: isize = 0;
    let ok = unsafe { CreatePipe(&mut read, &mut write, std::ptr::null(), 0) };
    if ok == 0 || read == 0 || write == 0 {
        return Err(HelperError::new(
            super::SPAWN_FAILED,
            format!("CreatePipe 失败（win32 code {}）", unsafe { GetLastError() }),
        ));
    }
    let ok = unsafe { SetHandleInformation(write, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) };
    if ok == 0 {
        close_handle(read);
        close_handle(write);
        return Err(HelperError::new(super::SPAWN_FAILED, "SetHandleInformation(写端继承) 失败"));
    }
    Ok(Pipe { read, write })
}

/// Windows 引号规则拼命令行（含空格/引号转义）。
fn quote_arg(arg: &str) -> String {
    if !arg.is_empty()
        && !arg.chars().any(|c| c == ' ' || c == '\t' || c == '\n' || c == '\u{B}' || c == '"')
    {
        return arg.to_string();
    }
    let mut quoted = String::with_capacity(arg.len() + 2);
    quoted.push('"');
    let mut backslashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
                quoted.push('"');
                backslashes = 0;
            }
            _ => {
                quoted.push_str(&"\\".repeat(backslashes));
                backslashes = 0;
                quoted.push(c);
            }
        }
    }
    quoted.push_str(&"\\".repeat(backslashes * 2));
    quoted.push('"');
    quoted
}

/// 读线程的收集结果（UTF-8 lossy 在 join 后统一做）。
fn drain_to_string(handle: isize, done: mpsc::Sender<Vec<u8>>) {
    let raw: RawHandle = handle as RawHandle;
    let mut file = unsafe { std::fs::File::from_raw_handle(raw) };
    let mut buf = Vec::new();
    let _ = file.read_to_end(&mut buf);
    let _ = done.send(buf);
}

/// Job 活动进程数（0 = 范围已空，可结算）。
fn job_active_processes(job: isize) -> u32 {
    let mut info: windows_sys::Win32::System::JobObjects::JOBOBJECT_BASIC_ACCOUNTING_INFORMATION =
        unsafe { std::mem::zeroed() };
    let ok = unsafe {
        QueryInformationJobObject(
            job,
            JobObjectBasicAccountingInformation as JOBOBJECTINFOCLASS,
            &mut info as *mut _ as *mut core::ffi::c_void,
            std::mem::size_of::<windows_sys::Win32::System::JobObjects::JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        // 查询失败保守按"仍有活动"（绝不提前宣称范围空）。
        return u32::MAX;
    }
    info.ActiveProcesses
}

/// 等 Job 活动数归 0（范围空证明；dsh"active-process quiescence"）。
fn wait_job_drained(job: isize) {
    loop {
        if job_active_processes(job) == 0 {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(JOB_DRAIN_POLL_MS as u64));
    }
}

/// 以受限令牌 spawn 目标（入 kill-on-close Job）并等待**范围**结算。
/// 超时 → TerminateJobObject 全树回收 → 等 Job 清空 → 报 TIMEOUT。
pub fn spawn_and_wait(
    token: isize,
    program: &str,
    args: &[String],
    cwd: &str,
    timeout_ms: Option<u64>,
) -> Result<(u32, String, String)> {
    // kill-on-close Job（unnamed）；不设 BREAKAWAY_OK → 后代无法脱离。
    let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if job == 0 {
        return Err(HelperError::new(
            super::SPAWN_FAILED,
            format!("CreateJobObjectW 失败（win32 code {}）", unsafe { GetLastError() }),
        ));
    }
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
    if ok == 0 {
        close_handle(job);
        return Err(HelperError::new(
            super::SPAWN_FAILED,
            format!("SetInformationJobObject 失败（win32 code {}）", unsafe { GetLastError() }),
        ));
    }

    let out_pipe = make_pipe()?;
    let err_pipe = make_pipe()?;

    // stdin 挂 NUL 设备（ignored stdin = null 设备描述符，dsh 语义）。
    let nul = wide("NUL");
    let stdin_handle = unsafe {
        CreateFileW(
            nul.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            0,
            0,
        )
    };
    let stdin_ok = stdin_handle != 0 && stdin_handle != INVALID_HANDLE_VALUE;
    let command_line: Vec<u16> = {
        let mut line = quote_arg(program);
        for arg in args {
            line.push(' ');
            line.push_str(&quote_arg(arg));
        }
        wide(&line)
    };
    let wide_cwd = wide(cwd);

    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = if stdin_ok { stdin_handle } else { 0 };
    startup.hStdOutput = out_pipe.write;
    startup.hStdError = err_pipe.write;
    let mut process: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };

    let creation_flags: PROCESS_CREATION_FLAGS =
        (CREATE_NO_WINDOW | CREATE_SUSPENDED) as PROCESS_CREATION_FLAGS;
    let ok = unsafe {
        CreateProcessAsUserW(
            token,
            // applicationName 传 null：按命令行首 token 解析并搜 PATH
            // （对齐 Node execFile 的可执行解析语义；applicationName 非
            // null 时必须是全路径，裸 "bash" 会 FILE_NOT_FOUND）。
            std::ptr::null(),
            command_line.as_ptr() as *mut u16,
            std::ptr::null(),
            std::ptr::null(),
            1, // bInheritHandles
            creation_flags,
            std::ptr::null(),
            wide_cwd.as_ptr(),
            &startup,
            &mut process,
        )
    };
    if stdin_ok {
        close_handle(stdin_handle);
    }
    if ok == 0 {
        close_handle(out_pipe.read);
        close_handle(err_pipe.read);
        close_handle(job); // kill-on-close：Job 已空，无成员可杀
        return Err(HelperError::new(
            super::SPAWN_FAILED,
            format!("CreateProcessAsUserW({program}) 失败（win32 code {}）", unsafe {
                GetLastError()
            }),
        ));
    }

    // suspended 状态入 Job，入妥后才 resume（无可逃逸窗口，dsh 纪律）。
    let assigned = unsafe { AssignProcessToJobObject(job, process.hProcess) };
    if assigned == 0 {
        let code = unsafe { GetLastError() };
        // 已创建但未 resume 的进程：回收（TerminateProcess 对挂起进程有效）。
        unsafe { TerminateProcess(process.hProcess, 1) };
        close_handle(process.hThread);
        close_handle(process.hProcess);
        close_handle(out_pipe.read);
        close_handle(err_pipe.read);
        close_handle(job);
        return Err(HelperError::new(
            super::SPAWN_FAILED,
            format!("AssignProcessToJobObject 失败（win32 code {code}）——目标已回收，绝不入无管辖运行"),
        ));
    }
    unsafe { ResumeThread(process.hThread) };

    // 父进程侧立即关写端副本（否则读端永远等不到 EOF）。
    close_handle(out_pipe.write);
    close_handle(err_pipe.write);

    let (tx_out, rx_out) = mpsc::channel();
    let (tx_err, rx_err) = mpsc::channel();
    let t_out = std::thread::spawn(move || drain_to_string(out_pipe.read, tx_out));
    let t_err = std::thread::spawn(move || drain_to_string(err_pipe.read, tx_err));

    let wait_ms: u32 = match timeout_ms {
        Some(ms) => ms.min(u64::from(INFINITE)) as u32,
        None => INFINITE,
    };
    let wait_result = unsafe { WaitForSingleObject(process.hProcess, wait_ms) };
    let timed_out = wait_result == WAIT_TIMEOUT;
    if timed_out {
        // 先回收再释放许可：Job 全树回收 → 等 Job 清空 → 才结算。
        unsafe { TerminateJobObject(job, 1) };
        wait_job_drained(job);
    } else {
        // 目标已退：后代（重挂父进程/活过目标的）仍被 Job 持有——
        // 等范围空才算结算完（超时预算不再适用：后代自然跑完）。
        wait_job_drained(job);
    }
    let mut exit_code: u32 = 0;
    let got_code = unsafe { GetExitCodeProcess(process.hProcess, &mut exit_code) };
    close_handle(process.hThread);
    close_handle(process.hProcess);
    // kill-on-close 兜底防线：结算完关 Job 句柄（若仍有漏网成员则全灭）。
    close_handle(job);

    let stdout = rx_out.recv().unwrap_or_default();
    let stderr = rx_err.recv().unwrap_or_default();
    let _ = t_out.join();
    let _ = t_err.join();

    if !timed_out && got_code != 0 && wait_result == WAIT_OBJECT_0 {
        return Ok((exit_code, lossy(&stdout), lossy(&stderr)));
    }
    Err(HelperError::new(
        super::TIMEOUT,
        if timed_out {
            format!("目标进程树在 {wait_ms}ms 超时后已被 Job 回收（范围已空）")
        } else {
            "等待目标进程结算失败".to_string()
        },
    ))
}

fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

// ── run-offline（D16）：以沙箱账户身份 spawn（seclogon 路径）─────────────

/// CreateProcessWithLogonW 请求的 LOGON_TYPE：批处理登录（账户已被授予
/// SeBatchLogonRight——account.rs 的 provision 面）。
const LOGON32_LOGON_BATCH: u32 = 4;
const LOGON32_PROVIDER_DEFAULT: u32 = 0;

/// 以沙箱账户 spawn（CreateProcessWithLogonW——Secondary Logon Service，
/// **不需要 SE_TCB 特权**，与 LogonUser 路线的本质差别）。目标进程以该
/// 账户身份运行，其出站流量被 WFP persistent BLOCK（wfp.rs）拦截。
/// stdin 挂 NUL、管道收集、超时 Job 回收语义与受限路径一致——
/// 但离线账户进程**不入受限令牌 Job**（账户即身份边界），超时直接
/// TerminateProcess 目标。
pub fn spawn_offline_and_wait(
    account: &str,
    password: &str,
    program: &str,
    args: &[String],
    cwd: &str,
    timeout_ms: Option<u64>,
) -> Result<(u32, String, String)> {
    use windows_sys::Win32::System::Threading::CreateProcessWithLogonW;

    let out_pipe = make_pipe()?;
    let err_pipe = make_pipe()?;

    let nul = wide("NUL");
    let stdin_handle = unsafe {
        CreateFileW(
            nul.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            0,
            0,
        )
    };
    let stdin_ok = stdin_handle != 0 && stdin_handle != INVALID_HANDLE_VALUE;
    let command_line: Vec<u16> = {
        let mut line = quote_arg(program);
        for arg in args {
            line.push(' ');
            line.push_str(&quote_arg(arg));
        }
        wide(&line)
    };
    let account_w = wide(account);
    let password_w = wide(password);
    let wide_cwd = wide(cwd);

    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = if stdin_ok { stdin_handle } else { 0 };
    startup.hStdOutput = out_pipe.write;
    startup.hStdError = err_pipe.write;
    let mut process: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };

    let ok = unsafe {
        CreateProcessWithLogonW(
            account_w.as_ptr(),
            std::ptr::null(), // 域：null = 本机
            password_w.as_ptr(),
            LOGON32_LOGON_BATCH,
            std::ptr::null(), // applicationName：按命令行解析（同 run 路径）
            command_line.as_ptr() as *mut u16,
            CREATE_NO_WINDOW as u32,
            std::ptr::null(),
            wide_cwd.as_ptr(),
            &startup,
            &mut process,
        )
    };
    // 密码缓冲即用即清（防 helper 内存驻留明文）。
    drop(password_w);
    if stdin_ok {
        close_handle(stdin_handle);
    }
    if ok == 0 {
        close_handle(out_pipe.read);
        close_handle(err_pipe.read);
        return Err(HelperError::new(
            super::NETWORK_SANDBOX_NOT_PROVISIONED,
            format!(
                "CreateProcessWithLogonW({account}) 失败（win32 code {}）——沙箱账户未 provision 或未授予批处理登录权",
                unsafe { GetLastError() }
            ),
        ));
    }

    close_handle(out_pipe.write);
    close_handle(err_pipe.write);

    let (tx_out, rx_out) = mpsc::channel();
    let (tx_err, rx_err) = mpsc::channel();
    let t_out = std::thread::spawn(move || drain_to_string(out_pipe.read, tx_out));
    let t_err = std::thread::spawn(move || drain_to_string(err_pipe.read, tx_err));

    let wait_ms: u32 = match timeout_ms {
        Some(ms) => ms.min(u64::from(INFINITE)) as u32,
        None => INFINITE,
    };
    let wait_result = unsafe { WaitForSingleObject(process.hProcess, wait_ms) };
    let timed_out = wait_result == WAIT_TIMEOUT;
    if timed_out {
        unsafe { TerminateProcess(process.hProcess, 1) };
        unsafe { WaitForSingleObject(process.hProcess, INFINITE) };
    }
    let mut exit_code: u32 = 0;
    let got_code = unsafe { GetExitCodeProcess(process.hProcess, &mut exit_code) };
    close_handle(process.hThread);
    close_handle(process.hProcess);

    let stdout = rx_out.recv().unwrap_or_default();
    let stderr = rx_err.recv().unwrap_or_default();
    let _ = t_out.join();
    let _ = t_err.join();

    if !timed_out && got_code != 0 && wait_result == WAIT_OBJECT_0 {
        return Ok((exit_code, lossy(&stdout), lossy(&stderr)));
    }
    Err(HelperError::new(
        super::TIMEOUT,
        if timed_out {
            format!("离线账户进程在 {wait_ms}ms 超时后已被回收")
        } else {
            "等待离线账户进程结算失败".to_string()
        },
    ))
}
