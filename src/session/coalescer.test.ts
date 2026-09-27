import { describe, expect, it } from "vitest";

import type { NewSessionEvent, SessionEvent } from "../kernel/events.js";
import {
  coalesceEvents,
  foldCoalesced,
  PROGRESS_RULE,
  type CoalesceRule,
} from "./coalescer.js";
import { buildChatMessages } from "./messages.js";
import { Projector } from "./project.js";

let seq = 0;
const ev = (e: NewSessionEvent): SessionEvent =>
  ({ ...e, seq: ++seq, ts: 1_700_000_000_000 }) as SessionEvent;

const progress = (callId: string, seqInCall: number): SessionEvent =>
  ev({ type: "tool/progress", turn: 1, step: 1, callId, seqInCall, message: `第 ${seqInCall} 步` });

describe("coalesceEvents（E15/T-P1-88 事件合并器）", () => {
  it("同 callId 12 条 progress 折叠为最新 1 条；不同 callId 不互折叠", () => {
    const events = [
      progress("c1", 1),
      progress("c1", 2),
      progress("c2", 1),
      ...Array.from({ length: 10 }, (_, i) => progress("c1", 3 + i)),
      progress("c2", 2),
    ];
    const out = coalesceEvents(events);
    const kept = out.filter((e) => e.type === "tool/progress");
    expect(kept).toHaveLength(2); // c1 最新一条 + c2 最新一条
    expect(kept.map((e) => (e.type === "tool/progress" ? e.seqInCall : 0))).toEqual([12, 2]);
    // 保序：c2 的最新条仍在 c1 最新条之后
    const indexOf = (e: SessionEvent): number => out.indexOf(e);
    expect(indexOf(kept[0]!)).toBeLessThan(indexOf(kept[1]!));
  });

  it("折叠是视图行为：输入数组与元素逐字节不变（不变量 1 的读取面纪律）", () => {
    const events = [progress("c1", 1), progress("c1", 2), progress("c1", 3)];
    const snapshot = JSON.parse(JSON.stringify(events));
    const out = coalesceEvents(events);
    expect(out).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(events))).toEqual(snapshot);
    expect(events).toHaveLength(3);
  });

  it("自定义规则可扩展：todo/update 按'整值最新'折叠为独立消费面", () => {
    const rules: CoalesceRule[] = [
      PROGRESS_RULE,
      { typeName: "todo/update", keyOf: (e) => (e.type === "todo/update" ? "items" : "") },
    ];
    const events: SessionEvent[] = [
      ev({ type: "todo/update", turn: 0, items: [{ content: "甲", status: "pending" }] }),
      ev({ type: "tool/call", turn: 1, step: 1, callId: "c1", name: "bash", arguments: "{}" }),
      ev({ type: "todo/update", turn: 0, items: [{ content: "甲", status: "completed" }] }),
    ];
    const out = coalesceEvents(events, rules);
    // 穿插的 tool/call 保留；两条 todo 只留最新（E12 整值语义下的视图折叠）
    expect(out.map((e) => e.type)).toEqual(["tool/call", "todo/update"]);
  });

  it("折叠后消息重建 = 不折叠消息重建（progress 不进消息——E12 等价域）；foldCoalesced 投影等价", () => {
    // 局部 seq（从 1 连续）——fold 的 E16 seq 连续性校验要求完整流合法
    let localSeq = 0;
    const sev = (e: NewSessionEvent): SessionEvent =>
      ({ ...e, seq: ++localSeq, ts: 1_700_000_000_000 }) as SessionEvent;
    const sprogress = (callId: string, seqInCall: number): SessionEvent =>
      sev({ type: "tool/progress", turn: 1, step: 1, callId, seqInCall, message: `第 ${seqInCall} 步` });
    const events: SessionEvent[] = [
      sev({ type: "turn/start", turn: 1 }),
      sev({ type: "user/message", turn: 1, message: { content: "hi" }, source: "user" }),
      sev({ type: "step/start", turn: 1, step: 1 }),
      sev({ type: "tool/call", turn: 1, step: 1, callId: "c1", name: "bash", arguments: "{}" }),
      sprogress("c1", 1),
      sprogress("c1", 2),
      sprogress("c1", 3),
      sev({ type: "tool/result", turn: 1, step: 1, callId: "c1", message: { content: "done" } }),
      sev({ type: "assistant/message", turn: 1, step: 1, message: { content: "答" }, stream: [] }),
      sev({ type: "step/end", turn: 1, step: 1 }),
      sev({ type: "turn/end", turn: 1, reason: { kind: "completed" } }),
    ];
    expect(coalesceEvents(events)).toHaveLength(events.length - 2);
    // 消息重建逐条等价（折叠 vs 不折叠）
    const raw = JSON.stringify(buildChatMessages(events));
    const coalesced = JSON.stringify(buildChatMessages(coalesceEvents(events)));
    expect(coalesced).toBe(raw);
    // 折叠投影 = 完整投影（逐域等价——progress 是投影不消费的瞬态事实）；
    // seq 除外：foldCoalesced 的视图重编号使 seq 位移（预期，位置序非事实序）
    const stripSeq = (ms: { seq: number; role: string; content: string }[]) =>
      ms.map((m) => ({ role: m.role, content: m.content }));
    const folded = foldCoalesced(events).projection;
    const plain = Projector.fold(events).projection;
    expect(JSON.stringify(stripSeq(folded.messages))).toBe(JSON.stringify(stripSeq(plain.messages)));
    expect(folded.turnCount).toBe(plain.turnCount);
  });
});

