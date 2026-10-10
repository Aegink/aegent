/**
 * loop 护栏族（T3-1/W7 自 loop.ts 拆出——G10"护栏全家桶"的独立可测面）：
 * A14 maxSteps 收束判定、B20 输出触顶续跑、B13 mutation 重试预算上报。
 *
 * 纪律：护栏是**显式终止**（blocked 收轮，非 completed）——模型一直 continue
 * 不停/单件工具反复失败都是失控面；缺声明 = 从严（护栏只收紧不放宽）。
 * 断言锚点：loop.test.ts（maxSteps 专项 862 行 / mutation describe 1077 行 /
 * OUTPUT_TOKEN 续跑用例）——改本文件前先跑这三个 describe。
 */

import * as path from "node:path";
import type { ToolExecutionResult } from "../core/index.js";
import { MUTATION_RETRY_BUDGET_EXHAUSTED, type MutationRetryBudget } from "./tools/mutation-budget.js";

// ---------------------------------------------------------------------------
// A14/T-P1-50：maxStepsPerTurn 收束判定
// ---------------------------------------------------------------------------

/** A14 护栏判定：缺省 0 = 不限；step 超上限 → 强制收束为 blocked。 */
export function maxStepsExceeded(step: number, maxStepsPerTurn: number | undefined): boolean {
  const maxSteps = maxStepsPerTurn ?? 0;
  return maxSteps > 0 && step > maxSteps;
}

// ---------------------------------------------------------------------------
// B20/T-P1-62：输出 token 触顶续跑
// ---------------------------------------------------------------------------

/**
 * B20/T-P1-62 输出 token 触顶的 finishReason 闭集（zcode OUTPUT_LIMIT_RAW_
 * REASONS 同构，冻结只追加——C10 先例）：纯文本被截断且无工具调用时判定
 * "可续跑"。
 */
export const OUTPUT_TOKEN_LIMIT_FINISH_REASONS: ReadonlySet<string> = new Set([
  "length",
  "max_tokens",
  "max_output_tokens",
]);

/** B20/T-P1-62 续跑指令（zcode OUTPUT_TOKEN_CONTINUE_PROMPT 同款语义）。 */
export const OUTPUT_TOKEN_CONTINUE_PROMPT =
  "Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.";

/** B20/T-P1-62 每 turn 续跑上限（zcode MAX_OUTPUT_TOKEN_CONTINUATIONS=3 同值）。 */
export const MAX_OUTPUT_TOKEN_CONTINUATIONS = 3;

/**
 * B20 续跑判定（纯函数）：纯文本（无工具调用）+ finishReason ∈ 触顶闭集 +
 * 本 turn 续跑未达上限 → 可续跑。续跑计数器状态由 LoopOutputContinuation 持有。
 */
export function isOutputTokenLimitHit(
  output: { toolCalls: unknown[]; finishReason?: string },
): boolean {
  return (
    output.toolCalls.length === 0 &&
    output.finishReason !== undefined &&
    OUTPUT_TOKEN_LIMIT_FINISH_REASONS.has(output.finishReason)
  );
}

/** B20 每 turn 续跑计数（runTurn 开始时 reset——计数作用域按 promptId 同理不跨轮）。 */
export class LoopOutputContinuation {
  private count = 0;

  reset(): void {
    this.count = 0;
  }

  /** 未达上限 → 计数并放行续跑；已达 → false（护栏终止，不放宽）。 */
  tryContinue(): boolean {
    if (this.count >= MAX_OUTPUT_TOKEN_CONTINUATIONS) return false;
    this.count += 1;
    return true;
  }
}

// ---------------------------------------------------------------------------
// B13/T-P1-57：mutation 重试预算上报
// ---------------------------------------------------------------------------

/** B13 终止事实（本 step 收尾消费——blocked 收轮的结构化原因）。 */
export interface MutationTerminateHit {
  path: string;
  errorCode: string;
}

/**
 * B13 mutation 预算护栏（MutationRetryBudget 的 loop 侧上报面）：
 * isError → 逐路径 record（第 3 次计数失败置 terminate，本 step 收尾收轮）；
 * 成功 → 逐路径 clear（ADR "a successful mutation clears that path's failure
 * history"）。路径规范化 = resolve + 小写折叠（Windows 大小写不敏感）。
 */
export class MutationOutcomeGuard {
  private terminate: MutationTerminateHit | null = null;

  constructor(private readonly budget: MutationRetryBudget | undefined) {}

  /** 消费本 step 的终止事实（一次性——runTurn 开始与消费后归 null）。 */
  consumeTerminate(): MutationTerminateHit | null {
    const hit = this.terminate;
    this.terminate = null;
    return hit;
  }

  /**
   * 把 mutation 工具的结果上报预算。budget 未装配或当前无 promptId = 不记账
   * （可选装配，C13 同款语义）。
   */
  reportOutcome(result: ToolExecutionResult, currentPromptId: string | undefined): void {
    const budget = this.budget;
    if (budget === undefined || currentPromptId === undefined) return;
    const meta = result.meta;
    if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return;
    const paths = (meta as { [key: string]: unknown }).mutationPaths;
    if (!Array.isArray(paths) || paths.length === 0) return;
    for (const raw of paths) {
      if (typeof raw !== "string" || raw === "") continue;
      const normalized = path.resolve(raw).toLowerCase();
      if (result.isError === true) {
        const verdict = budget.record(currentPromptId, normalized, result.error?.code);
        if (verdict.terminate) {
          this.terminate = {
            path: raw,
            errorCode: result.error?.code ?? "UNKNOWN",
          };
        }
      } else {
        budget.clear(currentPromptId, normalized);
      }
    }
  }
}

export { MUTATION_RETRY_BUDGET_EXHAUSTED };
export type { MutationRetryBudget };

/** loop 侧装配面（护栏的 budget 注入口——AgentLoopDeps.mutationBudget 同源）。 */
export type MutationGuardDeps = { budget?: MutationRetryBudget };
