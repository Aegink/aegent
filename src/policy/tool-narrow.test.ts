/**
 * W13a/T9-3 验收：工具级元数据收窄接入（needsApproval 强制人审 /
 * prepareApproval 只可收窄 / riskLevel 透传决策面）。G7 fail-closed 不破
 * ——deny/ask 判定不受预检面影响（工具不能给自己放行）。
 */
import { describe, expect, it } from "vitest";

import type { ChainNext } from "../core/index.js";
import type { ToolCallPayload, ToolExecutionResult } from "../core/index.js";
import type { JsonRecord } from "../core/index.js";
import { DenyPermissionBroker, ManualPermissionBroker } from "./broker.js";
import { PendingApprovals, type ApprovalRequest } from "./pending.js";
import { createToolGateLayer } from "./gate.js";
import { assemblePolicyChain } from "./chain.js";
import { builtinRuleMatchers } from "./matchers.js";
import { loadRules } from "./rule-loader.js";
import { createRuleSetModule } from "./rules.js";
import { loadedRuleMatch } from "./rule-match.js";

const payload = (args: JsonRecord, callId = "c1", name = "bash"): ToolCallPayload => ({
  turn: 1,
  step: 1,
  callId,
  name,
  arguments: JSON.stringify(args),
});

function makeNext(
  fn: (e2: ToolCallPayload) => Promise<ToolExecutionResult>,
): ChainNext<ToolCallPayload, ToolExecutionResult> {
  return Object.assign(fn, {
    point: "toolCall" as const,
    trace: Object.freeze([]),
    budget: Object.freeze({}),
  });
}

interface HarnessOptions {
  needsApproval?: boolean;
  riskLevel?: "low" | "medium" | "high";
  prepare?: (args: JsonRecord) => { deny?: string } | undefined;
  rule?: readonly ["allow" | "ask" | "deny", string];
}

function makeHarness(options: HarnessOptions = {}) {
  const entries = options.rule !== undefined ? [options.rule] : [];
  const rules = loadRules(
    entries.map(([action, raw]) => ({ raw, action })),
    builtinRuleMatchers,
  );
  const received: ToolCallPayload[] = [];
  const seenRequests: ApprovalRequest[] = [];
  const pending = new PendingApprovals(() => {});
  const layer = createToolGateLayer({
    chain: assemblePolicyChain({
      user: [
        createRuleSetModule({
          name: "user-rules",
          rules,
          match: loadedRuleMatch(),
          ruleText: (rule) => rule.raw,
        }),
      ],
    }),
    broker: new ManualPermissionBroker(pending, 60_000),
    sessionId: "s1",
    toolMetadata: () => ({
      ...(options.needsApproval !== undefined ? { needsApproval: options.needsApproval } : {}),
      ...(options.riskLevel !== undefined ? { riskLevel: options.riskLevel } : {}),
    }),
    ...(options.prepare !== undefined ? { prepareApprovalFor: () => options.prepare } : {}),
  });
  const next = makeNext(async (e2) => {
    received.push(e2);
    return { content: `executed ${e2.name}` };
  });
  return { layer, next, received, pending, seenRequests };
}

describe("工具级收窄接入（W13a/T9-3——只可收窄）", () => {
  it("needsApproval=true：规则 allow 也收窄为 ask（声明强制人审）", async () => {
    const h = makeHarness({ needsApproval: true, rule: ["allow", "bash(git status)"] });
    const result = h.layer({ sessionId: "s1" }, payload({ command: "git status" }), h.next);
    // 落 ask：next 未执行；审批请求挂起（带 riskLevel 透传）
    const settled: ToolExecutionResult[] = [];
    void Promise.resolve(result).then((r: ToolExecutionResult) => settled.push(r));
    await new Promise((r) => setTimeout(r, 30));
    expect(h.received).toHaveLength(0);
    expect(settled).toHaveLength(0);
    expect(h.pending.listPending().some((req) => req.tool === "bash")).toBe(true);
    h.pending.reply(h.pending.listPending()[0]!.id, { action: "allow" });
    expect((await result).content).toBe("executed bash");
  });

  it("needsApproval 缺省：allow 规则直通（零行为变化）", async () => {
    const h = makeHarness({ rule: ["allow", "bash(git status)"] });
    const result = await h.layer({ sessionId: "s1" }, payload({ command: "git status" }), h.next);
    expect(result).toEqual({ content: "executed bash" });
    expect(h.received).toHaveLength(1);
  });

  it("prepareApproval deny：allow 收窄为拒绝（预检拒绝面）", async () => {
    const h = makeHarness({
      rule: ["allow", "bash(git push*)"],
      prepare: (args) =>
        String((args as { command?: string }).command).includes("--force")
          ? { deny: "prepareApproval 禁止 force push" }
          : undefined,
    });
    const denied = await h.layer(
      { sessionId: "s1" },
      payload({ command: "git push --force" }),
      h.next,
    );
    expect(denied.isError).toBe(true);
    expect(denied.content).toContain("prepareApproval 禁止 force push");
    expect(h.received).toHaveLength(0);
    // 非 force 调用不收窄——放行
    const allowed = await h.layer(
      { sessionId: "s1" },
      payload({ command: "git push origin main" }),
      h.next,
    );
    expect(allowed).toEqual({ content: "executed bash" });
    expect(h.received).toHaveLength(1);
  });

  it("收窄绝不放宽：deny 规则 + prepare 无意见 → 仍拒绝", async () => {
    const h = makeHarness({
      rule: ["deny", "bash(rm *)"],
      prepare: () => undefined,
    });
    const result = await h.layer({ sessionId: "s1" }, payload({ command: "rm -rf /" }), h.next);
    expect(result.isError).toBe(true);
    expect(h.received).toHaveLength(0);
  });

  it("riskLevel 透传审批请求（决策面粗档标尺）", async () => {
    const h = makeHarness({ riskLevel: "high", rule: ["ask", "bash(*)"] });
    const result = h.layer({ sessionId: "s1" }, payload({ command: "anything" }), h.next);
    await new Promise((r) => setTimeout(r, 30));
    const pendingRequest = h.pending.listPending().find((req) => req.tool === "bash");
    expect(pendingRequest?.riskLevel).toBe("high");
    h.pending.reply(pendingRequest!.id, { action: "allow" });
    await result;
  });
});

// DenyPermissionBroker 引用保活（fail-closed 对照面——缺省 broker 路径由
// gate.test 覆盖，此处不重复）
void DenyPermissionBroker;
