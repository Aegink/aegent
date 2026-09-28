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
// U14/T-P3-103 设置中心
const settingsPanel = document.getElementById("settings-panel");
const settingsBtn = document.getElementById("settings-btn");
const settingsClose = document.getElementById("settings-close");

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
    label.textContent = `${entry.name}（${entry.adapter ?? "openai"}${entry.baseUrl ? ` · ${entry.baseUrl}` : ""}${entry.model ? ` · ${entry.model}` : ""}）`;
    const isDefault = settingsCache?.defaultProvider === entry.name;
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
    li.append(label, defaultBtn, delBtn);
    list.appendChild(li);
  }
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
  renderProviderList();
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

// 供应商新增（providers 段整体替换——列表语义）
document.getElementById("provider-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const name = document.getElementById("provider-name").value.trim();
  if (name === "" || !/^[A-Za-z0-9_.-]{1,64}$/.test(name)) return;
  if ((settingsCache?.providers ?? []).some((p) => p.name === name)) return;
  settingsCache.providers = [
    ...(settingsCache.providers ?? []),
    {
      name,
      adapter: document.getElementById("provider-adapter").value,
      ...(document.getElementById("provider-baseurl").value.trim() !== ""
        ? { baseUrl: document.getElementById("provider-baseurl").value.trim() }
        : {}),
      ...(document.getElementById("provider-model").value.trim() !== ""
        ? { model: document.getElementById("provider-model").value.trim() }
        : {}),
    },
  ];
  if (!settingsCache.defaultProvider) settingsCache.defaultProvider = name;
  document.getElementById("provider-form").reset();
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
