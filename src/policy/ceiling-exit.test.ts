import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  enforceCeiling,
  intersectAllProfiles,
  intersectPermissionProfiles,
  PermissionIntersectionError,
  type CeilingProfile,
  type PermissionSourceProfile,
} from "./intersect.js";
import type { PolicyCall } from "./chain.js";
import type { Verdict } from "./decision.js";
import { createToolGateLayer } from "./gate.js";
import { assemblePolicyChain } from "./chain.js";
import { builtinRuleMatchers } from "./matchers.js";
import { loadedRuleMatch, loadedRuleText, loadRules } from "./rule-loader.js";
import { createRuleSetModule } from "./rules.js";
import type { ChainNext } from "../kernel/chain.js";
import type { ToolCallPayload, ToolExecutionResult } from "../core/primitives/loop/loop.js";
import { createChildAssembly } from "../kernel/assembly.js";
import {SessionEventStore, type SessionStore} from "../session/store.js";
import type { Logger } from "../kernel/logger.js";

const call = (tool: string): PolicyCall => ({ tool, args: {} });

describe("C49 · enforceCeiling 出口级来源上限（T-P1-03）", () => {
  const profile: CeilingProfile = {
    kind: "ceilings",
    source: "来源A",
    ceilings: { bash: "ask", edit: "deny" },
  };

  it("无 profile / 上限 allow / 裁决已不宽于上限 → 原样透传", () => {
    const allow: Verdict = { action: "allow", reason: "r" };
    expect(enforceCeiling(allow, call("read"), undefined)).toBe(allow);
    expect(enforceCeiling(allow, call("read"), profile)).toBe(allow);
    const deny: Verdict = { action: "deny", reason: "r" };
    expect(enforceCeiling(deny, call("bash"), profile)).toBe(deny);
  });

  it("上限收窄：allow→ask、ask→deny，链裁决的 rule 证据保留（C18）", () => {
    const narrowed = enforceCeiling(
      { action: "allow", rule: "bash(echo *)", reason: "用户规则放行" },
      call("bash"),
      profile,
    );
    expect(narrowed.action).toBe("ask");
    expect(narrowed.rule).toBe("bash(echo *)");
    expect(narrowed.reason).toContain("来源A");
    const hardened = enforceCeiling(
      { action: "ask", reason: "r" },
      call("edit"),
      profile,
    );
    expect(hardened.action).toBe("deny");
  });

  it("多来源折叠：三 profile reduce 后每工具取最严（加来源不变宽松）", () => {
    const merged: readonly PermissionSourceProfile[] = [
      { kind: "ceilings", source: "A", ceilings: { bash: "allow" } },
      { kind: "ceilings", source: "B", ceilings: { bash: "ask" } },
      { kind: "ceilings", source: "C", ceilings: { bash: "deny", read: "ask" } },
    ];
    const profile2 = intersectAllProfiles(merged)!;
    expect(profile2.ceilings["bash"]).toBe("deny");
    expect(profile2.ceilings["read"]).toBe("ask");
    expect(intersectAllProfiles([])).toBeUndefined(); // 空 = 无约束
  });

  it("opaque 相遇在折叠时即抛（拒绝启动，错误含两来源名）", () => {
    expect(() =>
      intersectPermissionProfiles(
        { kind: "opaque", source: "外部强管", reason: "形态不可表达" },
        { kind: "ceilings", source: "A", ceilings: {} },
      ),
    ).toThrow(PermissionIntersectionError);
  });
});

// ---------------------------------------------------------------------------
// gate × ceiling 集成：上限在出口生效，规则 allow 被收窄
// ---------------------------------------------------------------------------

type Action = "allow" | "ask" | "deny";

function rulesModule(entries: ReadonlyArray<readonly [Action, string]>) {
  const rules = loadRules(
    entries.map(([action, raw]) => ({ raw, action })),
    builtinRuleMatchers,
  );
  return createRuleSetModule({
    name: "user-rules",
    rules,
    match: loadedRuleMatch(),
    ruleText: loadedRuleText,
  });
}

const payload = (name: string): ToolCallPayload => ({
  turn: 1,
  step: 1,
  callId: "c1",
  name,
  arguments: JSON.stringify({ command: "echo hi" }),
});

