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
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("host.log"))?;
    let log_err = log.try_clone()?;
    Command::new(&node)
        .args([
            "host.cjs",
            "--port",
            &HOST_PORT.to_string(),
            "--ui",
            dir.join("ui").to_str().expect("ui 路径非 UTF-8"),
            "--agent-entry",
            dir.join("agent-child.cjs").to_str().expect("entry 路径非 UTF-8"),
        ])
        .current_dir(dir)
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .spawn()
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
    let child = spawn_host(&dir);
    if let Err(e) = &child {
        // 开发态（target/debug 无 portable 布局）走这里——不炸壳
        eprintln!("[aegent-shell] host spawn 失败（开发态无 portable 布局属正常）: {e}");
    }
    // 健康探测先行：host 起来后 WebView 加载即连得上（UI 也有重连兜底）；
    // 探测失败照常显示——诊断面在 UI 的连接状态。
    let _healthy = child.is_ok() && wait_healthy(HEALTH_TIMEOUT);

    tauri::Builder::default()
        .manage(HostProcess(Mutex::new(child.ok())))
        // U7/T-P3-114：updater 单插件入册（九插件群不取的解禁例外——签名
        // 校验链；endpoints 指向 localhost 演示面，pubkey 在 tauri.conf.json）
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
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
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(child) = guard.as_mut() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
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
