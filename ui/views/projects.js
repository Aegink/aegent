/**
 * 项目中心视图（T-P3-150 原实现）——T-P3-156 布局批（方案 A）起退役：
 * 全部交互（项目列表/任务/添加三模式/编辑/文件树）已迁入 ui/sidebar.js
 * （侧栏两分段 + 文件树滑入层），文件查看迁入 ui/pane.js（右侧面板宿主）。
 * 本文件保留为深链兼容壳——#projects 已在 router.parseHash 重定向 #chat。
 */

export async function render() {
  // 深链兜底（正常路径 router 已重定向，不应到达）——回对话页
  location.hash = "#chat";
}
