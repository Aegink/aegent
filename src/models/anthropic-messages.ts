/**
 * Anthropic Messages API 流式适配（J5/T-P1-108，#16 追认 Anthropic）——
 * /v1/messages 的 SSE wire 映射到词汇表 StreamChunk。形状取 pi-mono·
 * packages/ai/src/api/anthropic-messages.ts 的四件：SSE 六事件闭集
 * （message_start / content_block_start / content_block_delta /
 * content_block_stop / message_delta / message_stop）+ usage 累积
 * （message_start 起始、message_delta 累加——"both overwrite `output
 * .usage`, so without a carry-over …"）+ x-api-key / authorization 双鉴权
 * （assertRequestAuth 同款——缺一即拒）+ content_block 分型。
 *
 * 消息形状（Anthropic wire 与 OpenAI 的关键差异）：
 * - system 是**顶层字段**不是 messages 角色；
 * - assistant 的 tool 调用是 content blocks（type:"tool_use"）；
 * - 工具结果是 **user 消息内的 tool_result 块**（is_error 映射）；
 * - max_tokens 必填（配置缺省卡内定形 8192）。
 *
 * 失败语义：非 2xx 在响应头阶段抛 ProviderHttpError（J26 重试层消费）；
 * **流中 error 事件帧直接抛**（T-P1-102 偏离②"流中 error 帧"预留判据的
 * 真实面——loop 的 stream-recovery blocked 判据消费）；流提前结束（未见
 * message_stop）→ 类型化抛出（"stream ended before message_stop" pi 同款）。
 *
 * 不预先抽象公共适配层（KISS——第二实现落完再评估提层，占位卡原文）；
 * cache_control 标记面不落（F6 锚检测在位，随 §6.2 真实厂商联调，记档）。
 */

import type { StreamChunk, TokenUsage } from "../kernel/events.js";
import type { ModelIdentity } from "./identity.js";
import { ProviderConfigError, type ProviderConfig } from "./config.js";
import type { AuthMaterial, AuthResolver } from "./auth.js";
import {
  ProviderHttpError,
  type ChatMessage,
  type ChatRequest,
  type ChatTool,
  type ModelProvider,
} from "./provider.js";

/** 适配层私有展开（settingsConfig 形状——J3 "内核不建模" 只约束内核）。 */
export interface AnthropicSettings {
  baseUrl: string;
  apiKey: string;
  /** max_tokens 必填（Anthropic wire 要求）；缺省 8192（卡内定形）。 */
  maxTokens?: number;
  /** anthropic-version 头（缺省 2023-06-01——当前稳定版）。 */
  version?: string;
}

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_VERSION = "2023-06-01";

export function parseAnthropicSettings(config: ProviderConfig): AnthropicSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(config.settingsConfig);
  } catch {
    throw new ProviderConfigError("settingsConfig 不是合法 JSON");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProviderConfigError("anthropic 的 settingsConfig 必须是 JSON 对象");
  }
  const rec = raw as { [key: string]: unknown };
  const baseUrl = rec["baseUrl"];
  const apiKey = rec["apiKey"];
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new ProviderConfigError("anthropic 配置缺少非空字符串字段 baseUrl");
  }
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new ProviderConfigError("anthropic 配置缺少非空字符串字段 apiKey");
  }
  const maxTokens = rec["maxTokens"];
  const version = rec["anthropicVersion"];
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    ...(typeof maxTokens === "number" && Number.isInteger(maxTokens) && maxTokens > 0
      ? { maxTokens }
      : {}),
    ...(typeof version === "string" && version !== "" ? { version } : {}),
  };
}

export function createAnthropicMessagesProvider(
  config: ProviderConfig,
  options?: { authResolver?: AuthResolver },
): ModelProvider {
  const settings = parseAnthropicSettings(config);
  return {
    streamChat: async function* (req: ChatRequest) {
      let material: AuthMaterial | undefined;
      if (options?.authResolver !== undefined) {
        material = await options.authResolver.resolve();
      }
      yield* streamChatAnthropic(settings, req, material);
    },
  };
}

// ---------------------------------------------------------------------------
// 请求构造（消息映射）
// ---------------------------------------------------------------------------

interface AnthropicContentBlock {
  type: string;
  [key: string]: unknown;
}

