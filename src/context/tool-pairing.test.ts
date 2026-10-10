/**
 * T-7-05 验收（F17）：
 * ① 喂含未配对 tool/call 的流：切点自动回退到配平位置（切点前的子流过
 *    expectPaired 配平断言）；
 * ② 人为伪造 step 标记与内容不符时切点仍正确（内容现算证据——切点只看
 *    tool/call↔tool/result，对 step 边界标记免疫）。
 */

import { describe, expect, it } from "vitest";
import type { NewSessionEvent, SessionEvent } from "../kernel/events.js";
import { expectPaired } from "../test-support/event-asserts.js";
import {
  advancePairing,
  balancedCutAfter,
  initialPairingState,
  latestBalancedCutAtOrBefore,
  ToolPairingError,
} from "./tool-pairing.js";

/** 最小合法流骨架：turn/step 开合 + tool 配对块，事件顺序按入参拼接。 */
function baseEvents(): SessionEvent[] {
  const mk = (seq: number, e: NewSessionEvent): SessionEvent =>
    ({ ...e, seq, ts: 0 }) as SessionEvent;
  return [
    mk(1, { type: "turn/start", turn: 1 }),
    mk(2, { type: "user/message", turn: 1, message: { content: "旧问题" }, source: "user" }),
    mk(3, { type: "step/start", turn: 1, step: 1 }),
    mk(4, { type: "assistant/message", turn: 1, step: 1, message: { content: "回答" }, stream: [] }),
    mk(5, { type: "step/end", turn: 1, step: 1 }),
    mk(6, { type: "turn/end", turn: 1, reason: { kind: "completed" } }),
  ];
}

/** 追加 call+result 配对块（同一 step 内，loop 的落盘顺序）。 */
function pairBlock(seq: number, turn: number, callId: string): SessionEvent[] {
  const mk = (s: number, e: NewSessionEvent): SessionEvent =>
    ({ ...e, seq: s, ts: 0 }) as SessionEvent;
  return [
    mk(seq, { type: "tool/call", turn, step: 1, callId, name: "bash", arguments: "{}" }),
    mk(seq + 1, { type: "tool/result", turn, step: 1, callId, message: { content: "输出" } }),
  ];
}

describe("增量配平状态机", () => {
  it("合法流：call 开着的位置不配平、result 后恢复配平；advancePairing 与全量扫描一致", () => {
    const events = [
      ...baseEvents(),
      ...pairBlock(7, 1, "c1"),
      (() => {
        const mk = (s: number, e: NewSessionEvent): SessionEvent =>
          ({ ...e, seq: s, ts: 0 }) as SessionEvent;
        return mk(9, { type: "turn/start", turn: 2 });
      })(),
    ];
    const cuts = balancedCutAfter(events);
    expect(cuts).toHaveLength(9);
    // call（seq=7）后开着 → 不配平；result（seq=8）后恢复 → 配平
    expect(cuts[6]).toBe(false);
    expect(cuts[7]).toBe(true);
    expect(cuts[8]).toBe(true);
    // 增量推进 = 全量扫描（分两段推）
    const s1 = advancePairing(initialPairingState(), events.slice(0, 5));
    expect(s1).toEqual({ lastSeq: 5, inProgress: 0 });
    const s2 = advancePairing(s1, events.slice(5));
    expect(s2).toEqual({ lastSeq: 9, inProgress: 0 });
  });

  it("孤立 tool/result（corrupt surface）→ ToolPairingError 带 seq，增量与全量同抛", () => {
    const mk = (s: number, e: NewSessionEvent): SessionEvent =>
      ({ ...e, seq: s, ts: 0 }) as SessionEvent;
    const events = [
      ...baseEvents(),
      mk(7, { type: "tool/result", turn: 1, step: 1, callId: "c9", message: { content: "out" } }), // 无前置 call
    ];
    expect(() => balancedCutAfter(events)).toThrow(ToolPairingError);
    expect(() => balancedCutAfter(events)).toThrow(/seq=7/);
    const state = advancePairing(initialPairingState(), events.slice(0, 6));
    expect(state).toEqual({ lastSeq: 6, inProgress: 0 });
    expect(() => advancePairing(state, events.slice(6))).toThrow(ToolPairingError);
  });

  it("增量推进断档（跳过片段）→ 抛错防假配平", () => {
    const events = [...baseEvents(), ...pairBlock(7, 1, "c1")];
    // 从流起点直接推 seq=8(跳过 seq 1..7)→ 断档
    expect(() => advancePairing(initialPairingState(), [events[7]!])).toThrow(ToolPairingError);
  });

  it("latestBalancedCutAtOrBefore：回退到最近配平点；流起点 0 恒兜底", () => {
    // 流尾悬挂 call（崩溃残留）：call 落了、result 没落
    const events = [
      ...baseEvents(),
      (() => {
        const mk = (s: number, e: NewSessionEvent): SessionEvent =>
          ({ ...e, seq: s, ts: 0 }) as SessionEvent;
        return mk(7, { type: "tool/call", turn: 2, step: 1, callId: "cx", name: "bash", arguments: "{}" });
      })(),
    ];
    // toSeq=7（call 之后）：最近配平点是 seq=6（call 之前）
    expect(latestBalancedCutAtOrBefore(events, 7)).toBe(6);
    // toSeq=6：本身就是配平点
    expect(latestBalancedCutAtOrBefore(events, 6)).toBe(6);
    // toSeq 覆盖不了任何配平点（首事件前）→ 0
    expect(latestBalancedCutAtOrBefore(events.slice(0, 0), 100)).toBe(0);
  });
});

