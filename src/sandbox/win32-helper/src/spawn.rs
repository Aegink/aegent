//! 受限 spawn + 等待 + stdio 管道收集（D6 执行面）。
//!
//! CreateProcessAsUserW（restricted token）+ 匿名管道捕获 stdout/stderr +
//! stdin 挂 NUL 设备（dsh 语义：ignored stdin 用 null 设备描述符）。
//! 等待支持超时：超时 → TerminateProcess 回收（D13 卡升级为 Job 全树
//! 回收）→ 结算 TIMEOUT。
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
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::Threading::{
    CreateProcessAsUserW, GetExitCodeProcess, TerminateProcess, WaitForSingleObject,
    PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOW,
};

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
pub const INFINITE: u32 = 0xFFFF_FFFF;
pub const WAIT_OBJECT_0: u32 = 0;
pub const WAIT_TIMEOUT: u32 = 0x102;

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

/// 以受限令牌 spawn 目标并等待；返回 (exitCode, stdout, stderr)。
/// 超时 → TerminateProcess 回收后报 TIMEOUT。
pub fn spawn_and_wait(
    token: isize,
    program: &str,
    args: &[String],
    cwd: &str,
    timeout_ms: Option<u64>,
) -> Result<(u32, String, String)> {
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
            CREATE_NO_WINDOW,
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
        // 父进程侧的读端也要收，防止句柄泄漏。
        close_handle(out_pipe.read);
        close_handle(err_pipe.read);
        return Err(HelperError::new(
            super::SPAWN_FAILED,
            format!("CreateProcessAsUserW({program}) 失败（win32 code {}）", unsafe {
                GetLastError()
            }),
        ));
    }

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
        // 先回收再结算（D13 的"先回收再释放许可"最小面：直接杀目标进程，
        // 全树 Job 回收在 D13 卡升级）。
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
            format!("目标进程在 {wait_ms}ms 超时后已被回收")
        } else {
            "等待目标进程结算失败".to_string()
        },
    ))
}

fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}
