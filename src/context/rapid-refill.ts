/**
 * 压缩抖动检测（F28，T-7-07）——"连续多次极小工作量后又触发压缩"的断路器
 * （zcode·turn-loop-state.ts 独家机制，需求注明无条件采纳；症状是"账单暴涨
 * 且看不到尽头"，无保护无法收敛）。
 *
 * 状态机（与 zcode 同构，纯拟算 + 成功落账分离）：
 * - `evaluate()` 拟算本次压缩的 rapidRefill 计数：距上次压缩的工具轮次
 *   < 阈值（默认 3）= "几乎无进展又压" → 连续计数 +1；否则归 0。**不写状态**。
 * - `recordCompactSuccess(decision)` 只在压缩成功后把拟算值落账并清零工具轮
 *   计数——压缩被阻断时状态冻结（计数停在阈值上，不虚增）。
 * - `recordCompletedToolStep()` 每个完成的工具步骤 +1——真实干活会把
 *   toolTurnsSinceCompact 拉过阈值，evaluate 自然归 0（干活解锁断路器）。
 *
 * 阻断 = 硬失败：`shouldBlock` 时抛 `RapidRefillError`，错误对象携带
 * consecutiveRapidRefills / toolTurnsSinceCompact 全计数（验收要求）。
 * 接入点：CompactionEngine 的 run 入口（生命周期第 0 段，先于 pre hook）。
 */

/** 连续极小进展压缩的阻断阈值（zcode MAX_CONSECUTIVE_RAPID_REFILLS 同款默认）。 */
export const MAX_CONSECUTIVE_RAPID_REFILLS = 3;
/** "几乎无进展"的工具轮次阈值（zcode RAPID_REFILL_TOOL_TURN_THRESHOLD 同款）。 */
export const RAPID_REFILL_TOOL_TURN_THRESHOLD = 3;

export interface RapidRefillTracking {
  consecutiveRapidRefills: number;
  toolTurnsSinceCompact: number;
}

export interface RapidRefillDecision extends RapidRefillTracking {
  shouldBlock: boolean;
}

/** 抖动断路器熔断（F28 硬失败）：全计数在错误对象上，调用方可观测可上报。 */
export class RapidRefillError extends Error {
  readonly code = "COMPACTION_RAPID_REFILL";
  readonly consecutiveRapidRefills: number;
  readonly toolTurnsSinceCompact: number;

  constructor(decision: RapidRefillDecision) {
    super(
      `压缩抖动断路器熔断：连续 ${decision.consecutiveRapidRefills} 次压缩后几乎无进展` +
        `（toolTurnsSinceCompact=${decision.toolTurnsSinceCompact} < ${RAPID_REFILL_TOOL_TURN_THRESHOLD}）` +
        "——压缩-填充循环无法收敛，硬失败（F28）",
    );
    this.name = "RapidRefillError";
    this.consecutiveRapidRefills = decision.consecutiveRapidRefills;
    this.toolTurnsSinceCompact = decision.toolTurnsSinceCompact;
  }
}

export class RapidRefillGuard {
  private tracking: RapidRefillTracking = { consecutiveRapidRefills: 0, toolTurnsSinceCompact: 0 };

  constructor(
    private readonly maxConsecutive: number = MAX_CONSECUTIVE_RAPID_REFILLS,
    private readonly toolTurnThreshold: number = RAPID_REFILL_TOOL_TURN_THRESHOLD,
  ) {}

  /** 当前状态快照（可观测用）。 */
  get snapshot(): RapidRefillTracking {
    return { ...this.tracking };
  }

  /**
   * 拟算本次压缩的计数（纯查询，不写状态）。工具轮次已达阈值说明上次压缩后
   * 干了实事——连续计数归 0；否则本次是"极小进展又压"，连续计数 +1。
   */
  evaluate(): RapidRefillDecision {
    const consecutiveRapidRefills =
      this.tracking.toolTurnsSinceCompact < this.toolTurnThreshold
        ? this.tracking.consecutiveRapidRefills + 1
        : 0;
    return {
      consecutiveRapidRefills,
      toolTurnsSinceCompact: this.tracking.toolTurnsSinceCompact,
      shouldBlock: consecutiveRapidRefills >= this.maxConsecutive,
    };
  }

  /** 压缩成功后落账：拟算的连续计数生效，工具轮计数清零（zcode recordCompactSuccess 同款）。 */
  recordCompactSuccess(decision: RapidRefillDecision): void {
    this.tracking = {
      consecutiveRapidRefills: decision.consecutiveRapidRefills,
      toolTurnsSinceCompact: 0,
    };
  }

  /** 一个工具步骤完成后记账（真实进展的累计；loop 在 step 收尾时调用）。 */
  recordCompletedToolStep(): void {
    this.tracking.toolTurnsSinceCompact += 1;
  }
}
