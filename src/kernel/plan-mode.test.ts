/**
 * plan 模式测试（G1/G7/G4，T-P1-11/13）——服务进出幂等 / 流重建（验收④：
 * 进出动作落事件可投影——tool/call+result 即事实，不扩词汇表）/ 出口级
 * 硬关（验收①规则压不过、②读类不限、③退出恢复）/ gate 集成（激活时
 * bash 不进 broker 直接拒）/ 注册面与提示词独立文件（验收⑤零 .ts diff）/
 * G4 计划 artifact（批准退出落盘 + 重启可读 + 与 E11 代码 checkpoint 互不
 * 干扰）。CLI 级联测（审批进出 + 硬关端到端）在 cli.test.ts。
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { NewSessionEvent, SessionEvent } from "./events.js";
import {
  createPlanModeService,
  planArtifactFromEvents,
  planModeFromEvents,
  savePlanArtifact,
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
import { createNetworkGuard } from "../sandbox/network.js";
import { PendingApprovals } from "../policy/pending.js";
import { createChildAssembly } from "./assembly.js";
import { InMemoryEventStorage, SessionStore } from "../session/store.js";
import {
  GitCheckpointService,
  createGitRunner,
} from "../session/git-checkpoint.js";

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
        match: loadedRuleMatch(),
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

  it("planMode 提供时注册 plan_enter/plan_exit；缺省不注册（全配置 = BUILTIN_TOOL_NAMES 19）", () => {
    const withPlan = new ToolRegistry();
    registerBuiltinTools(withPlan, { planMode: createPlanModeService() });
    expect(withPlan.names()).toContain("plan_enter");
    expect(withPlan.names()).toContain("plan_exit");
    // todoEmit 未传时 todo_write 不注册（各能力面独立启用）
    expect(withPlan.names()).not.toContain("todo_write");
    // networkGuard 未传时 webfetch 不注册（同款能力面绑定装配）
    expect(withPlan.names()).not.toContain("webfetch");
    expect(withPlan.names()).toHaveLength(13);

    const full = new ToolRegistry();
    registerBuiltinTools(full, {
      todoEmit: () => undefined,
      planMode: createPlanModeService(),
      // BUILTIN_TOOL_NAMES 是"可注册清单"（webfetch/question/task/session_*
      // 随装配条件注册）——全集等价断言需带齐各能力面的装配件
      networkGuard: createNetworkGuard({ policy: "deny" }),
      question: {
        pending: new PendingApprovals(),
        sessionId: "s-full",
        timeoutMs: 1_000,
      },
      task: { runSubagent: async () => ({ kind: "foreground", result: { sessionId: "x", stopReason: "completed", output: "" } }) },
      // Q2/T-P2-105：会话查询工具（dbPath 提供才注册——注册面不打开库，
      // 任意非空路径即可）
      sessionQuery: { dbPath: "unused-plan-mode-names.sqlite" },
    });
    expect(full.names()).toEqual([...BUILTIN_TOOL_NAMES]);
    expect(BUILTIN_TOOL_NAMES).toHaveLength(19);

    const withoutPlan = new ToolRegistry();
    registerBuiltinTools(withoutPlan);
    expect(withoutPlan.names()).not.toContain("plan_enter");
    expect(withoutPlan.names()).not.toContain("plan_exit");
    expect(withoutPlan.names()).toHaveLength(11); // P0 六工具 + skill_load + tool_load + pwsh
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

describe("G4 · 计划 artifact（T-P1-13）", () => {
  const tmpRoots: string[] = [];
  afterEach(() => {
    for (const dir of tmpRoots.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** 带计划落盘能力的完整装配 + 手工工具注册表（生产接线的装配级等价）。 */
  function makePlanHarness(store: SessionStore, artifactDir: string) {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "aegent-planart-"));
    tmpRoots.push(workspaceRoot);
    const assembly = createChildAssembly({
      sessionId: "s-plan-art",
      store,
      workspaceRoot,
      contextWindow: 200_000,
      approvalTimeoutMs: 5_000,
      planMode: true,
      planArtifactDir: artifactDir,
    });
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      ...(assembly.planMode ? { planMode: assembly.planMode } : {}),
      ...(assembly.savePlanArtifact ? { savePlanArtifact: assembly.savePlanArtifact } : {}),
    });
    return { assembly, registry };
  }

  it("验收①：plan_exit 批准提交计划 → artifact 落盘 + checkpoint 事件，重启后可读", async () => {
    const store = new SessionStore();
    const artifactDir = mkdtempSync(path.join(tmpdir(), "aegent-plan-dir-"));
    tmpRoots.push(artifactDir);
    const { registry } = makePlanHarness(store, artifactDir);
    store.append("s-plan-art", [{ type: "turn/start", turn: 1 }]);
    const result = await registry.dispatch({
      callId: "c-exit",
      name: "plan_exit",
      arguments: JSON.stringify({ plan: "# 实施计划\n1. 落词汇表\n2. 收官" }),
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("计划已落盘");
    // 流内 checkpoint{provider:"plan"} 记路径，重启后按流找回并读取
    const artifactPath = planArtifactFromEvents(store.load("s-plan-art"));
    expect(artifactPath).not.toBeNull();
    expect(readFileSync(artifactPath!, "utf8")).toContain("2. 收官");
    // 重启等价：同 store 新装配（流内 plan 模式事实已随 plan_exit 结算关闭）
    expect(planModeFromEvents(store.load("s-plan-art"))).toBe(false);
    expect(existsSync(artifactPath!)).toBe(true);
  });

  it("无 planArtifactDir：plan 参数不落盘（仅随工具结果可见），不记 plan checkpoint", async () => {
    const store = new SessionStore();
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "aegent-planart-"));
    tmpRoots.push(workspaceRoot);
    const assembly = createChildAssembly({
      sessionId: "s-plan-noart",
      store,
      workspaceRoot,
      contextWindow: 200_000,
      approvalTimeoutMs: 5_000,
      planMode: true,
    });
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, { planMode: assembly.planMode! });
    store.append("s-plan-noart", [{ type: "turn/start", turn: 1 }]);
    const result = await registry.dispatch({
      callId: "c-exit",
      name: "plan_exit",
      arguments: JSON.stringify({ plan: "只存在于会话流的计划" }),
    });
    expect(result.content).toContain("计划未落盘");
    expect(planArtifactFromEvents(store.load("s-plan-noart"))).toBeNull();
  });

  it("验收③：计划 artifact 与代码 checkpoint（E11）互不干扰——/revert 代码回退不动 artifact", async () => {
    const repo = mkdtempSync(path.join(tmpdir(), "aegent-plan-git-"));
    tmpRoots.push(repo);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    writeFileSync(path.join(repo, "baseline.txt"), "改前", "utf8");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"],
      { cwd: repo },
    );
    const artifactDir = mkdtempSync(path.join(tmpdir(), "aegent-plan-dir-"));
    tmpRoots.push(artifactDir);
    const store = new SessionStore();
    const checkpoint = new GitCheckpointService({
      sessionId: "s-plan-git",
      store,
      runGit: createGitRunner(repo),
      onWarn: () => undefined,
    });
    // 轮开始前打点（E11）→ plan_exit 落 artifact（untracked 新文件）
    await checkpoint.capture(1);
    const written = savePlanArtifact(artifactDir, "s-plan-git", "重启后仍要可读的计划");
    // 代码回退（/revert 的 E11 路径）：stash apply 只还原跟踪文件
    await checkpoint.restoreCodeTo(store.load("s-plan-git")[0]!.seq);
    // artifact 仍在且内容不变——两套 checkpoint 互不干扰
    expect(readFileSync(written.path, "utf8")).toBe("重启后仍要可读的计划");
  });

  it("planArtifactFromEvents：无 plan checkpoint → null；provider 其他值不误读", () => {
    const mk = (event: NewSessionEvent, seq: number): SessionEvent =>
      ({ ...event, seq, ts: 0 } as SessionEvent);
    const events = [
      mk({ type: "checkpoint", turn: 1, provider: "git", ref: { commit: "abc" } }, 1),
      mk({ type: "checkpoint", turn: 1, provider: "plan", ref: { path: "/p/plan.md" } }, 2),
    ];
    expect(planArtifactFromEvents(events)).toBe("/p/plan.md");
    expect(planArtifactFromEvents([events[0]!])).toBeNull();
    expect(planArtifactFromEvents([])).toBeNull();
  });
});
