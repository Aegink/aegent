/**
 * 工具结果历史裁剪器（F8/T-P1-104，投影级）——"历史中的冗余工具结果可被
 * 裁剪，且不破坏因果链"。生产时半边（boundedOutput：行/字节双上限 + spill
 * 落盘）B5/B10/B11 已在位；本模块是**历史面**的增量：模型可见消息视图里，
 * 把陈旧且超长的 tool result 替换为占位符。
 *
 * 红线与纪律：
 * - **事件流本体永不改写**（不变量 1）——裁剪只在请求面视图（ChatMessage[]）
 *   上进行，不落流、无事件；同流两次裁剪幂等。
 * - **因果链不破**：占位符仍是 tool 角色消息、callId 原样保留——每个
 *   tool/call 仍有配对 result（"a provider rejects a result whose call is
 *   missing" 的反面：绝不制造孤儿）。
 * - **冗余判据是尺寸非年龄**：超出 maxChars 的结果才裁（未超限的原文不动）；
 *   尾部最近 keepLast 个结果永远原文保留（模型正在使用的近因）。
 * - 与压缩分域：裁剪是请求面视图变换（不落流），压缩是流内事实（compaction
 *   事件）——两者可叠加不互扰（先裁剪视图再判溢出是保守方向反例：溢出判定
 *   按未裁尺寸，见卡内定形）。
 * - 两级压缩（F19/T-P2-510 定形）：本模块是 **micro 层**——轮内轻量裁剪，
 *   确定性规则（幂等、可从流重算，零事件）；compaction 引擎是 **full 层**
 *   （溢出/换模/指纹触发，两段落流）。次序 = 溢出判定按未裁尺寸（assembly
 *   detectLocalOverflow 的输入自 startNewContextWindow 原始投影），请求面
 *   按裁剪视图（loop.buildMessages 尾部接线）。#26 零事件结论见卡面完成记录。
 */

import type { ChatMessage } from "../../index.js";

/** 裁剪规则（keepLast/maxChars——卡内定形缺省：尾部 4 条 + 2000 字符阈值）。 */
export interface ResultTrimRules {
  /** 尾部最近 N 个 tool result 永远原文保留（缺省 4）。 */
  keepLast?: number;
  /** 超过该字符数的历史结果才裁（缺省 2000——未超不裁）。 */
  maxChars?: number;
}

export const DEFAULT_RESULT_TRIM_RULES: Required<ResultTrimRules> = {
  keepLast: 4,
  maxChars: 2_000,
};

/** boundedOutput 尾部提示中的 spill 指针（有则带进占位符——检索路径不断）。 */
const SPILL_POINTER_PATTERN = /完整输出在 ([^\]]+)\]/;

/**
 * 裁剪模型可见消息中的冗余 tool result（纯函数、幂等——占位符已裁的消息
 * 再次裁剪保持不变）。user/system/assistant 消息永不触碰；tool 角色消息按
 * 规则替换占位符。非破坏性：不修改入多数组（返回新数组）。
 */
export function trimToolResultMessages(
  messages: readonly ChatMessage[],
  rules: ResultTrimRules = {},
): ChatMessage[] {
  const keepLast = rules.keepLast ?? DEFAULT_RESULT_TRIM_RULES.keepLast;
  const maxChars = rules.maxChars ?? DEFAULT_RESULT_TRIM_RULES.maxChars;
  // 尾部 keepLast 个 tool 消息的下标集合（其余才是裁剪候选）
  const toolIndexes: number[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "tool") toolIndexes.push(i);
  }
  const protectedIndexes = new Set(toolIndexes.slice(0, keepLast));
  return messages.map((m, i) => {
    if (m.role !== "tool" || protectedIndexes.has(i)) return m;
    if (m.content.length <= maxChars) return m;
    const spill = SPILL_POINTER_PATTERN.exec(m.content);
    const pointer =
      spill !== null && spill[1] !== undefined ? `，完整输出在 ${spill[1]}` : "";
    return {
      role: "tool",
      callId: m.callId,
      content: `[结果已裁剪：原 ${String(m.content.length)} 字符，callId ${m.callId}${pointer}]`,
    };
  });
}
