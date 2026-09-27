//! aegent 桌面壳（K2/T-P1-129）——Tauri 2 最小壳：单窗口 WebView 加载
//! `ui/` 静态资产（frontendDist，零前端构建链），页面 JS 经 WS 连本机
//! node host 进程（内核在 Node 不在 Rust——cc-switch"Rust 全后端"形态
//! 不适用，卡序头约束 2）。Rust 侧零业务零插件（九插件群不取——展卡
//! 核对结论④）；host 进程管理（sidecar 打包/自启）随真实分发记档。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
