/**
 * U3/T-P3-105 会话历史视图（T-P3-134 · UI 批次 A④ 迁入；T-P3-136 批次 C④
 * 重做）——T-P3-156 布局批（方案 A）起退役：会话清单/未读/只读查看/删除
 * 已迁入 ui/sidebar.js（侧栏「最近会话」分段），导入 JSON 在分段头「导入」
 * 钮。本文件保留为深链兼容壳——#history 已在 router.parseHash 重定向 #chat。
 */

export async function render() {
  location.hash = "#chat"; // 深链兜底（正常路径 router 已重定向）
}
