import { describe, expect, it } from "vitest";

import type { Verdict } from "./decision.js";
import {
  DuplicateApprovalError,
  PERMISSION_REPLY_STALE,
  PERMISSION_TIMEOUT,
  PendingApprovals,
  PermissionTimeout,
  StaleApprovalError,
  UnknownApprovalError,
  type ApprovalAnnouncement,
} from "./pending.js";

function makeRequest(id: string) {
  return { id, sessionId: "s1", tool: "Bash", args: { command: "rm -rf /x" } };
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
