//! win32-sandbox-helper —— aegent 的沙箱 helper（D6/D10 受限令牌 · D13
//! Job 管辖 · D16 网络隔离）。
//!
//! 协议（T9：只传可序列化值）：argv `--action <action>`，stdin 一行 JSON
//! 请求，stdout 一行 JSON 结果。TS 侧只负责调用与协议编解码，全部 Win32
//! 面在本 crate。纪律（对齐 dsh sandbox-windows-acl 与 codex
//! windows-sandbox-rs 的失败处理教训）：**每个 Win32 调用都检查，任何
//! 失败都在目标进程 spawn 之前报错**——绝不降级为不受限运行（fail-closed，
//! D5 同款语义）。
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
//!
//! 动作闭集（T9 fail-closed）：run / provision-network / probe-network /
//! run-offline / computer——未知动作 BAD_REQUEST 退出。
#![cfg_attr(not(windows), allow(dead_code))]

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

mod account;
mod err;
mod grant;
mod spawn;
mod token;
mod wfp;

pub use err::{
    BAD_REQUEST, GRANT_FAILED, NETWORK_SANDBOX_NOT_PROVISIONED, PROVISION_FAILED, SPAWN_FAILED,
    TIMEOUT, TOKEN_FAILED,
};

#[cfg(test)]
mod mechanism_tests;
use err::{HelperError, Result};

/// run 动作请求的文件效果档位（与 TS 侧 SandboxMode 对齐）。
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
    // argv 形状：[exe, --action, <action>]（len == 3）。
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 || args[1] != "--action" {
        fail(BAD_REQUEST, "用法：win32-sandbox-helper --action <run|provision-network|probe-network|run-offline|computer>（请求经 stdin JSON）");
    }
    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        fail(BAD_REQUEST, "读取 stdin 失败");
    }
    match args[2].as_str() {
        "run" => action_run(&input),
        "provision-network" => action_provision_network(&input),
        "probe-network" => action_probe_network(),
        "run-offline" => action_run_offline(&input),
        "computer" => action_computer(&input),
        other => fail(BAD_REQUEST, format!("未知动作「{other}」（T9：动作名闭集，fail-closed）")),
    }
}

/// computer 动作（S4/T-P2-408）——屏幕捕获/输入注入。
///
/// 【存根状态】请求校验与操作分发给全，四操作的真实 Win32 实现
/// （SendInput / GDI BitBlt 屏幕捕获）未落——Windows 会话隔离环境的真实
/// 可用性需人工确认（plan-p2-progress.md 人工确认清单），确认后在本模块
/// 补齐。当前一律 NOT_IMPLEMENTED 结构化报错（fail-closed：明确报错，
/// 绝不静默假成功）。
#[derive(Deserialize)]
struct ComputerUseRequest {
    operation: String,
    #[allow(dead_code)]
    x: Option<f64>,
    #[allow(dead_code)]
    y: Option<f64>,
    #[allow(dead_code)]
    button: Option<String>,
    #[allow(dead_code)]
    text: Option<String>,
    #[allow(dead_code)]
    key: Option<String>,
}

fn action_computer(input: &str) {
    let request: ComputerUseRequest = match serde_json::from_str(input) {
        Ok(r) => r,
        Err(e) => fail(BAD_REQUEST, format!("请求 JSON 解析失败：{e}")),
    };
    match request.operation.as_str() {
        "screenshot" | "click" | "type" | "key" => fail(
            "NOT_IMPLEMENTED",
            format!(
                "屏幕操作「{}」待真实 Windows 会话验证（S4 人工确认项——操作分发面已就绪，Win32 实现待补）",
                request.operation
            ),
        ),
        other => fail(BAD_REQUEST, format!("未知屏幕操作「{other}」")),
    }
}

/// run 动作（D6 受限令牌）。
fn action_run(input: &str) {
    let request: RunRequest = match serde_json::from_str(input) {
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
        Ok((exit_code, stdout, stderr)) => emit_ok(exit_code, stdout, stderr),
        Err(e) => fail(e.code, e.message),
    }
}

/// provision-network 动作（D16，需管理员）：账户 + WFP persistent 三件套。
/// 幂等（账户已存在复用、filter delete-then-add）；自动生成的密码在响应
/// 回传给调用方（DPAPI 加密落盘，明文不进命令行——D8 argv 纪律同款）。
fn action_provision_network(input: &str) {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ProvisionRequest {
        /// 账户名（缺省自动生成；已存在则复用）。
        account: Option<String>,
        /// 账户密码（缺省自动生成）。
        password: Option<String>,
    }
    let request: ProvisionRequest = match serde_json::from_str(input) {
        Ok(r) => r,
        Err(e) => fail(BAD_REQUEST, format!("请求 JSON 解析失败：{e}")),
    };
    let account = request.account.unwrap_or_else(account::generate_account_name);
    let generated = request.password.is_none();
    let password = request.password.unwrap_or_else(account::generate_password);
    if let Err(e) = account::create_sandbox_account(&account, &password) {
        fail(e.code, e.message);
    }
    match wfp::provision_network_filters(&account) {
        Ok(detail) => {
            let payload = serde_json::json!({
                "ok": true,
                "account": account,
                "passwordGenerated": generated,
                "password": if generated { password } else { String::new() },
                "detail": detail,
            });
            println!("{payload}");
        }
        Err(e) => fail(e.code, e.message),
    }
}

/// probe-network 动作（D16 探针，doctor 消费）：WFP filter 在位性。
fn action_probe_network() {
    let filter_present = match wfp::probe_network_filter() {
        Ok(v) => v,
        Err(e) => fail(e.code, e.message),
    };
    let payload = serde_json::json!({
        "ok": true,
        "filterPresent": filter_present,
        "provisioned": filter_present,
    });
    println!("{payload}");
}

/// run-offline 动作（D16）：以沙箱账户 spawn（seclogon 路径），其网络被
/// WFP 的 persistent BLOCK 拦截。密码经 stdin JSON 传（明文不进命令行）。
fn action_run_offline(input: &str) {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct OfflineRunRequest {
        account: String,
        /// DPAPI 解密后的密码（由 TS 侧读取加密配置并解密）。
        password: String,
        program: String,
        args: Vec<String>,
        cwd: String,
        timeout_ms: Option<u64>,
    }
    let request: OfflineRunRequest = match serde_json::from_str(input) {
        Ok(r) => r,
        Err(e) => fail(BAD_REQUEST, format!("请求 JSON 解析失败：{e}")),
    };
    if request.account.trim().is_empty() || request.password.is_empty() {
        fail(BAD_REQUEST, "account 与 password 必填");
    }
    if request.args.is_empty() || request.program.trim().is_empty() {
        fail(BAD_REQUEST, "program 与 args 不得为空");
    }
    match spawn::spawn_offline_and_wait(
        &request.account,
        &request.password,
        &request.program,
        &request.args,
        &request.cwd,
        request.timeout_ms,
    ) {
        Ok((exit_code, stdout, stderr)) => emit_ok(exit_code, stdout, stderr),
        Err(e) => fail(e.code, e.message),
    }
}

fn emit_ok(exit_code: u32, stdout: String, stderr: String) {
    let ok = RunOk { ok: true, exit_code, stdout, stderr };
    println!("{}", serde_json::to_string(&ok).unwrap_or_default());
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
