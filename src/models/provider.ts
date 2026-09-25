/**
 * 模型适配统一接口（J1/J2 的内核侧）——内核（阶段 3 loop）只见 ModelProvider，
 * 不见任何厂商 wire 形状（形状取 pi·packages/ai 的"适配独立目录"边界）。
 *
 * 增量词汇直接采用词汇表 `StreamChunk`（src/kernel/events.ts：text-delta /
 * reasoning-delta / tool-call-delta / usage / done），不另设 Delta 类型——
 * 词汇表注释明说"阶段 2 适配层把厂商 wire 事件映射到这里"，两套词汇是过早抽象。
 *
 * 重试分层（J26/T-2-03）：ProviderHttpError 在"拿到响应头"阶段抛出，
 * 重试层据此分类退避；一旦 200 开始收流，流中途错误不再自动重试
 * （增量已送达调用方，重试必然重复产出——D15 的流侧版本）。
 */

import type { JsonValue, StreamChunk, TokenUsage } from "../kernel/events.js";
import type { ModelIdentity } from "./identity.js";

export interface ChatTool {
  name: string;
  description: string;
  /** JSON Schema 形式的参数描述（对内核不透明，原样透传给厂商） */
  parameters: JsonValue;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      /** 上游模型已发出的调用（回传给厂商续话时使用） */
      toolCalls?: { id: string; name: string; arguments: string }[];
    }
  | { role: "tool"; callId: string; content: string; isError?: boolean };

export interface ChatRequest {
  /** 目标模型（provider 段由承载方隐含，modelId 随请求指定） */
  identity: ModelIdentity;
  messages: ChatMessage[];
  tools?: ChatTool[];
  signal?: AbortSignal;
}

export interface ModelProvider {
  /** 单次流式调用：一次连接、顺序产出 StreamChunk，done 后终止。 */
  streamChat(req: ChatRequest): AsyncIterable<StreamChunk>;
}

/** 响应头阶段失败（非 2xx）——T-2-03 重试层的分类判据。 */
export class ProviderHttpError extends Error {
  readonly code = "MODEL_HTTP_ERROR";
  readonly status: number;
  /** 服务端 Retry-After 头原文（秒数或 HTTP 日期）；无则 undefined */
  readonly retryAfter?: string;
  readonly bodyPreview?: string;

  constructor(
    status: number,
    message: string,
    opts?: { retryAfter?: string; bodyPreview?: string },
  ) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = status;
    this.retryAfter = opts?.retryAfter;
    this.bodyPreview = opts?.bodyPreview;
  }
}

/** usage 计数缺失/非法时的兜底值——厂商计量残缺不是致命错误。 */
export function toTokenUsage(raw: {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  prompt_tokens_details?: { cached_tokens?: unknown } | null;
  completion_tokens_details?: { reasoning_tokens?: unknown } | null;
}): TokenUsage {
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const usage: TokenUsage = {
    inputTokens: num(raw.prompt_tokens) ?? 0,
    outputTokens: num(raw.completion_tokens) ?? 0,
  };
  const total = num(raw.total_tokens);
  if (total !== undefined) usage.totalTokens = total;
  const cached = num(raw.prompt_tokens_details?.cached_tokens);
  if (cached !== undefined) usage.cacheReadTokens = cached;
  const reasoning = num(raw.completion_tokens_details?.reasoning_tokens);
  if (reasoning !== undefined) usage.reasoningTokens = reasoning;
  return usage;
}
