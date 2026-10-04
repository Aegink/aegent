//! 浏览器面板的壳侧承载（T-P3-167 方案 B——**独立无边框子窗口**）。
//!
//! 历史：T-P3-156 用主窗内 child webview（unstable multiwebview 的
//! Window::add_child）——真机实测（T-P3-166/167）在 Windows WebView2 上
//! **同步死锁**：add_child 内部同步等待 WebView2 controller 异步创建，
//! 阻塞主线程消息泵等自己（webview.log 恒停在入口、UI 恒"正在加载内核"）。
//! 方案 B 改用 tauri 核心多窗口能力：每个浏览器 tab = 一个无边框、不进
//! 任务栏的独立 WebviewWindow，UI 面板 DOM 区域经 bounds 上报驱动
//! set_position/set_size——真实 WebView2 内核不变，主窗消息泵零阻塞。
//!
//! 数据目录独立于宿主（不共享登录态/LocalStorage——安全边界）。

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// 每 tab 的子窗口登记表（label → 存活标记；句柄经 get_webview_window 取）。
pub struct BrowserRegistry(Mutex<HashMap<String, bool>>);

/// 浏览器面板相对主窗视口的物理偏移（UI 上报——Rust 在主窗 Moved/Resized
/// 事件里直接重算子窗屏幕位置，拖动/拖宽零延迟跟随，不依赖 UI 轮询）。
pub struct PanelOffset(pub Mutex<(i32, i32, u32, u32)>);

/// 视口原点（屏幕物理坐标）= 外框位置 + 边框修正（Windows：水平对称/垂直
/// 顶部标题栏+底边框）。用 outer/inner 尺寸差求边框，避免硬编码。
fn viewport_origin(app: &AppHandle) -> Option<(i32, i32)> {
    let main = app.get_webview_window("main")?;
    let outer = main.outer_position().ok()?;
    let outer_size = main.outer_size().ok()?;
    let inner = main.inner_size().ok()?;
    let ox = (outer_size.width as i32 - inner.width as i32) / 2;
    let oy = outer_size.height as i32 - inner.height as i32 - ox;
    Some((outer.x + ox, outer.y + oy))
}

/// 把全部存活子窗对齐到「视口原点 + 面板偏移」（Moved/Resized/set_offset 共用）。
pub fn sync_browser_bounds(app: &AppHandle) {
    let state = match app.try_state::<PanelOffset>() {
        Some(s) => s,
        None => return,
    };
    let offset = match state.0.lock() {
        Ok(g) => *g,
        Err(_) => return,
    };
    let origin = match viewport_origin(app) {
        Some(o) => o,
        None => return,
    };
    if let Some(reg_state) = app.try_state::<BrowserRegistry>() {
        if let Ok(registry) = reg_state.0.lock() {
            for label in registry.keys() {
                if let Some(window) = app.get_webview_window(label) {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.set_position(tauri::PhysicalPosition::new(
                            origin.0 + offset.0,
                            origin.1 + offset.1,
                        ));
                        let _ = window.set_size(tauri::PhysicalSize::new(
                            offset.2.max(1),
                            offset.3.max(1),
                        ));
                    }
                }
            }
        }
    }
}

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

/// 创建（或复用）浏览器 tab 的子窗口。初始藏屏幕外，show 时对齐。
#[tauri::command]
pub async fn browser_create(
    app: AppHandle,
    label: String,
    url: String,
) -> Result<String, String> {
    wvlog(&format!("browser_create label={label} url={url}"));
    let state = app
        .try_state::<BrowserRegistry>()
        .ok_or_else(|| "browser registry 未初始化".to_string())?;
    let mut registry = state.0.lock().map_err(|_| "registry 锁中毒".to_string())?;
    if let Some(alive) = registry.get(&label) {
        if *alive && app.get_webview_window(&label).is_some() {
            wvlog("browser_create 复用既有子窗");
            return Ok(label);
        }
        // 标记在但窗已亡（用户 Alt+F4）——自愈重建
        wvlog("browser_create 标记在窗已亡——自愈重建");
    }
    let parsed: tauri::Url = url.parse().map_err(|e| {
        wvlog(&format!("browser_create url 解析失败: {e}"));
        format!("URL 不合法：{e}")
    })?;
    // T-P3-168 实测：主窗移动/点击时子窗被主窗覆盖——设 owner（属主窗口）
    // 语义：owned 窗永远浮在属主之上、随属主最小化、不抢任务栏（内嵌面板
    // 子窗的正确 Windows 形态）。
    let main_hwnd = app
        .get_webview_window("main")
        .and_then(|m| m.hwnd().ok())
        .ok_or_else(|| "主窗未就绪".to_string())?;
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title("浏览器")
        .decorations(false)
        .skip_taskbar(true)
        .resizable(true)
        .inner_size(400.0, 300.0)
        .visible(true)
        .owner_raw(main_hwnd)
        .build()
        .map_err(|e| {
            wvlog(&format!("browser_create build 失败: {e}"));
            format!("子窗创建失败：{e}")
        })?;
    // 初始藏屏幕外（show 时对齐面板区域）
    use tauri::Manager;
    let _ = window.set_position(tauri::LogicalPosition::new(20_000.0, 20_000.0));
    registry.insert(label.clone(), true);
    wvlog("browser_create build 成功");
    Ok(label)
}

