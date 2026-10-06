//! 浏览器面板的壳侧承载（T-P3-169 终版——**主窗内嵌 child webview**）。
//!
//! 死锁史与正解（三轮真机实测）：
//! - T-P3-156 方案 A：sync command 里 add_child——sync command 在主线程
//!   执行，WebView2 controller 创建"派发主线程+同步等待"= 主线程等自己
//!   死锁（官方 WebviewWindowBuilder 文档 Known issues 同款）；
//! - T-P3-167 方案 B：独立子窗（async command）不死于创建，但跨窗口
//!   SetWindowPos 跟随在 Windows 拖拽模态循环里重入死锁+renderer 崩溃
//!   （用户实测拖边框卡死、页面 DOM 全空）；
//! - **正解（本版）**：add_child 回到主窗内嵌——command 用 **async**（跑
//!   线程池）+ `run_on_main` 把 add_child **排队**到活着的事件循环执行
//!   （泵在跑 → controller 异步创建可完成，不再"等自己"）。子 webview
//!   是主窗一部分：bounds 用 set_bounds（视口坐标系）、hide/show 天然
//!   内嵌语义，z 序/覆盖/跟随问题整体消失。
//!
//! 数据目录独立于宿主（不共享登录态/LocalStorage——安全边界）。

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Webview, WebviewUrl, WebviewBuilder, Window};

/// 每 tab 的 child webview 登记表（label → Webview；label = `browser-<n>`）。
pub struct BrowserRegistry(Mutex<HashMap<String, Webview>>);

/// 诊断日志（便携壳 stderr 被吞——落 logs/webview.log 供排障）。
fn wvlog(msg: &str) {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let log_dir = dir.join("logs");
            let _ = std::fs::create_dir_all(&log_dir);
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_dir.join("webview.log"))
            {
                use std::io::Write;
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let _ = writeln!(f, "[ts={ts}] {msg}");
            }
        }
    }
}

/// 主线程执行窗口操作（async command 线程池里调用——run_on_main 排队到
/// 活着的事件循环，add_child 等 WebView2 异步创建可完成，不死锁）。
fn run_on_main<T: Send + 'static>(
    app: &AppHandle,
    job: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(job());
    })
    .map_err(|e| format!("主线程调度失败：{e}"))?;
    rx.recv_timeout(std::time::Duration::from_secs(15))
        .map_err(|_| "窗口操作超时（主线程繁忙）".to_string())
}

/// 创建（或复用）浏览器 tab 的 child webview：初始 1px 藏视口外（show
/// 时 set_bounds 对齐面板区域，避免创建瞬间闪整窗）。
#[tauri::command]
pub async fn browser_create(
    app: AppHandle,
    label: String,
    url: String,
) -> Result<String, String> {
    wvlog(&format!("browser_create label={label} url={url}"));
    let parsed: tauri::Url = url.parse().map_err(|e| {
        wvlog(&format!("browser_create url 解析失败: {e}"));
        format!("URL 不合法：{e}")
    })?;
    let app2 = app.clone();
    let result = run_on_main(&app2, move || {
        let window: Window = match app.get_window("main") {
            Some(w) => w,
            None => {
                wvlog("browser_create 主窗未就绪");
                return Err("主窗未就绪".to_string());
            }
        };
        let state = match app.try_state::<BrowserRegistry>() {
            Some(s) => s,
            None => return Err("browser registry 未初始化".to_string()),
        };
        let mut registry = match state.0.lock() {
            Ok(g) => g,
            Err(_) => return Err("registry 锁中毒".to_string()),
        };
        if registry.contains_key(&label) {
            wvlog("browser_create 复用既有 webview");
            return Ok(label.clone());
        }
        // CDP 通道安全面（T-P3-174 调研报告 §4.2 的硬前提）：面板 webview
        // 配**专属 data directory**——①满足 tauri 约束"不同 browser args 的
        // webview 必须配不同 data directory"；②开调试端口后暴露面只含面板
        // target（主 UI 的 tauri.localhost target 不在同端口列表）；③兑现
        // 本模块头注"数据目录独立"的设计意图。目录 = <exeDir>/data/
        // webview-panel（host/agent 侧按同一约定读 DevToolsActivePort 发现
        // 端口——随机端口零硬编码）。默认 wry args 被自定义覆盖，官方要求
        // 自行补回 SmartScreen/PDF/UI 三项 disable。
        let panel_data_dir = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|d| d.join("data").join("webview-panel")));
        let builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(parsed))
            .initialization_script("window.__AEGENT_BROWSER_TAB = true;");
        let builder = match panel_data_dir {
            Some(dir) => {
                if let Err(e) = std::fs::create_dir_all(&dir) {
                    wvlog(&format!("panel data dir 创建失败（继续无 CDP 创建）: {e}"));
                    builder
                } else {
                    builder
                        .data_directory(dir)
                        .additional_browser_args(
                            "--remote-debugging-port=0 --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
                        )
                }
            }
            None => builder,
        };
        match window.add_child(
            builder,
            tauri::LogicalPosition::new(0.0, 10_000.0), // 藏视口外——show 时对齐
            tauri::LogicalSize::new(400.0, 300.0),
        ) {
            Ok(webview) => {
                wvlog("browser_create add_child 成功");
                registry.insert(label.clone(), webview);
                Ok(label.clone())
            }
            Err(e) => {
                wvlog(&format!("browser_create add_child 失败: {e}"));
                Err(format!("webview 创建失败：{e}"))
            }
        }
    })
    .and_then(|inner| inner);
    result
}

