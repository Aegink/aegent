import { describe, expect, it } from "vitest";

import type { Verdict } from "./decision.js";
import { createApprovalAuditSink, type ApprovalAuditRecord } from "./audit-fields.js";
import { NotLeaseHolderError, OwnerCommandPort } from "../session/owner-port.js";
import {
  DuplicateApprovalError,
  PERMISSION_REPLY_STALE,
  PERMISSION_TIMEOUT,
  PendingApprovals,
  PermissionTimeout,
  StaleApprovalError,
  UnknownApprovalError,
  APPROVAL_CATEGORIES,
  APPROVAL_CATEGORY_CLOSED,
  type ApprovalAnnouncement,
  ApprovalReplyMalformedError,
  type ApprovalRequest,
} from "./pending.js";

function makeRequest(id: string): ApprovalRequest {
  return { id, sessionId: "s1", tool: "Bash", args: { command: "rm -rf /x" }, category: "tool" };
}

/** 收集宣告事实（C31：所有界面都能看到的广播，测试即第一个消费方）。 */
function makeRegistry() {
  const announcements: ApprovalAnnouncement[] = [];
  const registry = new PendingApprovals((a) => announcements.push(a));
  return { registry, announcements };
}

describe("C5 · 发起端 suspend，reply 唤醒", () => {
  it("ask 挂起期间请求可见，reply 后以裁决 resolve 继续往下走", async () => {
    const { registry, announcements } = makeRegistry();
    const pending = registry.ask(makeRequest("call-1"), { timeoutMs: 5_000 });

    // suspend：promise 未决、请求可列举（界面能看到）
    let settled: Verdict | undefined;
    pending.then((v) => (settled = v));
    await Promise.resolve(); // 让 then 回调有机会跑（若已决）
    expect(settled).toBeUndefined();
    expect(registry.listPending().map((r) => r.id)).toEqual(["call-1"]);
    expect(announcements.map((a) => a.kind)).toEqual(["asked"]);

    await registry.reply("call-1", { action: "allow" });
    expect(await pending).toEqual({ action: "allow", reason: "审批人放行" });
    expect(registry.listPending()).toEqual([]);
    expect(announcements.map((a) => a.kind)).toEqual(["asked", "settled"]);
  });

  it("deny 答复透传自定义理由，缺省给默认理由", async () => {
    const { registry } = makeRegistry();
    const pending = registry.ask(makeRequest("call-2"), { timeoutMs: 5_000 });
    await registry.reply("call-2", { action: "deny", reason: "太危险" });
    expect(await pending).toEqual({ action: "deny", reason: "太危险" });

    const pending2 = registry.ask(makeRequest("call-3"), { timeoutMs: 5_000 });
    await registry.reply("call-3", { action: "deny" });
    expect(await pending2).toMatchObject({ action: "deny" });
  });

  it("并发多请求互不串扰：各自 reply 各自唤醒", async () => {
    const { registry } = makeRegistry();
    const a = registry.ask(makeRequest("a"), { timeoutMs: 5_000 });
    const b = registry.ask(makeRequest("b"), { timeoutMs: 5_000 });
    await registry.reply("b", { action: "deny" });
    await registry.reply("a", { action: "allow" });
    expect(await a).toMatchObject({ action: "allow" });
    expect(await b).toMatchObject({ action: "deny" });
  });

  it("同 id 重复发起同步抛 Duplicate（挂起中或已结算都算）", async () => {
    const { registry } = makeRegistry();
    const pending = registry.ask(makeRequest("call-1"), { timeoutMs: 5_000 });
    expect(() => registry.ask(makeRequest("call-1"), { timeoutMs: 5_000 })).toThrow(
      DuplicateApprovalError,
    );
    await registry.reply("call-1", { action: "allow" });
    expect(() => registry.ask(makeRequest("call-1"), { timeoutMs: 5_000 })).toThrow(
      DuplicateApprovalError,
    );
    await pending;
  });
});

