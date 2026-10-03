//! T-P3-158 反馈 2：系统文件夹选择器（添加项目·本机文件夹 tab）。
//! rfd 直挂自定义 command——不加 dialog 插件（"九插件群不取"纪律沿用：
//! browser_* 自定义命令同款，无需 capability 面）。阻塞对话框放
//! spawn_blocking 线程（Windows 模态消息泵在创建线程自洽，不占主线程）。

/// 打开系统文件夹选择对话框，返回所选目录的本地路径（取消 = None）。
#[tauri::command]
pub async fn pick_folder() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择项目文件夹")
            .pick_folder()
    })
    .await
    .ok() // JoinError → 取消语义（不 panic 壳）
    .flatten()
    .map(|p| p.to_string_lossy().to_string())
}
