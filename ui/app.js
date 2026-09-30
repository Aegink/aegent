/**
 * aegent ui（K5/K2·T-P1-128）——一份静态资产两个端：Web（浏览器直开 host
 * 地址）与桌面壳（Tauri WebView 加载同一目录）。零构建链零框架（卡序头
 * 约束 1）；协议面 = 端间协议（K8 信封）：hello → query events（恢复视图）
 * → request/lease（写命令持约）→ event/notification（流渲染）。
 *
 * T-P3-134 · UI 批次 A：本文件瘦身为**入口**——WS 生命周期 + 路由启动 +
 * 聊天流主逻辑（会话域）。共享层已下沉：api.js（协议面）/ state.js（共享
 * 状态）/ feedback.js（跨视图 DOM 原语）/ router.js（hash 路由）/ icons.js
 * （图标集）；设置/用量/工作台/通知/历史/搜索迁出为 views/*.js 页面模块
 * （原生动态 import——视图契约 render(container, params) + 可选 unmount）。
 */

// U4/T-P3-107 渲染分层：assistant 走 markdown+高亮管线（render.js——
// 用户输入不走此管线，注入面防呆）；vendor 本地化见 ui/vendor/README.md
import { buildDiffLines, parseDenial, renderMarkdown } from "./render.js";
// U25/T-P3-128 快捷键分发面（注册表本体与清单渲染在 state.js/设置视图）
import { resolveAction } from "./keymap.js";
// 共享层（批 A③ 下沉——单向依赖：app/views → api/state/feedback）
import {
  SURFACE_KIND,
  SURFACE_ID,
  allocRequestId,
  connect,
  sendRaw,
  sendRequest,
  sendSettings,
  ensureFileCache,
  ensureMetaCache,
  inflight,
} from "./api.js";
import {
  settingsCache,
  setSettingsCache,
  getSessionId,
  setSessionId,
  lastUserPrompt,
  setLastUserPrompt,
  promptsCacheLoaded,
  markPromptsLoaded,
  notifications,
  emitNotify,
  emitTurnSettled,
  updateNotifyBadge,
  applyTheme,
  rebuildKeymap,
  getKeymapBindings,
  hooks,
} from "./state.js";
import { lineEl, appendLine, scrollBottom, oneLine, toast } from "./feedback.js";
import { go, startRouter } from "./router.js";
import { injectIcons } from "./icons.js";

const stream = document.getElementById("stream");
const pending = document.getElementById("pending");
const statusEl = document.getElementById("conn-status");
const surfaceEl = document.getElementById("surface-id");
const leaseEl = document.getElementById("lease-status");
const leaseBtn = document.getElementById("lease-btn");
const input = document.getElementById("prompt-input");
const sendBtn = document.getElementById("send-btn");

surfaceEl.textContent = SURFACE_ID;

let holdsLease = false;

/** 会话 id 读取（state.js 共享态的本地别名——聊天域调用点密集）。 */
function sessionId() {
  return getSessionId();
}

function setLeaseUi(held, holder) {
  holdsLease = held;
  leaseEl.textContent = held ? "写租约：本端" : holder ? `写租约：${holder}` : "写租约：空闲";
  leaseBtn.textContent = held ? "归还写租约" : "取得写租约";
}

leaseBtn.addEventListener("click", () => {
  sendRaw({
    type: "lease",
    op: holdsLease ? "release" : "acquire",
    surfaceId: SURFACE_ID,
  });
});

// ---------------------------------------------------------------------------
// U4/T-P3-107 渲染分层：assistant=markdown 气泡（流式打字回放）、工具=折叠卡
// （callId 成对 + 写操作 diff）、其余=单行摘要（repl renderEventSummary 同源）。
// ---------------------------------------------------------------------------

const STREAM_MAX_MS = 2000;

function endKindText(reason) {
  if (reason === undefined || reason === null) return "?";
  switch (reason.kind) {
    case "completed":
      return "completed";
    case "aborted":
      return `aborted（${reason.cause?.kind ?? "?"}）`;
    case "blocked":
      return "blocked";
    case "error":
      return `error：${reason.error?.code ?? ""} ${reason.error?.message ?? ""}`.trim();
    case "max-tokens":
      return "max-tokens";
    case "interrupted":
      return "interrupted";
    default:
      return reason.kind;
  }
}

/** 流式打字：text-delta 节流追加（rAF 消费 TimedStreamChunk 时间轴——事件
 * 自带流记录即回放输入，零新增 wire 面）；终态换完整 markdown+高亮渲染。 */
function typeStream(bubble, chunks, finalContent) {
  const deltas = [];
  for (const c of chunks) {
    if (c?.chunk?.type === "text-delta") deltas.push({ t: Number(c.time) || 0, text: String(c.chunk.text ?? "") });
  }
  if (deltas.length === 0) {
    bubble.innerHTML = renderMarkdown(finalContent);
    scrollBottom();
    return;
  }
  const t0 = deltas[0].t;
  const total = Math.max((deltas[deltas.length - 1]?.t ?? t0) - t0, 1);
  const speed = total > STREAM_MAX_MS ? STREAM_MAX_MS / total : 1; // 超长流压缩到 ≤2s
  let i = 0;
  let acc = "";
  const start = performance.now();
  const tick = () => {
    const elapsed = (performance.now() - start) / speed;
    while (i < deltas.length && deltas[i].t - t0 <= elapsed) {
      acc += deltas[i].text;
      i++;
    }
    bubble.textContent = acc; // 打字过程纯文本增量追加（不重排）
    scrollBottom();
    if (i < deltas.length) {
      requestAnimationFrame(tick);
    } else {
      bubble.innerHTML = renderMarkdown(finalContent);
      scrollBottom();
    }
  };
  requestAnimationFrame(tick);
}

function diffEl(lines) {
  const wrap = document.createElement("div");
  wrap.className = "diff";
  for (const l of lines) {
    const row = document.createElement("div");
    row.className = `diff-row ${l.kind}`;
    row.textContent = l.text;
    wrap.appendChild(row);
  }
  return wrap;
}

