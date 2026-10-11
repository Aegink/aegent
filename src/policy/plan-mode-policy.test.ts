/**
 * W13b/T9-4 验收：plan 进出权限规则（ruleId + 退出批准保留）。
 * plan-mode.test.ts（流重建/结算面）保持全绿——本文件只测权限映射。
 */
import { describe, expect, it } from "vitest";

import {
  createPlanModePolicyModule,
  PLAN_ENTER_RULE_ID,
  PLAN_EXIT_RULE_ID,
} from "./plan-mode-policy.js";

const call = (tool: string) => ({ tool, args: {}, source: "model" as const });

describe("plan-mode-policy（W13b/T9-4 权限规则映射）", () => {
  it("进入 → allow + ruleId tool.plan.enter", async () => {
    const mod = createPlanModePolicyModule({ planActive: () => false });
    const outcome = await mod.evaluate(call("plan_enter"));
    expect(outcome).toEqual({
      action: "allow",
      rule: PLAN_ENTER_RULE_ID,
      reason: expect.any(String),
    });
    expect(PLAN_ENTER_RULE_ID).toBe("tool.plan.enter");
  });

  it("非法退出（plan 未激活）→ deny + ruleId mode.plan.exitOnly", async () => {
    const mod = createPlanModePolicyModule({ planActive: () => false });
    const outcome = await mod.evaluate(call("plan_exit"));
    expect(outcome?.action).toBe("deny");
    expect(outcome?.rule).toBe(PLAN_EXIT_RULE_ID);
    expect(PLAN_EXIT_RULE_ID).toBe("mode.plan.exitOnly");
  });

  it("激活期间退出 → 弃权（undefined——落回 ask 面批准，退出批准不变量）", async () => {
    const mod = createPlanModePolicyModule({ planActive: () => true });
    expect(await mod.evaluate(call("plan_exit"))).toBeUndefined();
    // 进入恒 allow（重复进入幂等无害）
    expect((await mod.evaluate(call("plan_enter")))?.action).toBe("allow");
  });

  it("其他工具弃权（undefined——不干预既有链面）", async () => {
    const mod = createPlanModePolicyModule({ planActive: () => true });
    expect(await mod.evaluate(call("bash"))).toBeUndefined();
    expect(await mod.evaluate(call("read"))).toBeUndefined();
    expect(await mod.evaluate(call("todo_write"))).toBeUndefined();
  });
});
