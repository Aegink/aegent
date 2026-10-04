//! aegent 桌面壳（K2/T-P1-129 + U6/T-P3-113）——Tauri 2 最小壳：单窗口
//! WebView 加载 `ui/` 静态资产（frontendDist，零前端构建链），页面 JS 经
//! WS 连本机 node host 进程（内核在 Node 不在 Rust）。Rust 侧零业务零插件
//! （九插件群不取——展卡核对结论④）；U6 起 Rust 侧承担 **host 进程管理**
//! （std::process，不引 shell 插件）：起 portable host（node.exe + host.cjs
//! 布局）/ TCP 健康探测 / 退出收束 kill。启动参数来自 U1 配置链——壳不加
//! 环境变量（host 读 settings.json 启动）。
//!
//! 开发态（cargo tauri dev）：target/debug 旁无 portable 布局 → spawn 失败
//! 优雅降级（窗口照常显示，UI 走既有的"连接断开重连"循环——host 由开发者
//! 手动跑，K2 既有工作流不变）。

use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

/// T-P3-162 需求 3：Windows 上隐藏子进程控制台窗（node.exe 是 console
/// 程序——不设此 flag 时便携版每次启动都弹命令行黑窗）。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 静默杀进程树（taskkill /T 递归含 agent-child——child.kill() 不递归，
/// 关窗后孤儿内核持锁 = 用户遇到的"旧缓存"根因）。
fn kill_tree(pid: u32) {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd.spawn();
}

/// 收束 host 进程树（关窗/退出两路共用——taskkill /T 递归含 agent-child，
/// 再 kill/wait 兜底同步收尸）。
fn kill_host_tree(state: &HostProcess) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(child) = guard.as_mut() {
            kill_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// 启动前清理：读上次 pid 文件，仍在则杀树（壳异常退出的孤儿兜底）。
fn kill_stale_host(dir: &std::path::Path) {
    let pid_file = dir.join("data").join("host.pid");
    if let Ok(pid) = std::fs::read_to_string(&pid_file) {
        if let Ok(pid) = pid.trim().parse::<u32>() {
            kill_tree(pid);
        }
        let _ = std::fs::remove_file(&pid_file);
    }
}

mod browser; // T-P3-156 Q：浏览器面板 webview 管理（真实内核）
mod picker; // T-P3-158 反馈 2：系统文件夹选择器（rfd 直挂，不加插件）

/// host 子进程句柄（退出收束用——RunEvent::Exit 时 kill）。
struct HostProcess(Mutex<Option<Child>>);

const HOST_PORT: u16 = 8787;
const HEALTH_TIMEOUT: Duration = Duration::from_secs(15);

/// 起 portable host：node.exe host.cjs --port 8787 --ui ./ui
/// --agent-entry ./agent-child.cjs（cwd = 壳 exe 目录——资源与 bundle
/// 的 import.meta shim 布局都在旁）。stdout/stderr 落 logs/host.log
/// （T-P3-137 走查反馈：打包态输出被丢弃 = 用户无日志可看——追查列表
/// 消失类问题时需要 host 侧现场）。
fn spawn_host(dir: &std::path::Path) -> std::io::Result<Child> {
    let node = dir.join(if cfg!(windows) { "node.exe" } else { "node" });
    let log_dir = dir.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    // T-P3-158 反馈 1 附带：便携数据目录的事件库（此前无 --host-db →
    // 会话清单/用量面 SESSIONS_UNAVAILABLE + 聊天流刷错误行）
    let data_dir = dir.join("data");
    let _ = std::fs::create_dir_all(&data_dir);
    let host_db = data_dir.join("sessions.db");
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("host.log"))?;
    let log_err = log.try_clone()?;
    let mut cmd = Command::new(&node);
    cmd.args([
            "host.cjs",
            "--port",
            &HOST_PORT.to_string(),
            "--ui",
            dir.join("ui").to_str().expect("ui 路径非 UTF-8"),
            "--agent-entry",
            dir.join("agent-child.cjs").to_str().expect("entry 路径非 UTF-8"),
            "--host-db",
            host_db.to_str().expect("db 路径非 UTF-8"),
        ])
        .current_dir(dir)
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
}

