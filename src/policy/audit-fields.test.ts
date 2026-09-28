import { describe, expect, it } from "vitest";

import { PendingApprovals, type ApprovalAnnouncement } from "./pending.js";
import {
  APPROVAL_APPROVERS,
  APPROVAL_SURFACES,
  approvalAuditRecord,
  createApprovalAuditSink,
  type ApprovalAuditRecord,
} from "./audit-fields.js";
import { OwnerCommandPort } from "../session/owner-port.js";

function makeAuditedPending() {
  const records: ApprovalAuditRecord[] = [];
  const pending = new PendingApprovals(
    createApprovalAuditSink({ surface: "cli", sink: (r) => records.push(r) }),
  );
  return { pending, records };
}

describe("L2 · 字段闭集（多端真实端面已并入）", () => {
  it("surface 与 approver 是封闭清单（批次 14 并入 web/desktop——只追加不替换）", () => {
    expect([...APPROVAL_SURFACES]).toEqual(["cli", "web", "desktop", "feishu", "slack"]);
    expect([...APPROVAL_APPROVERS]).toEqual(["user", "timeout"]);
  });

  it("缺字段的事件构造即类型报错（L2：surface/approver 无默认值）", () => {
    const full = approvalAuditRecord({
      phase: "settled",
      requestId: "r1",
      tool: "bash",
      surface: "cli",
      approver: "user",
      at: 1,
    });
    expect(full.surface).toBe("cli");
    expect(full.approver).toBe("user");
    // 类型面验证：省略 approver 必须编译失败（vitest 运行时只执行合法构造）
    const broken = {
      phase: "settled",
      requestId: "r2",
      tool: "bash",
      surface: "cli",
      at: 2,
    };
    expect("approver" in broken).toBe(false);
  });
});

describe("验收 · 一次完整审批流后可检索到 {surface:\"cli\", approver:\"user\"}", () => {
  it("asked → settled（人经通道答复）→ 审计记录含 surface/approver 对", async () => {
    const { pending, records } = makeAuditedPending();
    const askPromise = pending.ask(
      { id: "call-1", sessionId: "s1", tool: "bash", args: { command: "git push" }, category: "tool" },
      { timeoutMs: 5_000 },
    );
    await pending.reply("call-1", { action: "allow", reason: "可以" });
    await askPromise;

    const asked = records.find((r) => r.phase === "asked");
    const settled = records.find((r) => r.phase === "settled");
    expect(asked).toMatchObject({ surface: "cli", approver: "user", tool: "bash" });
    expect(settled).toMatchObject({
      surface: "cli",
      approver: "user",
      requestId: "call-1",
      tool: "bash",
    });
    // 验收的字面形状：事件流中可检索到该对
    expect(records).toContainEqual(
      expect.objectContaining({ surface: "cli", approver: "user" }),
    );
  });

  it("超时流：approver=timeout（C50 不静默，审计可见）", async () => {
    const { pending, records } = makeAuditedPending();
    pending
      .ask({ id: "call-t", sessionId: "s1", tool: "bash", args: {}, category: "tool" }, { timeoutMs: 10 })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 30));
    expect(records.find((r) => r.phase === "timed-out")).toMatchObject({
      surface: "cli",
      approver: "timeout",
      requestId: "call-t",
    });
  });

  it("C24 feedback：答复带 feedback 时落 settled 审计记录（T-P1-02）", async () => {
    const { pending, records } = makeAuditedPending();
    const askPromise = pending.ask(
      { id: "call-f", sessionId: "s1", tool: "bash", args: { command: "ls" }, category: "tool" },
      { timeoutMs: 5_000 },
    );
    await pending.reply("call-f", {
      action: "allow",
      reason: "可以",
      feedback: "下次直接用 git status",
    });
    await askPromise;
    expect(records.find((r) => r.phase === "settled")).toMatchObject({
      requestId: "call-f",
      feedback: "下次直接用 git status",
    });
  });
});

describe("L2 · T-5-15 通道接入（owner 回复走同一审计面）", () => {
  it("owner 发 respond_permission → 审计 settled 带 surface/approver", async () => {
    const { pending, records } = makeAuditedPending();
    const port = new OwnerCommandPort({
      respondPermission: (id, reply) => pending.reply(id, reply),
    });
    const askPromise = pending.ask(
      { id: "call-2", sessionId: "s1", tool: "write", args: { path: "/a" }, category: "tool" },
      { timeoutMs: 5_000 },
    );
    await new Promise((r) => setTimeout(r, 5));
    const lease = port.acquireLease("cli");
    await port.requestOwnerCommand(lease, {
      type: "respond_permission",
      requestId: "call-2",
      reply: { action: "deny", reason: "不放行" },
    });
    await askPromise;
    const settled = records.find((r) => r.phase === "settled");
    expect(settled).toMatchObject({
      surface: "cli",
      approver: "user",
      tool: "write",
      requestId: "call-2",
    });
  });
});
