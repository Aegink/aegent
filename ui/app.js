/**
 * aegent ui（K5/K2·T-P1-128）——一份静态资产两个端：Web（浏览器直开 host
 * 地址）与桌面壳（Tauri WebView 加载同一目录）。零构建链零框架（卡序头
 * 约束 1）；协议面 = 端间协议（K8 信封）：hello → query events（恢复视图）
 * → request/lease（写命令持约）→ event/notification（流渲染）。
 */

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
  const div = document.createElement("div");
  div.className = `line ${cls}`.trim();
  div.textContent = text;
  stream.appendChild(div);
  stream.scrollTop = stream.scrollHeight;
}

function oneLine(text, limit = 400) {
  const flat = String(text).replace(/\r?\n/g, " ⏎ ");
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/** 事件 → 单行摘要（cli/repl.ts renderEventSummary 的 UI 同源简化版）。 */
function renderEvent(e) {
  switch (e.type) {
    case "turn/start":
      return [`── turn ${e.turn} 开始`, "meta"];
    case "turn/end":
      return [`── turn ${e.turn} 结束（${e.reason?.kind ?? "?"}）`, "meta"];
    case "user/message":
      return e.source === "injected"
        ? [`（注入）${oneLine(e.message?.content ?? "")}`, "dim"]
        : [`你：${oneLine(e.message?.content ?? "")}`, "user"];
    case "assistant/message":
      return e.interrupted
        ? [`⚠（中断，前缀）${oneLine(e.message?.content ?? "")}`, "warn"]
        : [e.message?.content === "" ? "⬢ （模型转入工具调用）" : `⬢ ${oneLine(e.message?.content ?? "")}`, "agent"];
    case "tool/call":
      return [`→ ${e.name} ${oneLine(e.arguments ?? "", 160)}`, "tool"];
    case "tool/result":
      return [`${e.message?.isError ? "✗" : "←"} ${oneLine(e.message?.content ?? "")}`, e.message?.isError ? "warn" : "tool"];
    case "compaction":
      return [`◇ 压缩：${e.reason ?? e.strategy ?? ""}`, "meta"];
    case "image/offload":
      return [`◇ 图片卸载：${(e.targets ?? []).length} 组`, "meta"];
    case "surface/attach":
      return [`＋ surface ${e.surfaceId} 接入`, "roster"];
    case "surface/detach":
      return [`－ surface ${e.surfaceId} 离开`, "roster"];
    default:
      return null; // wire 细节类静默（request/header 等——repl 同款纪律）
  }
}

function renderEventEnvelope(envelope) {
  const rendered = renderEvent(envelope.event);
  if (rendered !== null) appendLine(rendered[0], rendered[1]);
}

/** 恢复视图：历史事件一次性渲染（query 快照；此后走 event 流续播）。 */
function renderHistory(events) {
  for (const e of events) {
    const rendered = renderEvent(e);
    if (rendered !== null) appendLine(rendered[0], rendered[1]);
  }
  if (events.length > 0) appendLine(`── 已恢复 ${events.length} 条历史事件 ──`, "meta");
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

function submitPrompt() {
  const content = input.value.trim();
  if (content === "") return;
  input.value = "";
  void sendRequest(sessionId(), {
    type: "prompt",
    messageId: `m-${nextRequestId++}`,
    content,
  });
}

sendBtn.addEventListener("click", submitPrompt);
input.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") submitPrompt();
});

// ---------------------------------------------------------------------------
// WS 生命周期：hello → query 恢复 → live 流
// ---------------------------------------------------------------------------

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);
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
      } else if (!envelope.ok) {
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
