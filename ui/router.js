/**
 * aegent ui hash 路由（T-P3-134 · UI 批次 A③；T-P3-156 布局批改造）。
 *
 * T-P3-156 主界面重构后的一级路由：#chat（默认且恒在）/#settings[/section]
 * /#plugins/#usage/#notify/#search/#work（深链兼容）。旧路由重定向（方案 A
 * 8 项导航去向）：#projects/#history → 对话（项目列表/最近会话已迁侧栏两
 * 分段）。#plugins/#usage 保留独立 route——两页为 T-P3-148/T-P3-136 刚验收
 * 的完整页面形态，入口改经欢迎页/快捷键（Ctrl+U）/设置页跳转（插件），
 * 侧栏不再承载（记录于对照清单映射微调）。
 *
 * D 方案：settings 视图激活时主壳加 settings-mode 类——项目侧栏隐藏，
 * 设置页为独立形态（需求一.3）。
 */

const VIEW_MODULES = {
  settings: () => import("./views/settings.js"),
  plugins: () => import("./views/plugins.js"),
  usage: () => import("./views/usage.js"),
  work: () => import("./views/work.js"),
  import: () => import("./views/import.js"),
  notify: () => import("./views/notify.js"),
  search: () => import("./views/search.js"),
};

/** hash → 路由对象（纯函数——深链用例机验面）。未知/空 = 对话页。 */
export function parseHash(hash) {
  const raw = String(hash ?? "").replace(/^#\/?/, "");
  const [head, sub] = raw.split("/");
  if (head === "settings") return { view: "settings", section: sub || null };
  if (head === "work") return { view: "work", tab: sub ?? null };
  if (head === "plugins" || head === "usage" || head === "notify" || head === "search" || head === "import") {
    return { view: head };
  }
  // —— T-P3-156 重定向面：项目/历史已迁侧栏两分段（sidebar.js）——
  if (head === "projects" || head === "history") return { view: "chat" };
  return { view: "chat" };
}

let viewRoot = null;
let chatView = null;
let currentKey = "";
let currentModule = null;

/** 导航：同视图重复 go = 回对话（开关语义）；chat = 空 hash。 */
export function go(view) {
  const active = parseHash(location.hash).view;
  const target = typeof view === "string" ? parseHash(`#${view}`).view : view?.view ?? "chat";
  if (target !== "chat" && active === target) {
    location.hash = "#chat";
    return;
  }
  location.hash = target === "chat" ? "#chat" : `#${typeof view === "string" ? view : target}`;
}

async function applyRoute() {
  const route = parseHash(location.hash);
  const key = `${route.view}:${route.section ?? route.tab ?? ""}`;
  if (key === currentKey) return;
  currentKey = key;

  // D 方案：设置独立形态（无项目侧栏）——settings-mode 类随路由切换
  document.getElementById("app-shell")?.classList.toggle("settings-mode", route.view === "settings");

  // T-P3-166 需求 6：离开对话页收束全部面板（浏览器 child webview 是壳级
  // 悬浮物——pane DOM 被 view-root 替换后其关闭入口消失，webview 残留=关不掉）
  if (route.view !== "chat") {
    const pane = await import("./pane.js");
    pane.hideAllPanes();
  }

  // 卸载旧视图（toast 计时器/审批倒计时随视图卸载收束的纪律入口）
  if (currentModule !== null && typeof currentModule.unmount === "function") {
    try {
      currentModule.unmount();
    } catch {
      // 卸载清理失败不阻断导航（视图面非关键路径）
    }
  }
  currentModule = null;

  if (route.view === "chat") {
    viewRoot.replaceChildren(); // 清空卸载视图的残留 DOM（unmount 已先收束）
    viewRoot.hidden = true;
    chatView.hidden = false;
    return;
  }
  const mod = await VIEW_MODULES[route.view]();
  if (key !== currentKey) return; // 加载期间路由已再变——丢弃旧结果（竞态防呆）
  currentModule = mod;
  viewRoot.replaceChildren();
  viewRoot.hidden = false;
  chatView.hidden = true;
  try {
    await mod.render(viewRoot, route);
  } catch (e) {
    // 视图渲染失败可见化（T-P3-137 教训：异常静默吞 = 用户面对无提示的
    // 空页面无法报障——直接在路由容器呈现错误摘要，详情进 console）
    console.error("视图渲染失败", route.view, e);
    viewRoot.replaceChildren();
    const box = document.createElement("div");
    box.className = "render-error";
    // T-P3-147：附带堆栈前两行——间歇渲染错误（null deref）的定位面
    const stackTop = String(e?.stack ?? "")
      .split("\n")
      .slice(1, 3)
      .map((l) => l.trim())
      .join("  <-  ");
    box.textContent = `页面加载出错：${e?.message ?? String(e)}\n${stackTop}`;
    box.style.whiteSpace = "pre-wrap";
    console.error("视图渲染失败", route.view, e);
    viewRoot.appendChild(box);
  }
}

/** 路由启动：绑定 hashchange + 首路由解析（含深链直达）。 */
export function startRouter(container, chat) {
  viewRoot = container;
  chatView = chat;
  window.addEventListener("hashchange", () => void applyRoute());
  void applyRoute();
}
