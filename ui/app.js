/**
 * aegent ui（K5/K2·T-P1-128）——一份静态资产两个端：Web（浏览器直开 host
 * 地址）与桌面壳（Tauri WebView 加载同一目录）。零构建链零框架（卡序头
 * 约束 1）；协议面 = 端间协议（K8 信封）：hello → query events（恢复视图）
 * → request/lease（写命令持约）→ event/notification（流渲染）。
 */

// U4/T-P3-107 渲染分层：assistant 走 markdown+高亮管线（render.js——
// 用户输入不走此管线，注入面防呆）；vendor 本地化见 ui/vendor/README.md
import { buildDiffLines, parseDenial, renderMarkdown } from "./render.js";
// U25/T-P3-128 快捷键注册表（纯逻辑模块——清单/覆盖合并/冲突检测）
import {
  ACTION_LABELS,
  DEFAULT_KEYMAP,
  createKeymap,
  detectConflict,
  eventToCombo,
  resolveAction,
} from "./keymap.js";

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
  showRecoveryIfInterrupted(events); // U13：M3 启动恢复可视化（流尾未闭合轮）
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

// —— U16/T-P3-118：提示词模板的 / 补全数据面（settings get 一次缓存；
// 设置面板保存 prompts 段后 settingsCache 同步，下次补全即用新库）
let promptsCacheLoaded = false;
async function ensurePromptsCache() {
  if (promptsCacheLoaded) return settingsCache?.prompts ?? [];
  const envelope = await sendSettings({ op: "get" });
  if (envelope.ok) {
    settingsCache = envelope.result.settings;
    promptsCacheLoaded = true;
  }
  return settingsCache?.prompts ?? [];
}

function templateVarNames(content) {
  return [...new Set([...content.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].map((m) => m[1]))];
}
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
    } else if (section === "projects" || section === "prompts") {
      patch[section] = settingsCache[section] ?? []; // 数组段缺省发空数组（对象段才发 {}）
    } else {
      patch[section] = settingsCache[section] ?? {};
    }
  }
  dirtySections.clear();
  const envelope = await sendSettings({ op: "update", patch });
  if (envelope.ok) {
    settingsCache = envelope.result.settings;
    applyTheme(settingsCache.appearance?.theme);
    rebuildKeymap(); // U25：shortcuts 段保存后键位同步
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
    // U19/T-P3-121：故障转移优先级排序（数组序 = J15 队列序——可见可调）
    const orderIndex = settingsCache.providers.indexOf(entry);
    const moveBtn = (label2, delta) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label2;
      b.disabled =
        delta < 0 ? orderIndex === 0 : orderIndex === settingsCache.providers.length - 1;
      b.title = delta < 0 ? "故障转移优先级：上移" : "故障转移优先级：下移";
      b.addEventListener("click", () => {
        const arr = [...settingsCache.providers];
        const j = orderIndex + delta;
        [arr[orderIndex], arr[j]] = [arr[j], arr[orderIndex]];
        settingsCache.providers = arr;
        dirtySections.add("providers");
        renderProviderList();
        markDirty("providers");
      });
      return b;
    };
    li.append(
      label,
      defaultBtn,
      switchBtn,
      healthBtn,
      moveBtn("↑", -1),
      moveBtn("↓", 1),
      delBtn,
    );
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
  renderPromptList();
  renderMcpList();
  renderProfileList();
  // U18/T-P3-120：辅助模型分节回填（缺省回退主模型链——空输入 = 未配置）
  const task = (name) => settingsCache?.enhancement?.[name] ?? {};
  document.getElementById("enh-judge-provider").value = task("judge").provider ?? "";
  document.getElementById("enh-judge-model").value = task("judge").model ?? "";
  document.getElementById("enh-judge-reasoning").value = task("judge").reasoning ?? "";
  document.getElementById("enh-summarizer-provider").value = task("summarizer").provider ?? "";
  document.getElementById("enh-summarizer-model").value = task("summarizer").model ?? "";
  document.getElementById("enh-summarizer-reasoning").value = task("summarizer").reasoning ?? "";
  // U26/T-P3-129：STT 分节回填（空输入 = 未配置——语音输入不可用）
  document.getElementById("stt-baseurl").value = settingsCache?.stt?.baseUrl ?? "";
  document.getElementById("stt-model").value = settingsCache?.stt?.model ?? "";
  document.getElementById("stt-language").value = settingsCache?.stt?.language ?? "";
}

// U18：辅助模型三字段即改即存（enhancement 段整段合并——两任务互不覆盖）
function enhancementInputHandler(prefix, taskName, field) {
  document.getElementById(`${prefix}-${field}`).addEventListener("change", () => {
    const cur = settingsCache.enhancement?.[taskName] ?? {};
    const provider = document.getElementById(`${prefix}-provider`).value.trim();
    const model = document.getElementById(`${prefix}-model`).value.trim();
    const reasoning = document.getElementById(`${prefix}-reasoning`).value;
    const next = {};
    if (provider !== "") next.provider = provider;
    if (model !== "") next.model = model;
    if (reasoning !== "") next.reasoning = reasoning;
    settingsCache.enhancement = {
      ...(settingsCache.enhancement ?? {}),
      ...(Object.keys(next).length > 0 ? { [taskName]: next } : {}),
    };
    // 空配置 = 删除该任务条目（回退主模型链）
    if (Object.keys(next).length === 0) {
      const rest = { ...(settingsCache.enhancement ?? {}) };
      delete rest[taskName];
      settingsCache.enhancement = Object.keys(rest).length > 0 ? rest : undefined;
    }
    dirtySections.add("enhancement");
    markDirty("enhancement");
  });
}
enhancementInputHandler("enh-judge", "judge", "provider");
enhancementInputHandler("enh-judge", "judge", "model");
enhancementInputHandler("enh-judge", "judge", "reasoning");
enhancementInputHandler("enh-summarizer", "summarizer", "provider");
enhancementInputHandler("enh-summarizer", "summarizer", "model");
enhancementInputHandler("enh-summarizer", "summarizer", "reasoning");

// —— U19/T-P3-121 Profiles 组合档 + 故障转移优先级排序
function applyProfileValues(p) {
  // 切换 = 批量写生效段（applyProfile 同语义——UI 侧呈现层实现）
  settingsCache.defaultProvider = p.defaultProvider;
  settingsCache.defaultModel = p.defaultModel;
  settingsCache.permission = p.permission ?? settingsCache.permission;
  settingsCache.sandbox = p.sandbox ?? settingsCache.sandbox;
  settingsCache.activeProfile = p.name;
  for (const sec of ["defaultProvider", "defaultModel", "permission", "sandbox", "activeProfile"]) {
    dirtySections.add(sec);
  }
  renderProfileList();
  renderProviderList();
  markDirty("defaultProvider");
  markDirty("defaultModel");
  markDirty("permission");
  markDirty("sandbox");
  markDirty("activeProfile");
}

