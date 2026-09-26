/**
 * plan 模式测试（G1/G7，T-P1-11）——服务进出幂等 / 流重建（验收④：
 * 进出动作落事件可投影——tool/call+result 即事实，不扩词汇表）/ 出口级
 * 硬关（验收①规则压不过、②读类不限、③退出恢复）/ gate 集成（激活时
 * bash 不进 broker 直接拒）/ 注册面与提示词独立文件（验收⑤零 .ts diff）。
 * CLI 级联测（审批进出 + 硬关端到端）在 cli.test.ts。
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { NewSessionEvent, SessionEvent } from "./events.js";
import {
  createPlanModeService,
  planModeFromEvents,
} from "./plan-mode.js";
import { enforcePlanMode } from "../policy/plan-guard.js";
import { assemblePolicyChain, type PolicyCall } from "../policy/chain.js";
import { createToolGateLayer, TOOL_POLICY_DENIED } from "../policy/gate.js";
import { DenyPermissionBroker } from "../policy/broker.js";
import { builtinRuleMatchers } from "../policy/matchers.js";
import { loadedRuleMatch, loadedRuleText, loadRules } from "../policy/rule-loader.js";
import { createRuleSetModule } from "../policy/rules.js";
import { BUILTIN_TOOL_NAMES, registerBuiltinTools } from "./tools/builtin/index.js";
import { ToolRegistry } from "./tools/registry.js";

const mk = (event: NewSessionEvent, seq: number): SessionEvent =>
  ({ ...event, seq, ts: 0 } as SessionEvent);

/** plan 工具一轮的流内事实：tool/call + tool/result（isError 可选）。 */
function planToolRound(
  seq0: number,
  name: "plan_enter" | "plan_exit",
  opts: { isError?: boolean; turn?: number } = {},
): SessionEvent[] {
  const turn = opts.turn ?? 1;
  return [
    mk({ type: "turn/start", turn }, seq0),
    mk(
      { type: "tool/call", turn, step: 1, callId: `c-${name}-${seq0}`, name, arguments: "{}" },
      seq0 + 1,
    ),
    mk(
      {
        type: "tool/result",
        turn,
        step: 1,
        callId: `c-${name}-${seq0}`,
        message: { content: "ok", ...(opts.isError ? { isError: true } : {}) },
      },
      seq0 + 2,
    ),
    mk({ type: "turn/end", turn, reason: { kind: "completed" } }, seq0 + 3),
  ];
}

describe("PlanModeService（G1 进出）", () => {
  it("enter/exit 翻转 isActive；重复进出幂等（no-op）", () => {
    const plan = createPlanModeService();
    expect(plan.isActive).toBe(false);
    plan.enter();
    expect(plan.isActive).toBe(true);
    plan.enter(); // 幂等
    expect(plan.isActive).toBe(true);
    plan.exit();
    expect(plan.isActive).toBe(false);
    plan.exit(); // 幂等
    expect(plan.isActive).toBe(false);
  });
});

describe("planModeFromEvents（验收④：进出动作落事件可投影）", () => {
  it("plan_enter 成功结算 → true；后续 plan_exit 成功 → false（整流扫描取最新）", () => {
    const events = [
      ...planToolRound(1, "plan_enter", { turn: 1 }),
      ...planToolRound(5, "plan_exit", { turn: 2 }),
    ];
    expect(planModeFromEvents(events)).toBe(false);
    const events2 = events.slice(0, 4); // 只到 enter 成功
    expect(planModeFromEvents(events2)).toBe(true);
  });

  it("被拒的进出（isError 结果）不改变状态：enter 被拒仍 false、exit 被拒仍 true", () => {
    const rejectedEnter = planToolRound(1, "plan_enter", { isError: true });
    expect(planModeFromEvents(rejectedEnter)).toBe(false);
    const exitRejectedWhileActive = [
      ...planToolRound(1, "plan_enter", { turn: 1 }),
      ...planToolRound(5, "plan_exit", { turn: 2, isError: true }),
    ];
    expect(planModeFromEvents(exitRejectedWhileActive)).toBe(true);
  });

  it("空流 / 无 plan 工具调用 → false（缺省普通模式）", () => {
    expect(planModeFromEvents([])).toBe(false);
    expect(planModeFromEvents([mk({ type: "turn/start", turn: 1 }, 1)])).toBe(false);
  });
});

