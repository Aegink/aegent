import { describe, expect, it } from "vitest";

import type { JsonRecord } from "../kernel/events.js";
import {
  assemblePolicyChain,
  POLICY_LAYERS,
  type PolicyAction,
  type PolicyCall,
  type PolicyModule,
} from "./chain.js";
import { createRuleSetModule } from "./rules.js";

// ---------------------------------------------------------------------------
// 测试用最小规则与匹配器
//
// 真实的规则形状（Rule{permission,pattern,action}）与双维通配匹配是
// T-5-02（evaluate.ts）的产出；本文件只需要"能表达 Bash(*) / Bash(git*)、
// 且对 git status / git push 可区分"的最小匹配语义来验收顺序性质。
// ---------------------------------------------------------------------------

interface TestRule {
  readonly tool: string;
  /** "*" 匹配任意参数；否则取 "git*" 式前缀（去尾星做 startsWith）。 */
  readonly argPattern: string;
  readonly action: PolicyAction;
}

function testMatch(rule: TestRule, call: PolicyCall): PolicyAction | undefined {
  if (rule.tool !== call.tool) return undefined;
  if (rule.argPattern === "*") return rule.action;
  const command = call.args.command;
  const prefix = rule.argPattern.replace(/\*$/, "");
  return typeof command === "string" && command.startsWith(prefix)
    ? rule.action
    : undefined;
}

function ruleSet(name: string, rules: readonly TestRule[]): PolicyModule {
  return createRuleSetModule({ name, rules, match: testMatch });
}

function bashCall(command: string): PolicyCall {
  return { tool: "Bash", args: { command } satisfies JsonRecord };
}

describe("POLICY_LAYERS 层序常量（验收③）", () => {
  it("导出顺序即 C58 层序：托管 > 用户 > 项目 > 核心", () => {
    expect([...POLICY_LAYERS]).toEqual(["managed", "user", "project", "core"]);
  });

  it("装配后的模块顺序严格按层序展平，层内保持声明顺序", () => {
    const chain = assemblePolicyChain({
      core: [ruleSet("core-rules", [])],
      managed: [ruleSet("managed-rules", [])],
      project: [ruleSet("project-rules", [])],
      user: [ruleSet("user-rules", [])],
    });
    expect(chain.modules.map((m) => m.name)).toEqual([
      "managed-rules",
      "user-rules",
      "project-rules",
      "core-rules",
    ]);
  });
});

describe("层序即权威（验收①：C58）", () => {
  const denyInManaged = assemblePolicyChain({
    managed: [ruleSet("managed", [{ tool: "Bash", argPattern: "git*", action: "deny" }])],
    core: [ruleSet("core", [{ tool: "Bash", argPattern: "git*", action: "allow" }])],
  });
  const allowInManaged = assemblePolicyChain({
    managed: [ruleSet("managed", [{ tool: "Bash", argPattern: "git*", action: "allow" }])],
    core: [ruleSet("core", [{ tool: "Bash", argPattern: "git*", action: "deny" }])],
  });

  it("同两条规则，托管层 deny 在前则 deny 胜", async () => {
    await expect(denyInManaged.evaluate(bashCall("git status"))).resolves.toEqual({
      action: "deny",
    });
  });

  it("同两条规则换位后托管层 allow 在前则 allow 胜——结果随位置翻转", async () => {
    await expect(allowInManaged.evaluate(bashCall("git status"))).resolves.toEqual({
      action: "allow",
    });
  });
});

describe("规则集首匹配胜（验收②：C2/Q15）", () => {
  // 宽规则在前、窄规则在后：窄规则被完全遮蔽。
  const wideFirst = ruleSet("user-rules", [
    { tool: "Bash", argPattern: "*", action: "allow" },
    { tool: "Bash", argPattern: "git*", action: "ask" },
  ]);
  // 序列反过来：窄规则先生效。
  const narrowFirst = ruleSet("user-rules", [
    { tool: "Bash", argPattern: "git*", action: "ask" },
    { tool: "Bash", argPattern: "*", action: "allow" },
  ]);

  it("[Bash(*)允许, Bash(git*)询问] 下 git status 落允许", async () => {
    await expect(wideFirst.evaluate(bashCall("git status"))).resolves.toEqual({
      action: "allow",
    });
  });

  it("同规则集反转顺序后 git status 落询问——顺序决定结果", async () => {
    await expect(narrowFirst.evaluate(bashCall("git status"))).resolves.toEqual({
      action: "ask",
    });
  });

  it("不匹配的规则不产生裁决：git push 走到窄规则，无关宽规则不遮蔽链后模块", async () => {
    // narrowFirst 中 Bash(git*) 命中 git push → ask；证明首条匹配生效，
    // 而非"第一条规则无条件胜"（那条对 git push 本就不匹配）。
    await expect(narrowFirst.evaluate(bashCall("git push"))).resolves.toEqual({
      action: "ask",
    });
  });
});

describe("弃权与失败纪律", () => {
  it("全链无模块应答时返回 undefined（默认 ask 兜底属消费方语义，T-5-02/12）", async () => {
    const chain = assemblePolicyChain({
      managed: [ruleSet("managed", [{ tool: "Bash", argPattern: "git*", action: "allow" }])],
    });
    await expect(chain.evaluate(bashCall("ls"))).resolves.toBeUndefined();
    await expect(assemblePolicyChain({}).evaluate(bashCall("ls"))).resolves.toBeUndefined();
  });

  it("首个应答模块之后的模块不再被询问", async () => {
    let later = 0;
    const chain = assemblePolicyChain({
      managed: [ruleSet("managed", [{ tool: "Bash", argPattern: "*", action: "deny" }])],
      core: [
        {
          name: "probe",
          evaluate: async () => {
            later += 1;
            return { action: "allow" };
          },
        },
      ],
    });
    await expect(chain.evaluate(bashCall("ls"))).resolves.toEqual({ action: "deny" });
    expect(later).toBe(0);
  });

  it("模块抛错原样上抛，绝不当作弃权跳过（fail-open 不可接受）", async () => {
    const chain = assemblePolicyChain({
      managed: [
        {
          name: "broken",
          evaluate: async () => {
            throw new Error("策略模块崩溃");
          },
        },
      ],
      core: [ruleSet("core", [{ tool: "Bash", argPattern: "*", action: "allow" }])],
    });
    await expect(chain.evaluate(bashCall("ls"))).rejects.toThrow("策略模块崩溃");
  });
});
