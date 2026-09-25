/**
 * OpenAI 兼容流式适配（J1/J2 的厂商侧）——chat.completions 的 SSE wire 映射到
 * 词汇表 StreamChunk。选 OpenAI 兼容端点是因为覆盖面最大且 http-mock 易造。
 *
 * wire 映射表（chat.completion.chunk → StreamChunk）：
 * - `choices[0].delta.content`                 → {type:"text-delta"}
 * - `choices[0].delta.reasoning_content|reasoning` → {type:"reasoning-delta"}
 * - `choices[0].delta.tool_calls[i]`           → {type:"tool-call-delta"}，按 index 对齐：
 *   OpenAI 流式分片只在首片携带 id/name，后续片仅 index+arguments 增量——
 *   适配层按 index 记录开着的调用，替后续片补回 id（拼串职责归消费方）。
 * - 末尾 `usage` 对象（choices 为空）          → {type:"usage"}；请求带
 *   stream_options.include_usage 才会到达
 * - `data: [DONE]`                             → {type:"done"}，此后不再产出
 *
 * 失败语义：非 2xx 在响应头阶段抛 ProviderHttpError（T-2-03 重试层消费
 * status/Retry-After）；200 之后流中途的畸形帧是 wire 契约破坏，直接抛不重试。
 */

import type { StreamChunk } from "../kernel/events.js";
import { ProviderConfigError, type ProviderConfig } from "./config.js";
import {
  ProviderHttpError,
  toTokenUsage,
  type ChatMessage,
  type ChatRequest,
  type ChatTool,
  type ModelProvider,
} from "./provider.js";

/** 适配层私有展开——J3 的"内核不建模"只约束内核；适配层必须解释自己的配置。 */
export interface OpenAiCompatSettings {
  baseUrl: string;
  apiKey: string;
}

export function parseOpenAiCompatSettings(config: ProviderConfig): OpenAiCompatSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(config.settingsConfig);
  } catch {
    // parseProviderConfig 已保证语法合法，这里只是类型收窄的防御路径
    throw new ProviderConfigError("settingsConfig 不是合法 JSON");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProviderConfigError("openai-compat 的 settingsConfig 必须是 JSON 对象");
  }
  const rec = raw as { [key: string]: unknown };
  const baseUrl = rec["baseUrl"];
  const apiKey = rec["apiKey"];
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new ProviderConfigError("openai-compat 配置缺少非空字符串字段 baseUrl");
  }
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new ProviderConfigError("openai-compat 配置缺少非空字符串字段 apiKey");
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

export function createOpenAiCompatProvider(config: ProviderConfig): ModelProvider {
  const settings = parseOpenAiCompatSettings(config);
  return { streamChat: (req) => streamChatOpenAi(settings, req) };
}

