/**
 * 辅助对话面板（T-P3-156 方案 T——需求五.2 内置「辅助对话」）：轻量对话走
 * 辅助模型链（sendRequest type:"polish"——T-P3-147 协议面的 chat 复用，
 * 不进主会话流不占上下文）；历史 JSONL 落盘（裁决 9b——settings op
 * assistant-log-append/read，按日文件 <home>/.aegent/assistant/）。
 */

import { sendRequest, sendSettings, allocRequestId } from "./api.js";
import { getSessionId, settingsCache } from "./state.js";
import { toast } from "./feedback.js";
import { renderMarkdown } from "./render.js";
import { registerPane } from "./pane.js";
import { icon } from "./icons.js";

let history = []; // {ts, role, text}

registerPane("assistant", {
  title: () => "辅助对话",
  icon: "messageCircle",
  render: (body) => {
    body.replaceChildren();
    const head = document.createElement("div");
    head.className = "assistant-head";
    const headTitle = document.createElement("span");
    headTitle.className = "subagent-pane-title";
    headTitle.append(icon("messageCircle", { cls: "icon-sm" }), document.createTextNode(" 辅助对话"));
    const headHint = document.createElement("span");
    headHint.className = "assistant-hint";
    headHint.textContent = "辅助模型快问快答——不进主会话流、不占上下文";
    head.append(headTitle, headHint);
    const stream = document.createElement("div");
    stream.className = "assistant-stream";
    const inputRow = document.createElement("div");
    inputRow.className = "assistant-input-row";
    const input = document.createElement("textarea");
    input.className = "input assistant-input";
    input.rows = 2;
    input.placeholder = "问点什么…（Enter 发送，Shift+Enter 换行）";
    const sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "btn btn-primary";
    sendBtn.textContent = "发送";
    inputRow.append(input, sendBtn);
    body.append(head, stream, inputRow);

    const appendBubble = (role, text) => {
      const bubble = document.createElement("div");
      bubble.className = `assistant-bubble assistant-${role}`;
      if (role === "assistant") {
        bubble.innerHTML = renderMarkdown(text);
      } else {
        bubble.textContent = text;
      }
      stream.appendChild(bubble);
      stream.scrollTop = stream.scrollHeight;
    };

    const send = async () => {
      const text = input.value.trim();
      if (text === "") return;
      input.value = "";
      appendBubble("user", text);
      history.push({ ts: Date.now(), role: "user", text });
      void sendSettings({ op: "assistant-log-append", role: "user", text }).catch(() => {});
      const pending = document.createElement("div");
      pending.className = "assistant-bubble assistant-assistant assistant-pending";
      pending.textContent = "思考中…";
      stream.appendChild(pending);
      stream.scrollTop = stream.scrollHeight;
      try {
        const sid = getSessionId();
        if (sid === "") throw new Error("会话未就绪");
        // polish 契约对齐（核对 A5 修复）：call 体必须自带 requestId 非空 +
        // draft 非空（agent-protocol decode 校验；app.js 润色钮同款形状），
        // 结果经 response 信封 result = polish_result 载荷回执。
        const envelope = await Promise.race([
          sendRequest(sid, { type: "polish", requestId: allocRequestId("pa"), draft: text }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("辅助对话请求超时（60s）")), 60_000)),
        ]);
        if (!envelope.ok) throw new Error(envelope.error?.message ?? envelope.error?.code ?? "请求被拒");
        const result = envelope.result ?? {};
        if (result.ok !== true || typeof result.text !== "string" || result.text.trim() === "") {
          throw new Error(result.error ?? "模型未返回内容");
        }
        const answer = result.text.trim();
        pending.remove();
        appendBubble("assistant", answer);
        history.push({ ts: Date.now(), role: "assistant", text: answer });
        void sendSettings({ op: "assistant-log-append", role: "assistant", text: answer }).catch(() => {});
      } catch (e) {
        pending.remove();
        appendBubble("assistant", `请求失败：${e?.message ?? ""}（检查设置「辅助模型」分节是否已配置）`);
      }
    };
    sendBtn.addEventListener("click", () => void send());
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        void send();
      }
    });

    // 历史回放（assistant-log-read——最近 3 天）
    void (async () => {
      try {
        const envelope = await sendSettings({ op: "assistant-log-read", limit: 50 });
        if (envelope.ok) {
          for (const entry of envelope.result?.entries ?? []) {
            appendBubble(entry.role === "assistant" ? "assistant" : "user", entry.text);
          }
        }
      } catch {
        // 历史不可用（无文件）——空态正常
      }
      if (stream.children.length === 0) {
        const empty = document.createElement("div");
        empty.className = "assistant-empty";
        empty.textContent = settingsCache?.enhancement?.summarizerModel !== undefined
          ? "随时开问——历史按日落盘（~/.aegent/assistant/）"
          : "辅助模型未配置——设置「辅助模型」分节配置后可用（仍可尝试发送）";
        stream.appendChild(empty);
      }
      stream.scrollTop = stream.scrollHeight;
    })();
  },
});
