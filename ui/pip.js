/**
 * aegent 画中画面板（K9/T-P2-409）——"用户看得见 agent 在操作什么"：
 * 订阅同一 host 事件流，过滤 computer_* 工具调用/结果（S4 操作审计的
 * 消费端），渲染操作截图（tool/result meta.data 的 base64 PNG）+ 动作
 * 标注（tool/call 参数摘要）。锚点 zcode·cuaPipSession（只学行为：
 * PiP 会话窗口 + 操作回显——桌面服务集成不取，我方静态资产 + conf 声明
 * 的第二窗口）。
 *
 * 只读渲染面：画中画不发送任何写命令（无 prompt/approve UI——审批经
 * 主窗口；本窗口是"看"的端，surfaceId 前缀 pip- 不参与租约竞取）。
 */

// Tauri 2 WebView 注入 __TAURI_INTERNALS__ 全局（与 app.js 同款判定）。
const SURFACE_ID = `pip-${Math.random().toString(36).slice(2, 8)}`;
const PROTOCOL_VERSION = 1;
/** 连接参数：与主窗口同 host 地址（?ws= 参数可覆盖——本地调试）。 */
const params = new URLSearchParams(location.search);
const WS_URL = params.get("ws") ?? "ws://127.0.0.1:8787/ws";

const streamEl = document.getElementById("pip-stream");
const statusEl = document.getElementById("pip-status");
const countEl = document.getElementById("pip-count");

let operationCount = 0;
/** 进行中的调用（callId → 摘要）——tool/call 先入、tool/result 补结果。 */
const inflight = new Map();

function renderEntry(title, detail, screenshotData) {
  const entry = document.createElement("section");
  entry.className = "pip-entry";
  const label = document.createElement("div");
  label.className = "pip-entry-label";
  label.textContent = title;
  entry.appendChild(label);
  if (detail) {
    const detailEl = document.createElement("div");
    detailEl.className = "pip-entry-detail";
    detailEl.textContent = detail;
    entry.appendChild(detailEl);
  }
  if (screenshotData) {
    const img = document.createElement("img");
    img.className = "pip-entry-shot";
    img.alt = "操作截图";
    img.src = `data:image/png;base64,${screenshotData}`;
    entry.appendChild(img);
  }
  streamEl.prepend(entry); // 最新在最上（小窗可视面积有限）
  operationCount += 1;
  countEl.textContent = `${operationCount} 次操作`;
}

/** tool/call 的参数 → 人类可读动作标注。 */
function actionLabel(name, args) {
  const a = args ?? {};
  if (name === "computer_click") return `点击 (${a.x ?? "?"}, ${a.y ?? "?"})${a.button ? ` ${a.button}` : ""}`;
  if (name === "computer_type") return `输入文本 "${String(a.text ?? "").slice(0, 40)}"`;
  if (name === "computer_key") return `按键 ${a.key ?? "?"}`;
  if (name === "computer_screenshot") return "截屏";
  return name;
}

function handleEvent(event) {
  if (event.type === "tool/call" && String(event.name ?? "").startsWith("computer_")) {
    const summary = actionLabel(String(event.name), safeParse(event.arguments));
    inflight.set(String(event.callId), summary);
    renderEntry(summary, "执行中…", null);
  }
  if (event.type === "tool/result" && inflight.has(String(event.callId))) {
    const summary = inflight.get(String(event.callId));
    inflight.delete(String(event.callId));
    const meta = event.meta ?? {};
    const shot = typeof meta.data === "string" ? meta.data : null;
    renderEntry(summary, event.isError ? "失败" : "完成", shot);
  }
}

function safeParse(raw) {
  try {
    return JSON.parse(String(raw ?? "{}"));
  } catch {
    return {};
  }
}

function connect() {
  const ws = new WebSocket(WS_URL);
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "hello", surfaceId: SURFACE_ID, deliveryKind: "push", protocol: PROTOCOL_VERSION }));
    statusEl.textContent = "已连接";
  });
  ws.addEventListener("message", (message) => {
    for (const line of String(message.data).split("\n")) {
      if (line.trim() === "") continue;
      let envelope;
      try {
        envelope = JSON.parse(line);
      } catch {
        continue;
      }
      if (envelope.type === "event") handleEvent(envelope.event);
    }
  });
  ws.addEventListener("close", () => {
    statusEl.textContent = "连接断开（3s 重连）";
    setTimeout(connect, 3000);
  });
  ws.addEventListener("error", () => ws.close());
}

connect();
