/**
 * C45/C23 规则 linter 测试（T-P1-66 独立成文件）——既有三类判据用例在
 * self-guard.test.ts / ceiling-exit.test.ts（回归面），本文件承载 T-P1-66
 * 扩的两类（wildcard-tool-name / incomplete-namespace-name）与
 * findInactiveRuleToolNames 纯函数单测。
 */
import { describe, expect, it } from "vitest";

import { builtinRuleMatchers } from "./matchers.js";
import { loadRules } from "./rule-loader.js";
import {
  findInactiveRuleToolNames,
  lintRules,
} from "./linter.js";

const KNOWN_TOOLS = ["bash", "read", "write", "edit", "glob", "grep"];

function lint(raw: string, line?: number) {
  const rules = loadRules(
    [{ raw, action: "allow", ...(line !== undefined ? { line } : {}) }],
    builtinRuleMatchers,
  );
  return lintRules(rules, {
    knownToolNames: KNOWN_TOOLS,
    matchers: builtinRuleMatchers,
  });
}

describe("C23 · 策略自检扩面（T-P1-66）", () => {
  it("验收①：通配指向空集的规则报 wildcard-tool-name（注册表现存无一命中）", () => {
    // 大小写错位（我方方言大小写敏感，Bash* 命中不了 bash）
    const [caseMiss] = lint("Bash*(git *)", 3);
    expect(caseMiss).toMatchObject({
      kind: "wildcard-tool-name",
      raw: "Bash*(git *)",
      line: 3,
    });
    expect(caseMiss?.detail).toContain("无一命中");

    // 命名空间通配指向未连接的 server（注册表无 github__ 工具）
    const [noServer] = lint("github__*", 4);
    expect(noServer?.kind).toBe("wildcard-tool-name");
  });

  it("通配能命中注册表现存工具时不报（活规则零误报）", () => {
    expect(lint("b*")).toEqual([]); // b* 命中 bash
    expect(lint("g*p")).toEqual([]); // g*p 命中 glob/grep
  });

  it("验收②：命名空间形状畸形三类各报 incomplete-namespace-name", () => {
    for (const raw of ["a__", "__b", "a__b__c"]) {
      const [issue] = lint(raw);
      expect(issue).toMatchObject({
        kind: "incomplete-namespace-name",
        raw,
      });
      expect(issue?.detail).toContain("server__tool");
    }
  });

  it("两段非空的命名空间名走 unknown-tool（正确形状查注册表）；注册表现存名豁免畸形判定", () => {
    const [ghost] = lint("github__create_issue");
    expect(ghost?.kind).toBe("unknown-tool");

    // 三段名若注册表现存（工具名自身含 __）不报畸形——豁免防误报
    expect(findInactiveRuleToolNames(["a__b__c"], ["a__b__c"])).toEqual([]);
  });

  it("验收④：findInactiveRuleToolNames 三类各一可单测（kimi 同名函数意图）", () => {
    const found = findInactiveRuleToolNames(
      ["Bash*", "a__", "ghost", "bash"],
      KNOWN_TOOLS,
    );
    expect(found).toEqual([
      { name: "Bash*", kind: "wildcard-tool-name" },
      { name: "a__", kind: "incomplete-namespace-name" },
      { name: "ghost", kind: "unknown-tool" },
    ]);
  });
});
