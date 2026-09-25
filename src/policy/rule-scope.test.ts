import { describe, expect, it } from "vitest";

import { TurnScopeRules } from "./rule-scope.js";

describe("C22 · turn-override 作用域（T-P1-02）", () => {
  it("record 后同 turn 内 isApproved 为真；不同 turn 不可见", () => {
    const rules = new TurnScopeRules();
    rules.record(1, "bash(echo hi)");
    expect(rules.isApproved(1, "bash(echo hi)")).toBe(true);
    expect(rules.isApproved(2, "bash(echo hi)")).toBe(false);
    expect(rules.isApproved(1, "bash(echo other)")).toBe(false);
  });

  it("验收④：endTurn 后该 turn 记录失效，其后任何 turn 查不到", () => {
    const rules = new TurnScopeRules();
    rules.record(3, "bash(echo hi)");
    expect(rules.isApproved(3, "bash(echo hi)")).toBe(true);
    rules.endTurn(3);
    expect(rules.isApproved(3, "bash(echo hi)")).toBe(false);
    expect(rules.size()).toBe(0); // 记录被剪除，不是隐藏状态
  });

  it("同一规则可跨多次 turn 存活：endTurn(3) 不影响 turn 5 的记录", () => {
    const rules = new TurnScopeRules();
    rules.record(3, "bash(echo hi)");
    rules.record(5, "bash(echo hi)");
    rules.endTurn(3);
    expect(rules.isApproved(3, "bash(echo hi)")).toBe(false);
    expect(rules.isApproved(5, "bash(echo hi)")).toBe(true);
  });

  it("endTurn 幂等且剪除更早 turn（无中间残留）", () => {
    const rules = new TurnScopeRules();
    rules.record(1, "a");
    rules.record(2, "a");
    rules.record(2, "b");
    rules.endTurn(2);
    rules.endTurn(2);
    expect(rules.size()).toBe(0);
  });
});
