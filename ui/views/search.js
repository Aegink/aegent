/**
 * U9/T-P3-108 跨会话搜索视图（T-P3-134 · UI 批次 A④ 迁入；T-P3-136 · UI 批
 * 次 C⑤ 套组件类形态）——query op:"search"（Q2 检索的 UI 消费）：命中列
 * 表（会话/时间/摘录）+ 点开只读续聊入口。
 */

import { sendQuery } from "../api.js";
import { getSessionId, hooks } from "../state.js";
import { appendLine, fmtTime } from "../feedback.js";
import { go } from "../router.js";

const TEMPLATE = `
<aside id="search-panel" aria-label="跨会话搜索">
  <header class="page-head">
    <h2 class="tab-title">跨会话搜索</h2>
    <button id="search-close" type="button" class="btn btn-ghost">返回对话</button>
  </header>
  <div class="page-body">
    <form id="search-form" class="search-bar">
      <input id="search-input" class="input" type="text" placeholder="内容子串（跨全部会话）" autocomplete="off" />
      <button type="submit" class="btn btn-primary">搜索</button>
    </form>
    <p id="search-meta" class="hint"></p>
    <ul id="search-results"></ul>
    <p class="hint">查看 = 只读恢复视图；续聊请在终端执行 aegent sessions resume &lt;id&gt;。</p>
  </div>
</aside>
`;

function resultRow(r) {
  const li = document.createElement("li");
  li.className = "search-row";
  const head = document.createElement("div");
  head.className = "search-row-head";
  const session = document.createElement("span");
  session.className = "chip-ui";
  session.textContent = r.sessionId;
  const type = document.createElement("span");
  type.className = "search-type";
  type.textContent = r.type;
  const time = document.createElement("span");
  time.className = "search-time";
  time.textContent = fmtTime(r.ts);
  head.append(session, type, time);
  const excerpt = document.createElement("div");
  excerpt.className = "search-excerpt";
  excerpt.textContent = (r.excerpt ?? "").replace(/\s+/g, " ");
  const viewBtn = document.createElement("button");
  viewBtn.type = "button";
  viewBtn.textContent = "查看";
  viewBtn.className = "btn";
  viewBtn.addEventListener("click", async () => {
    go("chat"); // 先回对话页（流重建目标可见）——再拉事件快照
    const view = await sendQuery({ sessionId: r.sessionId, op: "events" });
    if (!view.ok) {
      appendLine(`查看失败：${view.error?.message ?? ""}`, "warn");
      return;
    }
    hooks.resetStreamView();
    hooks.renderHistory(view.result.events ?? []);
    appendLine("── 只读视图：续聊请执行 aegent sessions resume " + r.sessionId + " ──", "warn");
  });
  li.append(head, excerpt, viewBtn);
  return li;
}

export async function render(container) {
  container.innerHTML = TEMPLATE;
  document.getElementById("search-close").addEventListener("click", () => {
    go("chat");
  });
  const searchInput = document.getElementById("search-input");
  searchInput.focus();
  document.getElementById("search-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const q = searchInput.value.trim();
    if (q === "") return;
    const envelope = await sendQuery({
      sessionId: getSessionId() || "-",
      op: "search",
      criteria: { contentLike: q, limit: 50 },
    });
    const list = document.getElementById("search-results");
    const meta = document.getElementById("search-meta");
    if (list === null) return; // 回包晚于导航——丢弃
    list.replaceChildren();
    if (!envelope.ok) {
      meta.textContent = `检索不可用：${envelope.error?.message ?? ""}`;
      return;
    }
    const rows = envelope.result.rows ?? [];
    meta.textContent = `命中 ${envelope.result.total} 条（显示 ${rows.length}）`;
    for (const r of rows) list.appendChild(resultRow(r));
  });
}