/** C55 alternatives 展示（拒绝卡——"被拒之后可以怎么办"编号清单）。 */
function denialEl(denial) {
  const wrap = document.createElement("div");
  wrap.className = "denial";
  const reason = document.createElement("div");
  reason.textContent = `被权限策略拒绝：${denial.reason}`;
  wrap.appendChild(reason);
  if (denial.justification !== undefined) {
    const just = document.createElement("div");
    just.className = "denial-just";
    just.textContent = `规则理由：${denial.justification}`;
    wrap.appendChild(just);
  }
  if (denial.alternatives.length > 0) {
    const head = document.createElement("div");
    head.textContent = "替代做法：";
    const ol = document.createElement("ol");
    for (const alt of denial.alternatives) {
      const li = document.createElement("li");
      li.textContent = alt;
      ol.appendChild(li);
    }
    wrap.append(head, ol);
  }
  return wrap;
}

function buildToolCard(e) {
  const card = document.createElement("details");
  card.className = "tool-card";
  card.dataset.callId = e.callId;
  const summary = document.createElement("summary");
  const args = safeParseArgs(e.arguments);
  // 批 C 任务卡片化：icon + 工具名 + 参数一行 + 状态徽标（结果结算后翻转）
  const name = document.createElement("span");
  name.className = "tool-name";
  name.textContent = `⚙ ${e.name}`;
  const argsSpan = document.createElement("span");
  argsSpan.className = "tool-args";
  argsSpan.textContent = oneLine(args !== null ? JSON.stringify(args) : e.arguments, 160);
  const status = document.createElement("span");
  status.className = "tool-status running";
  status.textContent = "运行中";
  summary.append(name, argsSpan, status);
  const body = document.createElement("div");
  body.className = "tool-body";
  const argsPre = document.createElement("pre");
  argsPre.className = "card-args";
  argsPre.textContent = args !== null ? JSON.stringify(args, null, 2) : String(e.arguments ?? "");
  body.appendChild(argsPre);
  const diff = args !== null ? buildDiffLines(e.name, args) : null;
  if (diff !== null) body.appendChild(diffEl(diff)); // 写操作 diff 对照
  card.append(summary, body);
  return card;
}

/** 任务卡状态徽标翻转（结果结算——完成/失败两态，运行中只存在于调用未闭合时）。 */
function setToolStatus(card, isError) {
  const status = card.querySelector(".tool-status");
  if (status === null) return;
  status.className = `tool-status ${isError ? "fail" : "done"}`;
  status.textContent = isError ? "✗ 失败" : "✓ 完成";
}

function settleToolCard(e) {
  const content = e.message?.content ?? "";
  const isError = e.message?.isError === true;
  const existing = stream.querySelector(`details[data-call-id="${CSS.escape(e.callId)}"]`);
  if (existing !== null) {
    existing.classList.toggle("error", isError);
    setToolStatus(existing, isError);
    const body = existing.querySelector(".tool-body");
    const denial = isError ? parseDenial(content) : null;
    if (denial !== null) {
      body.appendChild(denialEl(denial)); // C55 结构化拒绝面
    } else {
      const resultPre = document.createElement("pre");
      resultPre.className = `card-args ${isError ? "warn" : ""}`.trim();
      resultPre.textContent = content; // 工具结果原样（不渲染 markdown）
      body.appendChild(resultPre);
    }
    return null; // 已并入 call 卡——不再追加节点
  }
  // 历史恢复/乱序兜底：result 单独成卡（callId 标注可追溯）
  const card = document.createElement("details");
  card.className = `tool-card result-only ${isError ? "error" : ""}`.trim();
  card.dataset.callId = e.callId;
  const summary = document.createElement("summary");
  summary.textContent = `${isError ? "✗" : "←"} ${oneLine(content, 160)}`;
  const body = document.createElement("div");
  body.className = "tool-body";
  const denial = isError ? parseDenial(content) : null;
  if (denial !== null) {
    body.appendChild(denialEl(denial));
  } else {
    const resultPre = document.createElement("pre");
    resultPre.className = `card-args ${isError ? "warn" : ""}`.trim();
    resultPre.textContent = content;
    body.appendChild(resultPre);
  }
  card.append(summary, body);
  return card;
}

function attachRetry(el, error) {
  if (lastUserPrompt === "") return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "retry-btn";
  btn.textContent = `↻ 重试上一条（${error?.code ?? "error"}）`;
  btn.addEventListener("click", () => {
    btn.disabled = true;
    void sendRequest(sessionId(), {
      type: "prompt",
      messageId: allocRequestId("m"),
      content: lastUserPrompt,
    });
  });
  el.appendChild(document.createTextNode(" "));
  el.appendChild(btn);
}

/** 事件 → DOM 节点（U4 分层版）；null = 不展示或已并入既有卡。 */
function renderEvent(e, options = {}) {
  switch (e.type) {
    case "turn/start":
      return lineEl(`── turn ${e.turn} 开始`, "meta");
    case "turn/end": {
      const el = lineEl(`── turn ${e.turn} 结束（${endKindText(e.reason)}）`, "meta");
      if (e.reason?.kind === "error") attachRetry(el, e.reason.error); // 错误重试交互
      return el;
    }
    case "user/message": {
      // 用户输入不渲染（注入面防呆——textContent 原样，不走 markdown 管线）
      const el = document.createElement("div");
      el.className = `bubble user ${e.source === "injected" ? "dim" : ""}`.trim();
      el.textContent = e.message?.content ?? "";
      if (e.source !== "injected") setLastUserPrompt(e.message?.content ?? "");
      return el;
    }
    case "assistant/message": {
      const bubble = document.createElement("div");
      bubble.className = `bubble agent ${e.interrupted ? "warn" : ""}`.trim();
      const content = e.message?.content ?? "";
      if (content === "") return lineEl("⬢ （模型转入工具调用）", "agent reasoning");
      if (options.live) {
        typeStream(bubble, e.message?.stream ?? [], content); // 流式打字节流
      } else {
        bubble.innerHTML = renderMarkdown(content); // 恢复视图直接终态
      }
      return bubble;
    }
    case "tool/call":
      return buildToolCard(e);
    case "tool/result":
      return settleToolCard(e);
    case "compaction":
      return lineEl(`◇ 压缩：${e.reason ?? e.strategy ?? ""}`, "meta");
    case "image/offload":
      return lineEl(`◇ 图片卸载：${(e.targets ?? []).length} 组`, "meta");
    case "surface/attach":
      return lineEl(`＋ surface ${e.surfaceId} 接入`, "roster");
    case "surface/detach":
      return lineEl(`－ surface ${e.surfaceId} 离开`, "roster");
    default:
      return null; // wire 细节类静默（request/header 等——repl 同款纪律）
  }
}

