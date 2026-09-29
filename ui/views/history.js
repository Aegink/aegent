/**
 * U3/T-P3-105 会话历史视图（T-P3-134 · UI 批次 A④ 从 app.js 原样迁入）——
 * query op:"sessions" 清单 + 只读查看 + 删除确认（settings op:"session-delete"
 * ——host 面写操作）；续聊 = aegent sessions resume <id>（入口提示）。
 */

import { sendQuery, sendSettings } from "../api.js";
import { getSessionId, hooks } from "../state.js";
import { appendLine, fmtTime } from "../feedback.js";
import { go } from "../router.js";

const TEMPLATE = `
<aside id="history-panel" aria-label="会话历史">
  <header class="settings-head">
    <span>会话历史</span>
    <button id="history-close" type="button">关闭</button>
  </header>
  <div class="settings-body">
    <ul id="history-list"></ul>
    <p class="hint">查看 = 只读恢复视图；续聊请在终端执行 aegent sessions resume &lt;id&gt;。</p>
  </div>
</aside>
`;

async function load() {
  const envelope = await sendQuery({ sessionId: getSessionId() || "-", op: "sessions" });
  const list = document.getElementById("history-list");
  if (list === null) return; // 回包晚于导航——丢弃
  list.replaceChildren();
  if (!envelope.ok) {
    const li = document.createElement("li");
    li.textContent = `会话清单不可用：${envelope.error?.message ?? ""}`;
    list.appendChild(li);
  } else {
    const sessions = envelope.result.sessions ?? [];
    if (sessions.length === 0) {
      const li = document.createElement("li");
      li.textContent = "（库中无会话——带 --db 跑一次会话即落库）";
      list.appendChild(li);
    }
    for (const s of sessions) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${s.title ? `${s.title} · ` : ""}${s.sessionId}（${s.eventCount} 事件，更新 ${fmtTime(s.updatedTs)}）`;
      const viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.textContent = "查看";
      viewBtn.addEventListener("click", async () => {
        go("chat"); // 先回对话页（流重建目标可见）——再拉事件快照
        const view = await sendQuery({ sessionId: s.sessionId, op: "events" });
        if (!view.ok) {
          appendLine(`查看失败：${view.error?.message ?? ""}`, "warn");
          return;
        }
        hooks.resetStreamView();
        hooks.renderHistory(view.result.events ?? []);
        appendLine("── 只读视图：续聊请执行 aegent sessions resume " + s.sessionId + " ──", "warn");
      });
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "删除";
      delBtn.className = "danger";
      delBtn.addEventListener("click", async () => {
        // 删除确认对话框（硬删除不可恢复——U3 卡面要求）
        if (!window.confirm(`确认删除会话 ${s.sessionId}？事件不可恢复。`)) return;
        const del = await sendSettings({ op: "session-delete", sessionId: s.sessionId });
        if (del.ok) appendLine(`已删除会话 ${s.sessionId}`, "meta");
        else appendLine(`删除失败：${del.error?.message ?? ""}`, "warn");
        void load(); // 刷新清单
      });
      li.append(label, viewBtn, delBtn);
      list.appendChild(li);
    }
  }
}

export async function render(container) {
  container.innerHTML = TEMPLATE;
  document.getElementById("history-close").addEventListener("click", () => {
    go("chat");
  });
  await load();
}