/// 上报面板偏移（UI ResizeObserver 调——Rust 侧 Moved/Resized 驱动跟随）。
#[tauri::command]
pub async fn browser_set_offset(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let state = app
        .try_state::<PanelOffset>()
        .ok_or_else(|| "panel offset 未初始化".to_string())?;
    *state.0.lock().map_err(|_| "offset 锁中毒")? = (x, y, width.max(1), height.max(1));
    sync_browser_bounds(&app);
    Ok(())
}

/// 对齐 bounds 并显示（tab 切换/首次打开时调——显示即对齐当前面板区域）。
#[tauri::command]
pub async fn browser_show(
    app: AppHandle,
    label: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let state = app
        .try_state::<PanelOffset>()
        .ok_or_else(|| "panel offset 未初始化".to_string())?;
    *state.0.lock().map_err(|_| "offset 锁中毒")? = (x, y, width.max(1), height.max(1));
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| "tab 不存在".to_string())?;
    let origin = viewport_origin(&app).unwrap_or((x, y));
    let _ = window.set_position(tauri::PhysicalPosition::new(origin.0 + x, origin.1 + y));
    let _ = window.set_size(tauri::PhysicalSize::new(width.max(1), height.max(1)));
    let _ = window.show();
    Ok(())
}

/// 隐藏（tab 切走/面板收起——保活不销毁）。
#[tauri::command]
pub fn browser_hide(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.hide();
    }
    Ok(())
}

/// 导航（地址栏/前进后退刷新由前端 history 面承担）。
#[tauri::command]
pub async fn browser_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| "tab 不存在".to_string())?;
    let parsed: tauri::Url = url.parse().map_err(|e| format!("URL 不合法：{e}"))?;
    let _ = window.navigate(parsed);
    Ok(())
}

/// 销毁 tab 子窗（关闭 Tab 时——真回收）。
#[tauri::command]
pub async fn browser_destroy(app: AppHandle, label: String) -> Result<(), String> {
    let state = app
        .try_state::<BrowserRegistry>()
        .ok_or_else(|| "browser registry 未初始化".to_string())?;
    let mut registry = state.0.lock().map_err(|_| "registry 锁中毒".to_string())?;
    registry.remove(&label);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.destroy();
    }
    wvlog(&format!("browser_destroy label={label}"));
    Ok(())
}

/// 在指定 tab 内执行 JS（后退/前进/刷新由前端经此驱动）。
#[tauri::command]
pub async fn browser_eval(app: AppHandle, label: String, js: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| "tab 不存在".to_string())?;
    let _ = window.eval(&js);
    Ok(())
}

/// 同步隐藏全部子窗（T-P3-168：关闭到托盘/最小化联动——子窗是独立
/// 窗口，主窗 hide 不会带走它们；CloseRequested 事件回调直接调）。
pub fn hide_all_sync(app: &AppHandle) {
    if let Some(state) = app.try_state::<BrowserRegistry>() {
        if let Ok(registry) = state.0.lock() {
            for label in registry.keys() {
                if let Some(window) = app.get_webview_window(label) {
                    let _ = window.hide();
                }
            }
        }
    }
}

/// 注册表挂载（lib.rs setup 调）。
pub fn manage_registry(app: &AppHandle) {
    app.manage(BrowserRegistry(Mutex::new(HashMap::new())));
}
