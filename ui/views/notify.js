/**
 * U13/T-P3-112 通知中心视图（T-P3-134 · UI 批次 A④ 从 app.js 原样迁入）——
 * N5 五类分型的清单消费（审批/提问以卡片弹出不进清单）。notifications 数组
 * 在 state.js 共享（入口消费信封 push + 徽标常显），本视图订阅重渲染。
 */

import { notifications, subscribeNotify, updateNotifyBadge } from "../state.js";
import { oneLine, fmtTime, KIND_ICONS } from "../feedback.js";

const TEMPLATE = `
<aside id="notify-panel" aria-label="通知中心">
  <header class="settings-head">
    <span>通知中心</span>
    <button id="notify-clear" type="button">清空</button>
    <button id="notify-close" type="button">关闭</button>
  </header>
  <div class="settings-body">
    <ul id="notify-list"></ul>
    <p class="hint">审批/提问以卡片弹出（不进清单）；此处为轮结算/后台任务/端面变化的分型通知。</p>
  </div>
</aside>
`;

export function renderNotifyList() {
  const list = document.getElementById("notify-list");
  if (list === null) return; // 视图未挂载（清单只在页面打开时渲染——徽标常显）
  list.replaceChildren();
  for (const n of [...notifications].reverse()) {
    const li = document.createElement("li");
    li.textContent = `${KIND_ICONS[n.kind] ?? "🔔"} [${n.kind}] ${oneLine(JSON.stringify(n.data ?? {}), 160)} · ${fmtTime(n.at)}`;
    list.appendChild(li);
  }
  updateNotifyBadge();
}

let notifyUnsubscribe = null;

export async function render(container) {
  container.innerHTML = TEMPLATE;
  document.getElementById("notify-close").addEventListener("click", () => {
    location.hash = "#chat";
  });
  document.getElementById("notify-clear").addEventListener("click", () => {
    notifications.length = 0;
    renderNotifyList();
  });
  renderNotifyList();
  // 新通知到达时重渲染（unmount 退订——订阅泄漏防线）
  notifyUnsubscribe = subscribeNotify(renderNotifyList);
}

export function unmount() {
  if (notifyUnsubscribe !== null) {
    notifyUnsubscribe();
    notifyUnsubscribe = null;
  }
}
