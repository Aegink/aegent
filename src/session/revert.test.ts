import { describe, expect, it } from "vitest";

import type { NewSessionEvent } from "../kernel/events.js";
import {InMemoryEventStorage, SessionEventStore, type SessionStore} from "./store.js";
import { RevertService } from "./revert.js";

/** 恰 5 个事件的合法流（turn 1 留开）。 */
function fiveEvents(): NewSessionEvent[] {
  return [
    { type: "turn/start", turn: 1 },
    { type: "user/message", turn: 1, message: { content: "q1" }, source: "user" },
    { type: "step/start", turn: 1, step: 1 },
    {
      type: "assistant/message",
      turn: 1,
      step: 1,
      message: { content: "a1" },
      stream: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    },
    { type: "tool/call", turn: 1, step: 1, callId: "c1", name: "bash", arguments: "{}" },
  ];
}

function setup(): { store: SessionStore; revert: RevertService } {
  const store = new SessionEventStore(new InMemoryEventStorage());
  store.append("s1", fiveEvents());
  return { store, revert: new RevertService(store) };
}

describe("RevertService（E4）", () => {
  it("验收：append 5 事件 → revert 到 seq=2 → 投影只含前 2 条效果 → unrevert 恢复", () => {
    const { store, revert } = setup();

    const reverted = revert.revert("s1", 2);
    expect(reverted.revertedTo).toBe(2);
    expect(reverted.messages.map((m) => m.seq)).toEqual([2]); // 只剩 seq ≤ 2 的效果
    expect(reverted.toolCalls.size).toBe(0); // seq=5 的 call 被隐藏
    expect(reverted.lastUsage).toBeNull(); // seq=4 的 usage 被隐藏
    // 标记落流（append-only：历史一条不少）
    expect(store.load("s1")).toHaveLength(6);
    expect(store.load("s1")[5]!.type).toBe("session/revert");

    const restored = revert.unrevert("s1");
    expect(restored.revertedTo).toBeNull();
    expect(restored.messages.map((m) => m.seq)).toEqual([2, 4]);
    expect(restored.toolCalls.get("c1")).toBeDefined();
    expect(restored.lastUsage).toEqual({ inputTokens: 1, outputTokens: 1 });
    expect(store.load("s1")).toHaveLength(7); // undo 也是追加，不截断
  });

  it("最新标记生效：revert(4) 后再 revert(2)，切点以后到的为准", () => {
    const { revert } = setup();
    expect(revert.revert("s1", 4).revertedTo).toBe(4);
    expect(revert.revert("s1", 2).revertedTo).toBe(2);
    expect(revert.unrevert("s1").revertedTo).toBeNull();
  });

  it("未 revert 时 unrevert 是幂等 no-op（不落事件）", () => {
    const { store, revert } = setup();
    const before = store.load("s1").length;
    revert.unrevert("s1");
    expect(store.load("s1")).toHaveLength(before);
  });

  it("越界与空会话拒绝", () => {
    const { revert } = setup();
    expect(() => revert.revert("s1", 99)).toThrow(/越界/);
    expect(() => revert.revert("s1", -1)).toThrow(/越界/);
    const empty = new RevertService(new SessionEventStore(new InMemoryEventStorage()));
    expect(() => empty.revert("ghost", 1)).toThrow(/空会话/);
  });

  it("revert 后继续 append：新事件进流（seq 继续），有效投影仍隐藏 seq > 切点的旧效果", () => {
    const { store, revert } = setup();
    revert.revert("s1", 2);
    store.append("s1", [{ type: "user/message", turn: 1, message: { content: "q2" }, source: "user" }]);
    const view = revert.unrevert("s1");
    expect(view.messages.map((m) => m.content)).toEqual(["q1", "a1", "q2"]);
    expect(store.load("s1").length).toBe(8);
  });
});
