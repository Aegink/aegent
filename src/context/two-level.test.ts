/**
 * 两级压缩边界（F19/T-P2-510）——micro 层（F8 result-trim）与 full 层
 * （E17 compaction）的触发边界与次序语义钉死。
 *
 * **#26 定形（零事件扩展）**：micro 层是**确定性投影规则**（keepLast/maxChars
 * 公开常量、幂等、无决策点）——裁剪视图可从事件流重算（流 + 规则的派生物），
 * 无新事实需事件承载；full 层的摘要内容是不可重算的外部事实，已由 compaction
 * 两段落流承载（T-P1-93 + #18 strategy 闭集）。zcode 的 microcompact_boundary
 * 事件不取——其 microcompact 是引擎决策（cleared/kept 选择不可重算），判据
 * 是"事实能否从流重算"而非"是否改变请求面"（known-diffs.md 记档）。
 */

import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../models/provider.js";
import { detectLocalOverflow } from "./overflow.js";
import { trimToolResultMessages } from "./result-trim.js";

function toolMsg(content: string): ChatMessage {
    return { role: "tool", callId: "c", content };
}

describe("两级压缩边界（F19）", () => {
  it("次序语义：溢出判定按未裁尺寸——同一窗口『未裁超限、裁剪后不超限』仍判溢出", () => {
    // 构造窗口：历史超长 tool 结果（裁剪候选）+ 尾部 4 条保留（keepLast 缺省）
    const window: ChatMessage[] = [
      { role: "user", content: "任务" },
      toolMsg("x".repeat(60_000)),
      toolMsg("y".repeat(60_000)),
      toolMsg("z".repeat(60_000)),
      ...Array.from({ length: 4 }, (_, i) => toolMsg(`recent-${i}: ${"r".repeat(10)}`)),
    ];
    const trimmed = trimToolResultMessages(window);
    // 裁剪生效：视图显著变小（micro 层请求面语义）
    const rawEstimate = JSON.stringify(window).length;
    const trimEstimate = JSON.stringify(trimmed).length;
    expect(trimEstimate).toBeLessThan(rawEstimate / 2);
    // 次序钉死：未裁尺寸超限 → 溢出（PreTurn 压缩触发——assembly.ts:993 的
    // 输入自 startNewContextWindow 原始投影，不消费裁剪视图）
    const rawVerdict = detectLocalOverflow({ messages: window, contextWindow: 10_000 });
    expect(rawVerdict.overflow).toBe(true);
    // 反证：若判定消费了裁剪视图，同一阈值不会溢出——两视图判定分离
    const trimmedVerdict = detectLocalOverflow({ messages: trimmed, contextWindow: 10_000 });
    expect(trimmedVerdict.overflow).toBe(false);
  });

  it("两级并存：micro 裁剪不产生 full 压缩事实——裁剪视图幂等且事件流零触碰（复证）", () => {
    const window: ChatMessage[] = [
      { role: "user", content: "任务" },
      toolMsg("big".repeat(1_000)),
      ...Array.from({ length: 4 }, (_, i) => toolMsg(`recent-${i}`)),
    ];
    const once = trimToolResultMessages(window);
    const twice = trimToolResultMessages(once);
    // micro 层幂等（投影规则——每次构建请求面现算，无状态累积）
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    // 未超 maxChars 的窗口：micro 层零动作（不裁未超限结果——触发边界）
    const small = trimToolResultMessages([
      { role: "user", content: "任务" },
      toolMsg("tiny"),
    ]);
    expect(JSON.stringify(small)).toBe(
      JSON.stringify([{ role: "user", content: "任务" }, { role: "tool", callId: "c", content: "tiny" }]),
    );
    // full 层触发边界独立：micro 裁剪只在小窗口上动作——不满足溢出（判定
    // 按未裁尺寸本就未溢出）就不触发 compaction；两层的触发判据互不依赖
    // （compaction 事件的产生由溢出/换模/指纹驱动——compaction.ts:36 四源，
    // 无"裁剪发生"源）。
  });
});
