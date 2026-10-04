/**
 * aegent ui 协议面（T-P3-134 · UI 批次 A③ 共享层下沉——从 app.js 原样搬出，
 * 签名不变——铁律）。WS 连接与重连 + request/settings/query 三类信封发送 +
 * requestId 关联（inflight）。信封分发不在此处：入口经 connect({onEnvelope,
 * onStatus}) 注入回调，保持共享层互不依赖（views/* → api.js 单向）。
 */

// 桌面壳检测：Tauri 2 WebView 注入 __TAURI_INTERNALS__ 全局（无需 @tauri-apps/api）。
// surfaceId 前缀 web-/desktop- 是审计答复端（replySource）的来源约定。
export const IS_DESKTOP = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const SURFACE_KIND = IS_DESKTOP ? "desktop" : "web";
export const SURFACE_ID = `${SURFACE_KIND}-${Math.random().toString(36).slice(2, 8)}`;
const PROTOCOL_VERSION = 1;

/** 在途请求（requestId → resolve）——response 信封关联（K8 requestId 关联面）。 */
export const inflight = new Map();
let nextRequestId = 1;

/** requestId 分配（r-/s-/h- 请求与 m- 消息 id 共用一个单调计数器）。 */
export function allocRequestId(prefix) {
  return `${prefix}-${nextRequestId++}`;
}

let ws = null;
// 工作会话 host 覆盖（T-P3-166 需求 2——任务切换=重连目标端口；重连循环
// 沿用该地址，返回主 host 置 null）
let addressOverride = null;

export function switchHost(address) {
  addressOverride = address !== null && address !== "" ? address : null;
  if (ws !== null) ws.close(); // close 触发既有重连循环（新地址生效）
}

export function sendRaw(envelope) {
  ws.send(JSON.stringify(envelope));
}

export function sendRequest(sessionId, call) {
  const requestId = allocRequestId("r");
  return new Promise((resolve) => {
    inflight.set(requestId, resolve);
    ws.send(JSON.stringify({ type: "request", requestId, sessionId, call }));
  });
}

export function sendSettings(call) {
  const requestId = allocRequestId("s");
  return new Promise((resolve) => {
    inflight.set(requestId, resolve);
    ws.send(JSON.stringify({ type: "settings", requestId, ...call }));
  });
}

export function sendQuery(call) {
  const requestId = allocRequestId("h");
  return new Promise((resolve) => {
    inflight.set(requestId, resolve);
    ws.send(JSON.stringify({ type: "query", requestId, ...call }));
  });
}

// —— 会话期数据缓存（@ 补全 / 工具集候选共用——会话期不失效，原 app.js 语义）：
// 查询带 sessionId 显式传参（共享层不依赖 state.js 的会话 id——防环纪律）
let fileCache = null; // { entries, truncated }（@ 补全——会话期缓存）
let metaCache = null; // { tools, skills }（/ 补全——会话期缓存）

export async function ensureFileCache(sessionId) {
  if (fileCache !== null) return fileCache;
  const envelope = await sendQuery({ sessionId: sessionId || "-", op: "files" });
  if (envelope.ok) fileCache = envelope.result;
  return fileCache;
}

export async function ensureMetaCache(sessionId) {
  if (metaCache !== null) return metaCache;
  const envelope = await sendQuery({ sessionId: sessionId || "-", op: "meta" });
  if (envelope.ok) metaCache = envelope.result;
  return metaCache;
}

/**
 * meta 缓存失效（T-P3-148 热加载——插件装载/卸载后工具/命令清单变化，
 * / 补全的数据源须重拉；插件中心热生效路径调用）。
 */
export function invalidateMetaCache() {
  metaCache = null;
}

/** host 地址：Web 模式 = 当前页面 origin（同一 host 进程）；桌面壳模式 =
 * WebView 从 tauri:// 协议加载（location.host 无意义）——直连本机 host
 * 缺省端口（server.ts --port 缺省 8787），可用 URL 参数 ?host= 覆盖。 */
export function hostAddress() {
  if (addressOverride !== null) return addressOverride;
  const params = new URLSearchParams(location.search);
  const explicit = params.get("host");
  if (explicit !== null && explicit !== "") return explicit;
  if (IS_DESKTOP) return "ws://127.0.0.1:8787";
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}

/** WS 生命周期：hello → query 恢复 → live 流（重连 3s——原语义）。
 * onStatus(text) 更新连接状态展示；onClose() 断连通知（租约 UI 归还等）；
 * onEnvelope(envelope) 分发全部信封。 */
export function connect({ onEnvelope, onStatus, onClose }) {
  ws = new WebSocket(`${hostAddress()}/ws`);
  ws.addEventListener("open", () => {
    onStatus("已连接");
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
      onEnvelope(envelope);
    }
  });
  ws.addEventListener("close", () => {
    onStatus("连接断开，3s 后重连…");
    if (onClose) onClose();
    setTimeout(() => connect({ onEnvelope, onStatus, onClose }), 3000);
  });
}
