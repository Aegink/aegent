/**
 * aegent ui（K5/K2·T-P1-128）——一份静态资产两个端：Web（浏览器直开 host
 * 地址）与桌面壳（Tauri WebView 加载同一目录）。零构建链零框架（卡序头
 * 约束 1）；协议面 = 端间协议（K8 信封）：hello → query events（恢复视图）
 * → request/lease（写命令持约）→ event/notification（流渲染）。
 */

// U4/T-P3-107 渲染分层：assistant 走 markdown+高亮管线（render.js——
// 用户输入不走此管线，注入面防呆）；vendor 本地化见 ui/vendor/README.md
import { buildDiffLines, parseDenial, renderMarkdown } from "./render.js";

// 桌面壳检测：Tauri 2 WebView 注入 __TAURI_INTERNALS__ 全局（无需 @tauri-apps/api）。
// surfaceId 前缀 web-/desktop- 是审计答复端（replySource）的来源约定。
const IS_DESKTOP = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const SURFACE_KIND = IS_DESKTOP ? "desktop" : "web";
const SURFACE_ID = `${SURFACE_KIND}-${Math.random().toString(36).slice(2, 8)}`;
const PROTOCOL_VERSION = 1;

const stream = document.getElementById("stream");
const pending = document.getElementById("pending");
const statusEl = document.getElementById("conn-status");
const surfaceEl = document.getElementById("surface-id");
const leaseEl = document.getElementById("lease-status");
const leaseBtn = document.getElementById("lease-btn");
const input = document.getElementById("prompt-input");
const sendBtn = document.getElementById("send-btn");
// U14/T-P3-103 设置中心
const settingsPanel = document.getElementById("settings-panel");
const settingsBtn = document.getElementById("settings-btn");
const settingsClose = document.getElementById("settings-close");
// U3/T-P3-105 会话历史侧栏
const historyPanel = document.getElementById("history-panel");
const historyBtn = document.getElementById("history-btn");
const historyClose = document.getElementById("history-close");

surfaceEl.textContent = SURFACE_ID;
let ws = null;
let holdsLease = false;
/** 在途请求（requestId → resolve）——response 信封关联（K8 requestId 关联面）。 */
const inflight = new Map();
let nextRequestId = 1;

function sendRequest(sessionId, call) {
  const requestId = `r-${nextRequestId++}`;
  return new Promise((resolve) => {
    inflight.set(requestId, resolve);
    ws.send(JSON.stringify({ type: "request", requestId, sessionId, call }));
  });
}

function sendRaw(envelope) {
  ws.send(JSON.stringify(envelope));
}

function appendLine(text, cls = "") {
  stream.appendChild(lineEl(text, cls));
  scrollBottom();
}

function lineEl(text, cls = "") {
  const div = document.createElement("div");
  div.className = `line ${cls}`.trim();
  div.textContent = text;
  return div;
}

function scrollBottom() {
  stream.scrollTop = stream.scrollHeight;
}

