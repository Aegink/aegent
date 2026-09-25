import { describe, expect, it } from "vitest";

import { assemblePolicyChain, type PolicyCall } from "./chain.js";
import { builtinRuleMatchers } from "./matchers.js";
import {
  RuleLoadError,
  loadedRuleMatch,
  loadedRuleText,
  loadRules,
  parseRulePattern,
} from "./rule-loader.js";
import { createRuleSetModule } from "./rules.js";

const bashCall = (command: string): PolicyCall => ({
  tool: "bash",
  args: { command },
});

describe("解析与 raw 保留（C38）", () => {
  it("Tool(argPattern) 拆解，原文原样保留", () => {
    const rules = loadRules(
      [{ raw: "bash(git *)", action: "ask" }],
      builtinRuleMatchers,
    );
    expect(rules[0]).toMatchObject({
      raw: "bash(git *)",
      toolName: "bash",
      argPattern: "git *",
      invalid: false,
    });
  });

  it("裸工具规则无 argPattern；Tool() 空参数按裸工具（kimi 同款）", () => {
    const rules = loadRules(
      [{ raw: "bash", action: "deny" }, { raw: "bash()", action: "ask" }],
      builtinRuleMatchers,
    );
    expect(rules[0]).toMatchObject({ toolName: "bash", action: "deny" });
    expect(rules[0]?.argPattern).toBeUndefined();
    expect(rules[1]).toMatchObject({ toolName: "bash" });
    expect(rules[1]?.argPattern).toBeUndefined();
  });

  it("畸形规则保留原文标 invalid（qwen never-match 纪律），加载不炸", () => {
    const rules = loadRules(
      [
        { raw: "bash(git", action: "allow", line: 2 },
        { raw: "(git *)", action: "allow", line: 3 },
        { raw: "   ", action: "allow", line: 4 },
      ],
      builtinRuleMatchers,
    );
    expect(rules.map((r) => r.invalid)).toEqual([true, true, true]);
    // never-match：畸形规则对任何调用都不产生裁决
    for (const rule of rules) {
      expect(loadedRuleMatch(builtinRuleMatchers)(rule, bashCall("git status"))).toBeUndefined();
    }
  });

  it("parseRulePattern 直接暴露（畸形返回 undefined）", () => {
    expect(parseRulePattern("Read(./secrets/**)")).toEqual({
      toolName: "Read",
      argPattern: "./secrets/**",
    });
    expect(parseRulePattern("Read(")).toBeUndefined();
    expect(parseRulePattern("")).toBeUndefined();
  });
});

describe("C44 · 加载期样例校验", () => {
  it("样例自洽的规则正常加载", () => {
    const rules = loadRules(
      [
        {
          raw: "bash(git *)",
          action: "allow",
          line: 5,
          matchExamples: ["git status", "git push"],
          notMatchExamples: ["rm -rf /"],
        },
      ],
      builtinRuleMatchers,
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.line).toBe(5);
  });

  it("正样例未命中的规则加载即报错，错误含行号与原文", () => {
    const load = () =>
      loadRules(
        [
          {
            raw: "bash(git push *)",
            action: "allow",
            line: 3,
            matchExamples: ["git status"],
          },
        ],
        builtinRuleMatchers,
      );
    expect(load).toThrow(RuleLoadError);
    try {
      load();
    } catch (e) {
      const err = e as RuleLoadError;
      expect(err.violations).toEqual([
        { line: 3, raw: "bash(git push *)", kind: "match-example", sample: "git status" },
      ]);
      expect(err.message).toContain("第 3 行");
      expect(err.message).toContain("bash(git push *)");
    }
  });

  it("反样例反而命中的规则同样报错；多条违规一次全列", () => {
    const load = () =>
      loadRules(
        [
          {
            raw: "bash(git *)",
            action: "ask",
            line: 7,
            matchExamples: ["git log"], // 合法
            notMatchExamples: ["git status"], // 反例实际命中 → 违规
          },
          {
            raw: "bash(rm *)",
            action: "deny",
            line: 12,
            matchExamples: ["ls"], // 正例未命中 → 违规
          },
        ],
        builtinRuleMatchers,
      );
    expect(load).toThrow(RuleLoadError);
    try {
      load();
    } catch (e) {
      const violations = (e as RuleLoadError).violations;
      expect(violations).toHaveLength(2);
      expect(violations[0]).toMatchObject({ line: 7, kind: "not-match-example" });
      expect(violations[1]).toMatchObject({ line: 12, kind: "match-example" });
    }
  });

  it("工具级规则与未登记工具的规则带样例即矛盾（examples-without-args）", () => {
    const load = () =>
      loadRules(
        [
          { raw: "bash", action: "allow", line: 2, matchExamples: ["anything"] },
          { raw: "write(/a/**)", action: "allow", line: 3, matchExamples: ["/a/b"] },
        ],
        builtinRuleMatchers,
      );
    expect(load).toThrow(RuleLoadError);
    try {
      load();
    } catch (e) {
      const violations = (e as RuleLoadError).violations;
      expect(violations.map((v) => v.kind)).toEqual([
        "examples-without-args",
        "examples-without-args",
      ]);
      expect(violations.map((v) => v.line)).toEqual([2, 3]);
    }
  });
});

describe("C21 · 参数匹配委托（链上路径）", () => {
  it("bash 规则经匹配器命中命令；首匹配胜 + raw 进 verdict（验收②）", async () => {
    const rules = loadRules(
      [
        { raw: "bash(git status)", action: "allow" },
        { raw: "bash(git *)", action: "ask" },
      ],
      builtinRuleMatchers,
    );
    const chain = assemblePolicyChain({
      user: [
        createRuleSetModule({
          name: "user-rules",
          rules,
          match: loadedRuleMatch(builtinRuleMatchers),
          ruleText: loadedRuleText,
        }),
      ],
    });
    const verdict = await chain.evaluate(bashCall("git status"));
    expect(verdict.action).toBe("allow");
    expect(verdict.rule).toBe("bash(git status)"); // raw 原文回显
  });

  it("未登记匹配器的工具，带参规则永不命中（fail-closed），链弃权", async () => {
    const rules = loadRules(
      [{ raw: "write(/a/**)", action: "allow" }],
      builtinRuleMatchers,
    );
    const chain = assemblePolicyChain({
      user: [
        createRuleSetModule({
          name: "user-rules",
          rules,
          match: loadedRuleMatch(builtinRuleMatchers),
        }),
      ],
    });
    // Write 未登记 RuleMatchable：引擎不能替工具猜参数语义
    expect((await chain.evaluate({ tool: "Write", args: { path: "/a/b" } })).action).toBe(
      "abstain",
    );
  });

  it("裸工具规则不经委托，按工具名通配命中", async () => {
    const rules = loadRules([{ raw: "bash", action: "deny" }], builtinRuleMatchers);
    const match = loadedRuleMatch(builtinRuleMatchers);
    expect(match(rules[0]!, bashCall("anything"))).toBe("deny");
  });

  it("工具名维度通配：B* 规则命中 Bash 调用", () => {
    const rules = loadRules([{ raw: "b*(git *)", action: "ask" }], builtinRuleMatchers);
    const match = loadedRuleMatch(builtinRuleMatchers);
    expect(match(rules[0]!, bashCall("git push"))).toBe("ask");
  });
});
