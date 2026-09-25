/**
 * 双轴预算（B14）——硬上限：墙钟时间 + 单次循环的计数，形状取 kimi
 * budget.ts 的两方法分工（文件头注释即说明）：
 *   tick()      计数 +1 并**双查**（超数量或超截止都 throw）——每次产出
 *               （我方 = 每次工具派发）调用；
 *   progress()  **只查截止**不计数——长步骤中间（我方 = 工具执行完回环时）
 *               调用，防"单件工作极慢"绕过数量轴。
 *
 * 我方的消费方是 loop 的工具分发循环（B14"工具循环统一用"）：预算耗尽 =
 * 停止派发，未派发的 tool/call **缺席**（与 T-3-04 取消的"未派发的缺席"
 * 同一语义，不造第二套词汇；配平不变量不受影响——没有 call 就没有
 * result）。时间用注入的 now（T-2-03 同款纪律：可测性优于读全局钟）。
 */

/** 每个工具分发循环的默认计数上限（大而有效：正常会话触不到）。 */
export const DEFAULT_MAX_TOOL_CALLS = 256;

/** 每个工具分发循环的默认墙钟上限（毫秒；Infinity 显式禁时）。 */
export const DEFAULT_TOOL_LOOP_TIMEOUT_MS = 120_000;

export type BudgetExceededCode = "BUDGET_TICKS_EXCEEDED" | "BUDGET_DEADLINE_EXCEEDED";

/** 预算耗尽：内部控制流错误，loop 在工具循环处捕获并停发（不进事件）。 */
export class BudgetExceededError extends Error {
  readonly code: BudgetExceededCode;
  constructor(code: BudgetExceededCode, message: string) {
    super(message);
    this.name = "BudgetExceededError";
    this.code = code;
  }
}

export interface ParseBudgetOptions {
  /** 墙钟上限（毫秒）；Infinity 禁时（kimi 同款语义）。 */
  timeoutMs?: number;
  /** 计数上限；Infinity 禁计数轴。 */
  maxTicks?: number;
  /** 时钟注入（测试 mock Date.now；缺省系统钟）。 */
  now?: () => number;
}

export class ParseBudget {
  private readonly deadline: number;
  private readonly maxTicks: number;
  private readonly nowFn: () => number;
  private tickCount = 0;

  constructor(options: ParseBudgetOptions = {}) {
    this.nowFn = options.now ?? Date.now;
    this.deadline = this.nowFn() + (options.timeoutMs ?? DEFAULT_TOOL_LOOP_TIMEOUT_MS);
    this.maxTicks = options.maxTicks ?? DEFAULT_MAX_TOOL_CALLS;
  }

  /** 已消耗的计数（观察面，不参与判定）。 */
  get ticksUsed(): number {
    return this.tickCount;
  }

  /**
   * 计一次产出并双查：超数量或超截止都 throw BudgetExceededError。
   * 注意顺序：先计数后查时（kimi 同款）——第 maxTicks+1 次产出即超。
   */
  tick(): void {
    this.tickCount++;
    if (this.tickCount > this.maxTicks) {
      throw new BudgetExceededError(
        "BUDGET_TICKS_EXCEEDED",
        `预算耗尽：计数超上限（${String(this.tickCount)} > ${String(this.maxTicks)}）`,
      );
    }
    this.checkDeadline("tick");
  }

  /** 只查截止，不计数（长间隔工作的中途检查点）。 */
  progress(): void {
    this.checkDeadline("progress");
  }

  private checkDeadline(at: string): void {
    if (this.nowFn() >= this.deadline) {
      throw new BudgetExceededError(
        "BUDGET_DEADLINE_EXCEEDED",
        `预算耗尽：超出墙钟上限（at=${at}）`,
      );
    }
  }
}
