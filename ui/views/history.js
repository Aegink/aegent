/**
 * U3/T-P3-105 会话历史视图（T-P3-134 · UI 批次 A④ 迁入；T-P3-136 · UI 批
 * 次 C④ 重做形态）——query op:"sessions" 清单 + 只读查看 + 删除确认
 * （settings op:"session-delete"——host 面写操作）；续聊 = aegent sessions
 * resume <id>（入口提示）。批 C 新增：按时间分组（今天/昨天/更早——
 * updatedTs 本地日）+ 未读点 + 时间显示。
 * 未读判定 = 本端 localStorage 已读标记（无 wire 面——跨端不同步记档）：
 * 当前会话与点过「查看」的会话记已读，updatedTs 晚于已读时间即未读。
 */

import { sendQuery, sendSettings } from "../api.js";
import { getSessionId, hooks } from "../state.js";
import { appendLine, fmtTime } from "../feedback.js";
import { go } from "../router.js";

const READ_KEY = "aegent.readSessions";

const TEMPLATE = `
<aside id="history-panel" aria-label="会话历史">
  <header class="page-head">
    <h2 class="tab-title">会话历史</h2>
    <button id="history-close" type="button" class="btn btn-ghost">返回对话</button>
  </header>
  <div class="page-body">
    <div id="history-list"></div>
    <p class="hint">查看 = 只读恢复视图；续聊请在终端执行 aegent sessions resume &lt;id&gt;。</p>
  </div>
</aside>
`;

function readMap() {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function markRead(sessionId, ts) {
  const map = readMap();
  if ((map[sessionId] ?? 0) >= ts) return;
  map[sessionId] = ts;
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(map));
  } catch {
    // 存储不可用（隐私模式等）——未读点退化为常显，不影响清单功能
  }
}

function isUnread(session, map) {
  return (map[session.sessionId] ?? 0) < (session.updatedTs ?? 0);
}

/** 本地日起点（epoch ms——分组与时间显示共用）。 */
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function groupLabel(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return "更早";
  const now = new Date();
  const day = startOfDay(new Date(ts));
  const today = startOfDay(now);
  if (day === today) return "今天";
  if (day === today - 86_400_000) return "昨天";
  return "更早";
}

/** 行内时间显示：今天 = HH:MM，昨天 = 昨天 HH:MM，更早 = 完整日期。 */
function rowTimeLabel(ts, label) {
  if (!Number.isFinite(ts) || ts <= 0) return "?";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (label === "今天") return hm;
  if (label === "昨天") return `昨天 ${hm}`;
  return fmtTime(ts);
}

async function viewSession(s) {
  markRead(s.sessionId, Date.now());
  go("chat"); // 先回对话页（流重建目标可见）——再拉事件快照
  const view = await sendQuery({ sessionId: s.sessionId, op: "events" });
  if (!view.ok) {
    appendLine(`查看失败：${view.error?.message ?? ""}`, "warn");
    return;
  }
  hooks.resetStreamView();
  hooks.renderHistory(view.result.events ?? []);
  appendLine("── 只读视图：续聊请执行 aegent sessions resume " + s.sessionId + " ──", "warn");
}

async function deleteSession(s, reload) {
  // 删除确认对话框（硬删除不可恢复——U3 卡面要求）
  if (!window.confirm(`确认删除会话 ${s.sessionId}？事件不可恢复。`)) return;
  const del = await sendSettings({ op: "session-delete", sessionId: s.sessionId });
  if (del.ok) appendLine(`已删除会话 ${s.sessionId}`, "meta");
  else appendLine(`删除失败：${del.error?.message ?? ""}`, "warn");
  void reload(); // 刷新清单
}

function sessionRow(s, label, map, reload) {
  const row = document.createElement("div");
  row.className = "history-row";
  const copy = document.createElement("div");
  copy.className = "row-copy";
  const title = document.createElement("div");
  title.className = "history-title";
  title.textContent = s.title || s.sessionId;
  const meta = document.createElement("div");
  meta.className = "history-meta";
  meta.textContent = `${s.sessionId} · ${s.eventCount} 事件 · ${rowTimeLabel(s.updatedTs, label)}`;
  copy.append(title, meta);
  row.appendChild(copy);
  if (isUnread(s, map)) {
    const dot = document.createElement("span");
    dot.className = "unread-dot";
    dot.title = "有更新";
    row.appendChild(dot);
  }
  const viewBtn = document.createElement("button");
  viewBtn.type = "button";
  viewBtn.textContent = "查看";
  viewBtn.className = "btn";
  viewBtn.addEventListener("click", () => void viewSession(s));
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.textContent = "删除";
  delBtn.className = "btn btn-danger";
  delBtn.addEventListener("click", () => void deleteSession(s, reload));
  row.append(viewBtn, delBtn);
  return row;
}

async function load() {
  const envelope = await sendQuery({ sessionId: getSessionId() || "-", op: "sessions" });
  const list = document.getElementById("history-list");
  if (list === null) return; // 回包晚于导航——丢弃
  list.replaceChildren();
  if (!envelope.ok) {
    const fail = document.createElement("p");
    fail.className = "hint";
    fail.textContent = `会话清单不可用：${envelope.error?.message ?? ""}`;
    list.appendChild(fail);
    return;
  }
  const sessions = (envelope.result.sessions ?? [])
    .slice()
    .sort((a, b) => (b.updatedTs ?? 0) - (a.updatedTs ?? 0));
  if (sessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="empty-title">还没有历史会话</div><div class="empty-desc">带 --db 跑一次会话即落库——对话记录会出现在这里。</div>`;
    list.appendChild(empty);
    return;
  }
  // 当前会话视为已读（正在其中——不计未读）
  if (getSessionId() !== "") markRead(getSessionId(), Date.now());
  const map = readMap();
  let lastLabel = null;
  for (const s of sessions) {
    const label = groupLabel(s.updatedTs);
    if (label !== lastLabel) {
      lastLabel = label;
      const head = document.createElement("div");
      head.className = "history-group-title";
      head.textContent = label;
      list.appendChild(head);
    }
    list.appendChild(sessionRow(s, label, map, load));
  }
}

export async function render(container) {
  container.innerHTML = TEMPLATE;
  document.getElementById("history-close").addEventListener("click", () => {
    go("chat");
  });
  await load();
}