describe("验收①：切点自动回退到配平位置（接入压缩切点选择）", () => {
  it("流尾悬挂 call 时,压缩 retainedTail 回退到 call 之前的配平位置;切点前子流过 expectPaired", async () => {
    const { SessionEventStore } = await import("../session/store.js");
    const { CompactionEngine } = await import("./compaction.js");
    const SESSION = "s-pairing";
    const store = new SessionEventStore();
    // turn 1 完整(含配对块);turn 2 开头落了一个 call 后"崩溃"——result 永远没来
    store.append(SESSION, [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "旧问题" }, source: "user" },
      { type: "step/start", turn: 1, step: 1 },
      { type: "assistant/message", turn: 1, step: 1, message: { content: "" }, stream: [] },
      { type: "tool/call", turn: 1, step: 1, callId: "c1", name: "bash", arguments: "{}" },
      { type: "tool/result", turn: 1, step: 1, callId: "c1", message: { content: "输出" } },
      { type: "step/end", turn: 1, step: 1 },
      { type: "turn/end", turn: 1, reason: { kind: "completed" } },
      { type: "turn/start", turn: 2 },
      { type: "user/message", turn: 2, message: { content: "新问题" }, source: "user" },
      { type: "step/start", turn: 2, step: 1 },
      { type: "assistant/message", turn: 2, step: 1, message: { content: "" }, stream: [] },
      { type: "tool/call", turn: 2, step: 1, callId: "cx", name: "bash", arguments: "{}" },
    ]);
    const engine = new CompactionEngine({
      sessionId: SESSION,
      store,
      summarizer: async () => "配平回退摘要",
      keepRules: { retainedFromEnd: 1 },
    });
    const result = await engine.run({
      turn: 2,
      phase: "MidTurn",
      request: { reason: "local-overflow", estimatedTokens: 9000, contextWindow: 8000 },
    });
    if (result.kind !== "compacted") throw new Error("应当压缩成功");
    const events = store.load(SESSION);
    const callCx = events.find((e) => e.type === "tool/call" && e.callId === "cx")!;
    // 候选边界是"新问题"前一条(seq-1)——但那在悬挂 call(cx) 之前吗?不在:
    // cx 在"新问题"之后落盘。候选位置本配平,但 retainedTail 必须 ≤ cx.seq-1
    // ……实际:候选 = 新问题.seq-1,该处配平(call 都闭合)→ retainedTail = 候选
    // 但这样 cx 与新问题都被摘要覆盖,配平块(c1)也整块覆盖——安全。
    // 反向场景用 latestBalancedCutAtOrBefore 的单元测试覆盖(悬挂在候选之前)。
    // 本用例断言:retainedTail 落在配平位置(切点前子流无开着的 call)
    const pre = events.filter((e) => e.seq <= result.retainedTail);
    const openCalls = new Map<string, true>();
    for (const e of pre) {
      if (e.type === "tool/call") openCalls.set(e.callId, true);
      if (e.type === "tool/result") openCalls.delete(e.callId);
    }
    expect(openCalls.size).toBe(0);
    // 切点前子流过 O7 配平断言(F17 的"复用 expectPaired"消费面)
    expectPaired(pre, "tool/call");
    void callCx;
  });

  it("悬挂 call 落在候选边界之前 → retainedTail 回退到该 call 之前(少摘要不劈对)", async () => {
    const { SessionEventStore } = await import("../session/store.js");
    const { CompactionEngine } = await import("./compaction.js");
    const SESSION = "s-pairing2";
    const store = new SessionEventStore();
    // 同一 turn 内:assistant 落了 call,没有 result(崩溃残留);下一个 user
    // 直接入流(user/message 只要求轮开启)——悬挂 call 落在候选边界之前
    store.append(SESSION, [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "旧问题" }, source: "user" },
      { type: "step/start", turn: 1, step: 1 },
      { type: "assistant/message", turn: 1, step: 1, message: { content: "" }, stream: [] },
      { type: "tool/call", turn: 1, step: 1, callId: "cx", name: "bash", arguments: "{}" },
      { type: "user/message", turn: 1, message: { content: "新问题" }, source: "user" },
    ]);
    const engine = new CompactionEngine({
      sessionId: SESSION,
      store,
      summarizer: async () => "回退摘要",
      keepRules: { retainedFromEnd: 1 },
    });
    const result = await engine.run({
      turn: 1,
      phase: "MidTurn",
      request: { reason: "local-overflow", estimatedTokens: 9000, contextWindow: 8000 },
    });
    if (result.kind !== "compacted") throw new Error("应当压缩成功");
    const events = store.load(SESSION);
    // 候选边界 = 最后一条 user("新问题",seq=6)前一条 = seq 5——call(cx,seq=5)
    // 之后开着 → 不配平;回退到最近配平点 = cx 之前的 seq 4
    expect(result.retainedTail).toBe(4);
    // 切点(4)后保留:悬挂 call + 新问题原文——绝不劈开
    const retained = events.filter((e) => e.seq > result.retainedTail);
    expect(retained.some((e) => e.type === "tool/call" && e.callId === "cx")).toBe(true);
    expect(retained.some((e) => e.type === "user/message" && e.message.content === "新问题")).toBe(true);
  });
});

