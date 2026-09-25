import { describe, expect, it } from "vitest";

import {
  DenyPermissionBroker,
  ManualPermissionBroker,
  PERMISSION_BROKER_DENIED,
  type PermissionBrokerPort,
} from "./broker.js";
import { PendingApprovals, PermissionTimeout } from "./pending.js";
import type { ApprovalRequest } from "./pending.js";

const req = (id: string, tool: string): ApprovalRequest => ({
  id,
  sessionId: "s1",
  tool,
  args: { command: "git push" },
});

describe("C51 · 默认权限实现是拒绝", () => {
  it("缺省 Deny broker 对任何 ask 请求 resolve deny 且码明确", async () => {
    const broker: PermissionBrokerPort = new DenyPermissionBroker();
    for (const request of [req("a", "bash"), req("b", "write"), req("c", "read")]) {
      const verdict = await broker.decide(request);
      expect(verdict.action).toBe("deny");
      expect((verdict as { code?: string }).code).toBe(PERMISSION_BROKER_DENIED);
      expect(verdict.reason).toContain(request.tool);
      expect(verdict.reason).toContain("未配置审批客户端");
    }
  });

  it("反复询问结果一致（拒绝不是一次性闸门）", async () => {
    const broker = new DenyPermissionBroker();
    const first = await broker.decide(req("x", "bash"));
    const second = await broker.decide(req("x", "bash"));
    expect(first).toEqual(second);
  });
});

describe("ManualPermissionBroker（CLI 骨架，复用 PendingApprovals）", () => {
  function makeManual(timeoutMs = 5_000) {
    const announcements: string[] = [];
    const pending = new PendingApprovals((a) => announcements.push(a.kind));
    return { broker: new ManualPermissionBroker(pending, timeoutMs) as PermissionBrokerPort, pending, announcements };
  }

  it("decide 挂起 → reply 唤醒为裁决；宣告经 PendingApprovals 发出", async () => {
    const { broker, pending, announcements } = makeManual();
    const pendingVerdict = broker.decide(req("call-1", "bash"));
    await Promise.resolve();
    expect(announcements).toEqual(["asked"]);
    await pending.reply("call-1", { action: "allow" });
    expect(await pendingVerdict).toEqual({ action: "allow", reason: "审批人放行" });
    expect(announcements).toEqual(["asked", "settled"]);
  });

  it("超时拒绝为类型化 PermissionTimeout（C50 纪律透传）", async () => {
    const { broker } = makeManual(10);
    await expect(broker.decide(req("call-t", "bash"))).rejects.toThrow(
      PermissionTimeout,
    );
  });

  it("dispose 释放未决请求，之后 reply 落 stale", async () => {
    const { broker, pending } = makeManual();
    const pendingVerdict = broker.decide(req("call-d", "bash"));
    broker.dispose?.();
    await expect(pendingVerdict).rejects.toThrow(PermissionTimeout);
    await expect(pending.reply("call-d", { action: "allow" })).rejects.toThrow(
      "已结算",
    );
  });
});
