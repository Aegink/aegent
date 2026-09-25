/**
 * 调用后压力测量与溢出恢复（F9/F10，T-7-04）。
 *
 * F10 是真实事故换来的纪律（pi-desktop ADR 0030 的 1,077,172 vs 1,000,000 事故 +
 * dsh after-call-compaction-pressure）：压力测量在每个模型调用**之后**做，且
 * **成功调用不是唯一压力信号**——provider 可能在返回 usage 前就拒绝（请求超限），
 * 有些成功调用不带 usage。三类信号统一成压力记录：
 *   ① 成功 + usage（权威计量）；
 *   ② 成功 + 无 usage → 本地估算兜底（overflow.ts 的保守估算）；
 *   ③ provider 拒绝 → 识别为超限即压力证据本身（isContextWindowExceeded）。
 *
 * 可回放（F10"压力测量在调用后且可回放"）：**不新增事件类型**——usage 已在
 * assistant/message.usage 落盘（E12 整值面），拒绝在 assistant/attempt 与
 * turn/end{error} 落盘，本地估算是事件流的纯函数现算；事件流重放即可重建压力史。
 *
 * 恢复失败不吞原始错误（F10）：压缩无法证明进展（hook 中止 / 恢复自身抛错）时
 * 抛 `OverflowRecoveryError`，其 `cause` 是 provider 原始错误对象（dsh："the loop
 * reports the original provider error object and code"）——调用方永远看得到真因。
 *
 * 压缩触发点在 turn 边界（F9，T-3-01 的 turnEnd 点位）：本模块提供记录与恢复
 * 原语；turnEnd 链上的压缩层消费 `PressureMonitor` 记录决定是否压缩——测试钉死
 * compaction 事件先于 turn/end 落盘（chain.ts 头注释预言的次序断言）。
 */

import type { ChatMessage } from "../models/provider.js";
import type { TokenUsage } from "../kernel/events.js";
import { type CompactionResult } from "./compaction.js";
import {
  estimateMessagesTokens,
  isContextWindowExceeded,
} from "./overflow.js";

/** 压力阈值比率默认值（dsh compaction-basic 同款默认：threshold ratio 0.8）。 */
export const DEFAULT_PRESSURE_THRESHOLD_RATIO = 0.8;

/** 压力信号来源（三类，见头注释）。 */
export type PressureSource = "usage" | "local-estimate" | "provider-rejection";

export interface PressureRecord {
  turn: number;
  step: number;
  /** 测得的 token 数：usage 权威值 / 无 usage 时的本地估算 / 拒绝时的估算。 */
  tokens: number;
  contextWindow: number;
  source: PressureSource;
  /** tokens ≥ contextWindow × 阈值比率（压缩触发判定，消费方在 turn 边界）。 */
  overThreshold: boolean;
  /** provider 送达的 usage（信号①才有）。 */
  usage?: TokenUsage;
}

export class PressureMonitor {
  private readonly history_: PressureRecord[] = [];

  constructor(
    private readonly thresholds: {
      contextWindow: number;
      thresholdRatio?: number;
    },
  ) {}

  get history(): readonly PressureRecord[] {
    return this.history_;
  }

  /** 成功调用后测量（调用后纪律：此时本 step 的工具结果尚未产出——下一边界再测）。 */
  recordSuccess(input: {
    turn: number;
    step: number;
    /** 发出请求的消息集（无 usage 时本地估算的输入）。 */
    messages: ChatMessage[];
    usage?: TokenUsage;
  }): PressureRecord {
    const { usage } = input;
    let tokens: number;
    let source: PressureSource;
    if (usage) {
      tokens = usage.totalTokens ?? usage.inputTokens + usage.outputTokens;
      source = "usage";
    } else {
      // 无 usage 兜底：本地保守估算（宁高估——方向论证见 overflow.ts 头注释）
      tokens = estimateMessagesTokens(input.messages);
      source = "local-estimate";
    }
    return this.commit({ ...input, tokens, source, ...(usage ? { usage } : {}) });
  }

  /**
   * 调用被拒后测量：识别为超限（ContextWindowExceeded）→ 拒绝即压力证据；
   * 非超限错误返回 null（不是压力问题，按原路径处理）。
   */
  recordRejection(input: {
    turn: number;
    step: number;
    messages: ChatMessage[];
    error: unknown;
  }): PressureRecord | null {
    if (!isContextWindowExceeded(input.error)) return null;
    return this.commit({
      turn: input.turn,
      step: input.step,
      tokens: estimateMessagesTokens(input.messages),
      source: "provider-rejection",
    });
  }

  private commit(fields: {
    turn: number;
    step: number;
    tokens: number;
    source: PressureSource;
    usage?: TokenUsage;
  }): PressureRecord {
    const ratio = this.thresholds.thresholdRatio ?? DEFAULT_PRESSURE_THRESHOLD_RATIO;
    const record: PressureRecord = {
      turn: fields.turn,
      step: fields.step,
      tokens: fields.tokens,
      contextWindow: this.thresholds.contextWindow,
      source: fields.source,
      overThreshold: fields.tokens >= this.thresholds.contextWindow * ratio,
      ...(fields.usage ? { usage: fields.usage } : {}),
    };
    this.history_.push(record);
    return record;
  }
}

/** 压缩恢复失败（F10）：provider 原始错误挂在 `cause` 上，绝不吞。 */
export class OverflowRecoveryError extends Error {
  readonly code = "CONTEXT_OVERFLOW_RECOVERY_FAILED";

  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
    this.name = "OverflowRecoveryError";
  }
}

/**
 * 溢出恢复编排：overflow 识别后尝试压缩；压缩无法证明进展（pre hook 中止 /
 * 压缩自身抛错）→ 抛 OverflowRecoveryError 且 cause = provider 原始错误。
 * `compacted` 即进展证明：compaction 事件已落盘（append-only 持久事实，
 * P0 语义；dsh 的 replaceGeneration 证明是同思想的 P1 强化）。
 * 进展成立时返回压缩结果——重试请求的决定权在调用方（loop 装配）。
 */
export async function recoverFromOverflow(input: {
  providerError: unknown;
  compact: () => Promise<CompactionResult>;
}): Promise<CompactionResult> {
  let result: CompactionResult;
  try {
    result = await input.compact();
  } catch (e) {
    throw new OverflowRecoveryError(
      `压缩恢复失败（${e instanceof Error ? e.message : String(e)}）——原始 provider 错误见 cause`,
      { cause: input.providerError },
    );
  }
  if (result.kind === "aborted") {
    throw new OverflowRecoveryError(
      `压缩恢复被中止（${result.reason ?? "pre-hook 中止"}）——原始 provider 错误见 cause`,
      { cause: input.providerError },
    );
  }
  return result;
}