describe("验收②:伪造 step 标记与内容不符,切点仍正确(内容现算)", () => {
  it("step/end 缺失(step 标记说谎)与 call 块跨 step 谎称,切点只认 tool 内容", () => {
    const mk = (s: number, e: NewSessionEvent): SessionEvent =>
      ({ ...e, seq: s, ts: 0 }) as SessionEvent;
    // 伪造:turn/step 标记声称 call 属于 step 1、result "属于"另一个 step 编号
    // (内容上仍按 callId 配平)——切点选择对 step 标记零依赖
    const events: SessionEvent[] = [
      mk(1, { type: "turn/start", turn: 1 }),
      mk(2, { type: "user/message", turn: 1, message: { content: "q" }, source: "user" }),
      mk(3, { type: "step/start", turn: 1, step: 1 }),
      mk(4, { type: "assistant/message", turn: 1, step: 1, message: { content: "" }, stream: [] }),
      mk(5, { type: "tool/call", turn: 1, step: 1, callId: "c1", name: "bash", arguments: "{}" }),
      // 谎称 step 42(不存在的 step 标记)——内容配平只认 callId
      mk(6, { type: "tool/result", turn: 1, step: 42 as unknown as number, callId: "c1", message: { content: "out" } }),
      mk(7, { type: "turn/end", turn: 1, reason: { kind: "completed" } }),
    ];
    // step 标记是假的,但 callId 配平内容是真的 → seq=6 之后配平
    expect(balancedCutAfter(events).slice(4)).toEqual([false, true, true]);
    expect(latestBalancedCutAtOrBefore(events, 6)).toBe(6);
    // 而 step 标记若被信任(result "属于" step 42,无 step/start)就会得出错误切点
    // ——F17 的内容现算证据:我们根本不读 step
  });
});
