//! win32-sandbox-helper —— aegent 的受限令牌沙箱 helper（D6/D10）。
//!
//! 协议（T9：只传可序列化值）：argv `--action run`，stdin 一行 JSON 请求，
//! stdout 一行 JSON 结果。TS 侧只负责调用与协议编解码，全部 Win32 面在本
//! crate。纪律（对齐 dsh sandbox-windows-acl 与 codex windows-sandbox-rs
//! 的失败处理教训）：**每个 Win32 调用都检查，任何失败都在目标进程
//! spawn 之前报错**——绝不降级为不受限运行（fail-closed，D5 同款语义）。
//!
//! 受限机制（dsh POC 语义，Win11 验证过的 restricting 清单形状）：
//!   - read-only：       restricting = [logon SID, Everyone]
//!   - workspace-write： restricting = [logon SID, Everyone, workspace SID, temp SID?]
//!   - CreateRestrictedToken(DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED)
//!     ——WRITE_RESTRICTED 使 pass-2（受限检查）只对写访问生效：读不受限，
//!     写 = 正常检查 && 受限检查（restricting 清单里的 SID 必须在目标上
//!     有 allow ACE）。
//!   - 目录授予三件套（一次 SetNamedSecurityInfoW）：capability SID 的写
//!     ACE（OI|CI 继承）+ Everyone 的 FILE_DELETE_CHILD deny（CI）+ Low
//!     no-write-up 强制标签（OI|CI）——deny 挡住"从父目录
//!     FILE_DELETE_CHILD 删除"的旁路，标签与降级后的 Low 令牌匹配。
//!   - 令牌默认 DACL 合并 restricting 写 SID 的 FILE_ALL_ACCESS ACE：
//!     受限令牌新建对象（匿名管道等）的 DACL 不含 restricting SID，
//!     pass-2 会在对象创建时拒绝（孙进程 spawn EPERM）。
//!   - 令牌完整性降到 Low（S-1-16-4096）与目录标签匹配。
#![cfg_attr(not(windows), allow(dead_code))]

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

mod err;
mod grant;
mod spawn;
mod token;

pub use err::{BAD_REQUEST, GRANT_FAILED, SPAWN_FAILED, TIMEOUT, TOKEN_FAILED};

#[cfg(test)]
mod mechanism_tests;
use err::{HelperError, Result};

/// 请求的文件效果档位（与 TS 侧 SandboxMode 对齐）。
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    ReadOnly,
    WorkspaceWrite,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub mode: Mode,
    /// 已 canonical 化的工作区绝对路径（TS 侧 realpathSync.native）。
    pub workspace: String,
    /// 工作区能力 SID（S-1-4-x-y，TS 侧 sha256 派生）。
    pub workspace_sid: String,
    /// 私有 temp 目录（workspace-write 可选授予；read-only 必须 null）。
    pub temp_dir: Option<String>,
    pub temp_sid: Option<String>,
    /// 目标可执行文件与参数（宿主 shell 的选择留在 TS 侧——D11）。
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOk {
    pub ok: bool,
    pub exit_code: u32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Serialize)]
pub struct ErrorBody {
    pub code: &'static str,
    pub message: String,
}

#[derive(Serialize)]
pub struct RunErr {
    pub ok: bool,
    pub error: ErrorBody,
}

fn main() {
    // argv 形状：[exe, --action, run]（len == 3）；未知动作 BAD_REQUEST 退出。
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 || args[1] != "--action" || args[2] != "run" {
        fail(BAD_REQUEST, "用法：win32-sandbox-helper --action run（请求经 stdin JSON）");
    }

    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        fail(BAD_REQUEST, "读取 stdin 失败");
    }
    let request: RunRequest = match serde_json::from_str(&input) {
        Ok(r) => r,
        Err(e) => fail(BAD_REQUEST, format!("请求 JSON 解析失败：{e}")),
    };
    // 请求校验：read-only 不授予任何写 SID；workspace-write 必须有工作区 SID。
    if request.workspace.trim().is_empty() || request.workspace_sid.trim().is_empty() {
        fail(BAD_REQUEST, "workspace 与 workspaceSid 必填");
    }
    if request.args.is_empty() || request.program.trim().is_empty() {
        fail(BAD_REQUEST, "program 与 args 不得为空");
    }
    if (request.temp_dir.is_some()) != (request.temp_sid.is_some()) {
        fail(BAD_REQUEST, "tempDir 与 tempSid 必须成对出现");
    }

    match run(&request) {
        Ok((exit_code, stdout, stderr)) => {
            let ok = RunOk { ok: true, exit_code, stdout, stderr };
            println!("{}", serde_json::to_string(&ok).unwrap_or_default());
        }
        Err(e) => fail(e.code, e.message),
    }
}

/// 结构化失败：单行 JSON 到 stdout + 非零退出（绝不 spawn 目标）。
fn fail(code: &'static str, message: impl Into<String>) -> ! {
    let err = RunErr { ok: false, error: ErrorBody { code, message: message.into() } };
    let line = serde_json::to_string(&err).unwrap_or_default();
    let _ = std::io::stdout().write_all(line.as_bytes());
    let _ = std::io::stdout().write_all(b"\n");
    std::process::exit(2);
}

/// run 动作主体：授予 → 令牌 → spawn → 等待 → 结算。
fn run(request: &RunRequest) -> Result<(u32, String, String)> {
    #[cfg(windows)]
    {
        // 1. ACL 授予（workspace-write；read-only 零授予）——失败即停，
        //    绝不让目标在无授予/无标签状态下以受限令牌运行（标签不匹配
        //    会把写全拒，授予失败仍 spawn = 既慢又错的中间态）。
        if request.mode == Mode::WorkspaceWrite {
            grant::grant_write(&request.workspace, &request.workspace_sid)?;
            if let (Some(dir), Some(sid)) = (&request.temp_dir, &request.temp_sid) {
                grant::grant_write(dir, sid)?;
            }
        }
        // 2. 受限令牌构造（mode 决定 restricting 清单）。
        let token =
            token::create_write_restricted(request.mode, &request.workspace_sid, request.temp_sid.as_deref())?;
        // 3. 受限 spawn + 等待 + 管道收集。
        spawn::spawn_and_wait(
            token,
            &request.program,
            &request.args,
            &request.cwd,
            request.timeout_ms,
        )
    }
    #[cfg(not(windows))]
    {
        let _ = request;
        Err(HelperError::new(SPAWN_FAILED, "win32-sandbox-helper 只能在 Windows 上运行"))
    }
}