// —— 日期分隔（批 C 消息流）：事件 ts 的本地日分组——跨日插入分隔条；
// lastStreamDay 随流重建归零（resetStreamView 只读查看共用面）。
function dayKey(ts) {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function fmtDateLabel(ts) {
  const d = new Date(ts);
  const now = Date.now();
  const key = dayKey(ts);
  if (key === dayKey(now)) return "今天";
  if (key === dayKey(now - 86_400_000)) return "昨天";
  const year = d.getFullYear() === new Date().getFullYear() ? "" : `${d.getFullYear()}年`;
  return `${year}${d.getMonth() + 1}月${d.getDate()}日`;
}

function dateSepEl(ts) {
  const div = document.createElement("div");
  div.className = "date-sep";
  div.textContent = fmtDateLabel(ts);
  return div;
}

let lastStreamDay = null;

/** 流追加统一入口：先按事件 ts 补日期分隔条，再挂节点（null 守卫在调用侧）。 */
function appendStreamNode(node, e) {
  const key = dayKey(e?.ts);
  if (key !== null && key !== lastStreamDay) {
    lastStreamDay = key;
    stream.appendChild(dateSepEl(e.ts));
  }
  stream.appendChild(node);
}

function renderEventEnvelope(envelope) {
  const node = renderEvent(envelope.event, { live: true });
  if (node !== null) {
    appendStreamNode(node, envelope.event);
    scrollBottom();
    syncChatEmpty(); // 首个可见事件到达 = 欢迎卡让位
  }
  minimapRegister(node, envelope.event); // 小地图登记（含 null 守卫）
}

/** 恢复视图：历史事件一次性渲染（query 快照；此后走 event 流续播）。 */
function renderHistory(events) {
  for (const e of events) {
    const node = renderEvent(e);
    if (node !== null) appendStreamNode(node, e);
    minimapRegister(node, e);
  }
  if (events.length > 0) appendLine(`── 已恢复 ${events.length} 条历史事件 ──`, "meta");
  scrollBottom();
  showRecoveryIfInterrupted(events); // U13：M3 启动恢复可视化（流尾未闭合轮）
  syncChatEmpty(); // 批 C：首屏空状态（历史为空 = 欢迎卡）
}

// 代码块复制按钮（U4：事件委托——动态内容免逐个绑）
stream.addEventListener("click", (ev) => {
  const btn = ev.target instanceof Element ? ev.target.closest(".code-copy") : null;
  if (btn === null) return;
  const code = btn.parentElement?.querySelector("code");
  const text = code?.textContent ?? "";
  navigator.clipboard
    ?.writeText(text)
    .then(() => {
      btn.textContent = "已复制";
      setTimeout(() => {
        btn.textContent = "复制";
      }, 1500);
    })
    .catch(() => {
      btn.textContent = "复制失败";
    });
});

function safeParseArgs(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 审批 / 提问卡（notification 面驱动——"任何通道可答"）
// ---------------------------------------------------------------------------

function removeCard(requestId) {
  const card = pending.querySelector(`[data-request-id="${CSS.escape(requestId)}"]`);
  if (card !== null) card.remove();
  if (pending.children.length === 0) pending.classList.remove("active");
}

function buildCard(name, payload) {
  pending.classList.add("active");
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.requestId = payload.requestId;
  const title = document.createElement("div");
  title.className = "card-title";
  if (name === "approval_requested") {
    title.textContent = `审批请求：${payload.tool}`;
    // C54 审批来源分类 chip + 超时倒计时（审批卡优化——U4/T-P3-107）
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = String(payload.category ?? "tool");
    title.appendChild(chip);
    // T-P3-140 批次 E：沙箱升级徽标（升级目标一眼可见——fail-closed 审批面；
    // escalation 值自带 "sandbox → X" 形状，剥前缀避免与中文标签重复）
    const escArgs = payload.args && typeof payload.args === "object" ? payload.args : undefined;
    if (typeof escArgs?.escalation === "string") {
      const escChip = document.createElement("span");
      escChip.className = "chip chip-warn";
      escChip.textContent = `沙箱升级 ${escArgs.escalation.replace(/^sandbox\s*→\s*/, "→ ")}`;
      title.appendChild(escChip);
    }
    const countdown = document.createElement("span");
    countdown.className = "countdown";
    title.appendChild(countdown);
    const deadline = Date.now() + (Number(payload.timeoutMs) || 0);
    const timer = setInterval(() => {
      if (!countdown.isConnected) {
        clearInterval(timer);
        return;
      }
      countdown.textContent = `${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s`;
    }, 1000);
    // T-P3-140 批次 E：升级理由独立展示行（审批人先读理由再看参数）
    if (typeof escArgs?.justification === "string" && escArgs.justification !== "") {
      const justification = document.createElement("div");
      justification.className = "card-justification";
      justification.textContent = `理由：${escArgs.justification}`;
      card.appendChild(justification);
    }
    const args = document.createElement("pre");
    args.className = "card-args";
    args.textContent = JSON.stringify(payload.args, null, 2);
    card.append(title, args);
    // T-P3-137 八轮 B（用户裁决"不止外观，功能也要一样"——参考 opencode/
    // pi-desktop 审批三选）：allow 带 scope（once=允许一次 / session=本会话
    // 内同类调用不再问——C22 session-runtime 作用域，子进程 approvalCache 记账）
    const actions = [
      { label: "允许一次", action: "allow", scope: "once", className: "allow" },
      { label: "本会话内允许", action: "allow", scope: "session", className: "allow allow-session" },
      { label: "拒绝", action: "deny", scope: undefined, className: "deny" },
    ];
    for (const { label, action, scope, className } of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.className = className;
      btn.addEventListener("click", async () => {
        await sendRequest(sessionId(), {
          type: "approve",
          requestId: payload.requestId,
          action,
          ...(scope !== undefined ? { scope } : {}),
          source: SURFACE_KIND,
        });
        removeCard(payload.requestId);
      });
      card.appendChild(btn);
    }
  } else if (name === "question_asked") {
    title.textContent = `模型提问`;
    const q = document.createElement("pre");
    q.className = "card-args";
    q.textContent = payload.question ?? "";
    card.append(title, q);
    const answerInput = document.createElement("input");
    answerInput.type = "text";
    answerInput.placeholder = "输入答复（空 = 跳过）";
    const answerBtn = document.createElement("button");
    answerBtn.type = "button";
    answerBtn.textContent = "答复";
    answerBtn.className = "allow";
    answerBtn.addEventListener("click", async () => {
      await sendRequest(sessionId(), {
        type: "question/answer",
        requestId: payload.requestId,
        answer: answerInput.value,
      });
      removeCard(payload.requestId);
    });
    card.append(answerInput, answerBtn);
    answerInput.focus();
  }
  pending.appendChild(card);
}

// ---------------------------------------------------------------------------
// U10/T-P3-109 Composer 升级：多行编辑（Shift+Enter 换行）+ 两类补全
// （@ workspace 清单 / 命令+工具+技能）+ 粘贴图片入 P1 附件链。
// ---------------------------------------------------------------------------

// 多行输入的自动增高（上限 8 行——再长出滚动）
function autoGrow() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 8 * 22)}px`;
}
input.addEventListener("input", autoGrow);

// —— 粘贴图片（clipboard → P1 附件链 attachments；限额与
// attachments/limits.ts 同源：10MB/件、8 件/消息、四类 image 白名单）
const MAX_ATTACHMENT_BYTES = 10_000_000;
const MAX_ATTACHMENTS_PER_MESSAGE = 8;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const pendingAttachments = [];
const attachmentsPreview = document.getElementById("attachments-preview");

function renderAttachmentsPreview() {
  attachmentsPreview.replaceChildren();
  for (const [i, a] of pendingAttachments.entries()) {
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    const label = document.createElement("span");
    label.textContent = `🖼 ${a.name ?? "image"}（${Math.ceil((a.data.length * 3) / 4 / 1024)}KB）`;
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "×";
    del.addEventListener("click", () => {
      pendingAttachments.splice(i, 1);
      renderAttachmentsPreview();
    });
    chip.append(label, del);
    attachmentsPreview.appendChild(chip);
  }
}

function addAttachment(file) {
  if (!IMAGE_TYPES.has(file.type)) {
    appendLine(`不支持的附件类型：${file.type}（白名单：png/jpeg/gif/webp）`, "warn");
    return;
  }
  if (pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
    appendLine(`附件数量已达上限（${MAX_ATTACHMENTS_PER_MESSAGE}/消息）`, "warn");
    return;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    appendLine(`附件超过单件上限（${Math.ceil(MAX_ATTACHMENT_BYTES / 1e6)}MB）`, "warn");
    return;
  }
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const result = String(reader.result ?? "");
    const base64 = result.includes(",") ? result.slice(result.indexOf(",") + 1) : result;
    pendingAttachments.push({ mediaType: file.type, data: base64, name: file.name || "pasted-image" });
    renderAttachmentsPreview();
  });
  reader.readAsDataURL(file);
}

input.addEventListener("paste", (ev) => {
  for (const item of ev.clipboardData?.items ?? []) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file !== null && IMAGE_TYPES.has(file.type)) {
        ev.preventDefault(); // 图片不进文本——入附件链
        addAttachment(file);
      }
    }
  }
});

// —— 两类补全（@ 文件/目录——query op:"files"；/ 命令+工具+技能——
// query op:"meta" 的 ready 清单 + UI 本地命令集）
const autocomplete = document.getElementById("autocomplete");
const UI_COMMANDS = [
  { label: "/cancel", hint: "取消当前轮" },
  { label: "/find", hint: "会话内搜索（Ctrl+F）" },
  { label: "/search", hint: "跨会话搜索" },
  { label: "/history", hint: "会话历史" },
  { label: "/settings", hint: "设置中心" },
  { label: "/help", hint: "列出可用命令" },
];

// —— U16/T-P3-118：提示词模板的 / 补全数据面（settings get 一次缓存；
// 设置页保存 prompts 段后 settingsCache 同步，下次补全即用新库）
async function ensurePromptsCache() {
  if (promptsCacheLoaded) return settingsCache?.prompts ?? [];
  const envelope = await sendSettings({ op: "get" });
  if (envelope.ok) {
    setSettingsCache(envelope.result.settings);
    markPromptsLoaded();
  }
  return settingsCache?.prompts ?? [];
}

function templateVarNames(content) {
  return [...new Set([...content.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].map((m) => m[1]))];
}
let acItems = [];
let acIndex = -1;
let acContext = null; // { trigger, startPos, token }

function detectTrigger() {
  const cursor = input.selectionStart ?? 0;
  const text = input.value.slice(0, cursor);
  // / 触发：行首或空格后的斜杠（不误触 URL 路径——token 内无空格）
  const slash = text.match(/(^|\s)(\/[^\s]*)$/);
  if (slash !== null) {
    return { trigger: "/", startPos: cursor - slash[2].length, token: slash[2] };
  }
  const at = text.match(/(^|\s)(@[^\s]*)$/);
  if (at !== null) {
    return { trigger: "@", startPos: cursor - at[2].length, token: at[2] };
  }
  return null;
}

function renderAutocomplete() {
  autocomplete.replaceChildren();
  for (const [i, item] of acItems.entries()) {
    const row = document.createElement("div");
    row.className = `ac-row ${i === acIndex ? "active" : ""}`.trim();
    const label = document.createElement("span");
    label.textContent = `${item.icon} ${item.label}`;
    const hint = document.createElement("span");
    hint.className = "ac-hint";
    hint.textContent = item.hint ?? "";
    row.append(label, hint);
    row.addEventListener("mousedown", (ev) => {
      ev.preventDefault(); // 防 textarea 失焦
      applyCompletion(item);
    });
    autocomplete.appendChild(row);
  }
  autocomplete.hidden = acItems.length === 0;
}

function applyCompletion(item) {
  if (acContext === null) return;
  const before = input.value.slice(0, acContext.startPos);
  const after = input.value.slice(input.selectionStart ?? 0);
  // U16：模板选中 = 整段正文替换 /token（非命令非路径）；{{var}} 占位保留手改
  const insert =
    item.kind === "dir" ? item.label : item.kind === "prompt" ? item.content ?? "" : `${item.label} `;
  input.value = `${before}${insert}${after}`;
  const pos = (before + insert).length;
  input.setSelectionRange(pos, pos);
  input.focus();
  if (item.kind === "prompt" && (item.vars?.length ?? 0) > 0) {
    toast(`模板含变量 ${item.vars.join("、")}——占位符已保留，请手改`, "info");
  }
  acItems = [];
  acContext = null;
  renderAutocomplete();
  autoGrow();
}

async function updateAutocomplete() {
  const ctx = detectTrigger();
  acContext = ctx;
  if (ctx === null) {
    acItems = [];
    renderAutocomplete();
    return;
  }
  const tokenBody = ctx.token.slice(1).toLowerCase();
  if (ctx.trigger === "@") {
    const files = (await ensureFileCache(sessionId())) ?? { entries: [], truncated: false };
    const hits = files.entries
      .filter((e) => e.path.toLowerCase().includes(tokenBody))
      .slice(0, 8)
      .map((e) => ({ icon: e.dir ? "📁" : "📄", label: e.path, hint: "workspace", kind: e.dir ? "dir" : "file" }));
    acItems = hits;
    if (files.truncated === true) {
      acItems = [
        ...hits,
        { icon: "…", label: "", hint: "清单已截断（可继续输入缩小）", kind: "info" },
      ];
    }
  } else {
    const meta = (await ensureMetaCache(sessionId())) ?? { tools: [], skills: [] };
    const prompts = await ensurePromptsCache();
    const candidates = [
      ...UI_COMMANDS.map((c) => ({ icon: "⌘", label: c.label, hint: c.hint, kind: "command" })),
      ...meta.tools.map((t) => ({ icon: "🛠", label: t, hint: "工具", kind: "tool" })),
      ...meta.skills.map((s) => ({ icon: "✨", label: s.name, hint: s.description, kind: "skill" })),
      ...prompts.map((p) => ({
        icon: "📝",
        label: p.name,
        hint: p.description ?? "提示词模板",
        kind: "prompt",
        content: p.content,
        vars: templateVarNames(p.content),
      })),
    ].filter((c) => c.label.toLowerCase().startsWith(tokenBody));
    acItems = candidates.slice(0, 8);
  }
  acIndex = acItems.length > 0 ? 0 : -1;
  renderAutocomplete();
}

function executeCommand(label) {
  switch (label) {
    case "/cancel":
      void sendRequest(sessionId(), { type: "cancel" });
      appendLine("已请求取消当前轮", "meta");
      break;
    case "/find":
      openFind();
      break;
    case "/search":
      go("search");
      break;
    case "/history":
      openHistory();
      break;
    case "/settings":
      openSettings();
      break;
    case "/help":
      appendLine(`可用命令：${UI_COMMANDS.map((c) => c.label).join("、")}（另有 🛠 工具 / ✨ 技能名称提及——选中即入输入框）`, "meta");
      break;
    default:
      break;
  }
}

// —— 提交：多行（Shift+Enter 换行）/ 斜杠命令拦截 / 附件随 prompt 上送
function submitPrompt() {
  const content = input.value.trim();
  if (content === "") return;
  setLastUserPrompt(content);
  input.value = "";
  autoGrow();
  const attachments = pendingAttachments.splice(0, pendingAttachments.length);
  renderAttachmentsPreview();
  void sendRequest(sessionId(), {
    type: "prompt",
    messageId: allocRequestId("m"),
    content,
    ...(attachments.length > 0 ? { attachments } : {}),
  });
}

sendBtn.addEventListener("click", submitPrompt);
input.addEventListener("keydown", (ev) => {
  if (autocomplete.hidden === false && acItems.length > 0) {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      acIndex = (acIndex + 1) % acItems.length;
      renderAutocomplete();
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      acIndex = (acIndex - 1 + acItems.length) % acItems.length;
      renderAutocomplete();
      return;
    }
    if (ev.key === "Enter" || ev.key === "Tab") {
      const item = acItems[acIndex];
      if (item !== undefined && item.kind !== "info") {
        ev.preventDefault();
        // 命令选中 = 直接收尾；Enter 二次提交执行（AC 面关闭）
        applyCompletion(item);
        return;
      }
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      acItems = [];
      acContext = null;
      renderAutocomplete();
      return;
    }
  }
  // 命令提交：Enter 时若输入是完整 UI 命令则本地执行（不发 prompt）
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    const trimmed = input.value.trim();
    if (UI_COMMANDS.some((c) => c.label === trimmed)) {
      input.value = "";
      autoGrow();
      executeCommand(trimmed);
      return;
    }
    submitPrompt();
  }
  // Shift+Enter = textarea 原生换行；输入变化经 input 监听刷新补全
});
input.addEventListener("input", () => void updateAutocomplete());

// —— U26/T-P3-129 语音输入（实验性）：麦克风录音 → STT（设置分节在
//    views/settings.js——此处是 Composer 消费端：权限拒绝降级 + 未配置引导）
const micBtn = document.getElementById("mic-btn");
let mediaRecorder = null;
let audioChunks = [];
let recording = false;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    });
    reader.addEventListener("error", () => reject(new Error("读取录音失败")));
    reader.readAsDataURL(blob);
  });
}

async function startRecording() {
  if (settingsCache?.stt?.baseUrl === undefined || settingsCache?.stt?.model === undefined) {
    toast("语音输入未配置——请先在设置「语音」分节填 STT 端点与模型", "warn");
    return;
  }
  if (navigator.mediaDevices === undefined) {
    toast("当前环境不支持录音（需 HTTPS 或桌面壳）", "warn");
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    // 权限拒绝降级（NotAllowedError 为主——不区分细分原因，提示一致）
    toast(`麦克风不可用：${e.name === "NotAllowedError" ? "权限被拒绝——请在浏览器设置允许后重试" : e.message}`, "warn");
    return;
  }
  audioChunks = [];
  // 卡内定形：浏览器 MediaRecorder 缺省产出 audio/webm（Chrome 系）——
  // P4 AUDIO_MEDIA_TYPES 白名单含 audio/webm，格式解码交给 provider。
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.addEventListener("dataavailable", (ev) => {
    if (ev.data.size > 0) audioChunks.push(ev.data);
  });
  mediaRecorder.addEventListener("stop", () => {
    for (const track of stream.getTracks()) track.stop(); // 释放麦克风
    void finishRecording();
  });
  mediaRecorder.start();
  recording = true;
  micBtn.classList.add("recording");
  micBtn.textContent = "⏹";
  toast("录音中…再次点击结束", "info");
}

async function finishRecording() {
  recording = false;
  micBtn.classList.remove("recording");
  micBtn.textContent = "🎤";
  if (audioChunks.length === 0) {
    toast("没有录到音频", "warn");
    return;
  }
  const blob = new Blob(audioChunks, { type: mediaRecorder?.mimeType ?? "audio/webm" });
  const mediaType = blob.type.split(";")[0] ?? "audio/webm";
  micBtn.disabled = true;
  micBtn.textContent = "⏳";
  try {
    const base64 = await blobToBase64(blob);
    const envelope = await sendSettings({
      op: "stt-transcribe",
      mediaType,
      content: base64,
    });
    if (!envelope.ok) {
      appendLine(`语音转写失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
      return;
    }
    const text = envelope.result.text ?? "";
    // 转写文本填入输入框（不自动发送——用户确认后回车）
    input.value = input.value === "" ? text : `${input.value} ${text}`;
    autoGrow();
    input.focus();
    toast("已转写填入输入框", "info");
  } catch (e) {
    appendLine(`语音转写失败：${e instanceof Error ? e.message : String(e)}`, "warn");
  } finally {
    micBtn.disabled = false;
    micBtn.textContent = "🎤";
  }
}

