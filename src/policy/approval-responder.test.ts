/**
 * W13a/T9-3 验收：审批竞速收口（hook 慢/挂 → broker 先到者胜；先兑现后
 * abort 败者；全弃权 fail-closed 等 broker；空 responders 零行为变化）。
 */
import { describe, expect, it } from "vitest";

import type { ApprovalRequest } from "./pending.js";
import type { PermissionBrokerPort } from "./broker.js";
import {
  racePermissionResponders,
  type ApprovalResponderPort,
} from "./approval-responder.js";

const request: ApprovalRequest = {
  id: "r1",
  sessionId: "s1",
  tool: "bash",
  args: { command: "git status" },
  category: "tool",
};

/** 可控 broker/responder 假件（挂起/放行/弃权均可编排）。 */
function makeController(name: string) {
  let resolveNow: ((a: {
    action: "allow" | "deny";
    reason: string;
  }) => void) | undefined;
  let rejectNow: ((e: Error) => void) | undefined;
  const promise = new Promise<{ action: "allow" | "deny"; reason: string }>(
    (resolve, reject) => {
      resolveNow = resolve;
      rejectNow = reject;
    },
  );
  let aborts = 0;
  return {
    name,
    promise,
    settle: (answer: { action: "allow" | "deny"; reason: string }) => resolveNow!(answer),
    fail: (e: Error) => rejectNow!(e),
    markAbort: () => {
      aborts += 1;
    },
    get abortCount() {
      return aborts;
    },
  };
}

function brokerOf(c: ReturnType<typeof makeController>): PermissionBrokerPort {
  return { name: c.name, decide: () => c.promise };
}

function responderOf(c: ReturnType<typeof makeController>): ApprovalResponderPort {
  return {
    name: c.name,
    respond: (_request, signal) => {
      signal?.addEventListener("abort", () => {
        c.markAbort();
      });
      return c.promise;
    },
  };
}

describe("racePermissionResponders（W13a/T9-3 审批竞速）", () => {
  it("hook 快速 allow → responder 胜（broker 仍挂起不阻塞）", async () => {
    const slowBroker = makeController("broker-slow");
    const fastHook = makeController("hook-fast");
    const raced = racePermissionResponders(brokerOf(slowBroker), [responderOf(fastHook)]);
    const pending = raced.decide(request);
    fastHook.settle({ action: "allow", reason: "hook 自动放行" });
    const answer = await pending;
    expect(answer.action).toBe("allow");
    expect(answer.reason).toBe("hook 自动放行");
  });

  it("hook 挂死 → broker 先到者胜（先兑现后 abort 败者）", async () => {
    const fastBroker = makeController("broker-fast");
    const hungHook = makeController("hook-hung");
    const raced = racePermissionResponders(brokerOf(fastBroker), [responderOf(hungHook)]);
    const pending = raced.decide(request);
    fastBroker.settle({ action: "allow", reason: "用户点击批准" });
    const answer = await pending;
    // 兑现：胜者答案完整到达调用方
    expect(answer.action).toBe("allow");
    expect(answer.reason).toBe("用户点击批准");
    // abort 败者（兑现之后——挂死的败者不阻塞主流程）
    expect(hungHook.abortCount).toBe(1);
  });

  it("hook deny 先到 → deny 胜（竞速不偏向放行）", async () => {
    const hungBroker = makeController("broker-hung");
    const denyHook = makeController("hook-deny");
    const raced = racePermissionResponders(brokerOf(hungBroker), [responderOf(denyHook)]);
    const pending = raced.decide(request);
    denyHook.settle({ action: "deny", reason: "hook 策略拒绝" });
    const answer = await pending;
    expect(answer.action).toBe("deny");
    expect(answer.reason).toBe("hook 策略拒绝");
  });

  it("responder 全弃权（null）→ 继续等 broker（fail-closed 不静默放行）", async () => {
    const brokerC = makeController("broker");
    const abstainingHook: ApprovalResponderPort = {
      name: "hook-abstain",
      respond: () => Promise.resolve(null),
    };
    const raced = racePermissionResponders(brokerOf(brokerC), [abstainingHook]);
    const pending = raced.decide(request);
    // 弃权后 broker 仍是唯一活口——broker 未答前竞速不返回
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
    brokerC.settle({ action: "deny", reason: "用户拒绝" });
    const answer = await pending;
    expect(answer.action).toBe("deny");
  });

  it("responders 空 = 原样透传 primary（零行为变化）", async () => {
    const primary = makeController("primary");
    const raced = racePermissionResponders(brokerOf(primary), []);
    expect(raced.name).toBe("primary");
    const pending = raced.decide(request);
    primary.settle({ action: "allow", reason: "直达" });
    expect((await pending).reason).toBe("直达");
  });
});
