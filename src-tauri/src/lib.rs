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
        if let Some(entry) = guard.as_mut() {
            kill_tree(entry.child.id());
            let _ = entry.child.kill();
            let _ = entry.child.wait();
        }
    }
}

/// uuid v4（零依赖——进程 id+时间熵够用，会话 id 无需密码学强度）。
fn uuid_v4() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    let pid = std::process::id() as u64;
    let a = nanos ^ (pid << 17);
    let b = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
        ^ (pid << 3);
    format!("{a:08x}-4{b:03x}-4{a:03x}-8{b:012x}")
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
/// T-P3-166 需求 2：记录 session_id/port 支持多会话清单（UI 按端口重连）。
struct HostEntry {
    session_id: String,
    port: u16,
    child: Child,
}

struct HostProcess(Mutex<Option<HostEntry>>);

/// 工作会话 host 池（T-P3-166 需求 2——pi-desktop sidecar 多会话同构的
/// 多进程形态：每会话一个 host+agent-child 独立端口，任务切换=UI 重连
/// 目标端口；后台会话的进程独立存活 = 真并发）。
struct WorkspaceHosts(Mutex<Vec<HostEntry>>);

const HOST_PORT: u16 = 8787;
const HEALTH_TIMEOUT: Duration = Duration::from_secs(15);

/// 起 portable host：node.exe host.cjs --port 8787 --ui ./ui
/// --agent-entry ./agent-child.cjs（cwd = 壳 exe 目录——资源与 bundle
/// 的 import.meta shim 布局都在旁）。stdout/stderr 落 logs/host.log
/// （T-P3-137 走查反馈：打包态输出被丢弃 = 用户无日志可看——追查列表
/// 消失类问题时需要 host 侧现场）。
fn spawn_host(dir: &std::path::Path, session_id: Option<&str>, port: u16) -> std::io::Result<Child> {
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
            &port.to_string(),
            "--ui",
            dir.join("ui").to_str().expect("ui 路径非 UTF-8"),
            "--agent-entry",
            dir.join("agent-child.cjs").to_str().expect("entry 路径非 UTF-8"),
            "--host-db",
            host_db.to_str().expect("db 路径非 UTF-8"),
        ])
        .current_dir(dir);
    // T-P3-165 需求 2：指定会话 id（「新建任务」= 壳重启 host 指向新
    // --session——单会话架构下立即进入新会话的唯一真路径）。缺省不传 =
    // host 自生成（启动语义不变）。
    if let Some(sid) = session_id {
        cmd.arg("--session").arg(sid);
    }
    cmd.stdout(Stdio::from(log))
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
    // T-P3-166 需求 2：主 host 会话 id 壳侧生成并记录（多会话清单需要）
    let main_session = format!("sess-{}", uuid_v4());
    let child = spawn_host(&dir, Some(&main_session), HOST_PORT);
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

    let main_entry = child.ok().map(|child| HostEntry {
        session_id: main_session,
        port: HOST_PORT,
        child,
    });
    tauri::Builder::default()
        .manage(HostProcess(Mutex::new(main_entry)))
        .manage(WorkspaceHosts(Mutex::new(Vec::new())))
        // T-P3-162 需求 3 + T-P3-163 反馈 7：关窗 = 彻底关闭。CloseRequested
        // 阶段先杀树（防 webview 销毁阻塞导致用户感知「关不掉」）；
        // Destroyed 与 RunEvent::Exit 兜底幂等重杀。
        .on_window_event(|window, event| {
            let is_main = window.label() == "main";
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if is_main {
                        // T-P3-166 需求 4：关闭行为分流（tray=隐藏到托盘——
                        // host 与工作会话继续跑；exit=彻底收束）。缺省 exit。
                        let dir = std::env::current_exe()
                            .ok()
                            .and_then(|p| p.parent().map(|d| d.to_path_buf()));
                        let behavior = dir
                            .map(|d| read_close_behavior(&d))
                            .unwrap_or_else(|| "exit".to_string());
                        if behavior == "tray" {
                            api.prevent_close();
                            let _ = window.hide();
                            // 浏览器子窗同步藏（独立窗不随主窗 hide）
                            browser::hide_all_sync(window.app_handle());
                        } else {
                            kill_host_tree(&window.app_handle().state::<HostProcess>());
                            if let Some(pool) = window.app_handle().try_state::<WorkspaceHosts>() {
                                if let Ok(mut guard) = pool.0.lock() {
                                    for mut entry in guard.drain(..) {
                                        kill_tree(entry.child.id());
                                        let _ = entry.child.kill();
                                        let _ = entry.child.wait();
                                    }
                                }
                            }
                            // T-P3-167 实测：浏览器子窗活着时不满足「全部窗口关闭」
                            // → app 不退出（进程残留=「关不掉」）——杀树后显式退出
                            window.app_handle().exit(0);
                        }
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    if is_main {
                        kill_host_tree(&window.app_handle().state::<HostProcess>());
                        // T-P3-167 实录：工作池也收束（Destroy 路径此前漏池）
                        if let Some(pool) = window.app_handle().try_state::<WorkspaceHosts>() {
                            if let Ok(mut guard) = pool.0.lock() {
                                for mut entry in guard.drain(..) {
                                    kill_tree(entry.child.id());
                                    let _ = entry.child.kill();
                                    let _ = entry.child.wait();
                                }
                            }
                        }
                    }
                }
                _ => {}
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
            restart_host,
            spawn_workspace_host,
            list_hosts,
            close_workspace_host,
            get_close_behavior,
            set_close_behavior,
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
            // T-P3-166 需求 4：托盘（关闭行为=tray 时的落点；失败不炸壳——
            // 托盘缺席时 close 行为退化为 exit）
            if let Err(e) = setup_tray(app.handle()) {
                eprintln!("[aegent-shell] 托盘初始化失败（退化为直接退出）: {e}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<HostProcess>() {
                    kill_host_tree(&state);
                }
                if let Some(pool) = app_handle.try_state::<WorkspaceHosts>() {
                    if let Ok(mut guard) = pool.0.lock() {
                        for mut entry in guard.drain(..) {
                            kill_tree(entry.child.id());
                            let _ = entry.child.kill();
                            let _ = entry.child.wait();
                        }
                    }
                }
            }
        });
}

