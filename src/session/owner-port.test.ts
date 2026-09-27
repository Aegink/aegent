import { describe, expect, it } from "vitest";

import {
  LeaseBusyError,
  NotLeaseHolderError,
  OwnerCommandPort,
  OWNER_LEASE_BUSY,
  OWNER_NOT_LEASE_HOLDER,
} from "./owner-port.js";
import { PendingApprovals } from "../policy/pending.js";

/** T-5-04 + N6 的标准装配：respond_permission 直接转达 pending.reply。 */
function makePort() {
  const pending = new PendingApprovals();
  let stopped: string | undefined;
  const port = new OwnerCommandPort({
    respondPermission: (requestId, reply) => pending.reply(requestId, reply),
    stopGeneration: async (reason) => {
      stopped = reason;
    },
  });
  return { pending, port, stopped: () => stopped };
}

describe("N6 · lease 最小语义", () => {
  it("acquire → 持有者可见；重复 acquire 抛 LeaseBusy（错误码明确）", () => {
    const { port } = makePort();
    const lease = port.acquireLease("cli");
    expect(lease.ownerId).toBe("cli");
    expect(port.currentHolder()).toBe("cli");
    try {
      port.acquireLease("other-ui");
      expect.unreachable("应抛 LeaseBusyError");
    } catch (e) {
      expect(e).toBeInstanceOf(LeaseBusyError);
      expect((e as LeaseBusyError).code).toBe(OWNER_LEASE_BUSY);
      expect((e as LeaseBusyError).heldBy).toBe("cli");
    }
  });

  it("release 后可重新获取；旧句柄 release 与发命令均失效", async () => {
    const { port } = makePort();
    const first = port.acquireLease("cli");
    expect(first.release()).toBe(true);
    expect(port.currentHolder()).toBeUndefined();

    const second = port.acquireLease("ui");
    expect(first.release()).toBe(false); // 旧句柄 no-op
    const command = { type: "stop_generation" } as const;
    await expect(port.requestOwnerCommand(first, command)).rejects.toThrow(
      NotLeaseHolderError,
    );
    await expect(port.requestOwnerCommand(second, command)).resolves.toBeUndefined();
  });
});

describe("N6 · 验收：审批请求经通道 → reply 回传 → C5 Deferred 唤醒", () => {
  it("pending.ask 挂起 → owner 发 respond_permission → 发起端被唤醒继续", async () => {
    const { pending, port } = makePort();
    const askPromise = pending.ask(
      { id: "call-1", sessionId: "s1", tool: "bash", args: { command: "git push" }, category: "tool" },
      { timeoutMs: 5_000 },
    );
    await new Promise((r) => setTimeout(r, 5)); // 等待挂起注册

    const lease = port.acquireLease("cli");
    await port.requestOwnerCommand(lease, {
      type: "respond_permission",
      requestId: "call-1",
      reply: { action: "allow" },
    });
    await expect(askPromise).resolves.toEqual({ action: "allow", reason: "审批人放行" });
  });

  it("结果回传：迟到/未知答复的类型化错误原样上抛给 owner", async () => {
    const { port } = makePort();
    const lease = port.acquireLease("cli");
    // 未知请求
    await expect(
      port.requestOwnerCommand(lease, {
        type: "respond_permission",
        requestId: "nope",
        reply: { action: "deny" },
      }),
    ).rejects.toThrow("不存在");
    // 迟到答复（已超时的请求）
    const dying = new PendingApprovals();
    dying
      .ask({ id: "late", sessionId: "s1", tool: "bash", args: {}, category: "tool" }, { timeoutMs: 10 })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 30));
    const stalePort = new OwnerCommandPort({
      respondPermission: (id, reply) => dying.reply(id, reply),
    });
    const staleLease = stalePort.acquireLease("cli");
    await expect(
      stalePort.requestOwnerCommand(staleLease, {
        type: "respond_permission",
        requestId: "late",
        reply: { action: "allow" },
      }),
    ).rejects.toThrow("已结算");
  });
});

