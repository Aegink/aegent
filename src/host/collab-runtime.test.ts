import { describe, expect, it } from "vitest";

import type { AgentMessage, AgentRequest } from "../kernel/agent-protocol.js";
import { SessionStore } from "../session/store.js";
import { CollaborationError } from "../session/collaboration.js";
import { HostBridge } from "./bridge.js";
import {
  createCollabRuntime,
  permissionModeToCeiling,
  setCollabRuntime,
  tryCollabSettingsOp,
} from "./collab-runtime.js";

/** 假 agent 通道：send 记录 + 可控消息队列（accepted → 事件流）。 */
function makeFakeChannel() {
  const queue: AgentMessage[] = [];
  let wake: () => void = () => {};
  const sent: AgentRequest[] = [];
  let onSend: ((request: AgentRequest) => void) | undefined;
  const push = (message: AgentMessage): void => {
    queue.push(message);
    wake();
  };
  const channel = {
    send: (request: AgentRequest): void => {
      sent.push(request);
      // 受理 → 事件流回放（生产中由 agent-child 产出；此处即时三连）
      push({ type: "accepted", messageId: (request as { messageId?: string }).messageId ?? "" });
      onSend?.(request);
    },
    messages: {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<AgentMessage>> => {
          for (;;) {
            const message = queue.shift();
            if (message !== undefined) return { done: false, value: message };
            await new Promise<void>((resolve) => (wake = resolve));
          }
        },
      }),
    },
  };
  return { channel, sent, push, set onSend(fn: (request: AgentRequest) => void) { onSend = fn; } };
}

let seq = 0;
/** 事件构造（seq/ts 测试面自造——EventBase 形状）。 */
function makeEvent(type: "assistant/message" | "turn/end" | "step/start" | "step/end", turn: number, step = 1): Record<string, unknown> {
  seq += 1;
  if (type === "assistant/message") {
    return { type, seq, ts: Date.now(), turn, step, message: { content: "协作任务已完成：42" }, stream: [] };
  }
  if (type === "step/start") return { type, seq, ts: Date.now(), turn, step };
  if (type === "step/end") return { type, seq, ts: Date.now(), turn, step };
  return { type, seq, ts: Date.now(), turn, reason: { kind: "completed" } };
}

function makeFixture() {
  const store = new SessionStore();
  const main = makeFakeChannel();
  const target = makeFakeChannel();
  const factoryCalls: string[] = [];
  const bridge = new HostBridge({
    host: { sessionId: "s-main" } as never,
    agent: main.channel as never,
    agentFactory: (sessionId: string) => {
      factoryCalls.push(sessionId);
      return target.channel as never;
    },
    store,
  });
  const broadcast: { sessionId: string; type: string }[] = [];
  bridge.onEvent((sessionId, event) => broadcast.push({ sessionId, type: event.type }));
  // 模拟 server.ts 的镜像路径：agent 事件进 store（assistant 供 executor 结果提取）
  bridge.onEvent((sessionId, event) => {
    if (["assistant/message", "turn/end", "step/start", "step/end"].includes(event.type)) {
      try {
        store.append(sessionId, [event as never]);
      } catch (e) {
      }
    }
  });
  const runtime = createCollabRuntime({
    bridge,
    store,
  });
  return { runtime, store, main, target, factoryCalls, broadcast };
}

