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
struct HostEntry {
    child: Child,
}

struct HostProcess(Mutex<Option<HostEntry>>);

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

    let main_entry = child.ok().map(|child| HostEntry { child });
    tauri::Builder::default()
        .manage(HostProcess(Mutex::new(main_entry)))
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
            pip_show,
            get_close_behavior,
            set_close_behavior,
            get_keep_awake,
            set_keep_awake_command,
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
            // T-P3-174 批次 5：保持唤醒线程（常驻；开关态读 shell.json）
            {
                let dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|x| x.to_path_buf()));
                let on = dir
                    .map(|d| read_shell_config(&d).get("keepAwake").and_then(|v| v.as_bool()).unwrap_or(false))
                    .unwrap_or(false);
                set_keep_awake(on);
                spawn_keep_awake_thread();
            }
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
            }
        });
}

/// K9 画中画可达性修复（核对 A4）：按需显示 pip 窗口（tauri.conf 声明
/// visible:false——此前全仓无 show 调用=窗口永不可达）。幂等：已显示则
/// 取消最小化并前置聚焦。
#[tauri::command]
fn pip_show(app: tauri::AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("pip")
        .ok_or_else(|| "pip 窗口未声明（tauri.conf.json）".to_string())?;
    let _ = win.unminimize();
    win.show().map_err(|e| format!("pip show 失败：{e}"))?;
    let _ = win.set_focus();
    Ok(())
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
    read_shell_config(dir)
        .get("closeBehavior")
        .and_then(|v| v.as_str())
        .unwrap_or("exit")
        .to_string()
}

#[tauri::command]
fn get_close_behavior(_app: tauri::AppHandle) -> Result<String, String> {
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
    let mut value = read_shell_config(&dir);
    value["closeBehavior"] = serde_json::json!(mode);
    std::fs::write(shell_config_path(&dir), serde_json::to_string(&value).unwrap_or_default())
        .map_err(|e| format!("写入壳配置失败：{e}"))?;
    let _ = app; // 保持签名一致（未来托盘菜单热更新用）
    Ok(())
}

// —— 保持唤醒（T-P3-174 批次 5）：Electron powerSaveBlocker 同位。windows
// crate 直调 SetThreadExecutionState——ES_CONTINUOUS 是每线程状态，线程/进程
// 退出 Windows 自动还原（崩溃不留僵尸请求）；powercfg /requests（管理员）
// 的 SYSTEM/DISPLAY 段可见，可人工核验。专属常驻线程按开关设/清位。 ——
#[cfg(windows)]
static KEEP_AWAKE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(windows)]
fn spawn_keep_awake_thread() {
    std::thread::spawn(|| {
        use windows::Win32::System::Power::{
            SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
        };
        let mut active = false;
        loop {
            let want = KEEP_AWAKE.load(std::sync::atomic::Ordering::Relaxed);
            if want != active {
                // 状态切换才调（SetThreadExecutionState 幂等；设位一次即持续，
                // 其余程序的电源请求不影响本线程的累积状态）
                let flags = if want {
                    ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
                } else {
                    ES_CONTINUOUS
                };
                unsafe {
                    SetThreadExecutionState(flags);
                }
                active = want;
            }
            std::thread::sleep(std::time::Duration::from_secs(30));
        }
    });
}

#[cfg(not(windows))]
fn spawn_keep_awake_thread() {}

#[cfg(windows)]
fn set_keep_awake(on: bool) {
    KEEP_AWAKE.store(on, std::sync::atomic::Ordering::Relaxed);
}

#[cfg(not(windows))]
fn set_keep_awake(_on: bool) {}

/// 壳配置整对象读（read_close_behavior 的通用化——keepAwake/closeBehavior
/// 共用 data/shell.json 一处落盘，读改写互不覆盖）。
fn read_shell_config(dir: &std::path::Path) -> serde_json::Map<String, serde_json::Value> {
    if let Ok(raw) = std::fs::read_to_string(shell_config_path(dir)) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let serde_json::Value::Object(map) = value {
                return map;
            }
        }
    }
    serde_json::Map::new()
}

#[tauri::command]
fn get_keep_awake(_app: tauri::AppHandle) -> Result<bool, String> {
    let dir = std::env::current_exe()
        .map_err(|e| format!("无法定位可执行文件：{e}"))?
        .parent()
        .expect("可执行文件无父目录")
        .to_path_buf();
    Ok(read_shell_config(&dir).get("keepAwake").and_then(|v| v.as_bool()).unwrap_or(false))
}

#[tauri::command]
fn set_keep_awake_command(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    let dir = std::env::current_exe()
        .map_err(|e| format!("无法定位可执行文件：{e}"))?
        .parent()
        .expect("可执行文件无父目录")
        .to_path_buf();
    let _ = std::fs::create_dir_all(dir.join("data"));
    let mut value = read_shell_config(&dir);
    value.insert("keepAwake".into(), serde_json::json!(on));
    std::fs::write(shell_config_path(&dir), serde_json::to_string(&value).unwrap_or_default())
        .map_err(|e| format!("写入壳配置失败：{e}"))?;
    set_keep_awake(on);
    let _ = app;
    Ok(())
}

/// 托盘图标 + 菜单（显示主窗 / 退出；pi-desktop Tray 同位）。
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{CheckMenuItem, Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 aegent", true, None::<&str>)?;
    // 保持唤醒开关（T-P3-174 批次 5）——初始态随 shell.json
    let awake_initial = {
        let dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|x| x.to_path_buf()));
        match dir {
            Some(dir) => read_shell_config(&dir).get("keepAwake").and_then(|v| v.as_bool()).unwrap_or(false),
            None => false,
        }
    };
    let awake = CheckMenuItem::with_id(app, "keep-awake", "保持唤醒", true, awake_initial, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &awake, &quit])?;
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
            } else if event.id.as_ref() == "keep-awake" {
                // T-P3-174 批次 5：CheckMenuItem 勾选态由 tauri 自动翻转——
                // 读翻转后的值落 shell.json + 电源位（与 settings 页 command 同面）
                if let Some(item) = app_handle.menu().and_then(|m| m.get("keep-awake")) {
                    if let Some(awake) = item.as_check_menuitem() {
                        let on = awake.is_checked().unwrap_or(false);
                        let dir = std::env::current_exe()
                            .ok()
                            .and_then(|p| p.parent().map(|x| x.to_path_buf()));
                        if let Some(dir) = dir {
                            let _ = std::fs::create_dir_all(dir.join("data"));
                            let mut value = read_shell_config(&dir);
                            value.insert("keepAwake".into(), serde_json::json!(on));
                            let _ = std::fs::write(
                                shell_config_path(&dir),
                                serde_json::to_string(&value).unwrap_or_default(),
                            );
                        }
                        set_keep_awake(on);
                    }
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

