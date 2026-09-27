import { describe, expect, it, vi } from "vitest";

import { PendingApprovals, type ApprovalAnnouncement } from "../policy/pending.js";
import { LeaseBusyError, NotLeaseHolderError, OwnerCommandPort } from "../session/owner-port.js";
import { InMemoryEventStorage, SessionStore } from "../session/store.js";
import { HostRegistry } from "./registry.js";
import { parseDeliveryKind } from "./lease.js";

describe("N7+N3/T-P1-113 surface 连接与 run 租约", () => {
  it("acquire/release 往返 + 单 holder（第二连接 acquire → LeaseBusy）", () => {
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-a" });
    const cli = host.surfaces.connect("cli", "push");
    const feishu = host.surfaces.connect("feishu", "poll");

    const lease = host.surfaces.acquireRunLease("cli");
    expect(cli.holdsLease()).toBe(true);
    expect(host.surfaces.currentLeaseHolder()).toBe("cli");
    expect(() => host.surfaces.acquireRunLease("feishu")).toThrowError(LeaseBusyError);

    expect(lease.release()).toBe(true);
    expect(cli.holdsLease()).toBe(false);
    // 释放后另一连接可获取
    const lease2 = host.surfaces.acquireRunLease("feishu");
    expect(feishu.holdsLease()).toBe(true);
    lease2.release();
  });

  it("断线自动释放：持约连接 close → 租约归还 + 通知 → 新连接立即可 acquire", () => {
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-a" });
    const a = host.surfaces.connect("a", "push");
    const b = host.surfaces.connect("b", "poll");

    const listener = vi.fn();
    host.surfaces.onLeaseChange(listener);
    host.surfaces.acquireRunLease("a");
    expect(listener).toHaveBeenCalledWith("a");

    a.close(); // 断线即释放（不显式 release）
    expect(listener).toHaveBeenCalledWith(undefined);
    expect(host.surfaces.currentLeaseHolder()).toBeUndefined();
    expect(b.holdsLease()).toBe(false);
    expect(() => host.surfaces.acquireRunLease("b")).not.toThrow();
  });

  it("close 幂等 + dispose 后事件归属清空", () => {
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-a" });
    const a = host.surfaces.connect("a", "push");
    a.close();
    a.close(); // 幂等
    expect(host.surfaces.isConnected("a")).toBe(false);
    expect(host.surfaces.connectedSurfaceIds()).toEqual([]);
  });

  it("非持约写命令拒绝（NotLeaseHolderError 贯穿）", () => {
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-a" });
    host.surfaces.connect("cli", "push");
    host.surfaces.connect("feishu", "poll");
    const cliLease = host.surfaces.acquireRunLease("cli");

    // 非持约连接拿持约者的句柄发写命令
    expect(() =>
      host.surfaces.submitWrite("feishu", cliLease, () => {
        throw new Error("不应执行");
      }),
    ).toThrowError(NotLeaseHolderError);

    // 过期令牌（release 后重获，旧句柄失效）
    cliLease.release();
    const fresh = host.surfaces.acquireRunLease("cli");
    expect(() => host.surfaces.submitWrite("cli", cliLease, () => {})).toThrowError(
      NotLeaseHolderError,
    );

    // 持约者 + 当前令牌照常
    let executed = false;
    host.surfaces.submitWrite("cli", fresh, () => {
      executed = true;
    });
    expect(executed).toBe(true);
  });

  it("N3 会话级互斥：两连接同时写只一个受理 + 事件流 seq 单调无交错", () => {
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-a" });
    const storage = new InMemoryEventStorage();
    const store = new SessionStore(storage);
    host.surfaces.connect("cli", "push");
    host.surfaces.connect("feishu", "poll");
    const cliLease = host.surfaces.acquireRunLease("cli");

    // 持约者连续写 10 轮（turn/start + user/message）；非持约连接的每次写
    // 全部被租约拒绝（无第二写者）
    for (let i = 0; i < 10; i++) {
      host.surfaces.submitWrite("cli", cliLease, () => {
        store.append("s-a", [
          { type: "turn/start", turn: i + 1 },
          {
            type: "user/message",
            turn: i + 1,
            message: { content: `w${i}` },
            source: "user",
          },
          { type: "turn/end", turn: i + 1, reason: { kind: "completed" } },
        ] as Parameters<SessionStore["append"]>[1]);
      });
      expect(() =>
        host.surfaces.submitWrite("feishu", cliLease, () => {
          store.append("s-a", [] as Parameters<SessionStore["append"]>[1]);
        }),
      ).toThrowError(NotLeaseHolderError);
    }

    const events = store.load("s-a"); // write-behind——读内存投影视图
    expect(events).toHaveLength(30); // 10 轮 × (start + message + end)
    // seq 由 store 单调分配、越权写零落流（无交错的结构保证断言）
    for (let i = 0; i < 30; i++) {
      expect(events[i]!.seq).toBe(i + 1);
    }
  });

  it("deliveryKind 闭集两值 + 非法值拒绝", () => {
    expect(parseDeliveryKind("push")).toBe("push");
    expect(parseDeliveryKind("poll")).toBe("poll");
    expect(() => parseDeliveryKind("carrier")).toThrowError(/投递方式/);
    expect(() => parseDeliveryKind(42)).toThrowError(/投递方式/);
  });

  it("移交间隙：A 断线（租约归还）审批挂起保留 → 新 holder 可答（C6 贯穿）", async () => {
    const announcements: ApprovalAnnouncement[] = [];
    const pending = new PendingApprovals((a) => announcements.push(a));
    const port = new OwnerCommandPort({
      respondPermission: (requestId, reply) => pending.reply(requestId, reply),
    });
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-a" });
    const desktop = host.surfaces.connect("desktop", "push");
    host.surfaces.connect("feishu", "poll");

    // 端 A（桌面）持约开轮并挂起审批
    const leaseA = host.surfaces.acquireRunLease("desktop");
    const hanging = pending.ask(
      { id: "x-1", sessionId: "s-a", tool: "bash", args: { command: "git push" }, category: "tool" },
      { timeoutMs: 60_000 },
    );
    let settled: unknown;
    void hanging.then((v) => (settled = v));
    await new Promise((r) => setTimeout(r, 5));
    expect(pending.listPending().map((r) => r.id)).toEqual(["x-1"]);

    // A 端断线（未答复、未显式释放）——租约归还、挂起保留（不随连接消失）
    desktop.close();
    expect(host.surfaces.currentLeaseHolder()).toBeUndefined();
    expect(pending.listPending().map((r) => r.id)).toEqual(["x-1"]);

    // B 端 acquire host 面租约（run 保护）+ owner-port 租约（命令通道面）
    // ——host 面与 port 面是两个租约域（run 互斥 / 命令准入），各自校验
    const leaseB = host.surfaces.acquireRunLease("feishu");
    const portLeaseB = port.acquireLease("feishu");
    await port.requestOwnerCommand(portLeaseB, {
      type: "respond_permission",
      requestId: "x-1",
      reply: { action: "allow", source: "feishu" },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).toMatchObject({ action: "allow" });
    // 答复来源可检索（T-P1-82 审计面）
    expect(announcements.find((a) => a.kind === "settled")).toMatchObject({ source: "feishu" });
  });

  it("租约序号令牌：旧句柄在重获后失效（owner-port 语义贯穿）", () => {
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-a" });
    host.surfaces.connect("cli", "push");
    const lease1 = host.surfaces.acquireRunLease("cli");
    lease1.release();
    const lease2 = host.surfaces.acquireRunLease("cli"); // 重获（新令牌）
    expect(lease2.id).toBeGreaterThan(lease1.id);
    expect(lease1.release()).toBe(false); // 旧句柄释放是 no-op
    expect(() => host.surfaces.submitWrite("cli", lease1, () => {})).toThrowError(
      NotLeaseHolderError,
    );
    host.surfaces.submitWrite("cli", lease2, () => {}); // 新句柄有效
  });

  it("重复连接同 surfaceId 拒绝 + 未连接 surface acquire 防呆", () => {
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-a" });
    host.surfaces.connect("cli", "push");
    expect(() => host.surfaces.connect("cli", "poll")).toThrowError(/已连接/);
    expect(() => host.surfaces.acquireRunLease("ghost")).toThrowError(NotLeaseHolderError);
  });
});