/// T-P3-165 需求 2：「新建任务」= 壳重启 host 指向新 --session（单会话
/// 架构下立即进入新会话的唯一真路径；web 端无壳能力走 UI 降级提示）。
/// 调用前置：UI 已把 settings.activeProject 写盘（新 host 首轮归属按它）。
/// 流程：杀旧树（含 agent-child）→ spawn 新 host（--session）→ 写 pid →
/// 同步健康探测（UI 的 WS 断线重连循环会在端口回来后自动握手新会话）。
#[tauri::command]
fn restart_host(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<String, String> {
    if session_id.trim().is_empty() || !session_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("session id 不合法".into());
    }
    let dir = std::env::current_exe()
        .map_err(|e| format!("无法定位可执行文件：{e}"))?
        .parent()
        .expect("可执行文件无父目录")
        .to_path_buf();
    {
        let state = app.state::<HostProcess>();
        kill_host_tree(&state);
    }
    kill_stale_host(&dir);
    // T-P3-167 实录：杀树后端口 TIME_WAIT——EADDRINUSE 一次，spawn 前等释放
    for _ in 0..20 {
        if TcpStream::connect(("127.0.0.1", HOST_PORT)).is_err() {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    let child = spawn_host(&dir, Some(session_id.trim()), HOST_PORT)
        .map_err(|e| format!("host 重启失败：{e}"))?;
    let pid = child.id();
    let _ = std::fs::write(dir.join("data").join("host.pid"), pid.to_string());
    {
        let state = app.state::<HostProcess>();
        // map 内完成写入并 drop guard（if-let 临时作用域借用 state 会报 E0597）
        let _ = state.0.lock().map(|mut guard| {
            *guard = Some(HostEntry {
                session_id: session_id.trim().to_string(),
                port: HOST_PORT,
                child,
            });
        });
    }
    // 健康探测放后台线程（command 面不阻塞 webview——UI 重连循环自会等）
    std::thread::spawn(move || {
        let _ = wait_healthy(HEALTH_TIMEOUT);
    });
    Ok(session_id)
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

/// 壳侧配置（T-P3-166 需求 4：关闭行为——tray=隐藏到托盘、exit=彻底退出；
/// data/shell.json——壳专属配置不走 settings.json，UI 经 command 读写）。
fn shell_config_path(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join("data").join("shell.json")
}

fn read_close_behavior(dir: &std::path::Path) -> String {
    let path = shell_config_path(dir);
    if let Ok(raw) = std::fs::read_to_string(&path) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(mode) = value.get("closeBehavior").and_then(|v| v.as_str()) {
                return mode.to_string();
            }
        }
    }
    "exit".to_string()
}

#[tauri::command]
fn get_close_behavior(app: tauri::AppHandle) -> Result<String, String> {
    let dir = std::env::current_exe()
        .map_err(|e| format!("无法定位可执行文件：{e}"))?
        .parent()
        .expect("可执行文件无父目录")
        .to_path_buf();
    Ok(read_close_behavior(&dir))
}

#[tauri::command]
fn set_close_behavior(
    app: tauri::AppHandle,
    mode: String,
) -> Result<(), String> {
    if mode != "tray" && mode != "exit" {
        return Err("关闭行为只接受 tray|exit".into());
    }
    let dir = std::env::current_exe()
        .map_err(|e| format!("无法定位可执行文件：{e}"))?
        .parent()
        .expect("可执行文件无父目录")
        .to_path_buf();
    let _ = std::fs::create_dir_all(dir.join("data"));
    let value = serde_json::json!({ "closeBehavior": mode });
    std::fs::write(shell_config_path(&dir), serde_json::to_string(&value).unwrap_or_default())
        .map_err(|e| format!("写入壳配置失败：{e}"))?;
    let _ = app; // 保持签名一致（未来托盘菜单热更新用）
    Ok(())
}

/// 托盘图标 + 菜单（显示主窗 / 退出；pi-desktop Tray 同位）。
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 aegent", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    TrayIconBuilder::with_id("main-tray")
        .tooltip("aegent")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app_handle, event| {
            if event.id.as_ref() == "show" {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            } else if event.id.as_ref() == "quit" {
                app_handle.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            // 左键单击 = 恢复主窗（非 macOS 语义——便携只在 Windows）
            if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}

/// 工作会话 host（T-P3-166 需求 2）：为指定会话起独立 host+agent-child
/// （端口从 8788 起找空闲）——UI 切任务即重连目标端口；后台会话进程独立
/// 存活 = 多任务真并发（pi-desktop sidecar 多会话同构的多进程形态）。
#[tauri::command]
fn spawn_workspace_host(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let sid = session_id.trim().to_string();
    if sid.is_empty() || !sid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("session id 不合法".into());
    }
    let dir = std::env::current_exe()
        .map_err(|e| format!("无法定位可执行文件：{e}"))?
        .parent()
        .expect("可执行文件无父目录")
        .to_path_buf();
    let state = app.state::<WorkspaceHosts>();
    let mut pool = state.0.lock().map_err(|_| "hosts 锁中毒")?;
    // 池内已有该会话的活 host → 直接复用
    for entry in pool.iter_mut() {
        if entry.session_id == sid {
            if entry.child.try_wait().map(|st| st.is_none()).unwrap_or(false) {
                return Ok(serde_json::json!({ "sessionId": sid, "port": entry.port }));
            }
        }
    }
    // 端口分配：8788 起找未被池占用且未监听的
    let used: Vec<u16> = pool.iter().map(|e| e.port).collect();
    let mut port = 8788u16;
    while used.contains(&port) || TcpStream::connect(("127.0.0.1", port)).is_ok() {
        port += 1;
        if port > 8899 {
            return Err("工作会话端口耗尽（8788-8899）——请关闭部分会话".into());
        }
    }
    let child = spawn_host(&dir, Some(&sid), port).map_err(|e| format!("工作 host 启动失败：{e}"))?;
    // 旧死条目清理 + 新条目入池
    pool.retain_mut(|e| e.child.try_wait().map(|st| st.is_none()).unwrap_or(false));
    pool.push(HostEntry {
        session_id: sid.clone(),
        port,
        child,
    });
    std::thread::spawn(move || {
        let _ = wait_healthy(HEALTH_TIMEOUT);
    });
    Ok(serde_json::json!({ "sessionId": sid, "port": port }))
}

/// 活跃 host 清单（主 host + 工作池；死了的条目顺手清除）。
#[tauri::command]
fn list_hosts(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let mut out = Vec::new();
    let main = app.state::<HostProcess>();
    if let Ok(mut guard) = main.0.lock() {
        if let Some(entry) = guard.as_mut() {
            let alive = entry.child.try_wait().map(|st| st.is_none()).unwrap_or(false);
            out.push(serde_json::json!({
                "sessionId": entry.session_id,
                "port": entry.port,
                "alive": alive,
                "main": true,
            }));
        }
    }
    let pool = app.state::<WorkspaceHosts>();
    if let Ok(mut guard) = pool.0.lock() {
        guard.retain_mut(|e| e.child.try_wait().map(|st| st.is_none()).unwrap_or(false));
        for e in guard.iter() {
            out.push(serde_json::json!({
                "sessionId": e.session_id,
                "port": e.port,
                "alive": true,
                "main": false,
            }));
        }
    }
    Ok(out)
}

/// 关闭指定工作会话的 host（杀进程树——会话历史在事件库，可再切回重开）。
#[tauri::command]
fn close_workspace_host(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<bool, String> {
    let pool = app.state::<WorkspaceHosts>();
    let mut guard = pool.0.lock().map_err(|_| "hosts 锁中毒")?;
    let before = guard.len();
    guard.retain_mut(|e| {
        if e.session_id == session_id {
            kill_tree(e.child.id());
            let _ = e.child.kill();
            let _ = e.child.wait();
            false
        } else {
            e.child.try_wait().map(|st| st.is_none()).unwrap_or(false)
        }
    });
    Ok(guard.len() < before)
}
