import { describe, expect, it } from "vitest";
import {
  MUTATION_RETRY_BUDGET_EXHAUSTED,
  MutationRetryBudget,
} from "./mutation-budget.js";

describe("MutationRetryBudget —— B13 预算规则", () => {
  it("同 prompt 同路径：可恢复码首现宽限不计数，第 3 次计数失败 terminate", () => {
    const budget = new MutationRetryBudget();
    // 首现 OLD_TEXT_NOT_FOUND：宽限（0 计数）
    expect(budget.record("p1", "f:a", "OLD_TEXT_NOT_FOUND")).toEqual({
      terminate: false,
      countedFailures: 0,
    });
    // 同码第二次：计数 1
    expect(budget.record("p1", "f:a", "OLD_TEXT_NOT_FOUND")).toEqual({
      terminate: false,
      countedFailures: 1,
    });
    // 计数 2
    expect(budget.record("p1", "f:a", "OLD_TEXT_NOT_FOUND")).toEqual({
      terminate: false,
      countedFailures: 2,
    });
    // 计数 3 → terminate
    expect(budget.record("p1", "f:a", "OLD_TEXT_NOT_FOUND")).toEqual({
      terminate: true,
      countedFailures: 3,
    });
  });

  it("不同路径各自计数（互不干扰）", () => {
    const budget = new MutationRetryBudget();
    budget.record("p1", "f:a", undefined);
    budget.record("p1", "f:a", undefined);
    const b = budget.record("p1", "f:b", undefined);
    expect(b).toEqual({ terminate: false, countedFailures: 1 });
    const a = budget.record("p1", "f:a", undefined);
    expect(a.terminate).toBe(true);
  });

  it("不同 promptId 同路径互不影响（新输入 = 新预算）", () => {
    const budget = new MutationRetryBudget();
    budget.record("p1", "f:a", undefined);
    budget.record("p1", "f:a", undefined);
    const fresh = budget.record("p2", "f:a", undefined);
    expect(fresh).toEqual({ terminate: false, countedFailures: 1 });
  });

  it("成功清空该路径历史：clear 后重新计 3 次", () => {
    const budget = new MutationRetryBudget();
    budget.record("p1", "f:a", undefined);
    budget.record("p1", "f:a", undefined);
    budget.clear("p1", "f:a");
    expect(budget.record("p1", "f:a", undefined)).toEqual({
      terminate: false,
      countedFailures: 1,
    });
  });

  it("未知错误码保守直接计数（无宽限）；MUTATION_RETRY_BUDGET_EXHAUSTED 常量在位", () => {
    const budget = new MutationRetryBudget();
    expect(budget.record("p1", "f:a", "SOMETHING_ELSE")).toMatchObject({ countedFailures: 1 });
    expect(MUTATION_RETRY_BUDGET_EXHAUSTED).toBe("MUTATION_RETRY_BUDGET_EXHAUSTED");
  });
});