function oneLine(text, limit = 400) {
  const flat = String(text).replace(/\r?\n/g, " ⏎ ");
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function safeParseArgs(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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
  summary.textContent = `→ ${e.name} ${oneLine(args !== null ? JSON.stringify(args) : e.arguments, 160)}`;
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

function settleToolCard(e) {
  const content = e.message?.content ?? "";
  const isError = e.message?.isError === true;
  const existing = stream.querySelector(`details[data-call-id="${CSS.escape(e.callId)}"]`);
  if (existing !== null) {
    existing.classList.toggle("error", isError);
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

/** 最近一条用户输入（错误重试交互的重发面——turn/end error 卡的按钮）。 */
let lastUserPrompt = "";

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
      messageId: `m-${nextRequestId++}`,
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
      if (e.source !== "injected") lastUserPrompt = e.message?.content ?? "";
      return el;
    }
    case "assistant/message": {
      const bubble = document.createElement("div");
      bubble.className = `bubble agent ${e.interrupted ? "warn" : ""}`.trim();
      const content = e.message?.content ?? "";
      if (content === "") return lineEl("⬢ （模型转入工具调用）", "agent");
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

function renderEventEnvelope(envelope) {
  const node = renderEvent(envelope.event, { live: true });
  if (node !== null) {
    stream.appendChild(node);
    scrollBottom();
  }
  minimapRegister(node, envelope.event); // 小地图登记（含 null 守卫）
}

/** 恢复视图：历史事件一次性渲染（query 快照；此后走 event 流续播）。 */
function renderHistory(events) {
  for (const e of events) {
    const node = renderEvent(e);
    if (node !== null) stream.appendChild(node);
    minimapRegister(node, e);
  }
  if (events.length > 0) appendLine(`── 已恢复 ${events.length} 条历史事件 ──`, "meta");
  scrollBottom();
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
    const args = document.createElement("pre");
    args.className = "card-args";
    args.textContent = JSON.stringify(payload.args, null, 2);
    card.append(title, args);
    for (const action of ["allow", "deny"]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = action === "allow" ? "允许" : "拒绝";
      btn.className = action;
      btn.addEventListener("click", async () => {
        await sendRequest(sessionId(), {
          type: "approve",
          requestId: payload.requestId,
          action,
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
// 会话路由（单 host 单会话——sessionId 在 host 侧生成，恢复视图元数据回填）
// ---------------------------------------------------------------------------

let sessionIdValue = null;
function sessionId() {
  return sessionIdValue ?? "";
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
let fileCache = null; // { entries, truncated }（@ 补全——会话期缓存）
let metaCache = null; // { tools, skills }（/ 补全——会话期缓存）
let acItems = [];
let acIndex = -1;
let acContext = null; // { trigger, startPos, token }

async function ensureFileCache() {
  if (fileCache !== null) return fileCache;
  const envelope = await sendQuery({ sessionId: sessionId() || "-", op: "files" });
  if (envelope.ok) fileCache = envelope.result;
  return fileCache;
}

async function ensureMetaCache() {
  if (metaCache !== null) return metaCache;
  const envelope = await sendQuery({ sessionId: sessionId() || "-", op: "meta" });
  if (envelope.ok) metaCache = envelope.result;
  return metaCache;
}

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
  const insert = item.kind === "dir" ? item.label : `${item.label} `;
  input.value = `${before}${insert}${after}`;
  const pos = (before + insert).length;
  input.setSelectionRange(pos, pos);
  input.focus();
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
    const files = (await ensureFileCache()) ?? { entries: [], truncated: false };
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
    const meta = (await ensureMetaCache()) ?? { tools: [], skills: [] };
    const candidates = [
      ...UI_COMMANDS.map((c) => ({ icon: "⌘", label: c.label, hint: c.hint, kind: "command" })),
      ...meta.tools.map((t) => ({ icon: "🛠", label: t, hint: "工具", kind: "tool" })),
      ...meta.skills.map((s) => ({ icon: "✨", label: s.name, hint: s.description, kind: "skill" })),
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
      searchPanel.hidden = false;
      searchInput.focus();
      break;
    case "/history":
      void openHistory();
      break;
    case "/settings":
      void openSettings();
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
  lastUserPrompt = content;
  input.value = "";
  autoGrow();
  const attachments = pendingAttachments.splice(0, pendingAttachments.length);
  renderAttachmentsPreview();
  void sendRequest(sessionId(), {
    type: "prompt",
    messageId: `m-${nextRequestId++}`,
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

// ---------------------------------------------------------------------------
// U14/T-P3-103 设置中心：settings 信封直答（get/update + credentials-*），
// 即改即存（段级 patch，500ms 防抖合并），主题全端一致（CSS 变量）。
// ---------------------------------------------------------------------------

let settingsCache = null;
let saveTimer = null;
const dirtySections = new Set();

function sendSettings(call) {
  const requestId = `s-${nextRequestId++}`;
  return new Promise((resolve) => {
    inflight.set(requestId, resolve);
    sendRaw({ type: "settings", requestId, ...call });
  });
}

function applyTheme(theme) {
  document.body.dataset.theme = theme === "light" ? "light" : "dark";
}

/** 改动 → 标脏 → 防抖合并成一次段级 update（即改即存的保存时序）。 */
function markDirty(section) {
  dirtySections.add(section);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSettings, 500);
}

async function flushSettings() {
  if (dirtySections.size === 0 || settingsCache === null) return;
  const patch = {};
  for (const section of dirtySections) {
    if (section === "defaultProvider") {
      patch.defaultProvider = settingsCache.defaultProvider;
    } else {
      patch[section] = settingsCache[section] ?? {};
    }
  }
  dirtySections.clear();
  const envelope = await sendSettings({ op: "update", patch });
  if (envelope.ok) {
    settingsCache = envelope.result.settings;
    applyTheme(settingsCache.appearance?.theme);
  } else {
    appendLine(`设置保存失败：${envelope.error?.message ?? ""}`, "warn");
  }
}

function renderProviderList() {
  const list = document.getElementById("provider-list");
  list.replaceChildren();
  for (const entry of settingsCache?.providers ?? []) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    const isDefault = settingsCache?.defaultProvider === entry.name;
    const health = providerHealth[entry.name];
    const dot = health ? { operational: "●", degraded: "◐", unreachable: "○" }[health.status] ?? "" : "";
    label.textContent =
      `${dot} ${entry.name}（${entry.adapter ?? "openai"}${entry.model ? ` · ${entry.model}` : ""}）` +
      (health && health.message ? ` ${health.message}` : "");
    const defaultBtn = document.createElement("button");
    defaultBtn.type = "button";
    defaultBtn.textContent = isDefault ? "★ 默认" : "设为默认";
    defaultBtn.className = isDefault ? "default-mark" : "";
    defaultBtn.addEventListener("click", () => {
      settingsCache.defaultProvider = entry.name;
      dirtySections.add("defaultProvider");
      renderProviderList();
      markDirty("defaultProvider");
    });
    // U5/T-P3-104：会话期切换（J6——model/switch 请求，立即受理新 turn 生效）
    const switchBtn = document.createElement("button");
    switchBtn.type = "button";
    switchBtn.textContent = "本会话切换";
    switchBtn.addEventListener("click", async () => {
      if (sessionIdValue === null) {
        appendLine("会话未连接，无法切换（新会话将以默认供应商启动）", "warn");
        return;
      }
      const envelope = await sendRequest(sessionIdValue, {
        type: "model/switch",
        identity: { provider: entry.adapter ?? "openai", modelId: entry.model ?? settingsCache.defaultModel ?? "" },
      });
      if (envelope.ok) {
        appendLine(`已切换到 ${entry.adapter ?? "openai"}:${entry.model}（当前轮结束后新 turn 生效）`, "meta");
      } else {
        appendLine(`切换被拒：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
      }
    });
    // U5：健康徽标（J16 probeProvider 消费——可达性探测不触碰熔断器；10s 节流）
    const healthBtn = document.createElement("button");
    healthBtn.type = "button";
    healthBtn.textContent = "测健康";
    healthBtn.addEventListener("click", () => void probeHealth(entry.name));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => {
      settingsCache.providers = settingsCache.providers.filter((p) => p.name !== entry.name);
      if (isDefault) settingsCache.defaultProvider = undefined;
      dirtySections.add("providers");
      renderProviderList();
      markDirty("providers");
    });
    li.append(label, defaultBtn, switchBtn, healthBtn, delBtn);
    list.appendChild(li);
    // U5：编辑（点击条目名 → 表单回填 → 提交 = 条目更新，providers 段替换）
    label.style.cursor = "pointer";
    label.title = "点击编辑该条目";
    label.addEventListener("click", () => {
      editingProviderName = entry.name;
      document.getElementById("provider-name").value = entry.name;
      document.getElementById("provider-adapter").value = entry.adapter ?? "openai";
      document.getElementById("provider-baseurl").value = entry.baseUrl ?? "";
      document.getElementById("provider-model").value = entry.model ?? "";
      document.querySelector('#provider-form button[type="submit"]').textContent = "保存修改";
    });
  }
}

/** 编辑态（非 null = 表单在修改既有条目）。 */
let editingProviderName = null;

/** 健康探测结果缓存（UI 侧节流——每 provider 10s 内复用上次结果）。 */
const providerHealth = {};
const HEALTH_THROTTLE_MS = 10_000;

async function probeHealth(name) {
  const cached = providerHealth[name];
  const now = Date.now();
  if (cached && now - cached.at < HEALTH_THROTTLE_MS) return;
  const envelope = await sendSettings({ op: "probe", provider: name });
  if (envelope.ok) {
    const health = envelope.result.health;
    providerHealth[name] = { ...health, at: now };
    appendLine(`健康探测 ${name}：${health.message}`, health.status === "operational" ? "roster" : "warn");
  } else {
    providerHealth[name] = { status: "unreachable", message: envelope.error?.message ?? "探测失败", at: now, success: false };
    appendLine(`健康探测 ${name} 失败：${envelope.error?.message ?? ""}`, "warn");
  }
  renderProviderList();
}

function renderCredentialList(credentials) {
  const list = document.getElementById("credential-list");
  list.replaceChildren();
  for (const meta of credentials) {
    const li = document.createElement("li");
    li.textContent = `${meta.name}  ${meta.masked ?? ""}（更新于 ${meta.updatedAt}）`;
    list.appendChild(li);
  }
}

function fillSettingsForm() {
  document.getElementById("perm-timeout").value =
    settingsCache?.permission?.approvalTimeoutMs ?? "";
  document.getElementById("sandbox-network").value = settingsCache?.sandbox?.network ?? "";
  document.getElementById("sandbox-workspace").value = settingsCache?.sandbox?.workspace ?? "";
  document.getElementById("sandbox-db").value = settingsCache?.sandbox?.db ?? "";
  document.getElementById("appearance-theme").value = settingsCache?.appearance?.theme ?? "dark";
  document.getElementById("appearance-language").value = settingsCache?.appearance?.language ?? "zh-CN";
  document.getElementById("logging-rawdir").value = settingsCache?.logging?.rawLogDir ?? "";
  renderProviderList();
  renderProjectList();
}

async function openSettings() {
  const envelope = await sendSettings({ op: "get" });
  if (!envelope.ok) {
    appendLine(`设置读取失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  settingsCache = envelope.result.settings;
  applyTheme(settingsCache.appearance?.theme);
  fillSettingsForm();
  const creds = await sendSettings({ op: "credentials-list" });
  if (creds.ok) renderCredentialList(creds.result.credentials ?? []);
  settingsPanel.hidden = false;
}

settingsBtn.addEventListener("click", () => void openSettings());
settingsClose.addEventListener("click", () => {
  settingsPanel.hidden = true;
  void flushSettings(); // 关面板前收尾保存
});

// 供应商新增/编辑（providers 段整体替换——列表语义）
document.getElementById("provider-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const name = document.getElementById("provider-name").value.trim();
  if (name === "" || !/^[A-Za-z0-9_.-]{1,64}$/.test(name)) return;
  const entry = {
    name,
    adapter: document.getElementById("provider-adapter").value,
    ...(document.getElementById("provider-baseurl").value.trim() !== ""
      ? { baseUrl: document.getElementById("provider-baseurl").value.trim() }
      : {}),
    ...(document.getElementById("provider-model").value.trim() !== ""
      ? { model: document.getElementById("provider-model").value.trim() }
      : {}),
  };
  const rest = (settingsCache.providers ?? []).filter(
    (p) => p.name !== name && p.name !== editingProviderName,
  );
  settingsCache.providers = [...rest, entry];
  if (!settingsCache.defaultProvider || settingsCache.defaultProvider === editingProviderName) {
    settingsCache.defaultProvider = name;
  }
  editingProviderName = null;
  document.getElementById("provider-form").reset();
  document.querySelector('#provider-form button[type="submit"]').textContent = "新增";
  renderProviderList();
  markDirty("providers");
});

// 凭据（U2 的 UI 面——key 经 settings 信封 credentials-set，不落配置文件）
document.getElementById("credential-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const provider = document.getElementById("credential-provider").value.trim();
  const key = document.getElementById("credential-key").value;
  if (provider === "" || key === "") return;
  const envelope = await sendSettings({ op: "credentials-set", provider, key });
  document.getElementById("credential-key").value = "";
  if (envelope.ok) {
    appendLine(`凭据已保存：${provider} ${envelope.result.masked}`, "meta");
    const creds = await sendSettings({ op: "credentials-list" });
    if (creds.ok) renderCredentialList(creds.result.credentials ?? []);
  } else {
    appendLine(`凭据保存失败：${envelope.error?.message ?? ""}`, "warn");
  }
});

document.getElementById("credential-delete").addEventListener("click", async () => {
  const provider = document.getElementById("credential-provider").value.trim();
  if (provider === "") return;
  const envelope = await sendSettings({ op: "credentials-delete", provider });
  if (envelope.ok) {
    appendLine(`凭据已删除：${provider}`, "meta");
    const creds = await sendSettings({ op: "credentials-list" });
    if (creds.ok) renderCredentialList(creds.result.credentials ?? []);
  }
});

// 即改即存：字段改动 → 缓存 + 标脏（防抖合并）
document.getElementById("perm-timeout").addEventListener("change", (ev) => {
  const ms = Number(ev.target.value);
  settingsCache.permission = { ...settingsCache.permission, ...(Number.isFinite(ms) && ms > 0 ? { approvalTimeoutMs: ms } : {}) };
  markDirty("permission");
});
document.getElementById("sandbox-network").addEventListener("change", (ev) => {
  settingsCache.sandbox = { ...settingsCache.sandbox, ...(ev.target.value !== "" ? { network: ev.target.value } : {}) };
  markDirty("sandbox");
});
for (const [id, field] of [["sandbox-workspace", "workspace"], ["sandbox-db", "db"]]) {
  document.getElementById(id).addEventListener("change", (ev) => {
    const value = ev.target.value.trim();
    settingsCache.sandbox = { ...settingsCache.sandbox, ...(value !== "" ? { [field]: value } : {}) };
    markDirty("sandbox");
  });
}
document.getElementById("appearance-theme").addEventListener("change", (ev) => {
  settingsCache.appearance = { ...settingsCache.appearance, theme: ev.target.value };
  applyTheme(ev.target.value);
  markDirty("appearance");
});
document.getElementById("appearance-language").addEventListener("change", (ev) => {
  settingsCache.appearance = { ...settingsCache.appearance, language: ev.target.value };
  markDirty("appearance");
});
// U14/T-P3-132（#28）：日志分节（E14 原始分片目录持久化位——即改即存）
document.getElementById("logging-rawdir").addEventListener("change", (ev) => {
  const value = ev.target.value.trim();
  settingsCache.logging = { ...settingsCache.logging, ...(value !== "" ? { rawLogDir: value } : {}) };
  markDirty("logging");
});

// ---------------------------------------------------------------------------
// U11/T-P3-110 项目页：项目档 CRUD（projects 段整体替换）+ 设为活动
// （activeProject——生效语义 = 新会话以该项目 workspace 启动）+ 项目指令。
// ---------------------------------------------------------------------------

function renderProjectList() {
  const list = document.getElementById("project-list");
  list.replaceChildren();
  for (const p of settingsCache?.projects ?? []) {
    const li = document.createElement("li");
    const isActive = settingsCache?.activeProject === p.name;
    const label = document.createElement("span");
    label.textContent = `${isActive ? "★ " : ""}${p.name} → ${p.workspace}${p.instructions ? "（含指令）" : ""}`;
    const activateBtn = document.createElement("button");
    activateBtn.type = "button";
    activateBtn.textContent = isActive ? "★ 活动" : "设为活动";
    activateBtn.className = isActive ? "default-mark" : "";
    activateBtn.addEventListener("click", () => {
      settingsCache.activeProject = p.name;
      dirtySections.add("activeProject");
      renderProjectList();
      markDirty("activeProject");
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger";
    delBtn.addEventListener("click", () => {
      settingsCache.projects = settingsCache.projects.filter((x) => x.name !== p.name);
      if (settingsCache.activeProject === p.name) settingsCache.activeProject = undefined;
      dirtySections.add("projects");
      dirtySections.add("activeProject");
      renderProjectList();
      markDirty("projects");
      markDirty("activeProject");
    });
    li.append(label, activateBtn, delBtn);
    list.appendChild(li);
    label.style.cursor = "pointer";
    label.title = "点击编辑该项目";
    label.addEventListener("click", () => {
      editingProjectName = p.name;
      document.getElementById("project-name").value = p.name;
      document.getElementById("project-workspace").value = p.workspace;
      document.getElementById("project-instructions").value = p.instructions ?? "";
      document.querySelector('#project-form button[type="submit"]').textContent = "保存修改";
    });
  }
}

let editingProjectName = null;

document.getElementById("project-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const name = document.getElementById("project-name").value.trim();
  const workspace = document.getElementById("project-workspace").value.trim();
  const instructions = document.getElementById("project-instructions").value.trim();
  if (name === "" || workspace === "") return;
  const entry = { name, workspace, ...(instructions !== "" ? { instructions } : {}) };
  const rest = (settingsCache.projects ?? []).filter((p) => p.name !== name && p.name !== editingProjectName);
  settingsCache.projects = [...rest, entry];
  editingProjectName = null;
  document.getElementById("project-form").reset();
  document.querySelector('#project-form button[type="submit"]').textContent = "新增";
  renderProjectList();
  markDirty("projects");
});

// ---------------------------------------------------------------------------
// U3/T-P3-105 会话历史侧栏：query op:"sessions" 清单 + 只读查看 +
// 删除确认（settings op:"session-delete"——host 面写操作）
// ---------------------------------------------------------------------------

function sendQuery(call) {
  const requestId = `h-${nextRequestId++}`;
  return new Promise((resolve) => {
    inflight.set(requestId, resolve);
    sendRaw({ type: "query", requestId, ...call });
  });
}

function fmtTime(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return "?";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function openHistory() {
  const envelope = await sendQuery({ sessionId: sessionId() || "-", op: "sessions" });
  const list = document.getElementById("history-list");
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
        historyPanel.hidden = true;
        const view = await sendQuery({ sessionId: s.sessionId, op: "events" });
        if (view.ok) {
          resetStreamView();
          renderHistory(view.result.events ?? []);
          appendLine("── 只读视图：续聊请执行 aegent sessions resume " + s.sessionId + " ──", "warn");
        } else {
          appendLine(`查看失败：${view.error?.message ?? ""}`, "warn");
        }
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
        void openHistory(); // 刷新清单
      });
      li.append(label, viewBtn, delBtn);
      list.appendChild(li);
    }
  }
  historyPanel.hidden = false;
}

historyBtn.addEventListener("click", () => void openHistory());
historyClose.addEventListener("click", () => {
  historyPanel.hidden = true;
});

// ---------------------------------------------------------------------------
// U9/T-P3-108 对话导航与检索：会话内搜索（Ctrl+F 渲染层高亮跳转）+
// 跨会话搜索（query op:"search"——Q2 检索面的 UI 消费）+ 小地图（消息
// 类型着色条 + 点击跳轮，纯 DOM）。
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

// —— 跨会话搜索（Q2 消费）：命中列表 → 查看 = 只读恢复视图（续聊入口提示）
const searchPanel = document.getElementById("search-panel");
const searchInput = document.getElementById("search-input");

document.getElementById("search-btn").addEventListener("click", () => {
  searchPanel.hidden = false;
  searchInput.focus();
});
document.getElementById("search-close").addEventListener("click", () => {
  searchPanel.hidden = true;
});

document.getElementById("search-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const q = searchInput.value.trim();
  if (q === "") return;
  const envelope = await sendQuery({
    sessionId: sessionId() || "-",
    op: "search",
    criteria: { contentLike: q, limit: 50 },
  });
  const list = document.getElementById("search-results");
  const meta = document.getElementById("search-meta");
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
      searchPanel.hidden = true;
      const view = await sendQuery({ sessionId: r.sessionId, op: "events" });
      if (view.ok) {
        resetStreamView();
        renderHistory(view.result.events ?? []);
        appendLine("── 只读视图：续聊请执行 aegent sessions resume " + r.sessionId + " ──", "warn");
      } else {
        appendLine(`查看失败：${view.error?.message ?? ""}`, "warn");
      }
    });
    li.append(label, viewBtn);
    list.appendChild(li);
  }
});

// —— 小地图：消息类型着色条 + 点击跳轮（纯 DOM——展示什么导航什么）
const minimap = document.getElementById("minimap");
const MINIMAP_KINDS = {
  "user/message": "mm-user",
  "assistant/message": "mm-agent",
  "tool/call": "mm-tool",
  "tool/result": "mm-tool",
};
const minimapEntries = [];
let minimapTurn = 0;

function minimapRegister(node, e) {
  const kind = MINIMAP_KINDS[e.type];
  if (kind === undefined) {
    if (e.type === "turn/start") minimapTurn = e.turn;
    return;
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
  stream.replaceChildren();
}

// Ctrl+F 会话内搜索 / Ctrl+Shift+F 跨会话搜索 / Esc 关闭
window.addEventListener("keydown", (ev) => {
  if (ev.ctrlKey && !ev.shiftKey && ev.key.toLowerCase() === "f") {
    ev.preventDefault();
    openFind();
  } else if (ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === "f") {
    ev.preventDefault();
    searchPanel.hidden = false;
    searchInput.focus();
  } else if (ev.key === "Escape") {
    if (!findBar.hidden) {
      findBar.hidden = true;
      clearHits();
    }
  }
});

// ---------------------------------------------------------------------------
// WS 生命周期：hello → query 恢复 → live 流
// ---------------------------------------------------------------------------

/** host 地址：Web 模式 = 当前页面 origin（同一 host 进程）；桌面壳模式 =
 * WebView 从 tauri:// 协议加载（location.host 无意义）——直连本机 host
 * 缺省端口（server.ts --port 缺省 8787），可用 URL 参数 ?host= 覆盖。 */
function hostAddress() {
  const params = new URLSearchParams(location.search);
  const explicit = params.get("host");
  if (explicit !== null && explicit !== "") return explicit;
  if (IS_DESKTOP) return "ws://127.0.0.1:8787";
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}

function connect() {
  ws = new WebSocket(`${hostAddress()}/ws`);
  ws.addEventListener("open", () => {
    statusEl.textContent = "已连接";
    sendRaw({ type: "hello", version: PROTOCOL_VERSION, surfaceId: SURFACE_ID, deliveryKind: "push" });
  });
  ws.addEventListener("message", (ev) => {
    for (const line of String(ev.data).split("\n")) {
      if (line.trim() === "") continue;
      let envelope;
      try {
        envelope = JSON.parse(line);
      } catch {
        continue;
      }
      handleEnvelope(envelope);
    }
  });
  ws.addEventListener("close", () => {
    statusEl.textContent = "连接断开，3s 后重连…";
    setLeaseUi(false, undefined);
    setTimeout(connect, 3000);
  });
}

function handleEnvelope(envelope) {
  switch (envelope.type) {
    case "hello":
      // 握手回执携带本 host 的会话 id（路由引导）→ 发 query 恢复视图
      //（快照先行）；流续播随 event 信封自然衔接。
      leaseBtn.hidden = false;
      sessionIdValue = envelope.sessionId ?? null;
      if (sessionIdValue !== null) {
        const requestId = `q-${nextRequestId++}`;
        inflight.set(requestId, null);
        sendRaw({ type: "query", requestId, sessionId: sessionIdValue, op: "events" });
      }
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
      if (sessionIdValue === null) sessionIdValue = envelope.sessionId;
      renderEventEnvelope(envelope);
      break;
    case "notification":
      if (envelope.name === "approval_requested" || envelope.name === "question_asked") {
        if (sessionIdValue === null) sessionIdValue = envelope.sessionId;
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

connect();
