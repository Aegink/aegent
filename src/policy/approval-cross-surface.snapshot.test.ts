/**
 * 快照即规格（T-P1-84 收口⑦）：审批跨端回转全链一条——
 * 桌面（A 端）发起审批（gate ask 挂起）→ 审批权随 lease 移交 →
 * 飞书（B 端）答复（source 端标识）→ 桌面在途调用继续执行 →
 * 答复来源落宣告与审计。C6 场景③的进程内规格（多端并发 holder 归 N7）。
 */

import { describe, expect, it } from "vitest";

import type { ChainNext } from "../kernel/chain.js";
import type { ToolCallPayload, ToolExecutionResult } from "../core/primitives/loop/loop.js";
import { DenyPermissionBroker, ManualPermissionBroker } from "./broker.js";
import { createToolGateLayer } from "./gate.js";
import { assemblePolicyChain } from "./chain.js";
import { builtinRuleMatchers } from "./matchers.js";
import { loadedRuleMatch, loadRules } from "./rule-loader.js";
import { createRuleSetModule } from "./rules.js";
import { createApprovalAuditSink, type ApprovalAuditRecord } from "./audit-fields.js";
import { OwnerCommandPort, NotLeaseHolderError } from "../session/owner-port.js";
import { PendingApprovals } from "./pending.js";

describe("快照 · 审批跨端回转全链（C6 场景③ · T-P1-84）", () => {
  it("A 端挂起 → lease 移交 → B 端 source 答复 → 在途继续执行 → 审计留痕，全链一条", async () => {
    // —— 审计面 + 挂起注册表 + gate（ask 规则）+ owner 通道 ——
    const records: ApprovalAuditRecord[] = [];
    const audit = createApprovalAuditSink({
      surface: "cli",
      sink: (r) => records.push(r),
    });
    const pending = new PendingApprovals(audit);
    const broker = new ManualPermissionBroker(pending, 60_000);
    void broker;
    const rules = loadRules([{ raw: "bash(git *)", action: "ask" }], builtinRuleMatchers);
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
    });
    const port = new OwnerCommandPort({
      respondPermission: (requestId, reply) => pending.reply(requestId, reply),
    });

    const next = ((e2: ToolCallPayload) =>
      Promise.resolve({ content: `executed ${JSON.parse(e2.arguments).command as string}` })) as unknown as ChainNext<ToolCallPayload, ToolExecutionResult>;
    (
      next as unknown as { point: string; trace: readonly string[]; budget: Readonly<Record<string, never>> }
    ).point = "toolCall";
    (
      next as unknown as { point: string; trace: readonly string[]; budget: Readonly<Record<string, never>> }
    ).trace = Object.freeze([]);
    (
      next as unknown as { point: string; trace: readonly string[]; budget: Readonly<Record<string, never>> }
    ).budget = Object.freeze({});

    // ① 桌面（A 端）发起：bash git push 命中 ask 规则 → 挂起（在途）
    const leaseA = port.acquireLease("desktop");
    const inFlight = layer(
      { sessionId: "s1" },
      { turn: 1, step: 1, callId: "snap-1", name: "bash", arguments: JSON.stringify({ command: "git push" }) },
      next,
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(pending.listPending().map((r) => r.id)).toEqual(["snap-1"]);

    // ② 审批权随 lease 移交（A 释放 → B 获取）；A 旧句柄答复被拒
    leaseA.release();
    const leaseB = port.acquireLease("feishu");
    await expect(
      port.requestOwnerCommand(leaseA, {
        type: "respond_permission",
        requestId: "snap-1",
        reply: { action: "deny" },
      }),
    ).rejects.toThrow(NotLeaseHolderError);

    // ③ 飞书（B 端）答复（source 端标识）
    await port.requestOwnerCommand(leaseB, {
      type: "respond_permission",
      requestId: "snap-1",
      reply: { action: "allow", source: "feishu" },
    });

    // ④ 桌面在途调用继续（gate 解除挂起 → 工具执行）
    const result = await inFlight;
    expect(result).toEqual({ content: "executed git push" });

    // ⑤ 答复来源全链可审计：asked（等 user）→ settled（approver=user，replySource=feishu）
    expect(records.map((r) => r.phase)).toEqual(["asked", "settled"]);
    expect(records[1]).toMatchObject({
      phase: "settled",
      requestId: "snap-1",
      approver: "user",
      replySource: "feishu",
    });
  });

  it("反例：跨端不等于越权——B 端答复也只能在挂起面转达，deny 路径与 A 端同语义", async () => {
    const pending = new PendingApprovals();
    const port = new OwnerCommandPort({
      respondPermission: (requestId, reply) => pending.reply(requestId, reply),
    });
    port.acquireLease("desktop").release();
    const leaseB = port.acquireLease("feishu");
    const hanging = pending.ask(
      { id: "snap-2", sessionId: "s1", tool: "bash", args: {}, category: "tool" },
      { timeoutMs: 5_000 },
    );
    await port.requestOwnerCommand(leaseB, {
      type: "respond_permission",
      requestId: "snap-2",
      reply: { action: "deny", reason: "B 端拒绝", source: "feishu" },
    });
    expect(await hanging).toMatchObject({ action: "deny", reason: "B 端拒绝" });
  });
});
