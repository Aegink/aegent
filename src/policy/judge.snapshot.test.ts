/**
 * 批次 15b 快照即规格（T-P2-204）——两阶段判官全链一条：
 * 规则不匹配 → 链 abstain → gate ask 分支 → 判官两阶段复核 → abstain →
 * 落回人（PendingApprovals 挂起，人答裁决生效）。盘点面①②③的行为断言
 * 内嵌同链：allow/deny 规则命中时判官零调用（判官只是 ask/abstain 的
 * 修正路径）；参数 JSON 校验先于匹配（坏参数不进规则与判官）；既有拒绝
 * 文本逐字节零变化。环内细节断言在各自套件（param-matchers / denial /
 * judge / gate），本文件钉**环与环之间**的接缝。
 */

import { describe, expect, it } from "vitest";

import type { ChainNext } from "../kernel/chain.js";
import type { ToolCallPayload, ToolExecutionResult } from "../core/primitives/loop/loop.js";
import type { ChatRequest, ModelProvider } from "../models/provider.js";
import type { StreamChunk } from "../kernel/events.js";
import { modelIdentity } from "../models/identity.js";
import { ManualPermissionBroker } from "./broker.js";
import { PendingApprovals } from "./pending.js";
import { createToolGateLayer } from "./gate.js";
import { createLlmJudge, type JudgeAuditRecord } from "./judge.js";
import { JudgeBudgetTracker } from "./judge-port.js";
import { loadedRuleDenial, loadedRuleMatch, loadRules } from "./rule-loader.js";
import { createRuleSetModule } from "./rules.js";
import { assemblePolicyChain } from "./chain.js";
import { builtinRuleMatchers } from "./matchers.js";

// ---------------------------------------------------------------------------
// 装配：规则面（allow/deny/无规则三分）+ 两阶段判官（脚本机）+ 真审批通道
// ---------------------------------------------------------------------------

const judgeAbortErr = (): Error =>
  Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

function makeSnapshotHarness(stageResponses: string[]) {
  const providerCalls: ChatRequest[] = [];
  let callIndex = 0;
  const provider: ModelProvider = {
    async *streamChat(req: ChatRequest): AsyncIterable<StreamChunk> {
      providerCalls.push(req);
      const text = stageResponses[callIndex] ?? "";
      callIndex++;
      if (req.signal?.aborted === true) throw judgeAbortErr();
      yield { type: "text-delta", text };
      yield { type: "done" };
    },
  };
  const judgeAudit: JudgeAuditRecord[] = [];
  const judge = createLlmJudge({
    provider,
    identity: modelIdentity("mock", "judge-fast"),
    audit: (r) => judgeAudit.push(r),
  });
  const rules = loadRules(
    [
      { raw: "bash(git status)", action: "allow" },
      {
        raw: "bash(rm *)",
        action: "deny",
        justification: "防误删工作区",
        alternatives: ["用 apply_patch 改文件"],
      },
      { raw: "bash(whoami)", action: "deny" }, // 无声明——既有拒绝文本形状
    ],
    builtinRuleMatchers,
  );
  const pending = new PendingApprovals();
  const broker = new ManualPermissionBroker(pending, 5_000);
  const received: ToolCallPayload[] = [];
  const layer = createToolGateLayer({
    chain: assemblePolicyChain({
      user: [
        createRuleSetModule({
          name: "user-rules",
          rules,
          match: loadedRuleMatch(),
          ruleText: (r) => r.raw,
          ruleDenial: loadedRuleDenial,
        }),
      ],
    }),
    broker,
    sessionId: "s1",
    judge,
    judgeBudget: new JudgeBudgetTracker(),
  });
  const next = Object.assign(
    async (e2: ToolCallPayload): Promise<ToolExecutionResult> => {
      received.push(e2);
      return { content: `executed ${e2.name}` };
    },
    { point: "toolCall" as const, trace: Object.freeze([]), budget: Object.freeze({}) },
  ) satisfies ChainNext<ToolCallPayload, ToolExecutionResult>;
  const call = (command: string, callId: string): ToolCallPayload => ({
    turn: 1,
    step: 1,
    callId,
    name: "bash",
    arguments: JSON.stringify({ command }),
  });
  return { layer, next, received, pending, providerCalls, judgeAudit, call };
}