micBtn.addEventListener("click", () => {
  if (recording) {
    mediaRecorder?.stop();
  } else {
    void startRecording();
  }
});

// ---------------------------------------------------------------------------
// 面板函数（函数名保留——调用点兼容；实现 = 路由跳转，数据拉取在视图模块）
// ---------------------------------------------------------------------------

function openSettings() {
  go("settings");
}

function openUsage() {
  go("usage");
}

function openHistory() {
  go("history");
}

function openWorkpanel() {
  go("work");
}

// ---------------------------------------------------------------------------
// U9/T-P3-108 对话导航与检索：会话内搜索（Ctrl+F 渲染层高亮跳转——
// find-bar 浮层在骨架 index.html）+ 小地图（消息类型着色条 + 点击跳轮）。
// ---------------------------------------------------------------------------

// —— 会话内搜索：命中高亮 + 上下跳转（不落库、不经 host——渲染层文本检索）
const findBar = document.getElementById("find-bar");
const findInput = document.getElementById("find-input");
const findCount = document.getElementById("find-count");
const findHits = [];
let findCursor = -1;

function clearHits() {
  for (const mark of findHits) {
    const parent = mark.parentNode;
    if (parent !== null) {
      mark.replaceWith(...mark.childNodes); // 摘帽还原原文本节点
      parent.normalize();
    }
  }
  findHits.length = 0;
  findCursor = -1;
  findCount.textContent = "";
}

