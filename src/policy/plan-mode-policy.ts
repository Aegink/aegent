/**
 * plan 进出权限规则（W13b/T9-4——zcode resolvePlanModeTransitionPermission
 * 最优评估 §23 同构）：plan 进入/退出是权限管线的一等规则——
 *   - 进入映射为 allow（ruleId `tool.plan.enter`）——进入计划模式是只读
 *     研究意图（zcode 同语义；此前经链 abstain 默认 ask，本规则显式化）；
 *   - 非法退出（plan 未激活时的 plan_exit）映射为 deny（ruleId
 *     `mode.plan.exitOnly`）；plan 激活期间的退出**弃权**——落回既有 ask
 *     面批准（计划文本结算——"退出需批准"不变量保留）。
 *
 * `planModeFromEvents` 流重建与退出批准语义不动（G9/plan-mode 服务面）。
 * plan 模式硬关（G7 enforcePlanMode）在出口级——压过本模块与任何规则
 * （链上 allow 进不了硬关写面），fail-closed 纪律不变。
 */

import type { PolicyCall, PolicyModule, PolicyOutcome } from "./chain.js";

/** plan 进入规则 id（verdict.rule / dry-run / 审计的稳定标识）。 */
export const PLAN_ENTER_RULE_ID = "tool.plan.enter";
/** 非法退出规则 id。 */
export const PLAN_EXIT_RULE_ID = "mode.plan.exitOnly";

export function createPlanModePolicyModule(deps: {
  /** plan 激活活查询（PlanModeService.isActive——与 gate 同源）。 */
  planActive: () => boolean;
}): PolicyModule {
  return {
    name: "plan-mode-policy",
    async evaluate(call: PolicyCall): Promise<PolicyOutcome | undefined> {
      if (call.tool === "plan_enter") {
        return {
          action: "allow",
          rule: PLAN_ENTER_RULE_ID,
          reason: "进入计划模式（只读研究意图——进出通道开放）",
        };
      }
      if (call.tool === "plan_exit") {
        if (!deps.planActive()) {
          return {
            action: "deny",
            rule: PLAN_EXIT_RULE_ID,
            reason: "非法退出：当前不在计划模式（mode.plan.exitOnly）",
          };
        }
        // 激活期间的退出 → 弃权落回 ask 面批准（计划文本批准结算不变量）
        return undefined;
      }
      return undefined;
    },
  };
}
