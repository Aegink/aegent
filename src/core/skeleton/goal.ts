/**
 * goal 跨轮驱动 + 截止时间调度（G3/G6，T-P1-12）——goal 跨 turn 保持、
 * 每轮注入提醒、invariant 自校验（dsh·goal-round-driver 三件纪律）与
 * "到期行为可定义"（kimi·IGoalDeadlineScheduler 的行为面——不抄其 DI
 * 架构，到期判定在每轮 tick 而非后台定时器：轮边界是我们的驱动节奏）。
 *
 * 状态机（invariant 自校验 = 迁移守卫纯函数 nextGoalState，表格外抛
 * GoalStateError——model-switch 的 nextSwitchPhase 同款可测性模式）：
 *   set    任意时刻可设（覆盖旧 goal——新目标即新事实）；
 *   renew  仅 active 可续期；achieve/abandon 仅 active 可结算。
 *   achieve/abandon 终态：只有 set 能重新开局（新事实覆盖）。
 *
 * 落流经注入 emit（goal/set 事件，E12 整值——流内最新即当前 goal，重启
 * 走 goalFromEvents 重建，验收④）。deadline 到期动作三选一可配：
 *   - "abandon"：到期即放弃（状态结算，当轮报告一次后不再提醒）；
 *   - "report"：状态不动，每轮注入到期催办（持续上报等待决策）；
 *   - "renew"：自动续期 renewExtendMs（落 renew 事件，当轮报告一次）。
 */

import { type GoalStatus, type SessionEvent } from "./events.js";

export interface GoalState {
  text: string;
  /** epoch 毫秒；缺省 = 无截止。 */
  deadline?: number;
  status: GoalStatus;
}

export type GoalExpiryAction = "abandon" | "report" | "renew";

/** goal 状态机拒绝的非法迁移（invariant 自校验，dsh goal-round-driver 纪律）。 */
export class GoalStateError extends Error {
  readonly code = "GOAL_STATE_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "GoalStateError";
  }
}

export type GoalAction =
  | { kind: "set"; text: string; deadline?: number }
  | { kind: "renew"; deadline: number }
  | { kind: "achieve" }
  | { kind: "abandon" };

/**
 * 迁移守卫（纯函数，穷举测试直接钉合法表）：非法迁移抛 GoalStateError
 * 而非静默——goal 是驱动依据，坏状态宁可炸在写入点。
 */
export function nextGoalState(
  from: GoalState | null,
  action: GoalAction,
): GoalState {
  switch (action.kind) {
    case "set": {
      const text = action.text.trim();
      if (text === "") throw new GoalStateError("goal 文本不能为空");
      return {
        text,
        ...(action.deadline !== undefined ? { deadline: action.deadline } : {}),
        status: "active",
      };
    }
    case "renew":
      if (!from || from.status !== "active") {
        throw new GoalStateError("仅 active 的 goal 可续期");
      }
      return { ...from, deadline: action.deadline };
    case "achieve":
    case "abandon":
      if (!from || from.status !== "active") {
        throw new GoalStateError(
          `仅 active 的 goal 可${action.kind === "achieve" ? "达成" : "放弃"}`,
        );
      }
      // 终态保留 text/deadline 终值（不抹历史事实）
      return { ...from, status: action.kind === "achieve" ? "achieved" : "abandoned" };
  }
}

export interface GoalService {
  /** 当前 goal 事实（流内最新 goal/set 的内存镜像；无 goal 时 null）。 */
  readonly current: GoalState | null;
  /** 设定（覆盖旧 goal）。 */
  set(text: string, deadline?: number): void;
  /** 续期（仅 active）。 */
  renew(deadline: number): void;
  /** 达成（仅 active；终态）。 */
  achieve(): void;
  /** 放弃（仅 active；终态）。 */
  abandon(): void;
  /**
   * 每轮开始 tick（beforeFirstModelRequest 挂点，同 PreTurn 压缩位）：
   * 到期判定 + 配置动作结算。返回本轮要注入的提醒文本（null = 无 goal
   * 或 goal 非活跃且无当轮报告）。
   */
  tickBeforeTurn(now: number): string | null;
}

export function createGoalService(options: {
  /** 落流注入：变更后的完整 goal 事实（装配闭包 append goal/set）。 */
  emit: (state: GoalState) => void;
  /** 到期动作（G6 三选一）；缺省 "report"（最保守：上报等待决策）。 */
  expiryAction?: GoalExpiryAction;
  /** "renew" 动作的续期时长（毫秒）；缺省 24h。 */
  renewExtendMs?: number;
  /** 恢复的初始状态（goalFromEvents 重建结果；缺省 null）。 */
  initial?: GoalState | null;
}): GoalService {
  const expiryAction = options.expiryAction ?? "report";
  const renewExtendMs = options.renewExtendMs ?? 24 * 60 * 60 * 1000;
  let current: GoalState | null = options.initial ?? null;
  const apply = (action: GoalAction): void => {
    const next = nextGoalState(current, action);
    current = next;
    options.emit(next);
  };
  return {
    get current(): GoalState | null {
      return current;
    },
    set(text, deadline) {
      apply({ kind: "set", text, ...(deadline !== undefined ? { deadline } : {}) });
    },
    renew(deadline) {
      apply({ kind: "renew", deadline });
    },
    achieve() {
      apply({ kind: "achieve" });
    },
    abandon() {
      apply({ kind: "abandon" });
    },
    tickBeforeTurn(now: number): string | null {
      const state = current;
      if (!state || state.status !== "active") return null;
      const expired = state.deadline !== undefined && state.deadline <= now;
      if (!expired) {
        const deadlineNote =
          state.deadline !== undefined
            ? `（截止：${new Date(state.deadline).toISOString()}）`
            : "";
        return `[目标提醒] 当前目标：${state.text}${deadlineNote}`;
      }
      switch (expiryAction) {
        case "abandon": {
          apply({ kind: "abandon" });
          return `[目标已到期] 「${state.text}」已按配置放弃，本轮起不再注入目标提醒。`;
        }
        case "renew": {
          const newDeadline = now + renewExtendMs;
          apply({ kind: "renew", deadline: newDeadline });
          return `[目标已到期] 「${state.text}」已自动续期至 ${new Date(newDeadline).toISOString()}。`;
        }
        case "report":
          // 状态不动（仍 active 且已到期）——每轮持续催办，等待决策
          return `[目标已到期] 「${state.text}」已过截止时间（${new Date(state.deadline!).toISOString()}），请确认放弃、续期或调整目标。`;
      }
    },
  };
}

/**
 * 从事件流重建 goal 事实（G3 验收④：重启后仍在——restore/回放按流
 * 重建，流内最新 goal/set 即当前 goal；有效视窗的 revert 切割由投影面
 * 处理，本函数面向装配期冷恢复读原始流）。
 */
export function goalFromEvents(events: readonly SessionEvent[]): GoalState | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== "goal/set") continue;
    return {
      text: e.text,
      ...(e.deadline !== undefined ? { deadline: e.deadline } : {}),
      status: e.status,
    };
  }
  return null;
}
