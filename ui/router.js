/**
 * aegent ui hash 路由（T-P3-134 · UI 批次 A③）——页面化主内容的导航机制：
 * #chat（默认）/#settings[/section]/#usage/#work[/tab]/#notify/#history/#search。
 * 深链可直达（首路由解析 + hashchange）；重复 go 当前视图 = 回对话（侧栏
 * 按钮的开关语义——原 hidden 切换行为的路由等价面）。视图经原生动态
 * import() 懒加载；视图契约 = render(container, params) + 可选 unmount()。
 */

const VIEW_MODULES = {
  settings: () => import("./views/settings.js"),
  usage: () => import("./views/usage.js"),
  work: () => import("./views/work.js"),
  notify: () => import("./views/notify.js"),
  history: () => import("./views/history.js"),
  search: () => import("./views/search.js"),
};

/** hash → 路由对象（纯函数——深链用例机验面）。未知/空 = 对话页。 */
export function parseHash(hash) {
  const raw = String(hash ?? "").replace(/^#\/?/, "");
  const [head, sub] = raw.split("/");
  if (head === "settings") return { view: "settings", section: sub || null };
  if (head === "work") return { view: "work", tab: sub || null };
  if (head === "usage" || head === "notify" || head === "history" || head === "search") {
    return { view: head };
  }
  return { view: "chat" };
}

let viewRoot = null;
let chatView = null;
let currentKey = "";
let currentModule = null;

/** 导航：同视图重复 go = 回对话（开关语义）；chat = 空 hash。 */
export function go(view) {
  const active = parseHash(location.hash).view;
  if (view !== "chat" && active === view) {
    location.hash = "#chat";
    return;
  }
  location.hash = view === "chat" ? "#chat" : `#${view}`;
}

async function applyRoute() {
  const route = parseHash(location.hash);
  const key = `${route.view}:${route.section ?? route.tab ?? ""}`;
  if (key === currentKey) return;
  currentKey = key;

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
    box.textContent = `页面加载出错：${e?.message ?? String(e)}`;
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