describe("C50 · 超时带类型失败", () => {
  it("超时 reject 的是 PermissionTimeout，不是 resolve、不是泛 Error", async () => {
    const { registry, announcements } = makeRegistry();
    const pending = registry.ask(makeRequest("call-t"), { timeoutMs: 10 });

    const error = await pending.then(
      () => {
        throw new Error("不该 resolve");
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PermissionTimeout);
    expect(error).toBeInstanceOf(Error);
    const timeout = error as PermissionTimeout;
    expect(timeout.code).toBe(PERMISSION_TIMEOUT);
    expect(timeout.requestId).toBe("call-t");
    expect(timeout.timeoutMs).toBe(10);
    // C31：超时不静默——timed-out 宣告发出
    expect(announcements.map((a) => a.kind)).toEqual(["asked", "timed-out"]);
  });

  it("超时后请求移出挂起名单", async () => {
    const { registry } = makeRegistry();
    registry.ask(makeRequest("call-t2"), { timeoutMs: 10 }).catch(() => {});
    // 轮询等待而非固定 sleep：并行负载下 10ms 计时器可能晚点
    const start = Date.now();
    while (registry.listPending().length > 0) {
      if (Date.now() - start > 2_000) throw new Error("超时未移出挂起名单");
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(registry.listPending()).toEqual([]);
  });
});

describe("C31 · 迟到 reply 落在已结算请求上", () => {
  it("落在已超时请求上抛 Stale 错误并标明结算方式", async () => {
    const { registry } = makeRegistry();
    const pending = registry.ask(makeRequest("call-late"), { timeoutMs: 10 });
    await pending.catch(() => {}); // 等它超时
    await expect(registry.reply("call-late", { action: "allow" })).rejects.toThrow(
      StaleApprovalError,
    );
    const error = await registry
      .reply("call-late", { action: "allow" })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect((error as StaleApprovalError).code).toBe(PERMISSION_REPLY_STALE);
    expect((error as StaleApprovalError).settledWith).toBe("timeout");
  });

  it("落在已答复请求上同样 stale（settledWith=reply）", async () => {
    const { registry } = makeRegistry();
    const pending = registry.ask(makeRequest("call-once"), { timeoutMs: 5_000 });
    await registry.reply("call-once", { action: "allow" });
    await pending;
    const error = await registry
      .reply("call-once", { action: "deny" })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(StaleApprovalError);
    expect((error as StaleApprovalError).settledWith).toBe("reply");
  });

  it("从未存在的 id 抛 Unknown 而非 Stale", async () => {
    const { registry } = makeRegistry();
    await expect(registry.reply("nope", { action: "allow" })).rejects.toThrow(
      UnknownApprovalError,
    );
  });
});

describe("dispose（会话关闭：不悬挂 promise，不静默结算）", () => {
  it("未决请求全部按超时语义拒绝并宣告", async () => {
    const { registry, announcements } = makeRegistry();
    const pending = registry.ask(makeRequest("call-d"), { timeoutMs: 60_000 });
    registry.dispose();
    await expect(pending).rejects.toThrow(PermissionTimeout);
    expect(announcements[announcements.length - 1]?.kind).toBe("timed-out");
    await expect(registry.reply("call-d", { action: "allow" })).rejects.toThrow(
      StaleApprovalError,
    );
  });
});

// ---------------------------------------------------------------------------
// C54 审批来源分类（T-P1-78）：关类 = 自动拒绝非放行；开类照常挂起。
// ---------------------------------------------------------------------------

describe("C54 · 审批来源分类与关类自动拒绝（T-P1-78）", () => {
  it("闭集 5 值：tool/question/task/elicitation/hook-review", () => {
    expect(APPROVAL_CATEGORIES).toEqual([
      "tool",
      "question",
      "task",
      "elicitation",
      "hook-review",
    ]);
  });

  it("关 tool 类：ask 自动 deny（不挂起）且 reason 带 APPROVAL_CATEGORY_CLOSED，settled 宣告留痕", async () => {
    const announcements: ApprovalAnnouncement[] = [];
    const registry = new PendingApprovals(
      (a) => announcements.push(a),
      { tool: false },
    );
    const verdict = await registry.ask(makeRequest("closed-1"), { timeoutMs: 5_000 });
    expect(verdict.action).toBe("deny");
    expect(verdict.reason).toContain(APPROVAL_CATEGORY_CLOSED);
    expect(verdict.reason).toContain("tool");
    // 不挂起：listPending 为空；结算有宣告（C31 不静默）
    expect(registry.listPending()).toEqual([]);
    expect(announcements.map((a) => a.kind)).toEqual(["settled"]);
    expect(announcements[0]).toMatchObject({ kind: "settled", tool: "Bash" });
  });

  it("开类照常挂起（缺省全开——零行为变化）；逐类开关互不影响", async () => {
    const registry = new PendingApprovals(undefined, { question: false });
    const pending = registry.ask(makeRequest("open-1"), { timeoutMs: 5_000 });
    await Promise.resolve();
    expect(registry.listPending().map((r) => r.id)).toEqual(["open-1"]);
    await registry.reply("open-1", { action: "allow" });
    expect(await pending).toMatchObject({ action: "allow" });
  });

  it("关类后同 id 可重新 ask（关类结算不占墓碑判重位——迟到 reply 报 Stale）", async () => {
    const registry = new PendingApprovals(undefined, { tool: false });
    const first = await registry.ask(makeRequest("re-1"), { timeoutMs: 5_000 });
    expect(first.action).toBe("deny");
    // 迟到 reply：关类结算已留墓碑 → Stale（非 Unknown）
    await expect(registry.reply("re-1", { action: "allow" })).rejects.toThrow(
      StaleApprovalError,
    );
  });
});

describe("C52 · modifiedInput 修改后参数（T-P1-79）", () => {
  it("allow+modifiedInput：结算 verdict 携带修改后参数（gate 消费）", async () => {
    const { registry } = makeRegistry();
    const pending = registry.ask(makeRequest("mi-1"), { timeoutMs: 5_000 });
    await registry.reply("mi-1", {
      action: "allow",
      modifiedInput: { command: "git status" },
    });
    const answer = await pending;
    expect(answer.action).toBe("allow");
    expect(answer.modifiedInput).toEqual({ command: "git status" });
  });

  it("deny 携带 modifiedInput → 类型化 APPROVAL_REPLY_MALFORMED（编程错误当场暴露）", async () => {
    const { registry } = makeRegistry();
    registry.ask(makeRequest("mi-2"), { timeoutMs: 5_000 });
    await expect(
      registry.reply("mi-2", { action: "deny", modifiedInput: { command: "x" } }),
    ).rejects.toThrow(ApprovalReplyMalformedError);
    // 类型化 code 可路由
    try {
      await registry.reply("mi-2", { action: "deny", modifiedInput: { command: "x" } });
    } catch (e) {
      expect((e as { code?: string }).code).toBe("APPROVAL_REPLY_MALFORMED");
    }
  });
});

describe("C6 · 审批跨端回转（T-P1-82）——场景③进程内对应", () => {
  it("桌面（A 端）挂起 → 移交 lease → 飞书（B 端）答复（source 留痕）→ 桌面 turn 继续", async () => {
    const announcements: ApprovalAnnouncement[] = [];
    const pending = new PendingApprovals((a) => announcements.push(a));
    const port = new OwnerCommandPort({
      respondPermission: (requestId, reply) => pending.reply(requestId, reply),
    });
    // 端 A（桌面）：挂起审批（turn 在途——gate 层 await 中）
    const leaseA = port.acquireLease("desktop");
    const hanging = pending.ask(
      { id: "x-1", sessionId: "s1", tool: "bash", args: { command: "git push" }, category: "tool" },
      { timeoutMs: 60_000 },
    );
    let settled: Verdict | undefined;
    hanging.then((v) => (settled = v));
    await new Promise((r) => setTimeout(r, 5));
    expect(pending.listPending().map((r) => r.id)).toEqual(["x-1"]);
    // 审批权移交：A 释放、B（飞书）获取
    leaseA.release();
    const leaseB = port.acquireLease("feishu");
    // B 端答复（带端标识）；A 端句柄再答复 → NotLeaseHolder
    await port.requestOwnerCommand(leaseB, {
      type: "respond_permission",
      requestId: "x-1",
      reply: { action: "allow", source: "feishu" },
    });
    await expect(
      port.requestOwnerCommand(leaseA, {
        type: "respond_permission",
        requestId: "x-1",
        reply: { action: "deny" },
      }),
    ).rejects.toThrow(NotLeaseHolderError);
    // 桌面在途调用继续（verdict resolve——"桌面继续"）
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).toMatchObject({ action: "allow" });
    // 答复来源可检索（settled 宣告带 source——审计/多端 UI 消费）
    const settledAnnouncement = announcements.find((a) => a.kind === "settled");
    expect(settledAnnouncement).toMatchObject({ kind: "settled", source: "feishu" });
  });

  it("审计面：settled 记录带 replySource（答复端标识）", async () => {
    const records: ApprovalAuditRecord[] = [];
    const audit = createApprovalAuditSink({
      surface: "cli",
      sink: (r) => records.push(r),
    });
    const pending = new PendingApprovals(audit);
    const hanging = pending.ask(
      { id: "x-2", sessionId: "s1", tool: "bash", args: {}, category: "tool" },
      { timeoutMs: 5_000 },
    );
    await pending.reply("x-2", { action: "allow", source: "feishu" });
    await hanging;
    const settledRecord = records.find((r) => r.phase === "settled");
    expect(settledRecord).toMatchObject({ requestId: "x-2", replySource: "feishu" });
    // 无 source 的答复：记录无 replySource 字段（P0 单端零变化）
    const hanging2 = pending.ask(
      { id: "x-3", sessionId: "s1", tool: "bash", args: {}, category: "tool" },
      { timeoutMs: 5_000 },
    );
    await pending.reply("x-3", { action: "allow" });
    await hanging2;
    const settled3 = records.find((r) => r.phase === "settled" && r.requestId === "x-3");
    expect(settled3).toBeDefined();
    expect(settled3!.replySource).toBeUndefined();
  });
});

describe("墓碑容量有界（D 级债务清偿）", () => {
  it("超限 FIFO 淘汰最旧墓碑：被淘汰 id 迟到 reply 降为 Unknown（仍是拒绝），近期 id 保持 Stale", async () => {
    const registry = new PendingApprovals(undefined, undefined, 2);
    // a/b/c 各 ask→reply 结算，留下 3 个墓碑（上限 2 → a 被淘汰）
    for (const id of ["t-a", "t-b", "t-c"]) {
      const hanging = registry.ask(makeRequest(id), { timeoutMs: 60_000 });
      await registry.reply(id, { action: "allow" });
      await hanging;
    }
    // 最早的 t-a 墓碑已被 FIFO 淘汰 → Unknown（非 Stale）
    await expect(registry.reply("t-a", { action: "deny" })).rejects.toThrow(UnknownApprovalError);
    // 近期的 t-b/t-c 墓碑仍在 → Stale
    await expect(registry.reply("t-b", { action: "deny" })).rejects.toThrow(StaleApprovalError);
    await expect(registry.reply("t-c", { action: "deny" })).rejects.toThrow(StaleApprovalError);
  });

  it("淘汰只动 settled：挂起中的请求不受影响，同 id 重复 ask 仍 Duplicate", async () => {
    const registry = new PendingApprovals(undefined, undefined, 1);
    const first = registry.ask(makeRequest("live-1"), { timeoutMs: 60_000 });
    // 结算另一个请求，触发淘汰位（上限 1 → live-1 的墓碑……live-1 尚未结算
    // 不在 settled，淘汰不动 pending）
    const other = registry.ask(makeRequest("live-2"), { timeoutMs: 60_000 });
    await registry.reply("live-2", { action: "allow" });
    await other;
    // live-1 仍挂起：重复 ask 判重、reply 仍可正常结算
    expect(() => registry.ask(makeRequest("live-1"), { timeoutMs: 60_000 })).toThrow(
      DuplicateApprovalError,
    );
    await registry.reply("live-1", { action: "deny" });
    await expect(first).resolves.toMatchObject({ action: "deny" });
  });

  it("缺省上限 = MAX_SETTLED_TOMBSTONES（1000），满额循环后仍可正常 ask/reply", async () => {
    const registry = new PendingApprovals();
    for (let i = 0; i < 1000; i++) {
      const id = `bulk-${i}`;
      const hanging = registry.ask(makeRequest(id), { timeoutMs: 60_000 });
      await registry.reply(id, { action: "allow" });
      await hanging;
    }
    // 满额后再走一轮完整生命周期（首批墓碑被淘汰）
    const hanging = registry.ask(makeRequest("bulk-after"), { timeoutMs: 60_000 });
    await registry.reply("bulk-after", { action: "allow" });
    await expect(hanging).resolves.toMatchObject({ action: "allow" });
  });
});