interface AnthropicWireMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

function toAnthropicMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: AnthropicWireMessage[];
} {
  let system: string | undefined;
  const wire: AnthropicWireMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      system = system === undefined ? m.content : `${system}\n${m.content}`;
      continue;
    }
    if (m.role === "user") {
      wire.push({ role: "user", content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (m.content !== "") blocks.push({ type: "text", text: m.content });
      for (const call of m.toolCalls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: safeJsonParse(call.arguments),
        });
      }
      wire.push({ role: "assistant", content: blocks });
      continue;
    }
    // tool 结果 → user 消息的 tool_result 块（Anthropic 形状）
    wire.push({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: m.callId, content: m.content, ...(m.isError ? { is_error: true } : {}) },
      ],
    });
  }
  return { system, messages: wire };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function toAnthropicTool(t: ChatTool): unknown {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  };
}

// ---------------------------------------------------------------------------
// SSE 流映射
// ---------------------------------------------------------------------------

const ANTHROPIC_MESSAGE_EVENTS = new Set([
  "message_start",
  "message_delta",
  "message_stop",
  "content_block_start",
  "content_block_delta",
  "content_block_stop",
]);

async function* streamChatAnthropic(
  settings: AnthropicSettings,
  req: ChatRequest,
  auth?: AuthMaterial,
): AsyncGenerator<StreamChunk> {
  const apiKey = auth?.apiKey ?? settings.apiKey;
  const { system, messages } = toAnthropicMessages(req.messages);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": settings.version ?? DEFAULT_VERSION,
    ...(auth?.headers ?? {}),
  };
  // assertRequestAuth 同款：x-api-key 与 authorization 至少其一（authResolver
  // 的 headers 可能携带 authorization——令牌轮换面）。
  if (auth?.headers?.["authorization"] === undefined) {
    headers["x-api-key"] = apiKey;
  }
  const res = await fetch(`${settings.baseUrl}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: req.identity.modelId,
      max_tokens: settings.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(system !== undefined ? { system } : {}),
      messages,
      ...(req.tools && req.tools.length > 0 ? { tools: req.tools.map(toAnthropicTool) } : {}),
      stream: true,
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
  const state: AnthropicStreamState = {
    openBlocks: new Map(),
    inputTokens: undefined,
    outputTokens: undefined,
    cacheReadTokens: undefined,
    sawMessageStop: false,
    stopReason: undefined,
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let frameEnd: number;
      while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const chunk = parseAnthropicSseFrame(frame, state);
        if (chunk === "done") {
          // message_stop 结算：先落累积 usage，再落 done（finishReason 携带
          // 厂商 stop_reason——end_turn→stop / max_tokens→max_tokens，B20
          // 输出触顶续跑面的 Anthropic 侧词汇）。
          const usage: TokenUsage = {
            inputTokens: state.inputTokens ?? 0,
            outputTokens: state.outputTokens ?? 0,
          };
          if (state.cacheReadTokens !== undefined) usage.cacheReadTokens = state.cacheReadTokens;
          const total = usage.inputTokens + usage.outputTokens;
          if (total > 0) usage.totalTokens = total;
          yield { type: "usage", usage };
          yield {
            type: "done",
            finishReason: state.stopReason === "max_tokens" ? "max_tokens" : "stop",
          };
          return;
        }
        if (chunk !== null) yield chunk;
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!state.sawMessageStop) {
    throw new ProviderHttpError(200, "Anthropic 流在 message_stop 之前结束（wire 契约破坏）");
  }
}

interface AnthropicStreamState {
  openBlocks: Map<number, { type: string; id?: string; name?: string }>;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cacheReadTokens: number | undefined;
  sawMessageStop: boolean;
  /** message_delta 的 stop_reason（done chunk 的 finishReason——B20 续跑面）。 */
  stopReason: string | undefined;
}

/** 解析一个 SSE 帧（event: + data: 行）；返回 null 表示帧无产出。 */
function parseAnthropicSseFrame(
  frame: string,
  state: AnthropicStreamState,
): StreamChunk | "done" | null {
  let eventName: string | undefined;
  const dataLines: string[] = [];
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith(":")) continue;
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const data = dataLines.join("\n");
  let wire: unknown;
  try {
    wire = JSON.parse(data);
  } catch {
    throw new Error(`MODEL_WIRE_ERROR: SSE data 载荷不是合法 JSON（前 120 字符：${data.slice(0, 120)}）`);
  }
  return mapAnthropicEvent(eventName, wire, state);
}

function mapAnthropicEvent(
  eventName: string | undefined,
  wire: unknown,
  state: AnthropicStreamState,
): StreamChunk | "done" | null {
  if (wire === null || typeof wire !== "object") return null;
  const rec = wire as { [key: string]: unknown };
  const type = typeof rec["type"] === "string" ? rec["type"] : eventName;
  if (type === undefined) return null;
  if (!ANTHROPIC_MESSAGE_EVENTS.has(type)) {
    // 流中 error 事件帧直接抛（"Error" SSE event 与 data.type==="error"
    // 两种形态——T-P1-102 预留的 blocked 判据真实面）。
    const errorShape = rec["error"];
    if (type === "error" || (errorShape !== null && typeof errorShape === "object")) {
      const err = (errorShape ?? {}) as { type?: unknown; message?: unknown };
      throw new ProviderHttpError(
        200,
        `Anthropic 流中 error 事件：${String(err.type ?? type)} ${String(err.message ?? JSON.stringify(wire).slice(0, 200))}`,
      );
    }
    return null;
  }
  if (type === "message_start") {
    const message = rec["message"] as { usage?: { input_tokens?: unknown; output_tokens?: unknown; cache_read_input_tokens?: unknown } } | undefined;
    const usage = message?.usage;
    if (usage !== undefined) {
      state.inputTokens = num(usage.input_tokens);
      state.outputTokens = num(usage.output_tokens); // 起始值（后续 delta 累加）
      state.cacheReadTokens = num(usage.cache_read_input_tokens);
    }
    return null;
  }
  if (type === "content_block_start") {
    const index = num(rec["index"]) ?? -1;
    const block = rec["content_block"] as { type?: unknown; id?: unknown; name?: unknown } | undefined;
    if (block !== undefined && typeof block.type === "string") {
      state.openBlocks.set(index, {
        type: block.type,
        ...(typeof block.id === "string" ? { id: block.id } : {}),
        ...(typeof block.name === "string" ? { name: block.name } : {}),
      });
    }
    return null;
  }
  if (type === "content_block_delta") {
    const index = num(rec["index"]) ?? -1;
    const delta = rec["delta"] as { type?: unknown; text?: unknown; thinking?: unknown; partial_json?: unknown } | undefined;
    if (delta === undefined) return null;
    const block = state.openBlocks.get(index);
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      return { type: "text-delta", text: delta.text };
    }
    if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
      return { type: "reasoning-delta", text: delta.thinking };
    }
    if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
      return {
        type: "tool-call-delta",
        id: block?.id ?? `block-${index}`,
        ...(block?.name !== undefined ? { name: block.name } : {}),
        argsDelta: delta.partial_json,
      };
    }
    return null;
  }
  if (type === "content_block_stop") {
    return null; // 块闭合（聚合面已在 delta 流式透传——无需动作）
  }
  if (type === "message_delta") {
    const delta = rec["delta"] as { stop_reason?: unknown } | undefined;
    const usage = rec["usage"] as { output_tokens?: unknown } | undefined;
    if (usage !== undefined) {
      // usage 累积（pi-mono carry-over：message_delta 的 output_tokens 是
      // **累计值**——直接覆盖而非相加；input 用 message_start 的）。
      const out = num(usage.output_tokens);
      if (out !== undefined) state.outputTokens = out;
    }
    if (delta !== undefined && typeof delta.stop_reason === "string") {
      state.stopReason = delta.stop_reason;
    }
    // 累积 usage 在 message_stop 时统一落一个 usage chunk。
    return null;
  }
  if (type === "message_stop") {
    state.sawMessageStop = true;
    // usage/done 由 streamChat 的 "done" 分支统一结算（usage 先于 done）。
    return "done";
  }
  return null;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function extractErrorMessage(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (parsed.error && typeof parsed.error.message === "string") {
      return parsed.error.message;
    }
  } catch {
    // 非 JSON 错误体——用状态行
  }
  return `Anthropic HTTP ${status}`;
}


