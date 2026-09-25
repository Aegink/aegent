/**
 * 预算是送达的事实（M10，T-7-08）——预算不是"限制"，是**必须送达的信号**：
 * 分级阈值（剩余 token 越过档位 → 产生提醒）+ 送达记账（**写进历史才算送达**，
 * 取消/未写历史则下次重发）+ 换窗重置（window 变化 → 送达记账失效，每个窗口
 * 都观察到越过的档位）。
 * 全部形态与语义取 codex·rollout_budget.rs（"Last reminder delivered to each
 * thread, so every thread observes crossed thresholds"；"Mark delivery only
 * after history insertion; cancellation before then should retry it"）。
 *
 * 计量按**加权 token** 不按裸数：`output × sampling_token_weight +
 * non_cached_input × prefill_token_weight`（rollout_budget.rs:62——同时是 J25
 * 的正确锚点）；cacheRead 不计权重（命中缓存不产生 prefill 成本）。
 *
 * 调用方契约：pendingReminder → 产出提醒消息 → **写进模型可见历史成功后**才
 * markReminderDelivered；写历史前被取消/失败 → 不 mark → 下次重发（M10 的
 * "送达"语义由调用方的落盘动作闭合，本类只管记账）。
 */

import type { TokenUsage } from "../kernel/events.js";

export interface BudgetConfig {
  /** 总预算（加权 token）。 */
  limitTokens: number;
  /** 提醒档位：剩余 token 的阈值数组（如 [5000, 1000]；越过的档数 = reminderIndex）。 */
  reminderAtRemainingTokens: readonly number[];
  /** 输出 token 权重（采样成本）。 */
  samplingTokenWeight: number;
  /** 未缓存输入 token 权重（prefill 成本）。 */
  prefillTokenWeight: number;
}

/** J25 同款加权计算：输出 × 采样权重 + 未缓存输入 × prefill 权重。 */
export function weightedTokensOf(usage: TokenUsage, config: BudgetConfig): number {
  const cached = Math.max(usage.cacheReadTokens ?? 0, 0);
  const nonCachedInput = Math.max(usage.inputTokens - cached, 0);
  return (
    Math.max(usage.outputTokens, 0) * config.samplingTokenWeight +
    nonCachedInput * config.prefillTokenWeight
  );
}

/** 送达提醒：remainingTokens 是提醒时刻的剩余预算（展示面）；reminderIndex 是判据。 */
export interface BudgetReminder {
  remainingTokens: number;
  reminderIndex: number;
}

interface Delivery {
  windowId: string;
  reminderIndex: number;
}

export class RolloutBudget {
  private weightedUsed = 0;
  private readonly deliveries = new Map<string, Delivery>();

  constructor(private readonly config: BudgetConfig) {}

  /**
   * 累计一次加权用量，返回预算是否已耗尽（含之后的每次调用——"Returns true
   * once the configured budget is exhausted, including on later calls"）。
   */
  recordUsage(usage: TokenUsage): boolean {
    this.weightedUsed += weightedTokensOf(usage, this.config);
    return this.weightedUsed >= this.config.limitTokens;
  }

  /** 已消耗的加权 token（可观测）。 */
  get used(): number {
    return this.weightedUsed;
  }

  /**
   * 待送达提醒：同 window 已送达 ≥ 当前档位 → null（不重复）；换窗 → 重发
   * （每个窗口都观察到越过的档位）。越过的档位数 = remaining ≤ 阈值的档数
   * （0 档 = 尚未越过任何档位的初始状态提醒，与 codex 一致）。
   */
  pendingReminder(threadId: string, windowId: string): BudgetReminder | null {
    const remainingTokens = Math.floor(
      Math.max(this.config.limitTokens - this.weightedUsed, 0),
    );
    const reminderIndex = this.config.reminderAtRemainingTokens.filter(
      (threshold) => remainingTokens <= threshold,
    ).length;
    const delivered = this.deliveries.get(threadId);
    if (delivered && delivered.windowId === windowId && delivered.reminderIndex >= reminderIndex) {
      return null;
    }
    return { remainingTokens, reminderIndex };
  }

  /**
   * 送达确认——**只在提醒写入模型可见历史成功之后调用**（M10 语义核心）。
   * 写历史前被取消 → 不调用本方法 → 下次 pendingReminder 仍返回同档提醒。
   */
  markReminderDelivered(threadId: string, windowId: string, reminder: BudgetReminder): void {
    this.deliveries.set(threadId, {
      windowId,
      reminderIndex: reminder.reminderIndex,
    });
  }
}
