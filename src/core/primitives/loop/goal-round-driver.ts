/**
 * goal 自主续跑驱动（T7-6，dsh §13 同构）：agent 空闲 + goal 存在且活跃 +
 * 配额未尽 → 自动再起一轮（把 goal 推进到下一 round）。
 *
 * 正确性纪律（任务卡原文）：
 * - **只有进模型历史的 goal round 消耗配额**（注入但未 kick 的轮不算）；
 * - 配额耗尽 → 记 blocker（落 system/message 事实，不静默终止）；
 * - **可裁**：驱动未装配（roundDriver 缺省 undefined）= 现行为（不自动续跑）。
 */

import type { GoalService } from "../../skeleton/goal.js";

/** 续跑配额（goal 存在期间最多自动再起的轮数——卡内定形 5）。 */
export const DEFAULT_GOAL_ROUND_QUOTA = 5;

export interface GoalRoundDriverOptions {
  /** goal 服务（流内事实的权威面）。 */
  readonly goal: GoalService;
  /** 空闲回调（agent 空闲 + goal 活跃时驱动 kick——装配闭包 bridge.send）。 */
  readonly kick: (prompt: string) => Promise<void> | void;
  /** 配额（缺省 DEFAULT_GOAL_ROUND_QUOTA）。 */
  readonly quota?: number;
  /** 续跑提示词模板（goal 文本注入；缺省卡内定形）。 */
  readonly promptTemplate?: (goalText: string, remaining: number) => string;
}

/** blocker 事实（配额耗尽——宿主可观测面）。 */
export interface GoalRoundBlocker {
  readonly goalText: string;
  readonly quota: number;
  readonly consumed: number;
}

export interface GoalRoundDriver {
  /** agent 空闲通知（宿主 idle-reaper/goal 提醒挂点调用——驱动唯一入口）。 */
  onIdle(): Promise<GoalRoundBlocker | null>;
  /** 已消耗配额（观测面）。 */
  readonly consumed: number;
}

export function createGoalRoundDriver(options: GoalRoundDriverOptions): GoalRoundDriver {
  const quota = options.quota ?? DEFAULT_GOAL_ROUND_QUOTA;
  let consumed = 0;
  let running = false; // 防重入（idle 双通知/回调重入）

  const defaultPrompt = (goalText: string, remaining: number): string =>
    `【goal 自主续跑】（剩余自动轮配额：${remaining}/${quota}）\n\n继续推进当前目标：${goalText}\n\n` +
    `如目标已达成请明确说明并调用 goal 完成；如无法推进请说明阻塞点后正常收轮。`;

  return {
    get consumed(): number {
      return consumed;
    },
    async onIdle(): Promise<GoalRoundBlocker | null> {
      if (running) return null;
      const goal = options.goal.current;
      // goal 缺席/非活跃（achieved/abandoned）→ 不续跑
      if (goal === null || goal.status !== "active") return null;
      if (consumed >= quota) {
        // 配额耗尽 → blocker（宿主可观测面——落事实的通道由调用方注入，
        // 此处只返回事实；调用方落 system/message 或通知）
        return { goalText: goal.text, quota, consumed };
      }
      running = true;
      try {
        consumed += 1; // kick 前记账（进模型历史的轮 = 本轮 kick 的 prompt 必然入流）
        const remaining = quota - consumed;
        const prompt =
          options.promptTemplate !== undefined
            ? options.promptTemplate(goal.text, remaining)
            : defaultPrompt(goal.text, remaining);
        await options.kick(prompt);
        return null;
      } finally {
        running = false;
      }
    },
  };
}