/// 对齐 bounds 并显示（UI 面板区域变化/激活 tab 时调——视口物理坐标）。
#[tauri::command]
pub async fn browser_show(
    app: AppHandle,
    label: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let app2 = app.clone();
    run_on_main(&app2, move || {
        let state = app
            .try_state::<BrowserRegistry>()
            .ok_or("browser registry 未初始化")?;
        let registry = state.0.lock().map_err(|_| "registry 锁中毒")?;
        let webview = registry.get(&label).ok_or("tab 不存在")?;
        let _ = webview.set_bounds(tauri::Rect {
            position: tauri::PhysicalPosition::new(x, y).into(),
            size: tauri::PhysicalSize::new(width.max(1), height.max(1)).into(),
        });
        let _ = webview.show();
        Ok(())
    })
    .and_then(|inner| inner)
}

/// 隐藏（tab 切走/面板收起——保活不销毁）。
#[tauri::command]
pub async fn browser_hide(app: AppHandle, label: String) -> Result<(), String> {
    let app2 = app.clone();
    run_on_main(&app2, move || {
        let state = app
            .try_state::<BrowserRegistry>()
            .ok_or("browser registry 未初始化")?;
        let registry = state.0.lock().map_err(|_| "registry 锁中毒")?;
        if let Some(webview) = registry.get(&label) {
            let _ = webview.hide();
        }
        Ok(())
    })
    .and_then(|inner| inner)
}

/// 导航（地址栏/前进后退刷新由前端 history 面承担）。
#[tauri::command]
pub async fn browser_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    let app2 = app.clone();
    run_on_main(&app2, move || {
        let state = app
            .try_state::<BrowserRegistry>()
            .ok_or("browser registry 未初始化")?;
        let registry = state.0.lock().map_err(|_| "registry 锁中毒")?;
        let webview = registry.get(&label).ok_or("tab 不存在")?;
        let parsed: tauri::Url = url.parse().map_err(|e| format!("URL 不合法：{e}"))?;
        let _ = webview.navigate(parsed);
        Ok(())
    })
    .and_then(|inner| inner)
}

/// 销毁 tab（关闭 Tab 时——真回收）。
#[tauri::command]
pub async fn browser_destroy(app: AppHandle, label: String) -> Result<(), String> {
    let app2 = app.clone();
    run_on_main(&app2, move || {
        let state = app
            .try_state::<BrowserRegistry>()
            .ok_or("browser registry 未初始化")?;
        let mut registry = state.0.lock().map_err(|_| "registry 锁中毒".to_string())?;
        if let Some(webview) = registry.remove(&label) {
            let _ = webview.close(); // Webview 无 destroy——close 是销毁面
        }
        wvlog(&format!("browser_destroy label={label}"));
        Ok(())
    })
    .and_then(|inner| inner)
}

/// 在指定 tab 内执行 JS（后退/前进/刷新由前端经此驱动）。
#[tauri::command]
pub async fn browser_eval(app: AppHandle, label: String, js: String) -> Result<(), String> {
    let app2 = app.clone();
    run_on_main(&app2, move || {
        let state = app
            .try_state::<BrowserRegistry>()
            .ok_or("browser registry 未初始化")?;
        let registry = state.0.lock().map_err(|_| "registry 锁中毒")?;
        if let Some(webview) = registry.get(&label) {
            let _ = webview.eval(&js);
        }
        Ok(())
    })
    .and_then(|inner| inner)
}

/// 同步隐藏全部 webview（CloseRequested/托盘事件回调直接调——主窗 hide
/// 不会带走 child webview，须逐个藏）。
pub fn hide_all_sync(app: &AppHandle) {
    if let Some(state) = app.try_state::<BrowserRegistry>() {
        if let Ok(registry) = state.0.lock() {
            for webview in registry.values() {
                let _ = webview.hide();
            }
        }
    }
}

/// 注册表挂载（lib.rs setup 调）。
pub fn manage_registry(app: &AppHandle) {
    app.manage(BrowserRegistry(Mutex::new(HashMap::new())));
}
