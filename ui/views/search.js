/**
 * U9/T-P3-108 跨会话搜索视图（T-P3-134 · UI 批次 A④ 从 app.js 原样迁入）——
 * query op:"search"（Q2 检索的 UI 消费）：命中列表（会话/时间/摘录）+
 * 点开只读续聊入口。
 */

import { sendQuery } from "../api.js";
import { getSessionId, hooks } from "../state.js";
import { appendLine, fmtTime } from "../feedback.js";
import { go } from "../router.js";

const TEMPLATE = `
<aside id="search-panel" aria-label="跨会话搜索">
  <header class="settings-head">
    <span>跨会话搜索</span>
    <button id="search-close" type="button">关闭</button>
  </header>
  <div class="settings-body">
    <form id="search-form">
      <input id="search-input" type="text" placeholder="内容子串（跨全部会话）" autocomplete="off" />
      <button type="submit">搜索</button>
    </form>
    <p id="search-meta" class="hint"></p>
    <ul id="search-results"></ul>
    <p class="hint">查看 = 只读恢复视图；续聊请在终端执行 aegent sessions resume &lt;id&gt;。</p>
  </div>
</aside>
`;

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
    for (const r of rows) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${r.sessionId} · ${r.type} · ${fmtTime(r.ts)}\n${(r.excerpt ?? "").replace(/\s+/g, " ")}`;
      const viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.textContent = "查看";
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
      li.append(label, viewBtn);
      list.appendChild(li);
    }
  });
}
