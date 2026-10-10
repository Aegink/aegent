/**
 * C11 项目信任测试（T-P1-69）——TrustState 三值状态机 + 出口降权
 * （规则不得授权）+ 装配级 gate 联动（warn 可检索）+ 缺省零行为变化。
 */
import { describe, expect, it } from "vitest";

import type { ChainNext } from "../kernel/chain.js";
import type { ToolCallPayload, ToolExecutionResult } from "../core/primitives/loop/loop.js";
import type { JsonRecord } from "../kernel/events.js";
import { DenyPermissionBroker } from "./broker.js";
import { createToolGateLayer } from "./gate.js";
import { assemblePolicyChain } from "./chain.js";
import { builtinRuleMatchers } from "./matchers.js";
import { loadedRuleMatch, loadRules } from "./rule-loader.js";
import { createRuleSetModule } from "./rules.js";
import {
  enforceTrustGate,
  ProjectTrustService,
} from "./project-trust.js";
import type { Verdict } from "./decision.js";

function makeNext(
  fn: (e2: ToolCallPayload) => Promise<ToolExecutionResult>,
): ChainNext<ToolCallPayload, ToolExecutionResult> {
  return Object.assign(fn, {
    point: "toolCall" as const,
    trace: Object.freeze([]),
    budget: Object.freeze({}),
  });
}

describe("C11 · ProjectTrustService（每次决策读当前状态）", () => {
  it("初始 undecided（陌生项目即降权）；显式信任后即刻放开（每次读当前状态）", () => {
    const trust = new ProjectTrustService();
    expect(trust.getState()).toBe("undecided");
    expect(trust.isTrusted()).toBe(false);

    trust.declareTrusted();
    expect(trust.isTrusted()).toBe(true); // 下一次决策立即生效

    trust.declareUntrusted();
    expect(trust.isTrusted()).toBe(false); // 撤销即刻暂停（qwen 同款）

    trust.reset();
    expect(trust.getState()).toBe("undecided");
  });
});

describe("C11 · enforceTrustGate（出口级降权，规则不得授权）", () => {
  const allowVerdict: Verdict = { action: "allow", reason: "用户规则 allow" };
  const writeCall = { tool: "write", args: { path: "/a/b.txt" } };
  const bashCall = { tool: "bash", args: { command: "git status" } };
  const readCall = { tool: "read", args: { path: "/a/b.txt" } };

  it("验收①：未信任时写/执行类出口 deny——链上 allow 压不过", () => {
    for (const call of [writeCall, bashCall, { tool: "apply_patch", args: { patchText: "*** Update File: x" } }]) {
      const verdict = enforceTrustGate(allowVerdict, call as typeof writeCall, false);
      expect(verdict.action).toBe("deny");
      expect(verdict.reason).toContain("项目未信任");
      expect(verdict.reason).toContain("C11");
    }
    // 读类不受降权
    expect(enforceTrustGate(allowVerdict, readCall, false)).toBe(allowVerdict);
  });

  it("验收②：declareTrusted 后即刻放行（活查询每次读当前状态断言）", () => {
    const trust = new ProjectTrustService();
    const trustedOf = () => (trust.isTrusted() ? true : false) as boolean | undefined;
    expect(enforceTrustGate(allowVerdict, writeCall, trustedOf()).action).toBe("deny");
    trust.declareTrusted();
    expect(enforceTrustGate(allowVerdict, writeCall, trustedOf())).toBe(allowVerdict);
  });

  it("验收⑤：缺省装配（trustState 未启用/undefined）零行为变化", () => {
    expect(enforceTrustGate(allowVerdict, writeCall, undefined)).toBe(allowVerdict);
    expect(enforceTrustGate(allowVerdict, bashCall, true)).toBe(allowVerdict);
  });
});

describe("C11 · 装配级 gate 联动（warn 可检索）", () => {
  function makeGate(trustState: () => boolean | undefined) {
    const rules = loadRules(
      [{ raw: "bash(git *)", action: "allow" }],
      builtinRuleMatchers,
    );
    const chain = assemblePolicyChain({
      user: [
        createRuleSetModule({
          name: "user-rules",
          rules,
          match: loadedRuleMatch(),
          ruleText: (rule) => rule.raw,
        }),
      ],
    });
    const warnings: string[] = [];
    const layer = createToolGateLayer({
      chain,
      broker: new DenyPermissionBroker(),
      sessionId: "s1",
      onWarning: (w) => warnings.push(w),
      trustState,
    });
    const payload: ToolCallPayload = {
      turn: 1,
      step: 1,
      callId: "c1",
      name: "bash",
      arguments: JSON.stringify({ command: "git status" } satisfies JsonRecord),
    };
    const next = makeNext(async (e2) => ({ content: "ok", payload: e2 }) as ToolExecutionResult);
    return { layer, payload, next, warnings };
  }

  it("未信任：用户 allow 规则压不过出口降权，deny 且 warn 可检索", async () => {
    const { layer, payload, next, warnings } = makeGate(() => false);
    const result = await layer(null as never, payload, next);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("项目未信任");
    expect(warnings.some((w) => w.includes("trust-gate") && w.includes("bash"))).toBe(true);
  });

  it("declareTrusted 后同链放行（活查询）；缺省未启用零行为变化", async () => {
    const { layer, payload, next, warnings } = makeGate(() => undefined);
    const result = await layer(null as never, payload, next);
    expect(result.isError).toBeUndefined(); // 规则 allow，执行放行
    expect(warnings).toEqual([]);
  });
});