/// TCP 健康探测：host HTTP 端口可连 = 监听在位（WS 升级同端口；HTTP 通即
/// 起来了——静态 serve 是 host 起动的最后一步）。
fn wait_healthy(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if TcpStream::connect(("127.0.0.1", HOST_PORT)).is_ok() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dir = std::env::current_exe()
        .expect("无法定位可执行文件")
        .parent()
        .expect("可执行文件无父目录")
        .to_path_buf();
    // T-P3-162 需求 3：上次孤儿 host 清理（壳崩溃残留——pid 文件兜底）
    kill_stale_host(&dir);
    let child = spawn_host(&dir);
    if let Ok(pid) = child.as_ref().map(|c| c.id()) {
        // pid 文件 = 下次启动的孤儿清理依据（异常退出兜底）
        let _ = std::fs::write(dir.join("data").join("host.pid"), pid.to_string());
    }
    if let Err(e) = &child {
        // 开发态（target/debug 无 portable 布局）走这里——不炸壳
        eprintln!("[aegent-shell] host spawn 失败（开发态无 portable 布局属正常）: {e}");
    }
    // 健康探测先行：host 起来后 WebView 加载即连得上（UI 也有重连兜底）；
    // 探测失败照常显示——诊断面在 UI 的连接状态。
    let _healthy = child.is_ok() && wait_healthy(HEALTH_TIMEOUT);

    tauri::Builder::default()
        .manage(HostProcess(Mutex::new(child.ok())))
        // T-P3-162 需求 3：关窗 = 彻底关闭（窗口销毁即杀 host 树——
        // 旧缓存问题的根因是孤儿内核持锁）
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                kill_host_tree(&window.app_handle().state::<HostProcess>());
            }
        })
        // U7/T-P3-114：updater 单插件入册（九插件群不取的解禁例外——签名
        // 校验链；endpoints 指向 localhost 演示面，pubkey 在 tauri.conf.json）
        .plugin(tauri_plugin_updater::Builder::new().build())
        // T-P3-156 Q：浏览器面板 command 面（真实内核 child webview）
        .invoke_handler(tauri::generate_handler![
            browser::browser_create,
            browser::browser_show,
            browser::browser_hide,
            browser::browser_navigate,
            browser::browser_destroy,
            browser::browser_eval,
            picker::pick_folder,
        ])
        .setup(|app| {
            browser::manage_registry(app.handle());
            // U6 修复（2026-09-29 用户走查发现）：主窗 visible:false（避免
            // WebView 加载前白屏闪烁）——host 就绪探测完成后必须显式 show
            // 并聚焦（"探测失败照常显示"——诊断面在 UI 连接状态）。此前
            // show 调用缺失 = 窗口创建后永远隐藏（用户双击无 UI）。
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            spawn_update_check(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<HostProcess>() {
                    kill_host_tree(&state);
                }
            }
        });
}

/// U7/T-P3-114：启动时检查更新（演示面——endpoints 指向 localhost），
/// 有更新则经 webview eval 调 UI 横幅钩子 `window.aegentShowUpdate`（U13
/// 的消费端——无 @tauri-apps/api 依赖的接线形态）。下载安装动作随真实
/// 分发（演示面只走"发现 → 横幅"链，记档）。
fn spawn_update_check(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_updater::UpdaterExt;
        let updater = match app.updater_builder().build() {
            Ok(u) => u,
            Err(e) => {
                eprintln!("[aegent-shell] updater build 失败（演示面端点未起属正常）: {e}");
                return;
            }
        };
        match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                let notes = update.body.clone().unwrap_or_default();
                if let Some(window) = app.get_webview_window("main") {
                    let escaped_notes = notes.replace('\\', "\\\\").replace('`', "\\`");
                    let _ = window.eval(&format!(
                        "window.aegentShowUpdate && window.aegentShowUpdate('{}', `{}`)",
                        version, escaped_notes
                    ));
                }
            }
            Ok(None) => {} // 已是最新——横幅不出现
            Err(e) => eprintln!("[aegent-shell] 更新检查失败（演示面端点未起属正常）: {e}"),
        }
    });
}
