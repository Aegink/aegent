/**
 * 右上角进度小弹窗（T-P3-156 方案 U——需求一.5/六：任务进行时右上角实时
 * 更新进度、避免缓慢）。
 *
 * 形态（zcode ConversationStatusPanel mini/panel 双态裁剪 + pi-desktop
 * ActivityGroup live ticker 的信息密度）：
 * - 收起 pill（运行时出现）：运行中 mm:ss（圆点）· 当前工具摘要 —— 每秒 tick
 *   （tabular-nums，BackgroundTaskElapsedLabel 的本地时钟基线语义）；
 * - 点击展开面板：当前任务（活动项目 · 会话标题）+ 当前工具 + 进程段
 *   （T-P3-160：todo_write 实时喂入的进行中/待处理/已完成三态——zcode
 *   statusPanel todo 语义）+ 最近事件迷你列表（环形缓冲 6 条）+ 审批挂起提示；
 * - 终态驻留：idle → 「完成 · 用时 mm:ss」8s 后收起（点击可提前收起）；
 * - 审批挂起：pill 转橙 + 面板首行「等待你的审批」。
 *
 * 事件源：agent:busy / agent:idle / agent:awaiting(-clear) CustomEvent
 * （app.js 广播）+ notifyToolCall（tool/call 事件转发）——纯 UI 件，内核
 * 零改动。
 */

import { settingsCache } from "./state.js";

const DONE_STAY_MS = 8000;
const EVENT_BUFFER_MAX = 6;

let dock = null; // #progress-dock（收起 pill 宿主）
let panel = null; // 展开面板（浮动层——dock 兄弟节点）
let busySince = 0; // Date.now()——本地时钟基线
let tickTimer = null;
let doneTimer = null;
let awaiting = false;
let running = false;
const eventBuffer = [];
/** 最新 todo 清单（todo_write 实时推入——{content,status} 数组）。 */
let todosCache = [];
let todosShowDone = false; // 已完成折叠开关（zcode statusPanel fold 语义）

export function initProgressDock() {
  dock = document.getElementById("progress-dock");
  if (dock === null) return;
  panel = document.createElement("div");
  panel.className = "progress-panel";
  panel.hidden = true;
  dock.after(panel);
  dock.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) paintPanel();
  });
  window.addEventListener("agent:busy", () => notifyBusy());
  window.addEventListener("agent:idle", () => notifyIdle());
  window.addEventListener("agent:awaiting", () => {
    awaiting = true;
    paintAll();
  });
  window.addEventListener("agent:awaiting-clear", () => {
    awaiting = false;
    paintAll();
  });
  paintAll();
}

/** turn/start → 运行态计时开始。 */
export function notifyBusy() {
  if (!running) busySince = Date.now();
  running = true;
  if (doneTimer !== null) {
    clearTimeout(doneTimer);
    doneTimer = null;
  }
  if (tickTimer === null) tickTimer = setInterval(paintPill, 1000);
  paintAll();
}

/** idle → 终态驻留 8s 后收起。启动即宣告的 idle（无运行史）不驻留——
 * 内核 agent-process 起手 kick 就发 idle，避免"完成 0:00"误报。 */
export function notifyIdle() {
  const wasRunning = running;
  running = false;
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (wasRunning) {
    pushEvent("本轮任务完成");
    paintAll();
    if (doneTimer !== null) clearTimeout(doneTimer);
    doneTimer = setTimeout(() => {
      doneTimer = null;
      if (!running) {
        dock.hidden = true;
        panel.hidden = true;
      }
    }, DONE_STAY_MS);
  } else {
    paintAll(); // 静默复位（首次 idle——不显示终态）
  }
}

/** tool/call → 当前工具摘要 + 事件缓冲（args 只留首行防泄敏/防长）。 */
export function notifyToolCall(toolName, argsPreview) {
  pushEvent(`调用工具 ${toolName}${argsPreview !== "" ? `：${argsPreview}` : ""}`);
  dock.dataset.tool = toolName ?? "";
  paintAll();
}

/** todo_write 实时喂入（app.js renderEvent tool/call 转发——仅 live 流）。 */
export function notifyTodos(items) {
  if (!Array.isArray(items)) return;
  todosCache = items
    .filter((t) => t !== null && typeof t === "object" && typeof t.content === "string")
    .map((t) => ({ content: String(t.content), status: String(t.status ?? "pending") }));
  todosShowDone = false;
  // T-P3-164：任务列表面板同源消费（pane-tasks 监听——重绘+首次自动打开）
  window.dispatchEvent(new CustomEvent("todos:updated"));
  paintAll();
}

/** 任务列表面板数据面（pane-tasks 同源读取）。 */
export function getTodos() {
  return [...todosCache];
}

/** 当前动作行（pane-tasks 顶部——最近一次工具调用摘要）。 */
export function getRunningTool() {
  return dock?.dataset?.tool ?? "";
}

export function notifyEventLine(text) {
  pushEvent(text);
  if (panel.hidden === false) paintPanel();
}