function updateFindUi() {
  findCount.textContent = findHits.length === 0 ? "无命中" : `${findCursor + 1}/${findHits.length}`;
  for (const [i, mark] of findHits.entries()) mark.classList.toggle("active", i === findCursor);
  if (findCursor >= 0) findHits[findCursor].scrollIntoView({ block: "center" });
}

function wrapMatches(node, needle) {
  const value = node.nodeValue ?? "";
  const lower = value.toLowerCase();
  const q = needle.toLowerCase();
  const frag = document.createDocumentFragment();
  let pos = 0;
  let idx = lower.indexOf(q);
  while (idx >= 0) {
    frag.appendChild(document.createTextNode(value.slice(pos, idx)));
    const mark = document.createElement("mark");
    mark.className = "search-hit";
    mark.textContent = value.slice(idx, idx + needle.length);
    frag.appendChild(mark);
    findHits.push(mark);
    pos = idx + needle.length;
    idx = lower.indexOf(q, pos);
  }
  frag.appendChild(document.createTextNode(value.slice(pos)));
  node.parentNode.replaceChild(frag, node);
}

function findInStream(needle) {
  clearHits();
  if (needle !== "") {
    const walker = document.createTreeWalker(stream, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement?.closest(".code-copy") === null &&
        (n.nodeValue ?? "").toLowerCase().includes(needle.toLowerCase())
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    const targets = [];
    while (walker.nextNode()) targets.push(walker.currentNode);
    for (const node of targets) wrapMatches(node, needle);
    findCursor = findHits.length > 0 ? 0 : -1;
  }
  updateFindUi();
}

document.getElementById("find-next").addEventListener("click", () => {
  if (findHits.length === 0) return;
  findCursor = (findCursor + 1) % findHits.length;
  updateFindUi();
});
document.getElementById("find-prev").addEventListener("click", () => {
  if (findHits.length === 0) return;
  findCursor = (findCursor - 1 + findHits.length) % findHits.length;
  updateFindUi();
});
document.getElementById("find-close").addEventListener("click", () => {
  findBar.hidden = true;
  clearHits();
});
findInput.addEventListener("input", () => findInStream(findInput.value.trim()));
findInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    document.getElementById(ev.shiftKey === true ? "find-prev" : "find-next").click();
  }
});

