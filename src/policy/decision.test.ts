import { describe, expect, it } from "vitest";

import { assemblePolicyChain, type PolicyCall } from "./chain.js";
import { abstainVerdict, verdictFromOutcome } from "./decision.js";
import { createRuleSetModule } from "./rules.js";

// ---------------------------------------------------------------------------
// 测试用最小规则集：tool 相等 + pattern 前缀（"*" 任意）即命中，规则原文
// 由 ruleText 回显。真实双维匹配见 evaluate.test.ts（T-5-02），此处只验收
// 证据流与决策值。
// ---------------------------------------------------------------------------

interface TextRule {
  readonly tool: string;
  readonly pattern: string;
  readonly text: string;
  readonly action: "allow" | "ask" | "deny";
}

function textRuleSet(rules: readonly TextRule[]) {
  return createRuleSetModule<TextRule>({
    name: "user-rules",
    rules,
    match: (rule, call: PolicyCall) => {
      if (rule.tool !== call.tool) return undefined;
      if (rule.pattern === "*") return rule.action;
      const command = call.args.command;
      return typeof command === "string" && command.startsWith(rule.pattern)
        ? rule.action
        : undefined;
    },
    ruleText: (rule) => rule.text,
  });
}

const bashCall = (command: string): PolicyCall => ({
  tool: "Bash",
  args: { command },
});

describe("C32 · 四值决策（abstain 与 ask 分开）", () => {
  it("链上无匹配策略时返回 abstain 而非 ask", async () => {
    const chain = assemblePolicyChain({
      user: [textRuleSet([{ tool: "Bash", pattern: "git", text: "Bash(git*)", action: "allow" }])],
    });
    const verdict = await chain.evaluate(bashCall("ls -la"));
    expect(verdict).toEqual(abstainVerdict());
    expect(verdict.action).toBe("abstain");
    expect(verdict.action).not.toBe("ask");
  });

  it("模块显式给 ask 时返回 ask——与 abstain 是两个值", async () => {
    const chain = assemblePolicyChain({
      user: [textRuleSet([{ tool: "Bash", pattern: "git", text: "Bash(git*)", action: "ask" }])],
    });
    const verdict = await chain.evaluate(bashCall("git status"));
    expect(verdict.action).toBe("ask");
    expect(verdict.action).not.toBe("abstain");
  });

  it("四值各自可达：allow / ask / deny / abstain", async () => {
    const scenarios = [
      { call: "git push", pattern: "git push", text: "Bash(git push)", action: "deny" },
      { call: "git status", pattern: "git status", text: "Bash(git status)", action: "ask" },
      { call: "ls", pattern: "*", text: "Bash(*)", action: "allow" },
    ] as const;
    for (const { call, pattern, text, action } of scenarios) {
      const chain = assemblePolicyChain({
        user: [textRuleSet([{ tool: "Bash", pattern, text, action }])],
      });
      expect((await chain.evaluate(bashCall(call))).action).toBe(action);
    }
    expect(abstainVerdict().action).toBe("abstain");
  });
});

describe("C18 · 裁决带 rule（规则原文）与 reason", () => {
  it("规则命中时 verdict.rule 是规则原文、reason 非空", async () => {
    const chain = assemblePolicyChain({
      user: [
        textRuleSet([{ tool: "Bash", pattern: "git status", text: "Bash(git status)", action: "allow" }]),
      ],
    });
    const verdict = await chain.evaluate(bashCall("git status"));
    expect(verdict.rule).toBe("Bash(git status)");
    expect(typeof verdict.reason).toBe("string");
    expect(verdict.reason.length).toBeGreaterThan(0);
  });

  it("非规则来源的裁决不带 rule 字段（in 运算符断言缺席而非 undefined）", async () => {
    const chain = assemblePolicyChain({
      core: [
        {
          name: "custom",
          evaluate: async () => ({ action: "deny", reason: "自定义策略拒绝" }),
        },
      ],
    });
    const verdict = await chain.evaluate(bashCall("anything"));
    expect(verdict.action).toBe("deny");
    expect("rule" in verdict).toBe(false);
    expect(verdict.reason).toBe("自定义策略拒绝");
  });

  it("模块未给 reason 时以模块名合成，裁决可解释不为空", () => {
    const verdict = verdictFromOutcome("dangerous-check", { action: "ask" });
    expect(verdict.reason).toBe("策略模块 dangerous-check 裁决为 ask");
  });

  it("abstain 裁决同样可解释", () => {
    const verdict = abstainVerdict();
    expect(verdict.rule).toBeUndefined();
    expect(verdict.reason.length).toBeGreaterThan(0);
  });
});
