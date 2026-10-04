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
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title("浏览器")
        .decorations(false)
        .skip_taskbar(true)
        .resizable(true)
        .inner_size(400.0, 300.0)
        .visible(true)
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

/// 对齐 bounds 并显示（UI 面板区域变化/激活 tab 时调——物理像素）。
#[tauri::command]
pub async fn browser_show(
    app: AppHandle,
    label: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| "tab 不存在".to_string())?;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
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

/// 注册表挂载（lib.rs setup 调）。
pub fn manage_registry(app: &AppHandle) {
    app.manage(BrowserRegistry(Mutex::new(HashMap::new())));
}
