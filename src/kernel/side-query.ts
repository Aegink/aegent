/**
 * 统一副调用底座（T-P3-147 A——qwen runSideQuery / pi one-shot-complete 的
 * 收敛位）：主对话之外的一切无历史 LLM 调用（润色/标题/任务测试…）走此单点
 * ——tools 恒空、输出帽与超时收口、瞬态有界重试、usage 返回、purpose 归因、
 * 错误码参数化（`<PURPOSE>_EMPTY`/`<PURPOSE>_TIMEOUT`）。
 *
 * 不收敛面记档：llm-summarizer（F11 三级链自带重试/分块/store header 落流，
 * 已验收复杂面不倒腾）；provider-test（host 测试专用链）。新副任务一律接入
 * 本底座，不再开裸 streamChat 循环。
 */

import type { ModelIdentity } from "../models/identity.js";
import type { ChatMessage, ModelProvider } from "../models/provider.js";
import { ProviderHttpError } from "../models/provider.js";
import { isRetryableStatus } from "../models/retry.js";
import type { TokenUsage } from "./events.js";

/** 副调用缺省超时（pi prompt-enhancement 60s 同值）。 */
export const SIDE_QUERY_TIMEOUT_MS = 60_000;
/** 副调用缺省输出帽（zcode auxiliaryModelOptions 输出帽 5000 同值族）。 */
export const SIDE_QUERY_MAX_TOKENS = 4_096;

export interface SideQueryResult {
  text: string;
  usage?: TokenUsage;
  /** 耗时（观测面——purpose 归因的延迟列）。 */
  ms: number;
}

export class SideQueryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SideQueryError";
  }
}

export interface SideQueryInput {
  purpose: string;
  provider: ModelProvider;
  identity: ModelIdentity;
  messages: ChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
  /** 瞬态重试次数（缺省 2；装饰性查询传 1——qwen "cosmetic queries pass 1"）。 */
  maxRetries?: number;
  /** 重试退避实现（测试注入 mock 时钟）。 */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * 一次副调用：流式收集 → 空输出/超时类型化失败。瞬态失败（J26 可重试
 * status）按 2s/4s 退避重试（llm-summarizer 同节奏）；usage 从流尾收集。
 */
export async function runSideQuery(input: SideQueryInput): Promise<SideQueryResult> {
  const purposeTag = input.purpose.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const maxTokens = input.maxTokens ?? SIDE_QUERY_MAX_TOKENS;
  const timeoutMs = input.timeoutMs ?? SIDE_QUERY_TIMEOUT_MS;
  const maxRetries = input.maxRetries ?? 2;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = Date.now();
  let lastError: unknown;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let text = "";
      let usage: TokenUsage | undefined;
      for await (const chunk of input.provider.streamChat({
        identity: input.identity,
        messages: input.messages,
        maxTokens,
        signal: controller.signal,
      })) {
        if (chunk.type === "text-delta") text += chunk.text;
        else if (chunk.type === "usage") usage = chunk.usage;
        else if (chunk.type === "done") break;
      }
      const trimmed = text.trim();
      if (trimmed === "") {
        throw new SideQueryError(`${purposeTag}_EMPTY`, "模型未返回内容（空输出）");
      }
      return { text: trimmed, usage, ms: Date.now() - started };
    } catch (e) {
      lastError = e;
      if (e instanceof SideQueryError) throw e; // 空输出不重试（换模型才有意义）
      if (controller.signal.aborted) {
        throw new SideQueryError(
          `${purposeTag}_TIMEOUT`,
          `副调用「${input.purpose}」在 ${String(timeoutMs)}ms 内未完成——可在设置换更快的辅助模型`,
        );
      }
      const retryable = e instanceof ProviderHttpError && isRetryableStatus(e.status);
      if (!retryable || attempt >= maxRetries) break;
      await sleep(2_000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError instanceof SideQueryError) throw lastError;
  throw new SideQueryError(
    `${purposeTag}_FAILED`,
    `副调用「${input.purpose}」失败：${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