function pushEvent(text) {
  if (text === "") return;
  eventBuffer.push({ ts: Date.now(), text });
  if (eventBuffer.length > EVENT_BUFFER_MAX) eventBuffer.shift();
}

function elapsedLabel() {
  const ms = Math.max(0, Date.now() - busySince);
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return m > 0 ? `${m}:${s}` : `0:${s}`;
}

function currentTaskLabel() {
  const project = (settingsCache?.projects ?? []).find((p) => p.id === settingsCache?.activeProject);
  return project !== undefined ? project.name : "当前会话";
}

function currentToolLabel() {
  return dock.dataset.tool ?? "";
}

function paintAll() {
  paintPill();
  if (panel.hidden === false) paintPanel();
}

function paintPill() {
  if (dock === null) return;
  if (running) {
    dock.hidden = false;
    const tool = currentToolLabel();
    dock.className = `progress-pill${awaiting ? " awaiting" : ""}`;
    dock.innerHTML = `<span class="progress-dot"></span><span class="progress-time">${elapsedLabel()}</span><span class="progress-tool">${escapeHtml(tool !== "" ? tool : "执行中")}…</span>`;
    return;
  }
  if (eventBuffer.length > 0 && doneTimer !== null) {
    // 终态驻留窗口（idle 后 8s 内）
    dock.hidden = false;
    dock.className = "progress-pill done";
    const doneDot = document.createElement("span");
    doneDot.className = "progress-dot done";
    dock.replaceChildren(doneDot, document.createTextNode(`完成 · 用时 ${elapsedLabel()}`));
    return;
  }
  dock.hidden = true;
}

function paintPanel() {
  if (panel === null) return;
  panel.replaceChildren();
  const head = document.createElement("div");
  head.className = "progress-panel-head";
  head.innerHTML = awaiting
    ? `<span class="progress-dot awaiting"></span><b>等待你的审批</b>（审批卡在聊天流——也可去通知中心）`
    : running
      ? `<span class="progress-dot"></span><b>${escapeHtml(currentTaskLabel())}</b> · 执行中 ${elapsedLabel()}`
      : `<span class="progress-dot done"></span><b>${escapeHtml(currentTaskLabel())}</b> · 已完成`;
  panel.appendChild(head);

  if (running && currentToolLabel() !== "") {
    const tool = document.createElement("div");
    tool.className = "progress-panel-tool";
    tool.textContent = `当前工具：${currentToolLabel()}`;
    panel.appendChild(tool);
  }

  // 进程段（T-P3-160 需求 5）：进行中完整显示 / 待处理列首几项 / 已完成
  // 折叠为计数行（点击展开）——zcode statusPanel todo 三态同构
  if (todosCache.length > 0) {
    const done = todosCache.filter((t) => t.status === "completed");
    const doing = todosCache.filter((t) => t.status === "in_progress");
    const waiting = todosCache.filter((t) => t.status !== "completed" && t.status !== "in_progress");
    const seg = document.createElement("div");
    seg.className = "progress-panel-todos";
    const segHead = document.createElement("div");
    segHead.className = "progress-todos-head";
    segHead.textContent = `进程  ${String(done.length)}/${String(todosCache.length)}`;
    seg.appendChild(segHead);
    const rowOf = (t, cls) => {
      const row = document.createElement("div");
      row.className = `progress-todo ${cls}`;
      row.textContent = t.content;
      return row;
    };
    for (const t of doing) seg.appendChild(rowOf(t, "doing"));
    if (waiting.length > 0) {
      for (const t of waiting.slice(0, 5)) seg.appendChild(rowOf(t, "waiting"));
      if (waiting.length > 5) {
        const more = document.createElement("div");
        more.className = "progress-todo-fold";
        more.textContent = `待处理 ${String(waiting.length)} 项（显示前 5）`;
        seg.appendChild(more);
      }
    }
    if (done.length > 0) {
      const fold = document.createElement("button");
      fold.type = "button";
      fold.className = "progress-todo-fold";
      fold.textContent = todosShowDone ? `收起 ${String(done.length)} 项已完成` : `已完成 ${String(done.length)} 项`;
      fold.addEventListener("click", () => {
        todosShowDone = !todosShowDone;
        paintPanel();
      });
      seg.appendChild(fold);
      if (todosShowDone) for (const t of done) seg.appendChild(rowOf(t, "done"));
    }
    panel.appendChild(seg);
  }

  const list = document.createElement("div");
  list.className = "progress-panel-events";
  for (const item of [...eventBuffer].reverse()) {
    const line = document.createElement("div");
    line.className = "progress-panel-event";
    const time = new Date(item.ts);
    line.innerHTML = `<span class="progress-event-time">${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}:${String(time.getSeconds()).padStart(2, "0")}</span> ${escapeHtml(item.text)}`;
    list.appendChild(line);
  }
  if (list.children.length === 0) {
    const empty = document.createElement("div");
    empty.className = "progress-panel-event";
    empty.textContent = "暂无事件——等待 AI 动作…";
    list.appendChild(empty);
  }
  panel.appendChild(list);
}

function escapeHtml(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
