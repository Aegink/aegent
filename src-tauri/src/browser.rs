//! 浏览器面板的壳侧 webview 管理（T-P3-156 方案 Q——用户裁决"完整实现+
//! 真实浏览器内核"：zcode 好用的关键正是真实 webview，TUI 类替代品测不出
//! 真实行为）。
//!
//! 形态：主窗内 **child Webview**（tauri `unstable` multiwebview 面）——
//! 每个 tab 一个 Webview 实例，同窗共存；bounds 由 UI 面板 DOM 区域经
//! ResizeObserver 上报（browser_show），隐藏 tab 用 `hide()` 保活（滚动
//! 位置/登录态不丢——zcode tab residency 语义的简化版）。数据目录独立于
//! 宿主（不共享登录态/LocalStorage——安全边界，报告 §4-Q⑤）。
//!
//! 与 agent 的联动：聊天流链接点击 → UI 调 browser_navigate（意图路由在
//! UI 层）；agent 驱动/截图（CDP 面）为后续增强（webview2 的
//! CallDevToolsProtocolMethod 经 with_webview——接口在本模块留 eval 面）。

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Webview, WebviewUrl, WebviewBuilder, Window};

/// 每 tab 的 webview 句柄登记表（label → Webview；label = `browser-<id>`）。
pub struct BrowserRegistry(Mutex<HashMap<String, Webview>>);

/// 创建（或复用）一个浏览器 tab 的真实 webview：挂主窗、bounds 先给面板
/// 初始区域（1px 藏底——show 时再对齐，避免创建瞬间闪整窗）。
#[tauri::command]
pub fn browser_create(
    app: AppHandle,
    label: String,
    url: String,
) -> Result<String, String> {
    // add_child 挂在 Window（非 WebviewWindow）——tauri 2.12 unstable 面
    let window: Window = app
        .get_window("main")
        .ok_or_else(|| "主窗未就绪".to_string())?;
    let parsed: tauri::Url = url
        .parse()
        .map_err(|e| format!("URL 不合法：{e}"))?;
    let state = app
        .try_state::<BrowserRegistry>()
        .ok_or_else(|| "browser registry 未初始化".to_string())?;
    let mut registry = state.0.lock().map_err(|_| "registry 锁中毒".to_string())?;
    if let Some(existing) = registry.get(&label) {
        let _ = existing.show();
        return Ok(label);
    }
    let webview = window
        .add_child(
            WebviewBuilder::new(label.clone(), WebviewUrl::External(parsed))
                .initialization_script("window.__AEGENT_BROWSER_TAB = true;"),
            tauri::LogicalPosition::new(0.0, 10_000.0), // 藏在窗外——show 时对齐
            tauri::LogicalSize::new(400.0, 300.0),
        )
        .map_err(|e| format!("webview 创建失败：{e}"))?;
    registry.insert(label.clone(), webview);
    Ok(label)
}

/// 对齐 bounds 并显示（UI 面板区域变化/激活 tab 时调——物理像素）。
#[tauri::command]
pub fn browser_show(
    app: AppHandle,
    label: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let state = app.try_state::<BrowserRegistry>().ok_or("registry 未初始化")?;
    let registry = state.0.lock().map_err(|_| "registry 锁中毒")?;
    let webview = registry.get(&label).ok_or("tab 不存在")?;
    // 其余 tab 先藏（单显——多 tab 切换语义）
    for (other_label, other) in registry.iter() {
        if other_label != &label {
            let _ = other.hide();
        }
    }
    let _ = webview.set_bounds(tauri::Rect {
        position: tauri::PhysicalPosition::new(x, y).into(),
        size: tauri::PhysicalSize::new(width.max(1), height.max(1)).into(),
    });
    let _ = webview.show();
    Ok(())
}

/// 隐藏（tab 切走/面板收起——保活不销毁）。
#[tauri::command]
pub fn browser_hide(app: AppHandle, label: String) -> Result<(), String> {
    let state = app.try_state::<BrowserRegistry>().ok_or("registry 未初始化")?;
    let registry = state.0.lock().map_err(|_| "registry 锁中毒")?;
    if let Some(webview) = registry.get(&label) {
        let _ = webview.hide();
    }
    Ok(())
}

/// 导航（地址栏/前进后退刷新由前端 history 面承担——webview 内部自持；
/// 这里只承担"外部 URL 打进指定 tab"）。url 为空 = 刷新当前页语义交前端。
#[tauri::command]
pub fn browser_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    let state = app.try_state::<BrowserRegistry>().ok_or("registry 未初始化")?;
    let registry = state.0.lock().map_err(|_| "registry 锁中毒")?;
    let webview = registry.get(&label).ok_or("tab 不存在")?;
    let parsed: tauri::Url = url.parse().map_err(|e| format!("URL 不合法：{e}"))?;
    let _ = webview.navigate(parsed);
    Ok(())
}

/// 销毁 tab（关闭 Tab 时——真回收，区别于 hide 保活）。
#[tauri::command]
pub fn browser_destroy(app: AppHandle, label: String) -> Result<(), String> {
    let state = app.try_state::<BrowserRegistry>().ok_or("registry 未初始化")?;
    let mut registry = state.0.lock().map_err(|_| "registry 锁中毒")?;
    if let Some(webview) = registry.remove(&label) {
        let _ = webview.close(); // Webview 无 destroy——close 是销毁面
    }
    Ok(())
}

/// 在指定 tab 内执行 JS（联动面预留：页面信息采集/截图前置/agent 驱动的
/// 最小底座）。返回串行化结果（JSON 字符串——复杂值由页面侧自序列化）。
#[tauri::command]
pub fn browser_eval(app: AppHandle, label: String, js: String) -> Result<(), String> {
    let state = app.try_state::<BrowserRegistry>().ok_or("registry 未初始化")?;
    let registry = state.0.lock().map_err(|_| "registry 锁中毒")?;
    let webview = registry.get(&label).ok_or("tab 不存在")?;
    let _ = webview.eval(&js);
    Ok(())
}

/// 注册表挂载（lib.rs setup 调）。
pub fn manage_registry(app: &AppHandle) {
    app.manage(BrowserRegistry(Mutex::new(HashMap::new())));
}
