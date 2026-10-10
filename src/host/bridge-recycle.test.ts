import { describe, expect, it } from "vitest";

import type { AgentMessage, AgentRequest } from "../kernel/agent-protocol.js";
import {SessionEventStore, type SessionStore} from "../session/store.js";
import { HostBridge } from "./bridge.js";
import { setStructuralReload, STRUCTURAL_HOT_RELOAD_SECTIONS, tryPluginSettingsOp } from "./settings-plugin-ops.js";

/** 假通道：send 即受理（accepted 入队）+ 可控事件注入 + kill 计数。 */
function makeChannel() {
  const queue: AgentMessage[] = [];
  let wake: () => void = () => {};
  const state = { killed: 0 };
  const push = (message: AgentMessage): void => {
    queue.push(message);
    wake();
  };
  const channel = {
    send: (request: AgentRequest): void => {
      if (request.type === "prompt") push({ type: "accepted", messageId: request.messageId });
    },
    kill: (): void => {
      state.killed += 1;
      push({ type: "idle" } as never); // 泵唤醒自然收束
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
  return { channel, state, push };
}

/** 会话事件经假通道注入（走真泵路径——busy 跟踪与广播都被覆盖）。 */
function eventMessage(type: string, turn: number): { type: "event"; event: Record<string, unknown> } {
  return {
    type: "event",
    event: { type, seq: Date.now(), ts: Date.now(), turn, reason: { kind: "completed" } },
  } as never;
}

function makeBridge() {
  const store = new SessionEventStore();
  const main = makeChannel();
  const factoryMade: { sessionId: string; handle: ReturnType<typeof makeChannel> }[] = [];
  const bridge = new HostBridge({
    host: { sessionId: "s-main" } as never,
    agent: main.channel as never,
    agentFactory: (sessionId: string) => {
      const handle = makeChannel();
      factoryMade.push({ sessionId, handle });
      return handle.channel as never;
    },
    store,
  });
  return { bridge, store, main, factoryMade };
}

describe("recycleIdleChannels（结构性设置热加载）", () => {
  it("空闲会话回收（含主会话）：摘池 + kill + 返回回收数", async () => {
    const { bridge, main, factoryMade } = makeBridge();
    await bridge.sendSystemPrompt("s-a", { type: "prompt", messageId: "m1", content: "x" });
    await bridge.sendSystemPrompt("s-b", { type: "prompt", messageId: "m2", content: "x" });
    await new Promise((r) => setTimeout(r, 20));
    expect(factoryMade).toHaveLength(2);
    const recycled = bridge.recycleIdleChannels();
    expect(recycled).toBe(3); // 主会话 + s-a + s-b（全部空闲——accepted 已回执）
    expect(main.state.killed).toBe(1);
    expect(factoryMade[0]!.handle.state.killed).toBe(1);
    expect(factoryMade[1]!.handle.state.killed).toBe(1);
  });

  it("进行中轮不回收（busy 跳过）；turn/end 后恢复可回收", async () => {
    const { bridge, main, factoryMade } = makeBridge();
    const pending = bridge.sendSystemPrompt("s-x", { type: "prompt", messageId: "m1", content: "x" });
    await new Promise((r) => setTimeout(r, 20));
    const handle = factoryMade[0]!.handle;
    // turn/start 经真泵路径进 bridge → busy 跟踪置位
    handle.push(eventMessage("turn/start", 1) as never);
    await new Promise((r) => setTimeout(r, 20));
    // busy 的 s-x 被跳过；空闲的主会话被回收（主会话入池后同语义）
    expect(bridge.recycleIdleChannels()).toBe(1);
    expect(handle.state.killed).toBe(0);
    expect(main.state.killed).toBe(1);
    // 收轮：turn/end（事件注入路径）
    handle.push(eventMessage("turn/end", 1) as never);
    handle.push({ type: "idle" } as never);
    await expect(pending).resolves.toMatchObject({ accepted: "m1" });
    await new Promise((r) => setTimeout(r, 20));
    expect(bridge.recycleIdleChannels()).toBe(1); // 收轮后可回收
    expect(handle.state.killed).toBe(1);
  });

  it("回收后同会话再投递 → agentFactory 重派生新通道（--db 恢复语义的池面）", async () => {
    const { bridge, factoryMade } = makeBridge();
    await bridge.sendSystemPrompt("s-r", { type: "prompt", messageId: "m1", content: "x" });
    await new Promise((r) => setTimeout(r, 20));
    expect(bridge.recycleIdleChannels()).toBe(2); // 主会话 + s-r（均空闲）
    await bridge.sendSystemPrompt("s-r", { type: "prompt", messageId: "m2", content: "y" });
    await new Promise((r) => setTimeout(r, 20));
    expect(factoryMade).toHaveLength(2);
    expect(factoryMade[1]!.sessionId).toBe("s-r"); // 重派生同 id
  });
});

describe("update op 的结构性段热加载触发", () => {
  const gateway = {
    update: async (patch: Record<string, unknown>) =>
      ({ version: 1 as const, providers: [], permission: {}, sandbox: {}, appearance: { theme: "dark", language: "zh-CN" }, logging: {}, projects: [], prompts: [], mcp: [], profiles: [], ...patch }) as never,
  } as never;

  it("结构性段命中 → 注入的 reload 被调且回执带 hotReloaded；非结构段不触发", async () => {
    let calls = 0;
    setStructuralReload(() => {
      calls += 1;
      return 2;
    });
    try {
      const structural = (await tryPluginSettingsOp(gateway, { op: "update", patch: { subagentBackend: { backend: "acp" } } } as never)) as { hotReloaded?: number };
      expect(structural.hotReloaded).toBe(2);
      expect(calls).toBe(1);
      const plain = (await tryPluginSettingsOp(gateway, { op: "update", patch: { chat: { sendOnEnter: false } } } as never)) as { hotReloaded?: number };
      expect(plain.hotReloaded).toBeUndefined();
      expect(calls).toBe(1);
    } finally {
      setStructuralReload(undefined);
    }
  });

  it("结构性段闭集包含本批新键（subagentBackend/computerUse），chat 不在内", () => {
    expect(STRUCTURAL_HOT_RELOAD_SECTIONS).toContain("subagentBackend");
    expect(STRUCTURAL_HOT_RELOAD_SECTIONS).toContain("computerUse");
    expect(STRUCTURAL_HOT_RELOAD_SECTIONS).not.toContain("chat");
  });
});
