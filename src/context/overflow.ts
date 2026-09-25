/**
 * 溢出检测（A4/F4，T-7-01）——与压缩分属两个模块：本模块只回答"超没超"，
 * 它的输出（OverflowVerdict / 识别出的 provider 超限错误）是 `compaction.ts`
 * 的输入，本模块绝不执行压缩。分野取 codex·compact.rs:315 的形态：
 * `ContextWindowExceeded` 是 provider 错误的一个处理分支，压缩逻辑在别处——
 * 把"超了"与"压了"写成一个函数就丢掉了"先判溢出再决定压缩"（F4）。
 *
 * 两个输入面：
 * 1. 本地估算（发请求前）——粗启发式，只回答"要不要提前压缩"（A4：先触发
 *    overflow 判定而非直接压）；
 * 2. provider 超限错误识别（发请求后）——provider 拒绝时的路由判据（F10：
 *    provider 可能在返回 usage 前拒绝）。
 *
 * 误差方向（纪律，别改反）：本地估算按 `chars / 3.6` 计 token——基础密度
 * 4 chars/token（英文粗略值）除以保守系数 0.9，即对同一段文本估出**更多**
 * token（放大约 11%）。保守 = 宁可误判提前压缩（多压一次无害），也不可漏判
 * 导致请求被 provider 在无恢复点时拒绝（pi-desktop ADR 0030 的真实事故：
 * 1,077,172 tokens 撞上 1,000,000 上限，provider 在有任何恢复点前就拒绝）。
 *
 * loop 接线属 T-7-02/T-7-04（压缩生命周期与 turn 边界压力测量），本模块保持纯函数。
 */

import type { ChatMessage } from "../models/provider.js";

/**
 * P0 规范超限码——events.ts `LlmFailure.code` 的既定例子（"稳定的厂商中立
 * 机器路由码"）。结构化判据优先；自由文本不当判据（Q10）。
 */
export const CONTEXT_WINDOW_EXCEEDED_CODE = "CONTEXT_WINDOW_EXCEEDED";

const BASE_CHARS_PER_TOKEN = 4;
/** 保守系数：除在密度上 = 放大估算（误差方向的论证见头注释）。 */
const CONSERVATIVE_FACTOR = 0.9;
const EFFECTIVE_CHARS_PER_TOKEN = BASE_CHARS_PER_TOKEN * CONSERVATIVE_FACTOR;
/** 每条消息的固定开销（角色标记 / wire 包装 / toolCalls 元数据的粗略折算）。 */
const PER_MESSAGE_OVERHEAD_TOKENS = 8;

/** 单段文本的本地 token 估算（向上取整——取整方向与保守方向一致）。 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / EFFECTIVE_CHARS_PER_TOKEN);
}

/** 消息序列的本地 token 估算：逐条内容 + 每条固定开销 + assistant 工具调用元数据。 */
export function estimateMessagesTokens(messages: readonly ChatMessage[]): number {
  let total = messages.length * PER_MESSAGE_OVERHEAD_TOKENS;
  for (const m of messages) {
    total += estimateTextTokens(m.content);
    if (m.role === "assistant" && m.toolCalls) {
      for (const c of m.toolCalls) {
        total += estimateTextTokens(c.name) + estimateTextTokens(c.arguments);
      }
    }
  }
  return total;
}

export interface OverflowVerdict {
  overflow: boolean;
  estimatedTokens: number;
  contextWindow: number;
  /** within 时为正余量，overflow 时为负超出量（与 contextWindow - estimatedTokens 同号）。 */
  margin: number;
}

/**
 * 本地溢出判定（发请求前的 A4 面）：估算超过窗口即判溢出。
 * 判定阈值不打折——保守余量已经吃在估算放大里，两处打折会双重放大。
 */
export function detectLocalOverflow(input: {
  messages: readonly ChatMessage[];
  contextWindow: number;
}): OverflowVerdict {
  const estimatedTokens = estimateMessagesTokens(input.messages);
  const margin = input.contextWindow - estimatedTokens;
  return { overflow: margin < 0, estimatedTokens, contextWindow: input.contextWindow, margin };
}

/**
 * provider 超限响应体的启发式短语（小写匹配）。codex 靠结构化
 * `CodexErrorDetails::ContextWindowExceeded`；我方 provider 层（T-2-02）能拿到
 * 的线索是 HTTP body 预览，短语清单是 P0 的识别面——只命中 unmistakable 的
 * 厂商措辞，宁可漏判（错误按原路径上抛）也不扩大误判面。
 */
const PROVIDER_OVERFLOW_BODY_PATTERNS = [
  "context window exceeded",
  "context length exceeded",
  "maximum context length",
  "context_length_exceeded",
  "too many tokens",
  "request too large",
] as const;

/**
 * 识别 provider 超限错误（发请求后的路由判据）。两判据有序：
 * 1. 结构化 `code`（大小写不敏感等于规范码）；
 * 2. `ProviderHttpError.bodyPreview` 命中启发式短语。
 * 错误的 `message` 刻意不认——自由文本的误判面不可控（Q10 纪律）。
 */
export function isContextWindowExceeded(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.toUpperCase() === CONTEXT_WINDOW_EXCEEDED_CODE) {
    return true;
  }
  const body = (error as { bodyPreview?: unknown }).bodyPreview;
  if (typeof body === "string") {
    const lower = body.toLowerCase();
    if (PROVIDER_OVERFLOW_BODY_PATTERNS.some((p) => lower.includes(p))) return true;
  }
  return false;
}
