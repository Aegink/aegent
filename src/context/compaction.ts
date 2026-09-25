/**
 * 压缩模块（F4/T-7-01 范围：消费接口）——overflow.ts 的输出是本模块的输入：
 * 溢出判定与 provider 超限错误经映射函数转成 `CompactionRequest`，压缩执行
 * 本体（摘要生成、retainedTail 选择、`compaction` 事件落盘、生命周期与相位、
 * hook 介入点）属 T-7-02/T-7-03，在此接口之后接入。
 *
 * 模块分野纪律（F4）：本文件是"压了"的一侧，"超了"的判定全在 overflow.ts——
 * 消费方（loop 装配 / T-7-04 压力测量）的次序永远是：先问 overflow，拿到
 * CompactionRequest 才进本模块。
 */

import {
  type OverflowVerdict,
  isContextWindowExceeded,
} from "./overflow.js";

/** 压缩请求：溢出的两种来源（本地提前判定 / provider 拒绝）各自带齐上下文。 */
export type CompactionRequest =
  | {
      /** 本地估算判溢出（发请求前的 A4 面，F10 的"provider 在返回 usage 前拒绝"之前）。 */
      reason: "local-overflow";
      estimatedTokens: number;
      contextWindow: number;
    }
  | {
      /** provider 拒绝（ContextWindowExceeded 分支，codex·compact.rs:315 形态）。 */
      reason: "provider-overflow";
      /** provider 错误的展示消息（C14：判据在 overflow 识别层，这里只留展示面）。 */
      message: string;
    };

/** 本地判定 → 压缩请求；未溢出返回 null（不压，正常发请求）。 */
export function compactionRequestFromVerdict(
  verdict: OverflowVerdict,
): CompactionRequest | null {
  if (!verdict.overflow) return null;
  return {
    reason: "local-overflow",
    estimatedTokens: verdict.estimatedTokens,
    contextWindow: verdict.contextWindow,
  };
}

/**
 * provider 错误 → 压缩请求；非超限错误返回 null（错误按原路径处理，绝不在
 * 此吞掉——F10：恢复失败保留 provider 原始错误）。
 */
export function compactionRequestFromProviderError(
  error: unknown,
): CompactionRequest | null {
  if (!isContextWindowExceeded(error)) return null;
  return {
    reason: "provider-overflow",
    message: error instanceof Error ? error.message : String(error),
  };
}