function makeNext(): ChainNext<ToolCallPayload, ToolExecutionResult> {
  return Object.assign(
    async () => ({ content: "executed" }),
    {
      point: "toolCall" as const,
      trace: Object.freeze([]),
      budget: Object.freeze({}),
    },
  );
}

describe("C49 · gate 出口上限集成（验收①）", () => {
  it("用户层 allow 规则先匹配胜，来源上限 ask 在出口收窄 → broker 拒绝、工具未执行", async () => {
    const layer = createToolGateLayer({
      chain: assemblePolicyChain({
        user: [rulesModule([["allow", "bash(echo *)"]])],
      }),
      broker: {
        name: "test-deny",
        decide: async () => ({ action: "deny", reason: "上限收窄后询问被拒" }),
      },
      sessionId: "s-ceiling",
      ceiling: { kind: "ceilings", source: "来源A", ceilings: { bash: "ask" } },
    });
    let executed = false;
    const next = Object.assign(
      async (): Promise<ToolExecutionResult> => {
        executed = true;
        return { content: "executed" };
      },
      { point: "toolCall" as const, trace: Object.freeze([]), budget: Object.freeze({}) },
    );
    const result = await layer(null!, payload("bash"), next);
    expect(executed).toBe(false);
    expect(result?.isError).toBe(true);
  });

  it("无 ceiling 时同配置放行（单来源回归，验收②）", async () => {
    const layer = createToolGateLayer({
      chain: assemblePolicyChain({
        user: [rulesModule([["allow", "bash(echo *)"]])],
      }),
      broker: { name: "test-deny", decide: async () => ({ action: "deny", reason: "拒绝" }) },
      sessionId: "s-ceiling",
    });
    let executed = false;
    const next = Object.assign(
      async (): Promise<ToolExecutionResult> => {
        executed = true;
        return { content: "executed" };
      },
      { point: "toolCall" as const, trace: Object.freeze([]), budget: Object.freeze({}) },
    );
    await layer(null!, payload("bash"), next);
    expect(executed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assembly 装配面：opaque 拒绝启动 + linter 常开（验收③）
// ---------------------------------------------------------------------------

describe("C49/C45 · assembly 装配接线（T-P1-03）", () => {
  function baseAssemblyOptions(logger?: Logger) {
    return {
      sessionId: "s-assemble",
      store: new SessionEventStore(),
      workspaceRoot: mkdtempSync(join(tmpdir(), "aegent-assemble-")),
      contextWindow: 200_000,
      approvalTimeoutMs: 5_000,
      ...(logger !== undefined ? { logger } : {}),
    };
  }

  it("opaque 来源传入装配即抛 PermissionIntersectionError（拒绝启动）", () => {
    expect(() =>
      createChildAssembly({
        ...baseAssemblyOptions(),
        permissionProfiles: [
          { kind: "opaque", source: "外部强管", reason: "形态不可表达" },
        ],
      }),
    ).toThrow(PermissionIntersectionError);
  });

  it("验收③：坏规则装配时 linter 警告落日志可检索（unknown-tool + invalid-syntax）", () => {
    const warnings: string[] = [];
    const logger: Logger = {
      debug: () => {},
      info: () => {},
      warn: (msg) => warnings.push(msg),
      error: () => {},
      setLevel: () => undefined,
      getLevel: () => "info",
    };
    const assembly = createChildAssembly({
      ...baseAssemblyOptions(logger),
      rules: [
        { raw: "notepad(*)", action: "allow" },
        { raw: "bash(*", action: "deny" },
      ],
    });
    assembly.dispose();
    const lint = warnings.filter((w) => w.startsWith("policy-lint:"));
    expect(lint.some((w) => w.includes("unknown-tool") && w.includes("notepad(*)"))).toBe(true);
    expect(lint.some((w) => w.includes("invalid-syntax") && w.includes("bash(*"))).toBe(true);
  });

  it("无 profiles 无坏规则 → 装配正常（默认路径零行为变化）", () => {
    const assembly = createChildAssembly(baseAssemblyOptions());
    expect(assembly.layers.toolCall).toHaveLength(1);
    assembly.dispose();
  });
});