function renderProfileList() {
  const list = document.getElementById("profile-list");
  list.replaceChildren();
  const profiles = settingsCache?.profiles ?? [];
  for (const p of profiles) {
    const li = document.createElement("li");
    li.className = "profile-item";
    const isActive = settingsCache?.activeProfile === p.name;
    const label = document.createElement("span");
    label.textContent = `${isActive ? "★ " : ""}${p.name} → ${p.defaultProvider}${p.defaultModel ? `/${p.defaultModel}` : ""}${p.sandbox?.network ? `（网络 ${p.sandbox.network}）` : ""}`;
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.textContent = isActive ? "★ 当前" : "切换";
    applyBtn.className = isActive ? "default-mark" : "";
    applyBtn.addEventListener("click", () => {
      applyProfileValues(p);
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger";
    delBtn.addEventListener("click", () => {
      if (!window.confirm(`删除配置档「${p.name}」？`)) return;
      settingsCache.profiles = (settingsCache.profiles ?? []).filter((x) => x.name !== p.name);
      if (settingsCache.activeProfile === p.name) settingsCache.activeProfile = undefined;
      dirtySections.add("profiles");
      dirtySections.add("activeProfile");
      renderProfileList();
      markDirty("profiles");
      markDirty("activeProfile");
    });
    li.append(label, applyBtn, delBtn);
    list.appendChild(li);
  }
  if (profiles.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "（无配置档——填表单或先填入当前生效值再建档）";
    list.appendChild(li);
  }
  renderProfileQuick();
}

function renderProfileQuick() {
  const sel = document.getElementById("profile-quick");
  const profiles = settingsCache?.profiles ?? [];
  sel.hidden = profiles.length === 0;
  sel.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "场景";
  sel.appendChild(placeholder);
  for (const p of profiles) {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = `${settingsCache?.activeProfile === p.name ? "★ " : ""}${p.name}`;
    sel.appendChild(opt);
  }
}

document.getElementById("profile-quick").addEventListener("change", (ev) => {
  const name = ev.target.value;
  ev.target.value = "";
  const p = (settingsCache?.profiles ?? []).find((x) => x.name === name);
  if (p !== undefined) {
    applyProfileValues(p);
    toast(`已切换配置档：${p.name}`, "info");
  }
});

document.getElementById("profile-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const name = document.getElementById("profile-name").value.trim();
  const provider = document.getElementById("profile-provider").value.trim();
  const model = document.getElementById("profile-model").value.trim();
  const timeoutRaw = document.getElementById("profile-timeout").value;
  const network = document.getElementById("profile-network").value;
  if (name === "" || provider === "") return;
  const entry = {
    name,
    defaultProvider: provider,
    ...(model !== "" ? { defaultModel: model } : {}),
    ...(timeoutRaw !== "" ? { permission: { approvalTimeoutMs: Number(timeoutRaw) } } : {}),
    ...(network !== "" ? { sandbox: { network } } : {}),
  };
  const profiles = (settingsCache.profiles ?? []).filter((x) => x.name !== name);
  profiles.push(entry);
  settingsCache.profiles = profiles;
  document.getElementById("profile-name").value = "";
  dirtySections.add("profiles");
  renderProfileList();
  markDirty("profiles");
});

document.getElementById("profile-snapshot").addEventListener("click", () => {
  document.getElementById("profile-provider").value = settingsCache?.defaultProvider ?? "";
  document.getElementById("profile-model").value = settingsCache?.defaultModel ?? "";
  document.getElementById("profile-timeout").value =
    settingsCache?.permission?.approvalTimeoutMs ?? "";
  document.getElementById("profile-network").value = settingsCache?.sandbox?.network ?? "";
});

// —— U20/T-P3-122 导入导出与深链分享（导出零凭据；导入必确认——不可信输入）
function buildExportText() {
  const payload = {
    version: 1,
    kind: "aegent-settings-export",
    exportedAt: new Date().toISOString(),
    settings: settingsCache,
  };
  const text = JSON.stringify(payload, null, 2);
  if (text.includes('"apiKey"')) throw new Error("导出包含 apiKey 字段（拒绝导出）");
  return text;
}

// 摘要行（与 src/session/settings-transfer.ts summarizePackage 同语义——UI 侧呈现层）
function summarizeImported(s) {
  const lines = [`供应商条目 ${(s.providers ?? []).length} 个（默认 ${s.defaultProvider ?? "未设置"}）`];
  if (s.defaultModel !== undefined) lines.push(`默认模型 ${s.defaultModel}`);
  if (s.permission?.approvalTimeoutMs !== undefined) lines.push(`审批超时 ${s.permission.approvalTimeoutMs}ms`);
  if (s.sandbox?.network !== undefined) lines.push(`网络档 ${s.sandbox.network}`);
  if ((s.projects ?? []).length > 0) lines.push(`项目 ${s.projects.length} 个`);
  if ((s.prompts ?? []).length > 0) lines.push(`提示词模板 ${s.prompts.length} 个`);
  if ((s.mcp ?? []).length > 0) lines.push(`MCP server ${s.mcp.length} 个`);
  if ((s.profiles ?? []).length > 0) lines.push(`配置档 ${s.profiles.length} 个`);
  return lines;
}

async function applyImportedSettingsObject(importedSettings) {
  const envelope = await sendSettings({ op: "import", settings: importedSettings });
  if (!envelope.ok) {
    appendLine(`导入失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
    return false;
  }
  settingsCache = envelope.result.settings;
  promptsCacheLoaded = true;
  applyTheme(settingsCache.appearance?.theme);
  rebuildKeymap(); // U25：导入后键位同步
  fillSettingsForm();
  return true;
}

document.getElementById("export-btn").addEventListener("click", () => {
  if (settingsCache === null) {
    document.getElementById("export-status").textContent = "设置未加载——先打开设置读取";
    return;
  }
  try {
    const text = buildExportText();
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aegent-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    document.getElementById("export-status").textContent = "已导出（不含凭据）";
  } catch (e) {
    document.getElementById("export-status").textContent = `导出失败：${e.message}`;
  }
});

document.getElementById("import-file").addEventListener("change", (ev) => {
  const file = ev.target.files?.[0];
  if (file === undefined) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result);
    const previewEl = document.getElementById("import-preview");
    const summaryEl = document.getElementById("import-summary");
    const applyBtn = document.getElementById("import-apply");
    try {
      const parsed = JSON.parse(text);
      if (parsed?.kind !== "aegent-settings-export") throw new Error("kind 不符（须为 aegent-settings-export 配置包）");
      const summary = summarizeImported(parsed.settings ?? {});
      previewEl.textContent = text.length > 4000 ? `${text.slice(0, 4000)}\n…（截断预览）` : text;
      previewEl.hidden = false;
      summaryEl.textContent = `导入将变更：${summary.join("；")}`;
      summaryEl.dataset.ok = "1";
      applyBtn.hidden = false;
      applyBtn.dataset.payload = text; // 确认后才上送（确认面 = C 族防线的用户侧延伸）
    } catch (e) {
      previewEl.hidden = true;
      applyBtn.hidden = true;
      summaryEl.textContent = `✘ 导入包不可用：${e.message}`;
    }
  };
  reader.readAsText(file);
});

document.getElementById("import-apply").addEventListener("click", (ev) => {
  const payload = ev.target.dataset.payload;
  if (payload === undefined) return;
  const parsed = JSON.parse(payload);
  const summary = summarizeImported(parsed.settings ?? {}).join("；");
  // 导入必确认（cc-switch deeplink 三确认行为锚——不可信输入逐项列出后确认）
  if (!window.confirm(`确认导入以下配置并覆盖当前值？\n\n${summary}\n\n（导入前自动备份当前配置）`)) return;
  void applyImportedSettingsObject(parsed.settings).then((ok) => {
    if (ok) {
      ev.target.hidden = true;
      document.getElementById("import-summary").textContent = "✔ 导入完成（备份已滚动）";
      toast("配置导入完成", "info");
    }
  });
});

// 深链确认钩子（宿主接线面——aegentShowUpdate 同款；scheme 注册随真实分发
// 接入，记档）：aegent://import?data=<urlencoded 配置包> → 本钩子收 data。
window.aegentApplyDeepLink = function (encodedData) {
  try {
    const text = decodeURIComponent(encodedData);
    const parsed = JSON.parse(text);
    if (parsed?.kind !== "aegent-settings-export") throw new Error("kind 不符");
    const summary = summarizeImported(parsed.settings ?? {}).join("；");
    if (!window.confirm(`收到深链分享配置，确认导入？\n\n${summary}`)) return "dismissed";
    void applyImportedSettingsObject(parsed.settings).then(() => toast("配置导入完成", "info"));
    return "accepted";
  } catch (e) {
    appendLine(`深链导入失败：${e.message}`, "warn");
    return "rejected";
  }
};

async function openSettings() {
  const envelope = await sendSettings({ op: "get" });
  if (!envelope.ok) {
    appendLine(`设置读取失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  settingsCache = envelope.result.settings;
  promptsCacheLoaded = true;
  applyTheme(settingsCache.appearance?.theme);
  rebuildKeymap(); // U25：键位表随 settings 就绪
  fillSettingsForm();
  renderShortcutList();
  const creds = await sendSettings({ op: "credentials-list" });
  if (creds.ok) renderCredentialList(creds.result.credentials ?? []);
  settingsPanel.hidden = false;
  renderSkillRoots();
  void refreshSkillsList(); // U22：技能清单（文件系统面——每次打开刷新）
  void refreshSubagentsList(); // U23：子代理清单（内置+自定义——每次打开刷新）
  void refreshPluginsList(); // T-P3-133：插件清单（安装期校验诊断——每次打开刷新）
  void openInstructionsOnce(); // U24：指令中心（打开时拉一次，保存后局部刷新）
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

// —— U16/T-P3-118 提示词模板库（settings prompts 段整段替换——upsert 同名原位替换）
let editingPromptName = null;

function renderPromptList() {
  const list = document.getElementById("prompt-list");
  list.replaceChildren();
  for (const p of settingsCache?.prompts ?? []) {
    const li = document.createElement("li");
    li.className = "prompt-item";
    const label = document.createElement("span");
    label.textContent = `📝 ${p.name}${p.description ? `——${p.description}` : ""}`;
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger";
    delBtn.addEventListener("click", () => {
      if (!window.confirm(`删除提示词模板「${p.name}」？`)) return;
      settingsCache.prompts = (settingsCache.prompts ?? []).filter((x) => x.name !== p.name);
      if (editingPromptName === p.name) editingPromptName = null;
      dirtySections.add("prompts");
      renderPromptList();
      markDirty("prompts");
    });
    li.append(label, delBtn);
    list.appendChild(li);
    label.style.cursor = "pointer";
    label.title = "点击编辑该模板";
    label.addEventListener("click", () => {
      editingPromptName = p.name;
      document.getElementById("prompt-name").value = p.name;
      document.getElementById("prompt-desc").value = p.description ?? "";
      document.getElementById("prompt-content").value = p.content;
      document.querySelector('#prompt-form button[type="submit"]').textContent = "保存修改";
    });
  }
  if ((settingsCache?.prompts ?? []).length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "（库为空——新增模板后在输入区 / 补全中调用）";
    list.appendChild(li);
  }
}

document.getElementById("prompt-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const name = document.getElementById("prompt-name").value.trim();
  const desc = document.getElementById("prompt-desc").value.trim();
  const content = document.getElementById("prompt-content").value;
  if (name === "" || content.trim() === "") return;
  const prompts = (settingsCache.prompts ?? []).filter((x) => x.name !== name);
  prompts.push({ name, content, ...(desc !== "" ? { description: desc } : {}) });
  settingsCache.prompts = prompts;
  editingPromptName = null;
  document.getElementById("prompt-name").value = "";
  document.getElementById("prompt-desc").value = "";
  document.getElementById("prompt-content").value = "";
  document.querySelector('#prompt-form button[type="submit"]').textContent = "新增";
  dirtySections.add("prompts");
  renderPromptList();
  markDirty("prompts");
});

// —— U17/T-P3-119 MCP 管理向导 + 统一面板（settings mcp 段；连接校验走
// settings op:"mcp-check"——launch 一次握手+列工具后关闭，回执转 UI 状态）
let editingMcpName = null;
let mcpWizardEntry = null; // 向导当前编辑的 {name, command, args}
let mcpTestOk = false;

function renderMcpList() {
  const list = document.getElementById("mcp-list");
  list.replaceChildren();
  for (const s of settingsCache?.mcp ?? []) {
    const li = document.createElement("li");
    li.className = "mcp-item";
    const label = document.createElement("span");
    label.textContent = `🔌 ${s.name} → ${s.command}${(s.args ?? []).length > 0 ? ` ${(s.args ?? []).join(" ")}` : ""}${s.enabled === false ? "（已停用）" : ""}`;
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.textContent = s.enabled === false ? "启用" : "停用";
    toggleBtn.addEventListener("click", () => {
      // 缺省启用（enabled 缺省 true）：停用写 false、启用删字段回缺省
      settingsCache.mcp = (settingsCache.mcp ?? []).map((x) => {
        if (x.name !== s.name) return x;
        if (x.enabled === false) {
          const { enabled: _omit, ...rest } = x;
          return rest;
        }
        return { ...x, enabled: false };
      });
      dirtySections.add("mcp");
      renderMcpList();
      markDirty("mcp");
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger";
    delBtn.addEventListener("click", () => {
      if (!window.confirm(`删除 MCP server「${s.name}」？`)) return;
      settingsCache.mcp = (settingsCache.mcp ?? []).filter((x) => x.name !== s.name);
      dirtySections.add("mcp");
      renderMcpList();
      markDirty("mcp");
    });
    li.append(label, toggleBtn, delBtn);
    list.appendChild(li);
    label.style.cursor = "pointer";
    label.title = "点击编辑该 server";
    label.addEventListener("click", () => {
      editingMcpName = s.name;
      openMcpWizard(s);
    });
  }
  if ((settingsCache?.mcp ?? []).length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "（无 MCP server——点「添加 server」走向导）";
    list.appendChild(li);
  }
}

function openMcpWizard(entry) {
  mcpWizardEntry = entry ?? null;
  mcpTestOk = false;
  document.getElementById("mcp-wizard").hidden = false;
  document.getElementById("mcp-step1").hidden = false;
  document.getElementById("mcp-step2").hidden = true;
  document.getElementById("mcp-save").disabled = true;
  document.getElementById("mcp-check-result").textContent = "未测试";
  document.getElementById("mcp-name").value = entry?.name ?? "";
  document.getElementById("mcp-command").value = entry?.command ?? "";
  document.getElementById("mcp-args").value = (entry?.args ?? []).join(" ");
}

document.getElementById("mcp-add").addEventListener("click", () => {
  editingMcpName = null;
  openMcpWizard(null);
});
document.getElementById("mcp-next").addEventListener("click", () => {
  const name = document.getElementById("mcp-name").value.trim();
  const command = document.getElementById("mcp-command").value.trim();
  const args = document.getElementById("mcp-args").value.trim().split(/\s+/).filter((a) => a !== "");
  if (name === "" || name.includes("__") || command === "") {
    toast("名称（不含 __）与启动命令必填", "warn");
    return;
  }
  mcpWizardEntry = { name, command, ...(args.length > 0 ? { args } : {}) };
  document.getElementById("mcp-step1").hidden = true;
  document.getElementById("mcp-step2").hidden = false;
});
document.getElementById("mcp-back").addEventListener("click", () => {
  document.getElementById("mcp-step2").hidden = true;
  document.getElementById("mcp-step1").hidden = false;
});
document.getElementById("mcp-test").addEventListener("click", () => {
  if (mcpWizardEntry === null) return;
  const resultEl = document.getElementById("mcp-check-result");
  resultEl.textContent = "测试中…（最长 8 秒）";
  void sendSettings({
    op: "mcp-check",
    name: mcpWizardEntry.name,
    command: mcpWizardEntry.command,
    ...(mcpWizardEntry.args !== undefined ? { args: mcpWizardEntry.args } : {}),
  }).then((envelope) => {
    if (!envelope.ok) {
      resultEl.textContent = `校验不可用：${envelope.error?.message ?? ""}`;
      return;
    }
    const check = envelope.result.check;
    if (check.ok) {
      mcpTestOk = true;
      document.getElementById("mcp-save").disabled = false;
      resultEl.textContent = `✔ 连接成功（协议 ${check.protocolVersion}，${(check.tools ?? []).length} 个工具）`;
    } else {
      resultEl.textContent = `✘ 连接失败：${check.error?.message ?? ""}`;
    }
  });
});
document.getElementById("mcp-save").addEventListener("click", () => {
  if (mcpWizardEntry === null || !mcpTestOk) return;
  // 重名校验（对其他条目——本条目编辑改名时以 editingMcpName 排除自身）
  const conflict = (settingsCache.mcp ?? []).some(
    (x) => x.name === mcpWizardEntry.name && x.name !== editingMcpName,
  );
  if (conflict) {
    toast("server 名已存在", "warn");
    return;
  }
  let list = (settingsCache.mcp ?? []).filter(
    (x) => x.name !== mcpWizardEntry.name && x.name !== editingMcpName,
  );
  list.push(mcpWizardEntry);
  settingsCache.mcp = list;
  editingMcpName = null;
  document.getElementById("mcp-wizard").hidden = true;
  dirtySections.add("mcp");
  renderMcpList();
  markDirty("mcp");
});

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
// U22/T-P3-125 技能管理：清单（多根扫描 + 停用开关）+ 编辑器写回
// （op:"skill-save"）+ 来源目录 CRUD（settings skills.roots 段）。
// ---------------------------------------------------------------------------

/** 技能清单缓存（openSettings 时刷新——文件系统面，不与会话期缓存混用）。 */
let skillsView = null;
let editingSkillName = null; // 非 null = 编辑器在改既有技能（同名覆盖）
const skillToolsSelected = new Set();

async function refreshSkillsList() {
  const envelope = await sendSettings({ op: "skills-list" });
  const list = document.getElementById("skill-list");
  list.replaceChildren();
  if (!envelope.ok) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = `技能清单不可用：${envelope.error?.message ?? ""}`;
    list.appendChild(li);
    return;
  }
  skillsView = envelope.result;
  for (const s of skillsView.skills) {
    const li = document.createElement("li");
    li.className = "skill-item";
    const label = document.createElement("span");
    const isWorkspace = s.origin === skillsView.roots[0];
    const disabled = skillsView.disabled.includes(s.name);
    label.textContent = `✨ ${s.name}${isWorkspace ? "" : "（外部来源）"}${disabled ? "（已停用）" : ""}——${s.description}`;
    // 启用开关（停用名单进 settings.skills.disabled——新会话装配生效）
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.textContent = disabled ? "启用" : "停用";
    toggleBtn.addEventListener("click", () => {
      const cur = new Set(settingsCache.skills?.disabled ?? []);
      if (cur.has(s.name)) cur.delete(s.name);
      else cur.add(s.name);
      settingsCache.skills = { ...(settingsCache.skills ?? {}), ...(cur.size > 0 ? { disabled: [...cur] } : {}) };
      dirtySections.add("skills");
      markDirty("skills");
      void refreshSkillsList();
    });
    // 工具集 chips（技能声明的工具集——清单元数据展示）
    const toolsRow = document.createElement("span");
    toolsRow.className = "skill-tools";
    for (const t of s.tools ?? []) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = t;
      toolsRow.appendChild(chip);
    }
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "编辑";
    editBtn.addEventListener("click", () => {
      void openSkillEditor(s);
    });
    li.append(label, toolsRow, toggleBtn, editBtn);
    list.appendChild(li);
  }
  if (skillsView.skills.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "（无技能——新建或添加来源目录；workspace/.zcode/skills 下的 SKILL.md 自动发现）";
    list.appendChild(li);
  }
  for (const d of skillsView.diagnostics) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = `诊断 [${d.code}] ${d.path}——${d.message}`;
    list.appendChild(li);
  }
}

function renderSkillRoots() {
  const list = document.getElementById("skill-roots");
  list.replaceChildren();
  const roots = settingsCache?.skills?.roots ?? [];
  for (const r of roots) {
    const li = document.createElement("li");
    li.textContent = r;
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger";
    delBtn.addEventListener("click", () => {
      settingsCache.skills = {
        ...(settingsCache.skills ?? {}),
        roots: roots.filter((x) => x !== r),
      };
      if ((settingsCache.skills.roots ?? []).length === 0) delete settingsCache.skills.roots;
      dirtySections.add("skills");
      renderSkillRoots();
      markDirty("skills");
      void refreshSkillsList();
    });
    li.appendChild(delBtn);
    list.appendChild(li);
  }
  if (roots.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "（无附加来源——workspace 主目录恒在）";
    list.appendChild(li);
  }
}

async function openSkillEditor(skill) {
  editingSkillName = skill?.name ?? null;
  skillToolsSelected.clear();
  // 工具集候选 = ready 协议的注册表工具名（meta 会话期缓存——无会话时为空）
  const meta = (await ensureMetaCache()) ?? { tools: [], skills: [] };
  const box = document.getElementById("skill-tools");
  box.replaceChildren();
  for (const t of meta.tools) {
    const chip = document.createElement("button");
    chip.type = "button";
    const selected = skill?.tools?.includes(t) ?? false;
    if (selected) skillToolsSelected.add(t);
    chip.className = selected ? "chip active" : "chip";
    chip.textContent = t;
    chip.addEventListener("click", () => {
      if (skillToolsSelected.has(t)) {
        skillToolsSelected.delete(t);
        chip.classList.remove("active");
      } else {
        skillToolsSelected.add(t);
        chip.classList.add("active");
      }
    });
    box.appendChild(chip);
  }
  document.getElementById("skill-name").value = skill?.name ?? "";
  document.getElementById("skill-desc").value = skill?.description ?? "";
  document.getElementById("skill-body").value = skill?.body ?? "";
  document.getElementById("skill-editor").hidden = false;
  document.getElementById("skill-new").hidden = true;
}

document.getElementById("skill-new").addEventListener("click", () => {
  void openSkillEditor(null);
});

document.getElementById("skill-cancel").addEventListener("click", () => {
  document.getElementById("skill-editor").hidden = true;
  document.getElementById("skill-new").hidden = false;
  editingSkillName = null;
});

document.getElementById("skill-save").addEventListener("click", async () => {
  const name = document.getElementById("skill-name").value.trim();
  const description = document.getElementById("skill-desc").value.trim();
  const body = document.getElementById("skill-body").value;
  if (name === "" || description === "" || body.trim() === "") {
    toast("技能名、描述与正文必填", "warn");
    return;
  }
  const envelope = await sendSettings({
    op: "skill-save",
    skill: {
      name,
      description,
      body,
      ...(skillToolsSelected.size > 0 ? { tools: [...skillToolsSelected] } : {}),
    },
  });
  if (!envelope.ok) {
    appendLine(`技能保存失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  // 改名保存 = 旧名技能不再被停用名单管着（名单按名匹配——同步清理）
  if (editingSkillName !== null && editingSkillName !== name) {
    const cur = (settingsCache.skills?.disabled ?? []).filter((x) => x !== editingSkillName);
    settingsCache.skills = { ...(settingsCache.skills ?? {}), ...(cur.length > 0 ? { disabled: cur } : {}) };
    if (cur.length === 0) delete settingsCache.skills.disabled;
    dirtySections.add("skills");
    markDirty("skills");
  }
  document.getElementById("skill-editor").hidden = true;
  document.getElementById("skill-new").hidden = false;
  editingSkillName = null;
  appendLine(`技能已保存：${name}（新会话装配生效）`, "meta");
  toast("技能已保存", "info");
  void refreshSkillsList();
});

document.getElementById("skill-root-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const p = document.getElementById("skill-root-path").value.trim();
  if (p === "") return;
  const roots = settingsCache.skills?.roots ?? [];
  if (roots.includes(p)) {
    toast("该来源目录已在清单", "warn");
    return;
  }
  settingsCache.skills = { ...(settingsCache.skills ?? {}), roots: [...roots, p] };
  document.getElementById("skill-root-path").value = "";
  dirtySections.add("skills");
  renderSkillRoots();
  markDirty("skills");
  void refreshSkillsList();
});

// ---------------------------------------------------------------------------
// U23/T-P3-126 子智能体管理：内置五预设卡（开关/工具 chips/覆盖编辑）+
// 用户自定义 CRUD + per-subagent 模型与 fallback 链（settings subagents 段）。
// ---------------------------------------------------------------------------

let subagentsView = null; // subagents-list 缓存（openSettings 刷新）
let editingSubagentName = null; // 非 null = 编辑既有条目（同名覆盖）
const subagentToolsSelected = new Set();

async function refreshSubagentsList() {
  const envelope = await sendSettings({ op: "subagents-list" });
  const list = document.getElementById("subagent-list");
  list.replaceChildren();
  if (!envelope.ok) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = `子代理清单不可用：${envelope.error?.message ?? ""}`;
    list.appendChild(li);
    return;
  }
  subagentsView = envelope.result;
  for (const b of subagentsView.builtins) {
    const li = document.createElement("li");
    li.className = "skill-item";
    const label = document.createElement("span");
    label.textContent = `🤖 ${b.name}（内置）——${b.description}${b.enabled ? "" : "（已停用）"}${b.overridden ? "（已自定义覆盖）" : ""}`;
    const toolsRow = document.createElement("span");
    toolsRow.className = "skill-tools";
    for (const t of b.tools ?? []) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = t;
      toolsRow.appendChild(chip);
    }
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.textContent = b.enabled ? "停用" : "启用";
    toggleBtn.addEventListener("click", () => {
      // 停用 = 写同名覆盖记录（enabled:false——最简形状）；启用 = 移除记录
      const defs = (settingsCache.subagents ?? []).filter((d) => d.name !== b.name);
      if (b.enabled) defs.push({ name: b.name, enabled: false });
      settingsCache.subagents = defs;
      dirtySections.add("subagents");
      markDirty("subagents");
      void refreshSubagentsList();
    });
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "编辑";
    editBtn.addEventListener("click", () => openSubagentEditor(b, true));
    li.append(label, toolsRow, toggleBtn, editBtn);
    list.appendChild(li);
  }
  for (const c of subagentsView.custom) {
    const li = document.createElement("li");
    li.className = "skill-item";
    const label = document.createElement("span");
    label.textContent = `🤖 ${c.name}（自定义）——${c.description ?? ""}${c.modelProvider ? `［模型 ${c.modelProvider}${c.model ? `/${c.model}` : ""}］` : ""}`;
    const toolsRow = document.createElement("span");
    toolsRow.className = "skill-tools";
    for (const t of c.tools ?? []) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = t;
      toolsRow.appendChild(chip);
    }
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "编辑";
    editBtn.addEventListener("click", () => openSubagentEditor(c, false));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger";
    delBtn.addEventListener("click", () => {
      if (!window.confirm(`删除自定义子代理「${c.name}」？`)) return;
      settingsCache.subagents = (settingsCache.subagents ?? []).filter((d) => d.name !== c.name);
      dirtySections.add("subagents");
      markDirty("subagents");
      void refreshSubagentsList();
    });
    li.append(label, toolsRow, editBtn, delBtn);
    list.appendChild(li);
  }
}

async function openSubagentEditor(def, isBuiltin) {
  editingSubagentName = isBuiltin ? def.name : def.name;
  subagentToolsSelected.clear();
  const meta = (await ensureMetaCache()) ?? { tools: [], skills: [] };
  const box = document.getElementById("subagent-tools");
  box.replaceChildren();
  for (const t of meta.tools) {
    const chip = document.createElement("button");
    chip.type = "button";
    const selected = def.tools?.includes(t) ?? false;
    if (selected) subagentToolsSelected.add(t);
    chip.className = selected ? "chip active" : "chip";
    chip.textContent = t;
    chip.addEventListener("click", () => {
      if (subagentToolsSelected.has(t)) {
        subagentToolsSelected.delete(t);
        chip.classList.remove("active");
      } else {
        subagentToolsSelected.add(t);
        chip.classList.add("active");
      }
    });
    box.appendChild(chip);
  }
  document.getElementById("subagent-name").value = def.name ?? "";
  document.getElementById("subagent-desc").value = def.description ?? "";
  document.getElementById("subagent-prompt").value = def.prompt ?? "";
  document.getElementById("subagent-provider").value = def.modelProvider ?? "";
  document.getElementById("subagent-model").value = def.model ?? "";
  document.getElementById("subagent-fallbacks").value = (def.fallbacks ?? []).join(", ");
  document.getElementById("subagent-editor").hidden = false;
  document.getElementById("subagent-new").hidden = true;
}

document.getElementById("subagent-new").addEventListener("click", () => {
  openSubagentEditor({ name: "", description: "", prompt: "" }, false);
});

document.getElementById("subagent-cancel").addEventListener("click", () => {
  document.getElementById("subagent-editor").hidden = true;
  document.getElementById("subagent-new").hidden = false;
  editingSubagentName = null;
});

document.getElementById("subagent-save").addEventListener("click", () => {
  const name = document.getElementById("subagent-name").value.trim();
  const description = document.getElementById("subagent-desc").value.trim();
  const prompt = document.getElementById("subagent-prompt").value;
  const provider = document.getElementById("subagent-provider").value.trim();
  const model = document.getElementById("subagent-model").value.trim();
  const fallbacks = document.getElementById("subagent-fallbacks").value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (name === "" || description === "" || prompt.trim() === "") {
    toast("预设名、描述与身份提示必填", "warn");
    return;
  }
  const entry = {
    name,
    description,
    prompt,
    ...(subagentToolsSelected.size > 0 ? { tools: [...subagentToolsSelected] } : {}),
    ...(provider !== "" ? { modelProvider: provider } : {}),
    ...(model !== "" ? { model } : {}),
    ...(fallbacks.length > 0 ? { fallbacks } : {}),
  };
  const defs = (settingsCache.subagents ?? []).filter(
    (d) => d.name !== name && d.name !== editingSubagentName,
  );
  defs.push(entry);
  settingsCache.subagents = defs;
  document.getElementById("subagent-editor").hidden = true;
  document.getElementById("subagent-new").hidden = false;
  editingSubagentName = null;
  dirtySections.add("subagents");
  markDirty("subagents");
  toast("子代理预设已保存（新会话生效）", "info");
  void refreshSubagentsList();
});

// ---------------------------------------------------------------------------
// U24/T-P3-127 指令中心：全局/项目 AGENTS.md + 用户规则文件（C22 project/
// user 档文件位）——查看/编辑/保存确认 + 规则 lint + 模板插入辅助。
// ---------------------------------------------------------------------------

const INSTR_TARGETS = {
  "project-agents": "instr-project",
  "global-agents": "instr-global",
  "user-rules": "instr-rules",
};
const INSTR_TARGET_LABEL = {
  "project-agents": "项目 AGENTS.md",
  "global-agents": "全局 AGENTS.md",
  "user-rules": "用户级规则 rules.txt",
};
const INSTR_TEMPLATES = {
  "project-agents": "## 代码风格\n- 缩进与命名遵循现有代码\n\n## 提交约定\n- ",
  "global-agents": "## 通用偏好\n- 中文回复\n- 先结论后理由\n",
  "user-rules": "# 每行：<规则> -> <allow|ask|deny>\nBash(git status) -> allow\nBash(git push) -> deny\n",
};

async function refreshInstructions() {
  const envelope = await sendSettings({ op: "instructions-list" });
  if (!envelope.ok) {
    document.getElementById("instr-rules-lint").textContent =
      `指令面不可用：${envelope.error?.message ?? ""}`;
    return;
  }
  const v = envelope.result;
  document.getElementById("instr-project").value = v.project.content;
  document.getElementById("instr-global").value = v.global.content;
  document.getElementById("instr-rules").value = v.rules.content;
  document.getElementById("instr-project-path").textContent =
    v.project.path.split(/[\\/]/).slice(0, -1).join("/");
  renderRulesLint(v.rules.issues ?? []);
}

function renderRulesLint(issues) {
  const el = document.getElementById("instr-rules-lint");
  if (issues.length === 0) {
    el.textContent = "规则 lint：无问题（合法行全部装载）";
    return;
  }
  el.textContent = `规则 lint：${issues.length} 行未装载——${issues
    .slice(0, 5)
    .map((i) => `第 ${i.line} 行 ${i.message}`)
    .join("；")}${issues.length > 5 ? "…" : ""}`;
}

async function openInstructionsOnce() {
  // 指令分节只在设置打开时拉一次（保存后局部刷新）
  if (!document.getElementById("instr-project").dataset.loaded) {
    await refreshInstructions();
    document.getElementById("instr-project").dataset.loaded = "1";
  }
}

for (const btn of document.querySelectorAll(".instr-save")) {
  btn.addEventListener("click", async () => {
    const target = btn.dataset.target;
    const content = document.getElementById(INSTR_TARGETS[target]).value;
    // 保存确认面（U24 卡面要求——覆盖用户文件前显式确认）
    if (!window.confirm(`确认保存到「${INSTR_TARGET_LABEL[target]}」？\n（保存后新会话生效；目标：覆盖写入）`)) return;
    const envelope = await sendSettings({ op: "instruction-save", target, content });
    if (!envelope.ok) {
      appendLine(`指令保存失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
      return;
    }
    appendLine(`指令已保存：${envelope.result.path}`, "meta");
    toast(`${INSTR_TARGET_LABEL[target]} 已保存（新会话生效）`, "info");
    if (target === "user-rules") await refreshInstructions();
  });
}

for (const btn of document.querySelectorAll(".instr-tpl")) {
  btn.addEventListener("click", () => {
    const target = btn.dataset.target;
    const ta = document.getElementById(INSTR_TARGETS[target]);
    ta.value = ta.value === "" ? (INSTR_TEMPLATES[target] ?? "") : `${ta.value}\n${INSTR_TEMPLATES[target] ?? ""}`;
    ta.focus();
  });
}

// —— U25/T-P3-128 快捷键分节：清单（可查）+ 捕获态改绑（自定义）+
// 冲突提示（注册表冲突阻断 / 保留键提示不拦截）
let capturingAction = null; // 非 null = 捕获态（下一次按键即新绑定）
let capturedCombo = null; // 捕获到的规范 combo（未保存）

function renderShortcutList() {
  const list = document.getElementById("shortcut-list");
  const status = document.getElementById("shortcut-status");
  list.replaceChildren();
  const bindings = createKeymap(settingsCache?.shortcuts);
  for (const [action, label] of Object.entries(ACTION_LABELS)) {
    const li = document.createElement("li");
    li.className = "skill-item";
    const name = document.createElement("span");
    const fixed = action === "send";
    const combo = fixed ? "Enter" : bindings[action] ?? "";
    name.textContent = `⌨ ${label}：${combo}${fixed ? "（固定）" : ""}`;
    li.appendChild(name);
    const conflictInfo = !fixed ? detectConflict(combo, bindings, action) : {};
    if (conflictInfo.conflict !== undefined) {
      const warn = document.createElement("span");
      warn.className = "hint";
      warn.textContent = `⚠ 与「${ACTION_LABELS[conflictInfo.conflict]}」冲突`;
      li.appendChild(warn);
    }
    if (conflictInfo.reserved === true) {
      const warn = document.createElement("span");
      warn.className = "hint";
      warn.textContent = "（浏览器保留键——提示不拦截，请自测）";
      li.appendChild(warn);
    }
    if (!fixed) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      if (capturingAction === action) {
        editBtn.textContent = capturedCombo ?? "按键…";
        editBtn.className = "default-mark";
      } else {
        editBtn.textContent = "修改";
        editBtn.addEventListener("click", () => {
          capturingAction = action;
          capturedCombo = null;
          status.textContent = `捕获中：为「${label}」按新组合（Esc 取消）`;
          renderShortcutList();
        });
      }
      li.appendChild(editBtn);
    }
    list.appendChild(li);
  }
}

window.addEventListener(
  "keydown",
  (ev) => {
    if (capturingAction === null) return;
    // 捕获态：Esc 空手取消；纯修饰键等待；组合转规范 combo 后即存
    if (ev.key === "Escape") {
      capturingAction = null;
      capturedCombo = null;
      document.getElementById("shortcut-status").textContent =
        "点击绑定进入捕获态——按新组合即改即存；Esc 取消捕获。";
      renderShortcutList();
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    const combo = eventToCombo(ev);
    if (combo === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    const bindings = createKeymap(settingsCache?.shortcuts);
    const conflict = detectConflict(combo, bindings, capturingAction);
    const statusEl = document.getElementById("shortcut-status");
    if (conflict.conflict !== undefined) {
      statusEl.textContent = `✘ ${combo} 已被「${ACTION_LABELS[conflict.conflict]}」占用——换一个组合（Esc 取消）`;
      renderShortcutList();
      return; // 冲突阻断保存
    }
    const reservedNote = conflict.reserved === true ? "（浏览器保留键——提示不拦截）" : "";
    // 保存覆盖（部分覆盖语义——settings.shortcuts 段）
    const overrides = { ...(settingsCache.shortcuts ?? {}) };
    overrides[capturingAction] = combo;
    settingsCache.shortcuts = overrides;
    dirtySections.add("shortcuts");
    markDirty("shortcuts");
    statusEl.textContent = `✔ ${ACTION_LABELS[capturingAction]} → ${combo}${reservedNote}`;
    capturingAction = null;
    capturedCombo = null;
    renderShortcutList();
  },
  true, // 捕获态用捕获阶段监听——抢先于分发监听
);

document.getElementById("shortcut-reset").addEventListener("click", () => {
  if (!window.confirm("恢复全部默认键位？（清除所有自定义绑定）")) return;
  settingsCache.shortcuts = {};
  delete settingsCache.shortcuts;
  dirtySections.add("shortcuts");
  markDirty("shortcuts");
  document.getElementById("shortcut-status").textContent = "已恢复默认键位。";
  renderShortcutList();
});

// —— U26/T-P3-129 语音设置（实验性）：STT 配置即改即存 + Composer 录音
// 转写（MediaRecorder → settings op:"stt-transcribe" → 文本填入输入框）

function sttInputHandler(field) {
  document.getElementById(`stt-${field}`).addEventListener("change", () => {
    const baseUrl = document.getElementById("stt-baseurl").value.trim();
    const model = document.getElementById("stt-model").value.trim();
    const language = document.getElementById("stt-language").value.trim();
    const next = {};
    if (baseUrl !== "") next.baseUrl = baseUrl;
    if (model !== "") next.model = model;
    if (language !== "") next.language = language;
    // 空配置 = 删除 stt 段（语音输入不可用——回退缺省）
    if (Object.keys(next).length < 2) {
      settingsCache.stt = undefined;
      delete settingsCache.stt;
    } else {
      settingsCache.stt = next;
    }
    dirtySections.add("stt");
    markDirty("stt");
  });
}
sttInputHandler("baseurl");
sttInputHandler("model");
sttInputHandler("language");

// —— 麦克风录音 → STT（实验性）：权限拒绝降级 + 未配置引导
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

// —— T-P3-133 插件管理：清单（安装期校验诊断 + 启停/删除）+ 安装表单
// （inprocess 目录 / ws URL——settings plugins 段，新会话装载生效）

async function refreshPluginsList() {
  const envelope = await sendSettings({ op: "plugins-list" });
  const list = document.getElementById("plugin-list");
  list.replaceChildren();
  if (!envelope.ok) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = `插件清单不可用：${envelope.error?.message ?? ""}`;
    list.appendChild(li);
    return;
  }
  const plugins = envelope.result;
  for (const p of plugins) {
    const li = document.createElement("li");
    li.className = "skill-item";
    const label = document.createElement("span");
    const trustTag = p.manifest ? `［trust: ${p.manifest.trust}］` : "";
    label.textContent = `🔌 ${p.name}（${p.transport === "ws" ? "进程外 ws" : "进程内"}）${trustTag}${p.enabled ? "" : "（已停用）"} → ${p.source}`;
    li.appendChild(label);
    if (p.error) {
      const err = document.createElement("span");
      err.className = "hint";
      err.textContent = `⚠ ${p.error}`;
      li.appendChild(err);
    } else if (p.manifest) {
      const caps = document.createElement("span");
      caps.className = "skill-tools";
      for (const c of p.manifest.capabilities ?? []) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = c;
        caps.appendChild(chip);
      }
      li.appendChild(caps);
    }
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.textContent = p.enabled ? "停用" : "启用";
    toggleBtn.addEventListener("click", () => {
      // 停用写 enabled:false、启用删键回缺省（mcp 启停同模式）
      const defs = (settingsCache.plugins ?? []).map((d) => {
        if (d.name !== p.name) return d;
        if (d.enabled === false) {
          const { enabled: _omit, ...rest } = d;
          return rest;
        }
        return { ...d, enabled: false };
      });
      settingsCache.plugins = defs;
      dirtySections.add("plugins");
      markDirty("plugins");
      void refreshPluginsList();
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger";
    delBtn.addEventListener("click", () => {
      if (!window.confirm(`从装载清单移除插件「${p.name}」？（不删除插件目录文件）`)) return;
      settingsCache.plugins = (settingsCache.plugins ?? []).filter((d) => d.name !== p.name);
      dirtySections.add("plugins");
      markDirty("plugins");
      void refreshPluginsList();
    });
    li.append(toggleBtn, delBtn);
    list.appendChild(li);
  }
  if (plugins.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "（未安装插件——填表单安装：进程内目录或进程外 ws URL）";
    list.appendChild(li);
  }
}

document.getElementById("plugin-add").addEventListener("click", async () => {
  const name = document.getElementById("plugin-name").value.trim();
  const source = document.getElementById("plugin-source").value.trim();
  const transport = document.getElementById("plugin-transport").value;
  const allowTools = document.getElementById("plugin-allowtools").checked;
  if (name === "" || source === "" || name.includes("__")) {
    toast("插件名（不含 __）与装载源必填", "warn");
    return;
  }
  // 安装先校验（I9 安装期全量——plugins-list 拉取后核对重名与形状）
  const preview = await sendSettings({ op: "plugins-list" });
  const existing = (settingsCache.plugins ?? []).find((d) => d.name === name);
  if (existing !== undefined && existing.enabled !== false) {
    toast(`插件名已存在：${name}`, "warn");
    return;
  }
  // 先落档（settings patch）——装载期再校验（never-fail），诊断随清单可见
  const defs = (settingsCache.plugins ?? []).filter((d) => d.name !== name);
  defs.push({
    name,
    source,
    ...(transport !== "inprocess" ? { transport } : {}),
    ...(allowTools ? { allowTools: true } : {}),
  });
  settingsCache.plugins = defs;
  document.getElementById("plugin-name").value = "";
  document.getElementById("plugin-source").value = "";
  dirtySections.add("plugins");
  markDirty("plugins");
  toast(`插件已加入装载清单：${name}（新会话生效）`, "info");
  void refreshPluginsList();
  void preview;
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

// ---------------------------------------------------------------------------
// U12/T-P3-111 用量面板：上下文检查器（占用/占比/压缩）+ 成本统计页
// （按会话/按轮——J21 消费端，纯 DOM 表，数据源 = query op:"usage" 单源）。
// ---------------------------------------------------------------------------

const usagePanel = document.getElementById("usage-panel");

function fmtTokens(n) {
  if (!Number.isFinite(n)) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtCost(usd) {
  if (!Number.isFinite(usd)) return "—";
  return `$${usd.toFixed(4)}`;
}

async function openUsage() {
  const envelope = await sendQuery({ sessionId: sessionId() || "-", op: "usage" });
  if (!envelope.ok) {
    document.getElementById("ctx-text").textContent = `用量面不可用：${envelope.error?.message ?? ""}`;
    document.getElementById("compaction-text").textContent = "";
    document.getElementById("cost-hint").textContent = "";
    usagePanel.hidden = false;
    return;
  }
  const u = envelope.result;

  // 上下文检查器：末轮 totalTokens ≈ 当前窗口占用（E17/F 族事实投影）
  const ctx = u.contextWindow ?? 0;
  const used = u.currentSession?.contextTokens ?? 0;
  const pct = ctx > 0 ? Math.min(100, Math.round((used / ctx) * 100)) : 0;
  document.getElementById("ctx-meter-fill").style.width = `${pct}%`;
  document.getElementById("ctx-meter-fill").classList.toggle("ctx-hot", pct >= 80);
  document.getElementById("ctx-text").textContent =
    `≈ ${fmtTokens(used)} / ${fmtTokens(ctx)} token（${pct}%）——取本会话末轮计量`;
  const comp = u.currentSession?.compaction ?? { total: 0, failures: [] };
  document.getElementById("compaction-text").textContent =
    comp.total === 0
      ? "本会话尚无压缩"
      : `已压缩 ${comp.total} 次${comp.failures.length > 0 ? `（${comp.failures.length} 次失败）` : ""}`;

  // 成本统计页：按会话（token 全库聚合 + 成本 = 计价表驱动——未配置如实缺席）
  const costBody = document.querySelector("#cost-table tbody");
  costBody.replaceChildren();
  const sessionRows = u.sessions ?? [];
  for (const s of sessionRows) {
    const cost = (u.costs ?? []).find((c) => c.sessionId === s.sessionId);
    const tr = document.createElement("tr");
    for (const text of [s.sessionId, String(s.requests), fmtTokens(s.totalTokens), cost ? fmtCost(cost.costUsd) : "—"]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    costBody.appendChild(tr);
  }
  if (sessionRows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "（库中无用量数据——带 --db 跑会话后可见）";
    tr.appendChild(td);
    costBody.appendChild(tr);
  }
  document.getElementById("cost-hint").textContent =
    (u.costs ?? []).length === 0
      ? "成本未显示：settings.json 的 pricing 段未配置模型价格（表驱动计价，无价格不虚构）。"
      : "成本 = settings 计价表 × token 用量（四类分列计价）。";

  // 按轮用量（本会话）——costs.byTurn 关联成本
  const turnBody = document.querySelector("#turn-table tbody");
  turnBody.replaceChildren();
  const turnCosts = new Map((u.costs ?? []).find((c) => c.sessionId === sessionId())?.byTurn.map((t) => [t.turn, t.costUsd]) ?? []);
  for (const t of u.currentSession?.turns ?? []) {
    const tr = document.createElement("tr");
    for (const text of [
      String(t.turn),
      String(t.requests),
      fmtTokens(t.inputTokens),
      fmtTokens(t.outputTokens),
      t.cacheHitRate !== undefined ? `${Math.round(t.cacheHitRate * 100)}%` : "—",
      turnCosts.has(t.turn) ? fmtCost(turnCosts.get(t.turn)) : "—",
    ]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    turnBody.appendChild(tr);
  }
  usagePanel.hidden = false;
}

document.getElementById("usage-btn").addEventListener("click", () => void openUsage());
document.getElementById("usage-close").addEventListener("click", () => {
  usagePanel.hidden = true;
});

// ---------------------------------------------------------------------------
// U15/T-P3-117 工作面板：三 Tab（文件树/变更评审/子代理监控）。变更与委派
// 数据源 = query op:"review"（纯函数从流直答）；文件树 = op:"files"（@ 补全
// 缓存复用）+ op:"file" 点击预览；n5 turn_settled 时面板可见则自动刷新。
// ---------------------------------------------------------------------------

const workPanel = document.getElementById("workpanel");
let workActiveTab = "files";
let lastReviewReport = null; // 变更/委派共用一次 review 拉取

function setWorkTab(tab) {
  workActiveTab = tab;
  for (const btn of document.querySelectorAll("#work-tabs .work-tab")) {
    btn.classList.toggle("active", btn.dataset.worktab === tab);
  }
  for (const sec of document.querySelectorAll("#workpanel [data-worktab-body]")) {
    sec.hidden = sec.dataset.worktabBody !== tab;
  }
}

async function fetchReviewReport() {
  const envelope = await sendQuery({ sessionId: sessionIdValue || "-", op: "review" });
  return envelope.ok ? envelope.result : null;
}

function renderReviewReport(report) {
  if (!report) return;
  const ops = report.operations ?? [];
  const writes = ops.filter((o) => o.op === "write").length;
  const edits = ops.filter((o) => o.op === "edit").length;
  const deletes = ops.filter((o) => o.op === "delete").length;
  document.getElementById("work-review-summary").textContent =
    `本会话 ${report.changes.length} 个文件被触碰：写入 ${writes} · 修改 ${edits} · 删除 ${deletes}`;
  const list = document.getElementById("work-review-list");
  list.replaceChildren();
  for (const c of report.changes) {
    const li = document.createElement("li");
    li.className = `review-item review-${c.op}`;
    const badge = document.createElement("span");
    badge.className = "review-badge";
    badge.textContent = c.op === "write" ? "写入" : c.op === "edit" ? "修改" : "删除";
    const path = document.createElement("code");
    path.textContent = c.path;
    const via = document.createElement("span");
    via.className = "hint";
    via.textContent = `via ${c.via}`;
    li.append(badge, path, via);
    list.appendChild(li);
  }
  if (report.changes.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "（本会话暂无文件写操作——agent 改动后自动刷新）";
    list.appendChild(li);
  }

  const body = document.querySelector("#work-delegation-table tbody");
  body.replaceChildren();
  for (const d of report.delegations ?? []) {
    const tr = document.createElement("tr");
    const statusText =
      d.status === "completed" ? "✔ 完成" : d.status === "failed" ? "✘ 失败" : d.status === "cancelled" ? "⊘ 取消" : "⏳ 进行中";
    for (const text of [
      d.description || "（无描述）",
      d.subagentSessionId ?? "—",
      d.errorCode ? `${statusText}（${d.errorCode}）` : statusText,
      d.durationMs !== undefined ? `${(d.durationMs / 1000).toFixed(1)}s` : "—",
    ]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  if ((report.delegations ?? []).length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "（本会话暂无子代理委派——task 工具调用后可见）";
    tr.appendChild(td);
    body.appendChild(tr);
  }
  document.getElementById("work-delegation-hint").textContent =
    "委派状态/耗时取 task 调用与结算的流内事实（H1/H2 面）；点击子代理 Tab 查看一览。";

  // U27/T-P3-131：协作往来（流投影——session/collab 事件）
  const collabBody = document.querySelector("#work-collab-table tbody");
  collabBody.replaceChildren();
  for (const c of report.collaborations ?? []) {
    const tr = document.createElement("tr");
    const dir = c.direction === "outgoing" ? "→ 派出" : "← 收到";
    const statusText =
      c.status === "completed" ? "✔ 完成" : c.status === "failed" ? "✘ 失败" : c.status === "cancelled" ? "⊘ 取消" : c.status === "running" ? "⏳ 进行中" : "… 排队";
    const outcome = c.result ?? c.error ?? "—";
    for (const text of [dir, c.peerSessionId, c.kind, statusText, outcome]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    collabBody.appendChild(tr);
  }
  if ((report.collaborations ?? []).length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "（本会话暂无协作往来——跨会话派任务后可见）";
    tr.appendChild(td);
    collabBody.appendChild(tr);
  }
}

async function refreshWorkReview() {
  lastReviewReport = await fetchReviewReport();
  renderReviewReport(lastReviewReport);
}

function renderFileTree(entries, truncated) {
  const tree = document.getElementById("work-filetree");
  tree.replaceChildren();
  // 全量清单按目录深度缩进成树（条目上限 1000 已在 host 侧防呆）
  for (const e of entries) {
    const row = document.createElement("div");
    row.className = "tree-row";
    const depth = e.path.split("/").length - (e.dir ? 2 : 1);
    row.style.paddingLeft = `${Math.max(0, depth) * 14 + 4}px`;
    if (e.dir) {
      row.textContent = `📁 ${e.path.split("/").filter(Boolean).pop() ?? e.path}/`;
      row.classList.add("tree-dir");
    } else {
      row.textContent = `📄 ${e.path.split("/").pop()}`;
      row.classList.add("tree-file");
      row.addEventListener("click", () => void previewWorkspaceFile(e.path));
    }
    tree.appendChild(row);
  }
  if (entries.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "（workspace 无可列举文件——检查 --workspace 或 sandbox 档）";
    tree.appendChild(p);
  }
  document.getElementById("work-tree-hint").textContent = truncated
    ? "文件清单超上限 1000 条已截断（大目录树提示）——可输入完整路径到输入区用 @ 补全定位。"
    : `共 ${entries.length} 项——点击文件预览内容。`;
}

async function previewWorkspaceFile(relPath) {
  const box = document.getElementById("work-preview-box");
  const pre = document.getElementById("work-preview");
  const label = document.getElementById("work-preview-path");
  label.textContent = relPath;
  pre.textContent = "读取中…";
  box.hidden = false;
  const envelope = await sendQuery({ sessionId: sessionIdValue || "-", op: "file", path: relPath });
  if (!envelope.ok) {
    pre.textContent = `预览不可用：${envelope.error?.message ?? ""}`;
    return;
  }
  const f = envelope.result;
  pre.textContent = f.truncated ? `${f.content}\n…（超 512KB 只读前缀）` : f.content;
}

async function openWorkpanel() {
  workPanel.hidden = false;
  setWorkTab(workActiveTab);
  const files = await ensureFileCache(); // 与 @ 补全同一会话期缓存
  if (files) renderFileTree(files.entries ?? [], files.truncated === true);
  await refreshWorkReview();
}

document.getElementById("work-btn").addEventListener("click", () => {
  if (workPanel.hidden) void openWorkpanel();
  else workPanel.hidden = true;
});
document.getElementById("work-close").addEventListener("click", () => {
  workPanel.hidden = true;
});
document.getElementById("work-preview-close").addEventListener("click", () => {
  document.getElementById("work-preview-box").hidden = true;
});
for (const btn of document.querySelectorAll("#work-tabs .work-tab")) {
  btn.addEventListener("click", () => setWorkTab(btn.dataset.worktab));
}

// ---------------------------------------------------------------------------
// U13/T-P3-112 五件套：通知中心（N5 分型消费）+ Toast 轻提示 + 首次引导
// 清单（settings 首跑标记）+ 启动恢复横幅（M3 诊断 + 一键续跑）+ 更新
// 横幅与发布说明弹窗（U7 消费端——真实更新源 T-P3-114 接线）。
// ---------------------------------------------------------------------------

// —— 通知中心 + Toast（N5 五类分型的 UI 消费——kind 图标与文案分型）
const KIND_ICONS = {
  approval_pending: "⏸",
  turn_settled: "✔",
  job_settled: "⚙",
  surface_changed: "⇄",
  computer_operation: "🖥",
};
const notifications = [];
const notifyPanel = document.getElementById("notify-panel");
const notifyBadge = document.getElementById("notify-badge");

function toast(text, kind) {
  const area = document.getElementById("toast-area");
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = `${(KIND_ICONS[kind] ?? "🔔") + " "}${text}`;
  area.appendChild(t);
  setTimeout(() => t.remove(), 4000); // 轻提示——不打断（4s 自散）
}

function renderNotifyList() {
  const list = document.getElementById("notify-list");
  list.replaceChildren();
  for (const n of [...notifications].reverse()) {
    const li = document.createElement("li");
    li.textContent = `${KIND_ICONS[n.kind] ?? "🔔"} [${n.kind}] ${oneLine(JSON.stringify(n.data ?? {}), 160)} · ${fmtTime(n.at)}`;
    list.appendChild(li);
  }
  notifyBadge.hidden = notifications.length === 0;
  notifyBadge.textContent = String(notifications.length);
}

function consumeN5(payload) {
  notifications.push(payload);
  if (notifications.length > 50) notifications.shift(); // 面板容量防呆
  toast(n5ToastText(payload), payload.kind);
  renderNotifyList();
  // U15：工作面板开着时随轮结算自动刷新（变更/委派是流投影——重算便宜）
  if (payload.kind === "turn_settled" && workPanel !== null && !workPanel.hidden) {
    void refreshWorkReview();
  }
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

document.getElementById("notify-btn").addEventListener("click", () => {
  renderNotifyList();
  notifyPanel.hidden = !notifyPanel.hidden;
});
document.getElementById("notify-close").addEventListener("click", () => {
  notifyPanel.hidden = true;
});
document.getElementById("notify-clear").addEventListener("click", () => {
  notifications.length = 0;
  renderNotifyList();
});

// —— 首次引导（settings 首跑标记——完成即写 onboardingDone）
async function maybeOnboard() {
  const envelope = await sendSettings({ op: "get" });
  if (!envelope.ok) return;
  settingsCache = envelope.result.settings;
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
      messageId: `m-${nextRequestId++}`,
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

// —— 快捷键统一分发（U25/T-P3-128）：注册表驱动（settings.shortcuts
// 覆盖默认键位——openSettings/flushSettings 后 rebuildKeymap 同步）；
// 替换既有 Ctrl+F/Ctrl+Shift+F/Esc 硬编码（行为等价 + 可自定义）。
let keymapBindings = createKeymap(null);

function rebuildKeymap() {
  keymapBindings = createKeymap(settingsCache?.shortcuts);
}

const KEYMAP_HANDLERS = {
  settings: () => {
    if (settingsPanel.hidden) void openSettings();
    else {
      settingsPanel.hidden = true;
      void flushSettings();
    }
  },
  find: () => openFind(),
  search: () => {
    searchPanel.hidden = false;
    searchInput.focus();
  },
  "close-find": () => {
    if (!findBar.hidden) {
      findBar.hidden = true;
      clearHits();
    }
  },
  history: () => {
    if (historyPanel.hidden) void openHistory();
    else historyPanel.hidden = true;
  },
  work: () => {
    if (workPanel.hidden) void openWorkpanel();
    else workPanel.hidden = true;
  },
  usage: () => {
    if (usagePanel.hidden) void openUsage();
    else usagePanel.hidden = true;
  },
  notify: () => {
    renderNotifyList();
    notifyPanel.hidden = !notifyPanel.hidden;
  },
};

window.addEventListener("keydown", (ev) => {
  // Esc 优先走搜索条关闭（输入态无关既有行为）；其余经注册表分发
  const inInput =
    document.activeElement instanceof HTMLTextAreaElement ||
    (document.activeElement instanceof HTMLInputElement &&
      document.activeElement.type !== "button");
  const action = resolveAction(keymapBindings, ev, { inInput });
  if (action === null) return;
  const handler = KEYMAP_HANDLERS[action];
  if (handler !== undefined) {
    ev.preventDefault();
    handler();
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
      if (sessionIdValue === null) sessionIdValue = envelope.sessionId;
      renderEventEnvelope(envelope);
      break;
    case "notification":
      if (envelope.name === "n5") {
        consumeN5(envelope.payload ?? {}); // U13：N5 分型通知中心消费
      } else if (envelope.name === "approval_requested" || envelope.name === "question_asked") {
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
