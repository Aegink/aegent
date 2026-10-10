import { describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "../kernel/events.js";
import { buildChatMessages } from "../session/messages.js";
import {InMemoryEventStorage, SessionEventStore, type SessionStore} from "../session/store.js";
import { HostRegistry } from "./registry.js";
import { activeRoster } from "./roster.js";

function ev(partial: Partial<SessionEvent> & { type: string; seq: number }): SessionEvent {
  return { turn: 0, ts: 1, ...partial } as unknown as SessionEvent;
}

describe("N8/T-P1-114 surface roster 投影（activeRoster）", () => {
  it("attach 入册（deliveryKind 快照）+ detach 出册", () => {
    const roster = activeRoster([
      ev({ type: "surface/attach", seq: 1, surfaceId: "desktop-1", deliveryKind: "push" }),
      ev({ type: "surface/attach", seq: 2, surfaceId: "feishu-1", deliveryKind: "poll" }),
    ]);
    expect(roster).toEqual([
      { surfaceId: "desktop-1", deliveryKind: "push" },
      { surfaceId: "feishu-1", deliveryKind: "poll" },
    ]);
    const after = activeRoster([
      ev({ type: "surface/attach", seq: 1, surfaceId: "desktop-1", deliveryKind: "push" }),
      ev({ type: "surface/attach", seq: 2, surfaceId: "feishu-1", deliveryKind: "poll" }),
      ev({ type: "surface/detach", seq: 3, surfaceId: "feishu-1", reason: "disconnected" }),
    ]);
    expect(after).toEqual([{ surfaceId: "desktop-1", deliveryKind: "push" }]);
  });

  it("重复 attach 幂等（roster 是集合，最新 deliveryKind 生效）", () => {
    const roster = activeRoster([
      ev({ type: "surface/attach", seq: 1, surfaceId: "cli", deliveryKind: "push" }),
      ev({ type: "surface/attach", seq: 2, surfaceId: "cli", deliveryKind: "poll" }),
    ]);
    expect(roster).toEqual([{ surfaceId: "cli", deliveryKind: "poll" }]);
  });

  it("未 attach 的 detach 是 no-op（删除收敛语义）", () => {
    const roster = activeRoster([
      ev({ type: "surface/detach", seq: 1, surfaceId: "ghost" }),
    ]);
    expect(roster).toEqual([]);
  });

  it("恢复恒等：同流两次推导 + 重读新数组实例推导相等（流即状态）", () => {
    const events = [
      ev({ type: "surface/attach", seq: 1, surfaceId: "desktop-1", deliveryKind: "push" }),
      ev({ type: "turn/start", seq: 2, turn: 1 }),
      ev({ type: "surface/attach", seq: 3, surfaceId: "feishu-1", deliveryKind: "poll" }),
      ev({ type: "surface/detach", seq: 4, surfaceId: "feishu-1" }),
    ];
    const a = activeRoster(events);
    const b = activeRoster([...events]);
    const c = activeRoster(events.map((e) => ({ ...e })));
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it("非 surface 事件不影响 roster（turn 域事件穿越）", () => {
    const roster = activeRoster([
      ev({ type: "surface/attach", seq: 1, surfaceId: "cli", deliveryKind: "push" }),
      ev({ type: "user/message", seq: 2, turn: 1, message: { content: "hi" }, source: "user" }),
      ev({ type: "model/switch", seq: 3, from: { provider: "a", modelId: "x" }, to: { provider: "a", modelId: "y" }, reason: "user" }),
    ]);
    expect(roster).toEqual([{ surfaceId: "cli", deliveryKind: "push" }]);
  });
});

describe("N8/T-P1-114 host 连接生命周期落流面", () => {
  it("connect → surface/attach 落流、close → surface/detach 落流（store.append 分配 seq/ts）", () => {
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-a" });
    const store = new SessionEventStore(new InMemoryEventStorage());
    // 落流面：装配方订阅 registry 分发 → append（生产面同构）
    registry.subscribe((sessionId, event) => {
      const { seq: _s, ts: _t, ...rest } = event as SessionEvent & { seq: number; ts: number };
      store.append(sessionId, [rest as never]);
    });

    const cli = host.surfaces.connect("cli", "push");
    cli.close();
    const events = store.load("s-a");
    expect(events.map((e) => e.type)).toEqual(["surface/attach", "surface/detach"]);
    expect(events[0]).toMatchObject({ surfaceId: "cli", deliveryKind: "push", seq: 1 });
    expect(events[1]).toMatchObject({ surfaceId: "cli", reason: "disconnected", seq: 2 });
  });

  it("断线释放也产生 detach（自动释放面与显式 close 同路）", () => {
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-a" });
    const listener = vi.fn();
    registry.subscribe(listener);
    const a = host.surfaces.connect("a", "poll");
    host.surfaces.acquireRunLease("a");
    a.close();
    const types = listener.mock.calls.map((c) => (c[1] as SessionEvent).type);
    expect(types).toEqual(["surface/attach", "surface/detach"]);
  });

  it("roster 从 host 落流重建：连接两枚 + 断开一枚 → 在册一枚（端到端）", () => {
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-a" });
    const store = new SessionEventStore(new InMemoryEventStorage());
    registry.subscribe((sessionId, event) => {
      const { seq: _s, ts: _t, ...rest } = event as SessionEvent & { seq: number; ts: number };
      store.append(sessionId, [rest as never]);
    });
    const a = host.surfaces.connect("desktop", "push");
    host.surfaces.connect("feishu", "poll");
    a.close();
    expect(activeRoster(store.load("s-a"))).toEqual([
      { surfaceId: "feishu", deliveryKind: "poll" },
    ]);
  });
});

describe("N8/T-P1-114 log-only 纪律与校验面", () => {
  it("surface 事件不进模型历史（buildChatMessages 不消费——append 后投影可见）", () => {
    const events = [
      ev({ type: "surface/attach", seq: 1, surfaceId: "cli", deliveryKind: "push" }),
      ev({ type: "user/message", seq: 2, turn: 1, message: { content: "hi" }, source: "user" }),
      ev({ type: "surface/detach", seq: 3, surfaceId: "cli", reason: "disconnected" }),
    ];
    const messages = buildChatMessages(events as SessionEvent[]);
    const roles = (messages as Array<{ role: string }>).map((m) => m.role);
    expect(roles).toEqual(["user"]); // surface 事件零消费（log-only）
  });

  it("project 校验：非法 deliveryKind / 空 surfaceId 拒绝（append 即拦）", () => {
    const store = new SessionEventStore(new InMemoryEventStorage());
    expect(() =>
      store.append("s-a", [{ type: "surface/attach", turn: 0, surfaceId: "x", deliveryKind: "carrier" } as never]),
    ).toThrowError(/deliveryKind 非法/);
    expect(() =>
      store.append("s-a", [{ type: "surface/detach", turn: 0, surfaceId: "" } as never]),
    ).toThrowError(/surfaceId 非空/);
  });
});
