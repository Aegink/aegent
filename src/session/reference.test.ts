import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../kernel/events.js";
import {
  MAX_REF_CHARS,
  MAX_REF_HEAD_EVENTS,
  MAX_SESSION_REFS,
  ReferenceError,
  SESSION_REF_WARNING,
  assertNoReferenceCycle,
  buildReferenceExcerpt,
  refsOfEvents,
  validateSessionRefs,
} from "./reference.js";
import { SessionStore } from "./store.js";

function userEvent(seq: number, content: string, refs?: Array<{ sessionId: string; upToSeq?: number }>): SessionEvent {
  return {
    type: "user/message",
    seq,
    ts: 0,
    turn: 1,
    message: { content },
    source: "user",
    ...(refs !== undefined ? { sessionRefs: refs } : {}),
  } as SessionEvent;
}

function assistantEvent(seq: number, content: string): SessionEvent {
  return {
    type: "assistant/message",
    seq,
    ts: 0,
    turn: 1,
    step: 1,
    message: { content },
    stream: [],
  } as SessionEvent;
}

describe("会话引用（E9/T-P2-107）", () => {
  it("validateSessionRefs：形状/上限（≤3）/去重/坏形状 fail-closed", () => {
    expect(validateSessionRefs([{ sessionId: "s-a" }])).toEqual([{ sessionId: "s-a" }]);
    expect(validateSessionRefs([{ sessionId: "s-a", upToSeq: 5 }])).toEqual([
      { sessionId: "s-a", upToSeq: 5 },
    ]);
    // 去重（同 id 只留首现）
    expect(validateSessionRefs([{ sessionId: "s-a" }, { sessionId: "s-a", upToSeq: 9 }])).toEqual([
      { sessionId: "s-a" },
    ]);
    // 上限 3（dsh maxReferences 同值）
    expect(MAX_SESSION_REFS).toBe(3);
    expect(
      validateSessionRefs([{ sessionId: "a" }, { sessionId: "b" }, { sessionId: "c" }]),
    ).toHaveLength(3);
    try {
      validateSessionRefs([{ sessionId: "a" }, { sessionId: "b" }, { sessionId: "c" }, { sessionId: "d" }]);
    } catch (error) {
      expect((error as ReferenceError).code).toBe("REFERENCE_TOO_MANY");
    }
    // 坏形状
    for (const bad of [null, "x", [1], [{ sessionId: "" }], [{ sessionId: "a", upToSeq: 0 }], [{ sessionId: "a", upToSeq: 1.5 }]]) {
      expect(() => validateSessionRefs(bad)).toThrow(ReferenceError);
    }
  });

  it("环检测：A 引 B、B 引 A 拒绝；自引拒绝；DAG 放行；读不到的会话视作无引用", () => {
    const streams: Record<string, SessionEvent[]> = {
      "s-a": [userEvent(1, "a 引 b", [{ sessionId: "s-b" }])],
      "s-b": [userEvent(1, "b 引 c", [{ sessionId: "s-c" }])],
      "s-c": [userEvent(1, "c 自己玩")],
      "s-x": [userEvent(1, "x 引 a", [{ sessionId: "s-a" }])],
    };
    const reader = {
      refsOf: (id: string) => (id in streams ? refsOfEvents(streams[id]!) : undefined),
    };

    // 间接环：x → a → b → c（a→…不回到 x，放行）；b 引 x 会成环
    expect(() => assertNoReferenceCycle("s-a", [{ sessionId: "s-b" }], reader)).not.toThrow();
    expect(() => assertNoReferenceCycle("s-a", [{ sessionId: "s-b" }], reader)).not.toThrow();

    // 直接环：a 要引 x，而 x 引 a → 拒绝
    try {
      assertNoReferenceCycle("s-a", [{ sessionId: "s-x" }], reader);
    } catch (error) {
      expect((error as ReferenceError).code).toBe("REFERENCE_CYCLE");
    }
    // 两跳环：a 要引 c（c 无引用，放行）；让 b 引 a 后 a 引 b 成环
    const reader2 = {
      refsOf: (id: string) =>
        id === "s-b" ? refsOfEvents([userEvent(1, "b 引 a", [{ sessionId: "s-a" }])]) : reader.refsOf(id),
    };
    expect(() => assertNoReferenceCycle("s-a", [{ sessionId: "s-b" }], reader2)).toThrow(/引用环/);

    // 自引
    expect(() => assertNoReferenceCycle("s-a", [{ sessionId: "s-a" }], reader)).toThrow(ReferenceError);

    // 读不到的会话（跨库/未装载）视作无引用——不误报环（已知边界记档）
    expect(() => assertNoReferenceCycle("s-a", [{ sessionId: "s-unknown" }], reader)).not.toThrow();
  });

  it("快照构建：upToSeq 视窗 + 头部 N 条上限 + 摘要优先 + 不可信警示", () => {
    // 30 条消息（超过头部上限）+ 一条已完成压缩摘要 + 一条 started（不作数）
    const events: SessionEvent[] = [
      { type: "compaction", seq: 1, ts: 0, turn: 0, summary: "旧摘要", retainedTail: 0, tokensBefore: 10, status: "completed" } as SessionEvent,
      { type: "compaction", seq: 2, ts: 0, turn: 0, summary: "新摘要", retainedTail: 0, tokensBefore: 10, status: "completed" } as SessionEvent,
      { type: "compaction", seq: 3, ts: 0, turn: 0, summary: "进行中摘要（不作数）", retainedTail: 0, tokensBefore: 10, status: "started" } as SessionEvent,
      ...Array.from({ length: 30 }, (_, i) => userEvent(4 + i, `msg-${i}`)),
    ];

    const full = buildReferenceExcerpt(events, { sessionId: "s-ref" });
    expect(full).toContain("[引用会话 s-ref]");
    expect(full).toContain(SESSION_REF_WARNING);
    expect(full).toContain("摘要：新摘要"); // 最新已结算摘要
    expect(full).not.toContain("进行中摘要");
    // 头部 N 条上限：msg-0..19 在、msg-20+ 不在
    expect(full).toContain("user: msg-0");
    expect(full).toContain(`user: msg-${MAX_REF_HEAD_EVENTS - 1}`);
    expect(full).not.toContain(`user: msg-${MAX_REF_HEAD_EVENTS}`);

    // upToSeq 视窗：只取 seq ≤ 6 的事件（msg-0..2）
    const windowed = buildReferenceExcerpt(events, { sessionId: "s-ref", upToSeq: 6 });
    expect(windowed).toContain("upToSeq=6");
    expect(windowed).toContain("user: msg-0");
    expect(windowed).toContain("user: msg-2");
    expect(windowed).not.toContain("user: msg-3");

    // 空视窗
    const empty = buildReferenceExcerpt([], { sessionId: "s-empty" });
    expect(empty).toContain("没有可引用的消息");
  });

  it("快照字符预算：超长内容截断（MAX_REF_CHARS）+ 截断标记", () => {
    const events: SessionEvent[] = [
      userEvent(1, "x".repeat(MAX_REF_CHARS * 2)),
    ];
    const text = buildReferenceExcerpt(events, { sessionId: "s-big" });
    expect(text.length).toBeLessThanOrEqual(MAX_REF_CHARS + "…（引用快照按字符预算截断）".length);
    expect(text).toContain("引用快照按字符预算截断");
  });

  it("流存引用不存内容：user/message 载荷只有指针（引用方流零被引内容字节）", () => {
    const store = new SessionStore();
    store.append("s-ref", [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "被引会话的私密内容 SECRET-NEEDLE" }, source: "user" },
      { type: "turn/end", turn: 1, reason: { kind: "completed" } },
    ]);
    store.append("s-citing", [
      {
        type: "turn/start",
        turn: 1,
      },
      {
        type: "user/message",
        turn: 1,
        message: { content: "看看引用" },
        source: "user",
        sessionRefs: [{ sessionId: "s-ref", upToSeq: 2 }],
      },
      { type: "turn/end", turn: 1, reason: { kind: "completed" } },
    ]);

    const citing = JSON.stringify(store.load("s-citing"));
    expect(citing).toContain("\"sessionRefs\":[{\"sessionId\":\"s-ref\",\"upToSeq\":2}]");
    expect(citing).not.toContain("SECRET-NEEDLE"); // 被引内容零字节进引用方流

    // 引用快照是读取时现算（同一流可算出、但从不落进引用方的流）
    const excerpt = buildReferenceExcerpt(store.load("s-ref"), { sessionId: "s-ref", upToSeq: 2 });
    expect(excerpt).toContain("SECRET-NEEDLE");
  });

  it("refsOfEvents：跨 user/message 聚合去重（环检测读取原语）", () => {
    const events: SessionEvent[] = [
      assistantEvent(1, "无关"),
      userEvent(2, "第一引", [{ sessionId: "s-a" }]),
      userEvent(3, "第二引", [{ sessionId: "s-b" }, { sessionId: "s-a" }]),
    ];
    expect(refsOfEvents(events)).toEqual([{ sessionId: "s-a" }, { sessionId: "s-b" }]);
    expect(refsOfEvents([assistantEvent(1, "x")])).toEqual([]);
  });
});