describe("collab-runtime（C10 生产装配）", () => {
  it("全链：dispatch → pump → executor 投递目标会话 → turn/end 结算 → 结果回投源流", async () => {
    const { runtime, store, target, factoryCalls, broadcast } = makeFixture();
    // 目标会话"存在"（无 sessionsLibrary → store.sessionIds 面）——先造目标会话镜像
    store.append("s-target", [
      { type: "turn/start", seq: 0, ts: Date.now(), turn: 1 } as never,
      { type: "user/message", seq: 0, ts: Date.now(), turn: 1, message: { content: "seed" } } as never,
    ]);

    // executor 投递时同步回放目标通道事件流（assistant 产出 + 正常收轮——
    // bridge 泵消费 → listeners → executor 结算）
    target.onSend = (request) => {
      expect(request.type).toBe("prompt");
      expect(String((request as { content?: string }).content)).toContain("统计测试用例数");
      expect(factoryCalls).toContain("s-target");
      target.push({ type: "event", event: makeEvent("step/start", 1) as never });
      target.push({ type: "event", event: makeEvent("assistant/message", 1) as never });
      target.push({ type: "event", event: makeEvent("step/end", 1) as never });
      target.push({ type: "event", event: makeEvent("turn/end", 1) as never });
    };
    const collabId = await runtime.dispatch({
      sourceSessionId: "s-main",
      targetSessionId: "s-target",
      kind: "task",
      content: "统计测试用例数",
    });
    expect(collabId).toMatch(/^collab-/);

    // dispatch 即落双流（源 dispatch + 目标 receive）并广播
    expect(broadcast.filter((b) => b.type === "session/collab").length).toBeGreaterThanOrEqual(2);
    // 结果等待：pump 完成后源流有 report（completed + result 文本）
    for (let i = 0; i < 100; i++) {
      const events = store.load("s-main");
      const report = events.find((e) => e.type === "session/collab" && (e as { direction?: string }).direction === "report");
      if (report !== undefined) {
        expect((report as { status?: string }).status).toBe("completed");
        expect((report as { result?: string }).result).toContain("42");
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    const sourceEvents = store.load("s-main");
    const report = sourceEvents.find((e) => e.type === "session/collab" && (e as { direction?: string }).direction === "report");
    expect(report).toBeDefined();
    const targetEvents = store.load("s-target");
    const targetStatuses = targetEvents
      .filter((e) => e.type === "session/collab")
      .map((e) => (e as { status?: string }).status);
    expect(targetStatuses).toEqual(["queued", "running", "completed"]);
  });

  it("目标不存在：dispatch 类型化拒绝（COLLAB_TARGET_MISSING）", async () => {
    const { runtime } = makeFixture();
    await expect(
      runtime.dispatch({ sourceSessionId: "s-main", targetSessionId: "s-ghost", kind: "task", content: "x" }),
    ).rejects.toMatchObject({ code: "COLLAB_TARGET_MISSING", name: "CollaborationError" });
  });

  it("permissionModeToCeiling：read-only/unattended 收敛保守 ask（快照不可提权）", () => {
    expect(permissionModeToCeiling("ask")).toBe("ask");
    expect(permissionModeToCeiling("accept-edits")).toBe("accept-edits");
    expect(permissionModeToCeiling("auto")).toBe("auto");
    expect(permissionModeToCeiling("read-only")).toBe("ask");
    expect(permissionModeToCeiling("unattended")).toBe("ask");
    expect(permissionModeToCeiling(undefined)).toBe("ask");
  });
});

describe("collab op 分发（模块级句柄）", () => {
  it("collab-dispatch / collab-cancel 经句柄分发；未装配抛 COLLAB_UNAVAILABLE", async () => {
    const { runtime, store } = makeFixture();
    store.append("s-target", [
      { type: "turn/start", seq: 0, ts: Date.now(), turn: 1 } as never,
      { type: "user/message", seq: 0, ts: Date.now(), turn: 1, message: { content: "seed" } } as never,
    ]);
    setCollabRuntime(runtime);
    try {
      const result = (await tryCollabSettingsOp({
        op: "collab-dispatch",
        sourceSessionId: "s-main",
        targetSessionId: "s-target",
        kind: "message",
        content: "你好，协作",
      } as never)) as { collabId?: string };
      expect(result.collabId).toMatch(/^collab-/);
      const cancel = (await tryCollabSettingsOp({ op: "collab-cancel", collabId: result.collabId } as never)) as {
        cancelled?: boolean;
      };
      expect(cancel.cancelled).toBe(true);
    } finally {
      setCollabRuntime(undefined);
    }
    await expect(tryCollabSettingsOp({ op: "collab-cancel", collabId: "collab-99" } as never)).rejects.toMatchObject({
      code: "COLLAB_UNAVAILABLE",
    });
    expect(new CollaborationError("COLLAB_SELF", "x").code).toBe("COLLAB_SELF");
  });
});