async function waitUntilRegistered(pending: PendingApprovals): Promise<string> {
  const start = Date.now();
  for (;;) {
    const list = pending.listPending();
    if (list.length > 0) return list[0]!.id;
    if (Date.now() - start > 2_000) throw new Error("审批请求未挂起");
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe("15b 快照 · 两阶段判官全链（规则 → 判官 → abstain → 落回人）", () => {
  it("快照：git push 无规则命中 → 判官 risky→abstain → 挂起等人 → 人答 deny 生效", async () => {
    const h = makeSnapshotHarness([
      "risky",
      "<verdict>abstain</verdict><reason>无法确定强推影响</reason>",
    ]);
    const pendingResult = h.layer({ sessionId: "s1" }, h.call("git push --force", "c1"), h.next);
    const requestId = await waitUntilRegistered(h.pending);
    // 挂起的是剥过提案字段的参数（人看得见原调用事实）
    expect(h.pending.listPending()[0]).toMatchObject({ tool: "bash" });
    await h.pending.reply(requestId, { action: "deny", reason: "不要强推" });
    const result = await pendingResult;
    // 判官两阶段被调用（Stage1 risky → Stage2 abstain），审计在案
    expect(h.providerCalls).toHaveLength(2);
    expect(h.judgeAudit).toEqual([
      expect.objectContaining({
        kind: "judge",
        phase: "reviewed",
        outcome: "abstain",
        stage: "review",
        model: "mock:judge-fast",
      }),
    ]);
    // abstain 落回人：人答 deny → 类型化拒绝（原询问 + 审批理由合成）
    expect(result.isError).toBe(true);
    expect(result.content).toContain("审批拒绝：不要强推");
    expect(h.received).toHaveLength(0); // 全程未执行
  });

  it("盘点①：allow/deny 规则命中时判官零调用（判官只是 ask/abstain 的修正路径）", async () => {
    const h = makeSnapshotHarness(["safe"]); // 判官若被调只会看到这份脚本
    const allowed = await h.layer({ sessionId: "s1" }, h.call("git status", "c1"), h.next);
    expect(allowed).toEqual({ content: "executed bash" });
    const denied = await h.layer({ sessionId: "s1" }, h.call("rm -rf /", "c2"), h.next);
    expect(denied.isError).toBe(true);
    expect(denied.content).toContain("规则理由：防误删工作区");
    expect(denied.content).toContain("1. 用 apply_patch 改文件");
    expect(h.providerCalls).toHaveLength(0); // 判官全程未被咨询
    expect(h.judgeAudit).toEqual([]);
    expect(h.received).toHaveLength(1); // 只有 allow 的执行了
  });

  it("盘点②：参数 JSON 校验先于匹配（坏参数不进规则与判官——交 registry 类型化报错）", async () => {
    const h = makeSnapshotHarness(["safe"]);
    const bad: ToolCallPayload = {
      turn: 1,
      step: 1,
      callId: "c1",
      name: "bash",
      arguments: "不是 JSON",
    };
    const result = await h.layer({ sessionId: "s1" }, bad, h.next);
    // evaluateToolPolicy 解析失败返回 null → gate 原样放行给链底（registry
    // 对坏参数报 TOOL_ARGUMENTS_INVALID——本 harness 的 next 即哨兵）
    expect(h.received).toHaveLength(1); // 原载荷直达链底
    expect(h.providerCalls).toHaveLength(0);
    expect(h.judgeAudit).toEqual([]);
  });

  it("盘点③：无声明 deny 规则的既有拒绝文本逐字节零变化", async () => {
    const h = makeSnapshotHarness(["safe"]);
    const result = await h.layer({ sessionId: "s1" }, h.call("whoami", "c1"), h.next);
    expect(result.isError).toBe(true);
    expect(result.content).toBe(
      "被权限策略拒绝：策略模块 user-rules 裁决为 deny（依规则 bash(whoami)）",
    );
    expect(h.providerCalls).toHaveLength(0);
  });
});