function openFind() {
  findBar.hidden = false;
  findInput.focus();
  findInput.select();
  if (findInput.value.trim() !== "") findInStream(findInput.value.trim());
}

// —— 小地图：消息类型着色条 + 点击跳轮（纯 DOM——展示什么导航什么）。
// 批 C 轨迹六色：现三色扩六类（--traj-* 六色槽——方案 §2.4 trajectory 同构；
// reasoning = 空文本 assistant 段〔模型转入工具调用〕；reasoning-alt 为备用槽）。
const minimap = document.getElementById("minimap");
const MINIMAP_KINDS = {
  "user/message": "mm-user",
  "assistant/message": "mm-agent",
  "tool/call": "mm-toolcall",
  "tool/result": "mm-toolresult",
};
const minimapEntries = [];
let minimapTurn = 0;

function minimapRegister(node, e) {
  let kind = MINIMAP_KINDS[e.type];
  if (kind === undefined) {
    if (e.type === "turn/start") minimapTurn = e.turn;
    return;
  }
  if (e.type === "assistant/message" && (e.message?.content ?? "") === "") {
    kind = "mm-reasoning"; // 推理段（空文本 assistant——转工具调用前）
  }
  if (node === null) return;
  minimapEntries.push({ el: node, turn: minimapTurn });
  const row = document.createElement("div");
  row.className = `mm-row ${kind}`;
  row.dataset.idx = String(minimapEntries.length - 1);
  row.title = `turn ${minimapTurn} · ${e.type}`;
  minimap.appendChild(row);
}