describe("enforcePlanMode（G7 出口级硬关）", () => {
  /** 用户层 allow 规则链——硬关必须压过它（验收①）。 */
  const userAllowChain = assemblePolicyChain({
    user: [
      createRuleSetModule({
        name: "user-rules",
        rules: loadRules(
          [
            { raw: "bash(echo *)", action: "allow" },
            { raw: "bash(*)", action: "allow" },
          ],
          builtinRuleMatchers,
        ),
        match: loadedRuleMatch(builtinRuleMatchers),
        ruleText: loadedRuleText,
      }),
    ],
  });

  it("验收①：plan 激活时 write/edit/bash/todo_write 一律 deny，用户层 allow 规则压不过", async () => {
    for (const tool of ["write", "edit", "bash", "todo_write"]) {
      const call: PolicyCall = {
        tool,
        args: tool === "bash" ? { command: "echo hi" } : { path: "/w/x.txt" },
      };
      const chainVerdict = await userAllowChain.evaluate(call);
      // bash(echo *) allow 规则链上裁决 allow——出口必须压过来
      if (tool === "bash") expect(chainVerdict.action).toBe("allow");
      const verdict = enforcePlanMode(chainVerdict, call, true);
      expect(verdict.action, tool).toBe("deny");
      expect(verdict.reason, tool).toContain("硬关");
    }
  });

  it("验收②：读类工具不受限（透传链裁决）；plan 进出通道在硬关期间开放", () => {
    for (const tool of ["read", "glob", "grep", "skill_load", "plan_enter", "plan_exit"]) {
      const call: PolicyCall = { tool, args: { path: "/w/x.txt" } };
      const verdict = enforcePlanMode({ action: "allow", reason: "链裁决" }, call, true);
      expect(verdict.action, tool).toBe("allow");
      expect(verdict.reason, tool).toBe("链裁决");
    }
  });

  it("验收③：退出 plan 模式后恢复既有规则裁决（未激活透传）", async () => {
    const call: PolicyCall = { tool: "bash", args: { command: "echo hi" } };
    const chainVerdict = await userAllowChain.evaluate(call);
    expect(chainVerdict.action).toBe("allow");
    expect(enforcePlanMode(chainVerdict, call, false).action).toBe("allow");
  });
});

describe("gate 集成（planMode 活查询）", () => {
  const layerOf = (planMode?: () => boolean) =>
    createToolGateLayer({
      chain: assemblePolicyChain({}),
      broker: new DenyPermissionBroker(),
      sessionId: "s-plan",
      ...(planMode !== undefined ? { planMode } : {}),
    });

  /** 带槽位的 ChainNext（洋葱链 next 契约，gate.test 同款）：到达即失败。 */
  const nextNever = () =>
    Object.assign(
      async () => {
        throw new Error("不应执行到链底");
      },
      { point: "toolCall" as const, trace: Object.freeze([]), budget: Object.freeze({}) },
    );

  const bashPayload = {
    turn: 1,
    step: 1,
    callId: "c1",
    name: "bash",
    arguments: JSON.stringify({ command: "echo hi" }),
  };

  it("plan 激活：bash 直接 deny（TOOL_POLICY_DENIED，不进 broker 不弹审批）", async () => {
    const result = await layerOf(() => true)({} as never, bashPayload as never, nextNever());
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe(TOOL_POLICY_DENIED);
    expect(result.content).toContain("plan 模式硬关");
  });

  it("未启用 planMode（缺省）：同调用走默认 ask → Deny broker 拒——零行为变化", async () => {
    const result = await layerOf(undefined)({} as never, bashPayload as never, nextNever());
    expect(result.isError).toBe(true);
    expect(result.content).not.toContain("plan 模式硬关");
  });
});

describe("注册面与提示词独立文件（验收⑤）", () => {
  const tmpRoots: string[] = [];
  afterEach(() => {
    for (const dir of tmpRoots.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("planMode 提供时注册 plan_enter/plan_exit；缺省不注册（全配置 = BUILTIN_TOOL_NAMES 10）", () => {
    const withPlan = new ToolRegistry();
    registerBuiltinTools(withPlan, { planMode: createPlanModeService() });
    expect(withPlan.names()).toContain("plan_enter");
    expect(withPlan.names()).toContain("plan_exit");
    // todoEmit 未传时 todo_write 不注册（各能力面独立启用）
    expect(withPlan.names()).not.toContain("todo_write");
    expect(withPlan.names()).toHaveLength(9);

    const full = new ToolRegistry();
    registerBuiltinTools(full, {
      todoEmit: () => undefined,
      planMode: createPlanModeService(),
    });
    expect(full.names()).toEqual([...BUILTIN_TOOL_NAMES]);
    expect(BUILTIN_TOOL_NAMES).toHaveLength(10);

    const withoutPlan = new ToolRegistry();
    registerBuiltinTools(withoutPlan);
    expect(withoutPlan.names()).not.toContain("plan_enter");
    expect(withoutPlan.names()).not.toContain("plan_exit");
    expect(withoutPlan.names()).toHaveLength(7); // P0 六工具 + skill_load
  });

  it("提示词独立文件：改 plan_enter.txt 描述即变，零 .ts diff（T-4-01 基建同款）", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plan-desc-"));
    tmpRoots.push(dir);
    writeFileSync(path.join(dir, "plan_enter.txt"), "A 版描述", "utf8");
    writeFileSync(path.join(dir, "plan_exit.txt"), "退出描述", "utf8");
    const registry = new ToolRegistry({ descriptionsDir: dir });
    registerBuiltinTools(registry, { planMode: createPlanModeService() });
    expect(registry.description("plan_enter")).toBe("A 版描述");
    // 改文件零 .ts diff：描述每次直读不缓存，重读即变
    writeFileSync(path.join(dir, "plan_enter.txt"), "B 版描述", "utf8");
    expect(registry.description("plan_enter")).toBe("B 版描述");
  });
});
