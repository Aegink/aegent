/**
 * 输入 Tab 栏 + 排队"等待中"条（T-P3-156 方案 K/L——需求四）。
 *
 * L（需求四：附件/权限/用量/模型常驻可见）：
 * - 📎 附件：隐藏 file input（multiple）→ 既有 addAttachment 链（10MB/件、
 *   8 件/消息限额不变）；图片能力提示（方案 N）在打磨批接线。
 * - 🔒 权限档 pill：五档菜单（PERMISSION_MODE_UI 与 kernel/session-config
 *   同源复制——basic.js 导出）→ applyPermissionMode（settings 持久化 +
 *   config/refresh 会话内即时生效，回执 toast 在 app.js 的 W 消费）。
 * - ☰ 上下文 % pill：数据源 = query op:"usage"（hello 后与每轮结算后由
 *   app.js 拉取并推入 refreshContextUsage）——≥80% 橙、≥95% 红（qwen
 *   ContextUsageDisplay 阈值语义）；点击弹本会话用量明细。
 * - ✦ 模型 pill：菜单 = settings.providers × models（本地已配置面）→
 *   model/switch（写命令持约；回执经事件流 renderEvent 呈现）。
 *
 * K（需求四：等待中 + 立即发送）：
 * - 内核忙时发送的 prompt 自动入队（agent-process admission：忙 → queue.ts
 *   enqueue 返 accepted）——UI 侧排队条只是**投影**：发送时 agent 忙则记
 *   本地 queued 摘要；idle（队列已排空）/prompt_returned（中止退回）时清空。
 * - ⏹ 停止 = cancel{cause:{kind:"user"}}（写命令持约）——中止后剩余排队经
 *   prompt_returned 回填输入框（app.js W 消费）。
 * - ⏩ 立即发送 = steer{expectedTurn, content}（输入框当前内容注入在途轮
 *   ——不打断，内核 turn 边界插入；排队消息仍在轮末自动发送）。
 */

import { sendQuery, sendRequest } from "./api.js";
import { getSessionId, settingsCache } from "./state.js";
import { toast } from "./feedback.js";
import { openMenu } from "./views/settings/core.js";

let input = null;
let queueBar = null;
let ctxPill = null;
let permPill = null;
let modelPill = null;
let attachBtn = null;
let fileInput = null;

/** 排队投影（本地摘要——内核队列的展示面，非控制面）。 */
const queued = [];
/** 当前轮号（turn/start 记录——steer 的 expectedTurn）。 */
let currentTurn = 0;
/** 上下文用量缓存（op:usage 推入）。 */
let usageInfo = { contextTokens: 0, contextWindow: 0 };

export function initComposerBar(deps) {
  input = deps.input;
  queueBar = document.getElementById("queue-bar");
  ctxPill = document.getElementById("ctx-pill");
  permPill = document.getElementById("perm-pill");
  modelPill = document.getElementById("model-pill");
  attachBtn = document.getElementById("attach-add-btn");
  fileInput = document.getElementById("attach-file-input");

  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    for (const file of fileInput.files ?? []) {
      deps.addAttachment(file); // 既有附件链（限额/预览/revoke 全复用）
    }
    fileInput.value = ""; // 同一文件可重复添加（用户再选同名文件不失效）
  });

  permPill.addEventListener("click", () => void openPermissionMenu());
  modelPill.addEventListener("click", () => void openModelMenu());
  ctxPill.addEventListener("click", () => void openUsageDetail());

  paintQueueBar();
  paintPermPill();
  paintModelPill();
  paintCtxPill();

  // 运行态事件兜底（与 sidebar/progress-dock 同模式——app.js 广播；
  // notifyTurnStarted/notifyIdle 是主路径，事件监听防状态漏同步）
  window.addEventListener("agent:busy", () => paintQueueBar());
  window.addEventListener("agent:idle", () => paintQueueBar());
}

// ---------------------------------------------------------------------------
// 运行态通知（app.js 事件转发进来——模块间解耦经显式调用）
// ---------------------------------------------------------------------------

/** turn/start：记录轮号 + 排队条进入"执行中"形态。 */
export function notifyTurnStarted(turn) {
  currentTurn = Number(turn) || currentTurn;
  paintQueueBar();
}

/** idle：队列已被内核排空（idle 只在队列空时宣告）——投影清零。 */
export function notifyIdle() {
  queued.splice(0, queued.length);
  paintQueueBar();
}

