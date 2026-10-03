/**
 * U13/T-P3-112 通知中心视图（T-P3-134 · UI 批次 A④ 迁入；T-P3-136 · UI 批
 * 次 C⑤ 套组件类形态）——N5 五类分型的清单消费（审批/提问以卡片弹出不进
 * 清单）。notifications 数组在 state.js 共享（入口消费信封 push + 徽标常
 * 显），本视图订阅重渲染。
 */

import { notifications, subscribeNotify, updateNotifyBadge } from "../state.js";
import { oneLine, fmtTime, KIND_ICONS } from "../feedback.js";
import { icon as iconEl } from "../icons.js";

const TEMPLATE = `
<aside id="notify-panel" aria-label="通知中心">
  <header class="page-head">
    <h2 class="tab-title">通知中心</h2>
    <div class="page-head-actions">
      <button id="notify-clear" type="button" class="btn">清空</button>
      <button id="notify-close" type="button" class="btn btn-ghost">返回对话</button>
    </div>
  </header>
  <div class="page-body">
    <ul id="notify-list"></ul>
    <p class="hint">审批/提问以卡片弹出（不进清单）；此处为轮结算/后台任务/端面变化的分型通知。</p>
  </div>
</aside>
`;

export function renderNotifyList() {
  const list = document.getElementById("notify-list");
  if (list === null) return; // 视图未挂载（清单只在页面打开时渲染——徽标常显）
  list.replaceChildren();
  if (notifications.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.innerHTML =
      '<div class="empty-title">暂无通知</div><div class="empty-desc">轮结算、后台任务与端面变化会出现在这里。</div>';
    list.appendChild(empty);
  }
  for (const n of [...notifications].reverse()) {
    const li = document.createElement("li");
    li.className = "notify-row";
    const iconWrap = document.createElement("span");
    iconWrap.className = "notify-icon";
    iconWrap.replaceChildren(iconEl(KIND_ICONS[n.kind] ?? "bell", { cls: "icon-sm" }));
    const copy = document.createElement("div");
    copy.className = "row-copy";
    const kind = document.createElement("div");
    kind.className = "notify-kind";
    kind.textContent = n.kind;
    const data = document.createElement("div");
    data.className = "notify-data";
    data.textContent = oneLine(JSON.stringify(n.data ?? {}), 160);
    copy.append(kind, data);
    const time = document.createElement("span");
    time.className = "notify-time";
    time.textContent = fmtTime(n.at);
    li.append(iconWrap, copy, time);
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