function minimapReset() {
  minimapEntries.length = 0;
  minimapTurn = 0;
  minimap.replaceChildren();
}

minimap.addEventListener("click", (ev) => {
  const row = ev.target instanceof Element ? ev.target.closest(".mm-row") : null;
  if (row === null) return;
  const entry = minimapEntries[Number(row.dataset.idx)];
  if (entry === undefined) return;
  entry.el.scrollIntoView({ block: "start" });
  entry.el.classList.add("mm-flash");
  setTimeout(() => entry.el.classList.remove("mm-flash"), 1200);
});

/** 流视图整体重置（只读查看入口共用——搜索命中摘帽 + 小地图重建）。 */
function resetStreamView() {
  clearHits();
  minimapReset();
  lastStreamDay = null; // 日期分隔随流重建归零
  stream.replaceChildren();
  syncChatEmpty();
}

// ---------------------------------------------------------------------------
// 批 C 首屏空状态：流为空时展示居中欢迎卡 + 能力快捷入口（empty-state 形态
// 扩展——三点同步：renderHistory / renderEventEnvelope / resetStreamView）。
// ---------------------------------------------------------------------------

const chatEmpty = document.getElementById("chat-empty");

function syncChatEmpty() {
  if (chatEmpty === null) return;
  // 判据 = 存在实质消息节点（气泡/工具卡）——surface 接入等元行不挤走欢迎卡
  chatEmpty.hidden = stream.querySelector(".bubble, .tool-card") !== null;
}

// 能力快捷入口（欢迎卡按钮——路由/聚焦输入，零新协议面）
for (const btn of document.querySelectorAll("#chat-empty [data-empty-action]")) {
  btn.addEventListener("click", () => {
    const action = btn.dataset.emptyAction;
    if (action === "input") {
      input.focus();
      return;
    }
    go(action); // settings/history/search 等路由名
  });
}

// ---------------------------------------------------------------------------
// U13/T-P3-112 五件套（横幅与弹窗面在骨架 index.html）：Toast（feedback.js）
// + 通知中心消费（N5 分型——清单渲染在 views/notify.js）+ 首次引导清单
//（settings 首跑标记）+ 启动恢复横幅（M3 诊断 + 一键续跑）+ 更新横幅与
// 发布说明弹窗（U7 消费端——真实更新源 T-P3-114 接线）。
// ---------------------------------------------------------------------------

function consumeN5(payload) {
  notifications.push(payload);
  if (notifications.length > 50) notifications.shift(); // 面板容量防呆
  toast(n5ToastText(payload), payload.kind);
  emitNotify(); // 通知视图挂载期重渲染清单
  updateNotifyBadge(); // 侧栏徽标常显
  // U15：turn 结算 → 工作面板自动刷新（订阅制——面板挂载期生效）
  if (payload.kind === "turn_settled") emitTurnSettled();
}

function n5ToastText(n) {
  const d = n.data ?? {};
  switch (n.kind) {
    case "turn_settled":
      return `turn ${d.turn} 结束`;
    case "approval_pending":
      return d.name === "question_asked" ? "模型有提问待答复" : "有审批待处理";
    case "job_settled":
      return "后台任务已结算";
    case "surface_changed":
      return `端面 ${d.surfaceId ?? ""} ${d.event ?? ""}`;
    case "computer_operation":
      return "屏幕操作回显";
    default:
      return oneLine(JSON.stringify(d), 80);
  }
}

// —— 首次引导（settings 首跑标记——完成即写 onboardingDone）
async function maybeOnboard() {
  const envelope = await sendSettings({ op: "get" });
  if (!envelope.ok) return;
  setSettingsCache(envelope.result.settings);
  applyTheme(settingsCache.appearance?.theme); // 启动即应用已存主题（批 A token 双主题——原缺口：需开一次设置才切）
  if (settingsCache.onboardingDone === true) return;
  document.getElementById("onboarding").hidden = false;
}
document.getElementById("ob-done").addEventListener("click", async () => {
  settingsCache.onboardingDone = true;
  document.getElementById("onboarding").hidden = true;
  await sendSettings({ op: "update", patch: { onboardingDone: true } });
});

// —— 启动恢复横幅（M3 可视化）：恢复视图流尾存在未闭合轮 → 诊断 + 一键续跑
function showRecoveryIfInterrupted(events) {
  const open = new Map();
  for (const e of events) {
    if (e.type === "turn/start") open.set(e.turn, true);
    if (e.type === "turn/end") open.delete(e.turn);
  }
  const openTurns = [...open.keys()].sort((a, b) => a - b);
  if (openTurns.length === 0) return;
  const banner = document.getElementById("recovery-banner");
  document.getElementById("recovery-text").textContent =
    `检测到中断的轮：turn ${openTurns.join("、")} 未正常收束（M3 续跑在子进程启动时已自动执行）`;
  const retry = document.getElementById("recovery-retry");
  retry.hidden = lastUserPrompt === "";
  banner.hidden = false;
}
document.getElementById("recovery-retry").addEventListener("click", () => {
  document.getElementById("recovery-banner").hidden = true;
  if (lastUserPrompt !== "") {
    void sendRequest(sessionId(), {
      type: "prompt",
      messageId: allocRequestId("m"),
      content: lastUserPrompt,
    });
  }
});
document.getElementById("recovery-dismiss").addEventListener("click", () => {
  document.getElementById("recovery-banner").hidden = true;
});

// —— 更新横幅 + 发布说明弹窗（U7 消费端：宿主面更新器经
// window.aegentShowUpdate(version, notes) 触发——T-P3-114 接线点）
function showUpdateBanner(version, notes) {
  document.getElementById("update-text").textContent = `新版本可用：${version}`;
  document.getElementById("rn-version").textContent = `发布说明 · ${version}`;
  document.getElementById("rn-body").textContent = notes ?? "（无发布说明）";
  document.getElementById("update-banner").hidden = false;
}
window.aegentShowUpdate = (version, notes) => showUpdateBanner(version, notes);
document.getElementById("update-details").addEventListener("click", () => {
  document.getElementById("release-notes").hidden = false;
});
document.getElementById("update-dismiss").addEventListener("click", () => {
  document.getElementById("update-banner").hidden = true;
});
document.getElementById("rn-close").addEventListener("click", () => {
  document.getElementById("release-notes").hidden = true;
});