describe("N6 · 命令闭集与 stop_generation", () => {
  it("stop_generation 命令到达 handler（A7 取消的 owner 入口）", async () => {
    const { port, stopped } = makePort();
    const lease = port.acquireLease("cli");
    await port.requestOwnerCommand(lease, {
      type: "stop_generation",
      reason: "用户按了停止",
    });
    expect(stopped()).toBe("用户按了停止");
  });

  it("非持有者发命令被拒（验收后半：lease 校验在分发之前）", async () => {
    const { port, stopped } = makePort();
    const lease = port.acquireLease("cli");
    lease.release();
    // 释放后未重新获取——无持有者，任何句柄都发不了命令
    const err = await port
      .requestOwnerCommand(lease, { type: "stop_generation" })
      .then(
        () => undefined,
        (e: unknown) => e as NotLeaseHolderError,
      );
    expect(err).toBeInstanceOf(NotLeaseHolderError);
    expect(err?.code).toBe(OWNER_NOT_LEASE_HOLDER);
    expect(stopped()).toBeUndefined();
  });

  it("model/switch 命令到达 handler（J6 换模的 owner 入口，T-P1-04）", async () => {
    const switched: { provider: string; modelId: string }[] = [];
    const port = new OwnerCommandPort({
      respondPermission: async () => {},
      modelSwitch: (identity) => {
        switched.push(identity);
      },
    });
    const lease = port.acquireLease("cli");
    await port.requestOwnerCommand(lease, {
      type: "model/switch",
      identity: { provider: "openai", modelId: "m2" },
    });
    expect(switched).toEqual([{ provider: "openai", modelId: "m2" }]);
  });

  it("model/switch 在未提供 handler 时静默跳过（与 stop_generation 同款可选语义）", async () => {
    const port = new OwnerCommandPort({ respondPermission: async () => {} });
    const lease = port.acquireLease("cli");
    await expect(
      port.requestOwnerCommand(lease, {
        type: "model/switch",
        identity: { provider: "openai", modelId: "m2" },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("C30 · 审批批量答复（T-P1-81）", () => {
  it("批量答复全部生效：逐项 verdict 正确归属（两挂起一次答复）", async () => {
    const { pending, port } = makePort();
    const lease = port.acquireLease("cli");
    const a = pending.ask(
      { id: "b-a", sessionId: "s1", tool: "bash", args: { command: "git status" }, category: "tool" },
      { timeoutMs: 5_000 },
    );
    const b = pending.ask(
      { id: "b-b", sessionId: "s1", tool: "bash", args: { command: "git push" }, category: "tool" },
      { timeoutMs: 5_000 },
    );
    const results = (await port.requestOwnerCommand(lease, {
      type: "respond_permission_batch",
      decisions: [
        { requestId: "b-a", reply: { action: "allow" } },
        { requestId: "b-b", reply: { action: "deny", reason: "不许推" } },
      ],
    })) as Array<{ requestId: string; ok: boolean }>;
    expect(results).toEqual([
      { requestId: "b-a", ok: true },
      { requestId: "b-b", ok: true },
    ]);
    expect(await a).toMatchObject({ action: "allow" });
    expect(await b).toMatchObject({ action: "deny" });
    expect(pending.listPending()).toEqual([]);
  });

  it("部分失败不回滚：stale 项逐项类型化返回，成功项照常生效", async () => {
    const { pending, port } = makePort();
    const lease = port.acquireLease("cli");
    const alive = pending.ask(
      { id: "c-alive", sessionId: "s1", tool: "bash", args: {}, category: "tool" },
      { timeoutMs: 5_000 },
    );
    // 制造一个 stale（先答复再批量重答）与一个 unknown（从未存在）
    await pending.reply("c-alive", { action: "deny" });
    const results = (await port.requestOwnerCommand(lease, {
      type: "respond_permission_batch",
      decisions: [
        { requestId: "c-alive", reply: { action: "allow" } },
        { requestId: "c-ghost", reply: { action: "allow" } },
      ],
    })) as Array<{ requestId: string; ok: boolean; code?: string }>;
    expect(results[0]).toMatchObject({ requestId: "c-alive", ok: false, code: "PERMISSION_REPLY_STALE" });
    expect(results[1]).toMatchObject({ requestId: "c-ghost", ok: false, code: "PERMISSION_REQUEST_UNKNOWN" });
    void alive;
  });

  it("非持约端批量答复 → NotLeaseHolderError（审批权随 lease 移交——C6 前置）", async () => {
    const { port } = makePort();
    const lease = port.acquireLease("desktop");
    lease.release();
    const leaseB = port.acquireLease("feishu");
    await expect(
      port.requestOwnerCommand(lease, {
        type: "respond_permission_batch",
        decisions: [{ requestId: "x", reply: { action: "allow" } }],
      }),
    ).rejects.toThrow(NotLeaseHolderError);
    // B 端（现持有者）批量答复可用
    const pending = new PendingApprovals();
    void pending;
    await expect(
      port.requestOwnerCommand(leaseB, {
        type: "respond_permission_batch",
        decisions: [],
      }),
    ).resolves.toEqual([]);
  });

  it("装配提供的 respondPermissionBatch 优先于 fallback（整批处理器接管）", async () => {
    let batched: string[] | undefined;
    const port = new OwnerCommandPort({
      respondPermission: async () => {
        throw new Error("fallback 不应被调");
      },
      respondPermissionBatch: async (decisions) => {
        batched = decisions.map((d) => d.requestId);
        return decisions.map((d) => ({ requestId: d.requestId, ok: true }));
      },
    });
    const lease = port.acquireLease("cli");
    const results = (await port.requestOwnerCommand(lease, {
      type: "respond_permission_batch",
      decisions: [{ requestId: "h-1", reply: { action: "allow" } }],
    })) as Array<{ requestId: string; ok: boolean }>;
    expect(batched).toEqual(["h-1"]);
    expect(results).toEqual([{ requestId: "h-1", ok: true }]);
  });
});