/** prompt_returned：中止退回（app.js 已回填输入框）——投影清零。 */
export function notifyPromptReturned() {
  queued.splice(0, queued.length);
  paintQueueBar();
}

/** 发送时 agent 忙 → 本条进了内核队列（投影摘要）。由 app.js submitPrompt 调。 */
export function notifyQueued(content) {
  queued.push(oneLineOf(content));
  paintQueueBar();
}

export function isAgentBusy() {
  return queueBar !== null && queueBar.dataset.busy === "1";
}

function oneLineOf(text) {
  const s = String(text).replace(/\s+/g, " ").trim();
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

// ---------------------------------------------------------------------------
// K：排队条渲染与动作
// ---------------------------------------------------------------------------

function paintQueueBar() {
  if (queueBar === null) return;
  const busy = window.__agentBusy === true;
  queueBar.dataset.busy = busy ? "1" : "0";
  queueBar.replaceChildren();
  if (!busy && queued.length === 0) {
    queueBar.hidden = true;
    return;
  }
  queueBar.hidden = false;

  const status = document.createElement("span");
  status.className = "queue-status";
  if (busy) {
    status.innerHTML = `<span class="queue-dot"></span> AI 执行中${currentTurn > 0 ? `（第 ${currentTurn} 轮）` : ""}`;
  } else {
    status.textContent = "空闲";
  }
  queueBar.appendChild(status);

  if (queued.length > 0) {
    const list = document.createElement("span");
    list.className = "queue-list";
    list.title = queued.join("\n");
    list.textContent = `⏳ 等待中 ${queued.length} 条：${queued[0]}${queued.length > 1 ? ` …` : ""}`;
    queueBar.appendChild(list);
    const hint = document.createElement("span");
    hint.className = "queue-hint";
    hint.title = "排队消息将在本轮结束后自动逐条发送；在输入框写入新内容可点「立即发送」插队注入当前轮。";
    hint.textContent = "轮末自动发送";
    queueBar.appendChild(hint);
  }

  if (busy) {
    // ⏩ 立即发送：输入框当前内容 steer 注入在途轮（不打断——codex steer 语义）
    const sendNow = document.createElement("button");
    sendNow.type = "button";
    sendNow.className = "queue-btn queue-btn-primary";
    sendNow.textContent = "立即发送";
    sendNow.title = "把输入框当前内容立即注入当前轮（AI 在下一步间隙即可看到——不打断执行）";
    sendNow.addEventListener("click", () => void steerNow());
    // ⏹ 停止：cancel（中止后剩余排队经 prompt_returned 回填输入框）
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "queue-btn queue-btn-danger";
    stop.textContent = "停止";
    stop.title = "中止当前轮（未消费的排队输入会退回输入框）";
    stop.addEventListener("click", () => void cancelTurn());
    queueBar.append(sendNow, stop);
  }
}

async function steerNow() {
  const content = input.value.trim();
  if (content === "") {
    toast("输入框为空——先写要插入的内容，再点「立即发送」", "warn");
    return;
  }
  const sid = getSessionId();
  if (sid === "" || currentTurn <= 0) {
    toast("当前没有执行中的轮次可注入", "warn");
    return;
  }
  try {
    await sendRequest(sid, { type: "steer", expectedTurn: currentTurn, content });
    input.value = "";
    input.dispatchEvent(new Event("input"));
    toast("已注入当前轮（steer）——AI 在下一步间隙即可看到", "info");
  } catch (e) {
    toast(`注入失败：${e?.message ?? ""}`, "warn");
  }
}

async function cancelTurn() {
  const sid = getSessionId();
  if (sid === "") return;
  try {
    await sendRequest(sid, { type: "cancel", cause: { kind: "user" } });
    toast("已请求中止——剩余排队输入将退回输入框", "info");
  } catch (e) {
    toast(`中止失败：${e?.message ?? ""}`, "warn");
  }
}

// ---------------------------------------------------------------------------
// L：权限档 pill（五档菜单——basic.js 同源导出）
// ---------------------------------------------------------------------------

async function openPermissionMenu() {
  const basic = await import("./views/settings/basic.js");
  const current = settingsCache?.permission?.mode ?? "ask";
  openMenu(permPill, basic.PERMISSION_MODE_UI.map((mode) => ({
    label: `${mode.name === current ? "● " : ""}${mode.label}——${mode.desc}`,
    onClick: () => void basic.applyPermissionMode(mode.name),
  })));
}

function paintPermPill() {
  if (permPill === null) return;
  const current = settingsCache?.permission?.mode ?? "ask";
  const labels = { ask: "每次询问", "accept-edits": "自动批编辑", "read-only": "只读", auto: "全自动", unattended: "无人值守" };
  permPill.textContent = `🔒 ${labels[current] ?? current}`;
}

/** settings 保存/切档回执后由 app.js 调（pill 文案随档位刷新）。 */
export function notifyPermissionChanged() {
  paintPermPill();
}

// ---------------------------------------------------------------------------
// L：模型·供应商 pill（model/switch——写命令持约）
// ---------------------------------------------------------------------------

async function openModelMenu() {
  const providers = settingsCache?.providers ?? [];
  const items = [];
  for (const provider of providers) {
    for (const model of provider.models ?? []) {
      const label = `${provider.name ?? provider.id ?? provider.baseUrl} · ${model}`;
      items.push({
        label,
        onClick: () => void switchModel(provider, model),
      });
    }
  }
  if (items.length === 0) {
    toast("尚未配置任何供应商/模型——设置「供应商」分节添加后可用", "warn");
    return;
  }
  openMenu(modelPill, items);
}

async function switchModel(provider, modelId) {
  const sid = getSessionId();
  if (sid === "") {
    toast("会话未就绪", "warn");
    return;
  }
  const providerId = provider.id ?? provider.name ?? provider.baseUrl;
  try {
    await sendRequest(sid, { type: "model/switch", identity: { provider: providerId, modelId } });
    modelPill.textContent = `✦ ${modelId}`;
    toast(`模型已切换：${providerId} / ${modelId}（下一轮起生效）`, "info");
  } catch (e) {
    toast(`切换失败：${e?.message ?? ""}（需要写租约）`, "warn");
  }
}

function paintModelPill() {
  if (modelPill === null) return;
  const currentModel = settingsCache?.model?.identity?.modelId;
  if (currentModel !== undefined && currentModel !== "") {
    modelPill.textContent = `✦ ${currentModel}`;
    return;
  }
  const first = settingsCache?.providers?.[0];
  const firstModel = first?.models?.[0];
  if (first !== undefined && firstModel !== undefined) {
    modelPill.textContent = `✦ ${firstModel}`;
    modelPill.title = `当前缺省：${first.name ?? first.id ?? ""} / ${firstModel}（点击切换本次会话模型）`;
  }
}

// ---------------------------------------------------------------------------
// L：上下文 % pill（op:usage 拉取推入——app.js 在 hello 后与轮结算后调用）
// ---------------------------------------------------------------------------

export async function refreshContextUsage() {
  const sid = getSessionId();
  if (sid === "") return;
  const envelope = await sendQuery({ sessionId: sid, op: "usage" });
  if (!envelope.ok) return;
  const u = envelope.result ?? {};
  usageInfo = {
    contextTokens: u.currentSession?.contextTokens ?? 0,
    contextWindow: u.contextWindow ?? 0,
  };
  paintCtxPill();
}

function paintCtxPill() {
  if (ctxPill === null) return;
  const { contextTokens, contextWindow } = usageInfo;
  const pct = contextWindow > 0 ? Math.min(100, Math.round((contextTokens / contextWindow) * 100)) : 0;
  ctxPill.textContent = `☰ ${String(pct)}%`;
  ctxPill.classList.toggle("ctx-warn", pct >= 80 && pct < 95);
  ctxPill.classList.toggle("ctx-hot", pct >= 95);
}

async function openUsageDetail() {
  const body = document.createElement("div");
  const { contextTokens, contextWindow } = usageInfo;
  const pct = contextWindow > 0 ? Math.round((contextTokens / contextWindow) * 100) : 0;
  const fmt = (n) => new Intl.NumberFormat("zh-CN", { notation: n >= 10000 ? "compact" : "standard" }).format(n);
  body.innerHTML = `
    <div class="usage-detail-row"><span>本会话上下文占用</span><b>${fmt(contextTokens)} / ${fmt(contextWindow)} token（${String(pct)}%）</b></div>
    <div class="usage-detail-row"><span>数据口径</span><span>本会话末轮计量——完整趋势/热力/成本见「用量统计」页</span></div>
  `;
  const { openDialog } = await import("./views/settings/core.js");
  openDialog({
    title: "上下文用量",
    body,
    actions: [{ label: "打开用量页", className: "btn btn-primary", onClick: () => { location.hash = "#usage"; } }],
  });
}
