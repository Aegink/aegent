/**
 * T-7-08 验收（M10）：
 * ① 越档产生提醒且写入历史后不再重复送达；
 * ② 提醒事件被取消（未写历史 → 未 mark）→ 下次仍重发；
 * ③ 换窗后记账清零（新窗口重新观察越档）；
 * ④ 加权计算断言（输出 2x 权重假例；J25 同款公式）。
 */

import { describe, expect, it } from "vitest";
import { RolloutBudget, weightedTokensOf, type BudgetConfig } from "./budget.js";

/** 输出 2x 权重假例：samplingTokenWeight=2、prefillTokenWeight=1。 */
const config: BudgetConfig = {
  limitTokens: 10_000,
  reminderAtRemainingTokens: [5000, 1000],
  samplingTokenWeight: 2,
  prefillTokenWeight: 1,
};

describe("验收④：加权计算（rollout_budget.rs:62 公式）", () => {
  it("输出 × 采样权重 + 未缓存输入 × prefill 权重（输出 2x 假例）", () => {
    const usage = { inputTokens: 50, outputTokens: 100 };
    // 100×2 + 50×1 = 250
    expect(weightedTokensOf(usage, config)).toBe(250);
  });

  it("cacheRead 不计 prefill 权重（non_cached_input = input − cached）", () => {
    const usage = { inputTokens: 50, outputTokens: 100, cacheReadTokens: 20 };
    // 100×2 + (50−20)×1 = 230
    expect(weightedTokensOf(usage, config)).toBe(230);
  });

  it("负值防御：output/input 为 0 下界；全缓存输入只剩采样成本", () => {
    expect(weightedTokensOf({ inputTokens: 0, outputTokens: 0 }, config)).toBe(0);
    expect(weightedTokensOf({ inputTokens: 100, outputTokens: 0, cacheReadTokens: 100 }, config)).toBe(0);
  });
});

describe("验收①：越档产生提醒，写历史后不再重复送达", () => {
  it("初始 0 档提醒 → 送达 → 越第 1 档重新提醒 → 送达 → 同档不再发", () => {
    const budget = new RolloutBudget(config);
    const thread = "t1";
    // 初始：剩余 10000,未越档 → index 0 的初始状态提醒
    const r0 = budget.pendingReminder(thread, "w1");
    expect(r0).toEqual({ remainingTokens: 10_000, reminderIndex: 0 });
    budget.markReminderDelivered(thread, "w1", r0!);
    expect(budget.pendingReminder(thread, "w1")).toBeNull(); // 同窗同档不重发

    // 消耗到剩余 4000（加权）：越第 1 档（≤5000）→ 新提醒 index 1
    budget.recordUsage({ inputTokens: 6000, outputTokens: 0 });
    const r1 = budget.pendingReminder(thread, "w1");
    expect(r1!.reminderIndex).toBe(1);
    expect(r1!.remainingTokens).toBe(4000);
    budget.markReminderDelivered(thread, "w1", r1!);
    expect(budget.pendingReminder(thread, "w1")).toBeNull(); // 写历史后不再重复送达

    // 越第 2 档（≤1000）→ index 2
    budget.recordUsage({ inputTokens: 3000, outputTokens: 0 });
    expect(budget.pendingReminder(thread, "w1")!.reminderIndex).toBe(2);
  });

  it("recordUsage 累计加权值并在预算耗尽时返回 true（含之后恒 true）", () => {
    const budget = new RolloutBudget(config);
    // 加权:input×1 + output×2
    expect(budget.recordUsage({ inputTokens: 1000, outputTokens: 1000 })).toBe(false); // 3000
    expect(budget.recordUsage({ inputTokens: 2000, outputTokens: 500 })).toBe(false); // 累计 6000
    expect(budget.recordUsage({ inputTokens: 1500, outputTokens: 500 })).toBe(false); // 累计 8500
    expect(budget.recordUsage({ inputTokens: 1000, outputTokens: 500 })).toBe(true); // 累计 10500 ≥ 10000
    expect(budget.recordUsage({ inputTokens: 0, outputTokens: 0 })).toBe(true);
    expect(budget.used).toBe(10_500);
  });
});

describe("验收②：取消（未写历史）→ 重发", () => {
  it("pendingReminder 拿到提醒后未 markDelivered → 下次仍返回同档提醒", () => {
    const budget = new RolloutBudget(config);
    budget.recordUsage({ inputTokens: 6000, outputTokens: 0 }); // 越第 1 档
    const r1 = budget.pendingReminder("t1", "w1");
    expect(r1!.reminderIndex).toBe(1);
    // 模拟:提醒事件被取消,没写进历史 → 不调用 markReminderDelivered
    const r1again = budget.pendingReminder("t1", "w1");
    expect(r1again).toEqual(r1); // 重发同档
    // 这次送达成功
    budget.markReminderDelivered("t1", "w1", r1again!);
    expect(budget.pendingReminder("t1", "w1")).toBeNull();
  });
});

describe("验收③：换窗后记账清零", () => {
  it("同 thread 换 windowId → 已送达记录失效,新窗口重新观察越档", () => {
    const budget = new RolloutBudget(config);
    // window1:初始提醒已送达
    const r0 = budget.pendingReminder("t1", "w1");
    budget.markReminderDelivered("t1", "w1", r0!);
    expect(budget.pendingReminder("t1", "w1")).toBeNull();
    // 换窗（压缩/恢复产生新窗口）：即使消耗未变(同 index),也要重新送达
    const r0w2 = budget.pendingReminder("t1", "w2");
    expect(r0w2).not.toBeNull();
    expect(r0w2!.reminderIndex).toBe(0);
    budget.markReminderDelivered("t1", "w2", r0w2!);
    expect(budget.pendingReminder("t1", "w2")).toBeNull();
    // 旧窗记录不串扰:回到 w1 也重新观察(交付记录按 window 判定)
    // （w1 的记录已被 w2 覆盖——per-thread 单槽,codex 同款:deliveries.insert）
    expect(budget.pendingReminder("t1", "w1")).not.toBeNull();
  });

  it("跨 thread 记账隔离：thread A 已送达不影响 thread B 首次观察", () => {
    const budget = new RolloutBudget(config);
    const ra = budget.pendingReminder("a", "w1");
    budget.markReminderDelivered("a", "w1", ra!);
    expect(budget.pendingReminder("b", "w1")).toEqual(ra); // b 首次观察同档
  });
});