// 深链确认钩子（宿主接线面——aegentShowUpdate 同款；scheme 注册随真实分发
// 接入，记档）：aegent://import?data=<urlencoded 配置包> → 本钩子收 data。
// 导入链在设置域（views/settings.js）——动态 import 委派（懒加载不破）；
// 返回值为 Promise<"accepted"|"dismissed"|"rejected">（宿主面 eval 不消费返回值）。
window.aegentApplyDeepLink = (encodedData) =>
  import("./views/settings.js").then((m) => m.applyDeepLink(encodedData));

// —— 侧栏 Profiles 快速切换（#profile-quick 在骨架侧栏——设置域的
//    applyQuickProfile 经动态 import 调用，启动即可用）
document.getElementById("profile-quick").addEventListener("change", (ev) => {
  const name = ev.target.value;
  ev.target.value = "";
  if (name === "") return;
  void import("./views/settings.js").then((m) => m.applyQuickProfile(name));
});

// ---------------------------------------------------------------------------
// 快捷键统一分发（U25/T-P3-128）：注册表驱动（settings.shortcuts 覆盖默认
// 键位——设置页保存后 state.rebuildKeymap 同步）；面板开关 = 路由跳转
//（go 对当前视图重复触发 = 回对话——原 hidden 切换的路由等价面）。
// ---------------------------------------------------------------------------

const KEYMAP_HANDLERS = {
  settings: () => go("settings"),
  find: () => openFind(),
  search: () => go("search"),
  "close-find": () => {
    if (!findBar.hidden) {
      findBar.hidden = true;
      clearHits();
    }
  },
  history: () => openHistory(),
  work: () => openWorkpanel(),
  usage: () => openUsage(),
  notify: () => go("notify"),
};

window.addEventListener("keydown", (ev) => {
  // Esc 优先走搜索条关闭（输入态无关既有行为）；其余经注册表分发
  const inInput =
    document.activeElement instanceof HTMLTextAreaElement ||
    (document.activeElement instanceof HTMLInputElement &&
      document.activeElement.type !== "button");
  const action = resolveAction(getKeymapBindings(), ev, { inInput });
  if (action === null) return;
  const handler = KEYMAP_HANDLERS[action];
  if (handler !== undefined) {
    ev.preventDefault();
    handler();
  }
});

// ---------------------------------------------------------------------------
// WS 生命周期：hello → query 恢复 → live 流（连接与重连在 api.js——入口注入
// 信封分发与状态展示）
// ---------------------------------------------------------------------------

function handleEnvelope(envelope) {
  switch (envelope.type) {
    case "hello":
      // 握手回执携带本 host 的会话 id（路由引导）→ 发 query 恢复视图
      //（快照先行）；流续播随 event 信封自然衔接。
      leaseBtn.hidden = false;
      setSessionId(envelope.sessionId ?? null);
      if (getSessionId() !== "") {
        const requestId = allocRequestId("q");
        inflight.set(requestId, null);
        sendRaw({ type: "query", requestId, sessionId: getSessionId(), op: "events" });
      }
      void maybeOnboard(); // U13：首跑引导（settings onboardingDone 标记）
      break;
    case "response": {
      if (envelope.requestId === "(lease)") {
        // lease 直答回执（bridge onLease——requestId 恒 "(lease)"）
        if (envelope.ok) {
          const result = envelope.result ?? {};
          setLeaseUi(result.held === true, result.held === true ? SURFACE_ID : undefined);
        } else {
          appendLine(`租约失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
          setLeaseUi(false, undefined);
        }
        return;
      }
      const resolve = inflight.get(envelope.requestId);
      if (resolve !== undefined) {
        inflight.delete(envelope.requestId);
        if (resolve !== null) resolve(envelope);
      }
      if (envelope.requestId.startsWith("q-")) {
        if (envelope.ok) {
          renderHistory(envelope.result?.events ?? []);
        } else {
          appendLine(`恢复视图失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
        }
      } else if (!envelope.ok && !envelope.requestId.startsWith("s-")) {
        appendLine(`请求被拒：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
      }
      break;
    }
    case "event":
      if (getSessionId() === "") setSessionId(envelope.sessionId);
      renderEventEnvelope(envelope);
      break;
    case "notification":
      if (envelope.name === "n5") {
        consumeN5(envelope.payload ?? {}); // U13：N5 分型通知中心消费
      } else if (envelope.name === "approval_requested" || envelope.name === "question_asked") {
        if (getSessionId() === "") setSessionId(envelope.sessionId);
        buildCard(envelope.name, envelope.payload ?? {});
      } else if (envelope.name === "approval_settled") {
        removeCard(envelope.payload?.requestId);
        appendLine(`审批已结算：${envelope.payload?.allowed ? "允许" : "拒绝"}`, "meta");
      }
      break;
    case "hello_error":
      statusEl.textContent = `协议版本不符：${envelope.error?.message ?? ""}`;
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 启动：图标注入 → 侧栏导航与路由 → WS 连接
// ---------------------------------------------------------------------------

injectIcons(document);

// 侧栏导航：[data-route] 按钮 → hash 路由（对话/历史/搜索/工作台/用量/通知/设置）
for (const btn of document.querySelectorAll("#sidebar [data-route]")) {
  btn.addEventListener("click", () => go(btn.dataset.route));
}
document.getElementById("sidebar-toggle").addEventListener("click", () => {
  document.getElementById("app-shell").classList.toggle("rail");
});

/** 侧栏激活态与路由同步（hashchange 驱动——深链/前进后退同样生效）。 */
function syncNav() {
  const active = location.hash.replace(/^#\/?/, "").split("/")[0] || "chat";
  for (const btn of document.querySelectorAll("#sidebar [data-route]")) {
    btn.classList.toggle("active", btn.dataset.route === active);
  }
}
window.addEventListener("hashchange", syncNav);
syncNav();

// 聊天流重建回调注册（history/search 的"查看 = 只读恢复视图"消费）
hooks.resetStreamView = resetStreamView;
hooks.renderHistory = renderHistory;

startRouter(document.getElementById("view-root"), document.getElementById("chat-view"));

connect({
  onEnvelope: handleEnvelope,
  onStatus: (text) => {
    statusEl.textContent = text;
  },
  onClose: () => setLeaseUi(false, undefined), // 断连归还租约 UI（原 close 语义）
});