async function* streamChatOpenAi(
  settings: OpenAiCompatSettings,
  req: ChatRequest,
): AsyncGenerator<StreamChunk> {
  const res = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: req.identity.modelId,
      messages: req.messages.map(toWireMessage),
      ...(req.tools && req.tools.length > 0
        ? { tools: req.tools.map(toWireTool) }
        : {}),
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal: req.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderHttpError(res.status, extractErrorMessage(body, res.status), {
      retryAfter: res.headers.get("retry-after") ?? undefined,
      bodyPreview: body.slice(0, 512),
    });
  }
  if (!res.body) {
    throw new ProviderHttpError(res.status, "响应没有可读的流式 body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const openToolCalls = new Map<number, { id: string }>();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let frameEnd: number;
      while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const chunk = parseSseFrame(frame, openToolCalls);
        if (chunk === "done") {
          yield { type: "done" };
          return;
        }
        if (chunk !== null) yield chunk;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** 解析一个 SSE 帧（`data: …` 行，可能多行拼一载荷）；返回 null 表示帧无产出。 */
function parseSseFrame(
  frame: string,
  openToolCalls: Map<number, { id: string }>,
): StreamChunk | "done" | null {
  const dataLines: string[] = [];
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith(":") || line === "") continue; // SSE 注释/空行
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return "done";

  let wire: unknown;
  try {
    wire = JSON.parse(data);
  } catch {
    throw new Error(`MODEL_WIRE_ERROR: SSE data 载荷不是合法 JSON（前 120 字符：${data.slice(0, 120)}）`);
  }
  return mapWireChunk(wire, openToolCalls);
}

function mapWireChunk(
  wire: unknown,
  openToolCalls: Map<number, { id: string }>,
): StreamChunk | null {
  if (wire === null || typeof wire !== "object") return null;
  const rec = wire as { [key: string]: unknown };
  const usage = rec["usage"];
  if (usage !== null && usage !== undefined) {
    return { type: "usage", usage: toTokenUsage(usage as Parameters<typeof toTokenUsage>[0]) };
  }
  const choices = rec["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const choice = choices[0];
  if (choice === null || typeof choice !== "object") return null;
  const delta = (choice as { [key: string]: unknown })["delta"];
  if (delta === null || typeof delta !== "object") return null;

  // 一个 wire chunk 理论上可同时携带 reasoning/content/tool_calls；按
  // reasoning → content → tool_calls 的产出顺序遍历（reasoning 先于正文）。
  const d = delta as { [key: string]: unknown };
  const reasoning = firstNonEmptyString(d["reasoning_content"], d["reasoning"]);
  if (reasoning !== null) return { type: "reasoning-delta", text: reasoning };
  const content = firstNonEmptyString(d["content"]);
  if (content !== null) return { type: "text-delta", text: content };

  const toolCalls = d["tool_calls"];
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      const chunk = mapToolCallDelta(tc, openToolCalls);
      if (chunk !== null) return chunk;
    }
  }
  return null;
}

function mapToolCallDelta(
  tc: unknown,
  openToolCalls: Map<number, { id: string }>,
): StreamChunk | null {
  if (tc === null || typeof tc !== "object") return null;
  const rec = tc as { [key: string]: unknown };
  const index = typeof rec["index"] === "number" ? rec["index"] : 0;
  const fn = rec["function"];
  const fnRec = fn !== null && typeof fn === "object" ? (fn as { [key: string]: unknown }) : {};
  const id = typeof rec["id"] === "string" ? rec["id"] : undefined;
  const name = typeof fnRec["name"] === "string" ? (fnRec["name"] as string) : undefined;
  const argsDelta = typeof fnRec["arguments"] === "string" ? (fnRec["arguments"] as string) : "";

  const known = openToolCalls.get(index);
  if (id !== undefined) {
    openToolCalls.set(index, { id });
  } else if (known === undefined) {
    throw new Error(
      `MODEL_WIRE_ERROR: tool_call 分片 index=${index} 未携带 id 且此前无同名调用开头`,
    );
  }
  const callId = id ?? known!.id;
  if (argsDelta === "" && name === undefined && id === undefined) return null;
  return { type: "tool-call-delta", id: callId, ...(name !== undefined ? { name } : {}), argsDelta };
}

function toWireMessage(m: ChatMessage): unknown {
  switch (m.role) {
    case "system":
    case "user":
      return { role: m.role, content: m.content };
    case "assistant":
      return {
        role: "assistant",
        content: m.toolCalls && m.content === "" ? null : m.content,
        ...(m.toolCalls
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: tc.arguments },
              })),
            }
          : {}),
      };
    case "tool":
      // OpenAI wire 无 isError 位；错误事实靠消息文本本身表达（loop 侧决定措辞）
      return { role: "tool", tool_call_id: m.callId, content: m.content };
  }
}

function toWireTool(t: ChatTool): unknown {
  return {
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

function firstNonEmptyString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v !== "") return v;
  }
  return null;
}

function extractErrorMessage(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { [key: string]: unknown };
    const err = parsed["error"];
    if (err !== null && typeof err === "object") {
      const msg = (err as { [key: string]: unknown })["message"];
      if (typeof msg === "string" && msg !== "") return msg;
    }
  } catch {
    // 非 JSON 错误体，落到下面用状态码
  }
  return `模型端点返回 ${status}`;
}
