/**
 * 缓存健康诊断（F16/T-P2-512）——"缓存命中率下降可定位原因"。
 *
 * 行为锚 pi-mono·cache-retention.ts（🔴 只学行为：缓存状态可观测可归因，
 * retention 配置解析不取——我方无 per-request retention 配置面）。
 *
 * 归因分型（启发式——机验钉统计与比对结构，分型准确率是人工面）：
 * - `prefix_drift`：请求前缀指纹的公共长度回退——上下文重建（压缩/换模/
 *   工具集变化）导致前缀断点，缓存无法命中；
 * - `thinking_stripped`：流内产出过 reasoning（推理模型）但请求面 assistant
 *   回传消息不带 reasoning 内容（deepseek reasoning_content 不回传前缀的
 *   真实面）——每轮续话的前缀与上轮响应不齐，缓存写入重复；
 * - `provider_no_cache`：usage 无 cacheRead/cacheWrite 分列（端点不报告
 *   缓存——无从诊断，如实标注）。
 *
 * 零落流零词汇表扩展（诊断是读面——统计归 in-memory 报告，事件流零触碰）。
 */

import type { ChatMessage } from "./provider.js";
import type { TokenUsage } from "../core/index.js";

/** 逐请求缓存统计样本。 */
export interface CacheHealthSample {
  /** 请求序号（诊断序列内单调）。 */
  index: number;
  /** 目标模型（换模导致的命中率变化可归因到身份切换）。 */
  modelId: string;
  /** usage 分列透传（L3 已有面）；端点不报告时 undefined。 */
  usage?: Pick<TokenUsage, "inputTokens" | "cacheReadTokens" | "cacheWriteTokens">;
  /** 请求前缀指纹（逐消息 `role:len:hash8`——比对用，非全文）。 */
  prefixFingerprint?: string[];
  /** 请求面 assistant 消息是否携带 reasoning 内容（thinking 剥离核对面）。 */
  assistantCarriesReasoning: boolean;
}

/** 命中率下降的归因条目。 */
export interface CacheRegression {
  kind: "prefix_drift" | "thinking_stripped" | "provider_no_cache";
  /** 下降发生的请求序号。 */
  atIndex: number;
  /** 人话证据（指纹公共长度 / 缺席分列名）。 */
  evidence: string;
}

/** FNV-1a 32 位哈希（compaction 指纹同款——无依赖、跨进程稳定）。 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 请求前缀指纹：逐消息 `role:内容长:内容hash`（有界、可比较、不落全文）。 */
export function prefixFingerprint(messages: readonly ChatMessage[]): string[] {
  return messages.map((m) => {
    const content = m.content ?? "";
    return `${m.role}:${content.length}:${fnv1a(content)}`;
  });
}

/** 两指纹序列的公共前缀长度。 */
export function commonPrefixLength(a: readonly string[], b: readonly string[]): number {
  let i = 0;
  const end = Math.min(a.length, b.length);
  while (i < end && a[i] === b[i]) i++;
  return i;
}

/**
 * 前缀漂移检测：本次前缀相对上次**回退**（公共长度 < 上次前缀长度）= drift。
 * 纯追加（公共长度 = 上次长度）是健康形态——缓存前缀单调生长。
 */
export function detectPrefixDrift(
  prev: readonly string[] | undefined,
  curr: readonly string[],
): { drift: boolean; commonLen: number } {
  if (prev === undefined || prev.length === 0) return { drift: false, commonLen: curr.length };
  const commonLen = commonPrefixLength(prev, curr);
  return { drift: commonLen < prev.length, commonLen };
}

/** 请求面是否携带 reasoning 内容（assistant 消息的 reasoning 字段核对）。 */
function carriesReasoning(messages: readonly ChatMessage[]): boolean {
  return messages.some(
    (m) => m.role === "assistant" && (m as { reasoning?: string }).reasoning !== undefined,
  );
}

export interface RecordSampleInput {
  index: number;
  modelId: string;
  messages: readonly ChatMessage[];
  usage?: Pick<TokenUsage, "inputTokens" | "cacheReadTokens" | "cacheWriteTokens">;
  /** 流内是否产出过 reasoning（loop 的 stream 面可观测——供剥离核对）。 */
  streamHadReasoning?: boolean;
}

export interface CacheHealthReport {
  samples: CacheHealthSample[];
  /** 可算命中率 = 有 read 分列样本的 hit 比例；无分列样本不进分母（不编造）。 */
  hitRate: { hits: number; requests: number; rate: number | null };
  regressions: CacheRegression[];
}

/** 缓存健康追踪器：逐请求记录 + 相邻样本归因。 */
export class CacheHealthTracker {
  private readonly samples: CacheHealthSample[] = [];
  private readonly regressions: CacheRegression[] = [];
  private prevFingerprint: string[] | undefined;
  private prevAssistantCarriedReasoning = false;
  /** 剥离是结构性事实——每追踪器报告一次。 */
  private strippedReported = false;

  record(input: RecordSampleInput): void {
    const fingerprint = prefixFingerprint(input.messages);
    const assistantCarriesReasoning = carriesReasoning(input.messages);

    // 归因一：前缀漂移（公共长度回退）
    const { drift, commonLen } = detectPrefixDrift(this.prevFingerprint, fingerprint);
    if (drift) {
      this.regressions.push({
        kind: "prefix_drift",
        atIndex: input.index,
        evidence: `前缀公共长度 ${commonLen} < 上次 ${this.prevFingerprint!.length}（上下文重建或前缀断点）`,
      });
    }
    // 归因二：thinking 剥离（流内产 reasoning 但请求面不携带——上一轮的响应
    // 与本轮请求前缀不齐，缓存写入重复；deepseek 真实面）
    if (
      input.streamHadReasoning === true &&
      !assistantCarriesReasoning &&
      this.prevFingerprint !== undefined &&
      !this.strippedReported
    ) {
      // 剥离是结构性事实——每追踪器报告一次（首轮无前次对照，重复报告无增量）
      this.strippedReported = true;
      this.regressions.push({
        kind: "thinking_stripped",
        atIndex: input.index,
        evidence: "流内产出 reasoning 但请求面 assistant 消息不带 reasoning——前缀与上轮响应不齐",
      });
    }

    const hasCacheColumns = input.usage?.cacheReadTokens !== undefined;
    if (!hasCacheColumns && input.usage !== undefined) {
      this.regressions.push({
        kind: "provider_no_cache",
        atIndex: input.index,
        evidence: "usage 无 cacheRead/cacheWrite 分列——端点不报告缓存，无从诊断",
      });
    }

    this.samples.push({
      index: input.index,
      modelId: input.modelId,
      ...(input.usage !== undefined ? { usage: input.usage } : {}),
      prefixFingerprint: fingerprint,
      assistantCarriesReasoning,
    });
    this.prevFingerprint = fingerprint;
    this.prevAssistantCarriedReasoning = assistantCarriesReasoning;
  }

  report(): CacheHealthReport {
    const withRead = this.samples.filter((s) => s.usage?.cacheReadTokens !== undefined);
    const hits = withRead.filter((s) => (s.usage?.cacheReadTokens ?? 0) > 0).length;
    return {
      samples: [...this.samples],
      hitRate: {
        hits,
        requests: withRead.length,
        rate: withRead.length > 0 ? hits / withRead.length : null,
      },
      regressions: [...this.regressions],
    };
  }
}
