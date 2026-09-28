/**
 * 轨迹回放测试（L4/T-P1-126）：请求级重放、工具归属、压缩视窗、纯读面。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { buildChatMessages } from "../session/messages.js";
import type { NewSessionEvent, SessionEvent } from "../kernel/events.js";
import { replaySession } from "./replay.js";

let seq = 0;
const ev = (e: Record<string, unknown>): SessionEvent =>
  ({ ...e, seq: ++seq, ts: 0 }) as unknown as SessionEvent;

const header = (turn: number, step: number, reason = "initial"): Record<string, unknown> => ({
  type: "request/header",
  turn,
  step,
  config: { provider: "openai", modelId: "gpt-test" },
  reason,
});

const fullTurn = (): SessionEvent[] => [
  ev({ type: "turn/start", turn: 1 }),
  ev({ type: "user/message", turn: 1, message: { content: "第一问" }, source: "user", promptId: "p1" }),
  ev(header(1, 1)),
  ev({ type: "step/start", turn: 1, step: 1 }),
  ev({
    type: "assistant/message",
    turn: 1,
    step: 1,
    message: { content: "我看一下" },
    stream: [],
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 0, reasoningTokens: 0 },
  }),
  ev({ type: "tool/call", turn: 1, step: 1, callId: "c1", name: "read", arguments: '{"path":"/x"}' }),
  ev({ type: "tool/result", turn: 1, step: 1, callId: "c1", message: { content: "file body" } }),
  ev({ type: "step/end", turn: 1, step: 1, timing: {} }),
  ev(header(1, 2, "series")),
  ev({ type: "step/start", turn: 1, step: 2 }),
  ev({ type: "assistant/message", turn: 1, step: 2, message: { content: "文件内容是…" }, stream: [] }),
  ev({ type: "step/end", turn: 1, step: 2, timing: {} }),
  ev({ type: "turn/end", turn: 1, reason: { kind: "completed" } }),
];

describe("replaySession（L4/T-P1-126）", () => {
  beforeEach(() => {
    seq = 0;
  });

  it("逐请求重放：每 header 一条目；messages 与 buildChatMessages upToSeq 一致；identity 从 header", () => {
    const events = fullTurn();
    const entries = replaySession(events);
    expect(entries).toHaveLength(2);
    // 第一请求：模型看到 user/message；身份来自 header.config
    expect(entries[0]!.turn).toBe(1);
    expect(entries[0]!.step).toBe(1);
    expect(entries[0]!.reason).toBe("initial");
    expect(entries[0]!.identity).toEqual({ provider: "openai", modelId: "gpt-test" });
    expect(entries[0]!.messages).toEqual(buildChatMessages(events, { upToSeq: 3 }));
    expect(entries[0]!.messages.at(-1)).toMatchObject({ role: "user", content: "第一问" });
    // 第二请求（series）：模型还看到第一轮的 assistant 消息 + tool 结果
    expect(entries[1]!.reason).toBe("series");
    expect(entries[1]!.messages.at(-1)).toMatchObject({ role: "tool", callId: "c1" });
  });

  it("工具调用归属：response.toolCalls 与该 step 的 tool/call 对应；usage 回填", () => {
    const entries = replaySession(fullTurn());
    expect(entries[0]!.response).toEqual({
      content: "我看一下",
      toolCalls: [{ id: "c1", name: "read", arguments: '{"path":"/x"}' }],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 0, reasoningTokens: 0 },
    });
    // 第二 step 无工具调用
    expect(entries[1]!.response).toEqual({ content: "文件内容是…", toolCalls: [] });
  });

  it("多轮：轮数 = turn/start 数；各轮条目按流序", () => {
    seq = 0;
    const events = [
      ...fullTurn(),
      ev({ type: "turn/start", turn: 2 }),
      ev({ type: "user/message", turn: 2, message: { content: "第二问" }, source: "user", promptId: "p2" }),
      ev(header(2, 1)),
      ev({ type: "assistant/message", turn: 2, step: 1, message: { content: "答二" }, stream: [] }),
      ev({ type: "turn/end", turn: 2, reason: { kind: "completed" } }),
    ];
    const entries = replaySession(events);
    expect(entries.map((e) => `${e.turn}:${e.step}`)).toEqual(["1:1", "1:2", "2:1"]);
    expect(entries[2]!.messages.at(-1)).toMatchObject({ role: "user", content: "第二问" });
  });

  it("revert 视窗语义贯穿重放（切点前的消息不进后续请求）", () => {
    seq = 0;
    const events = [
      ...fullTurn(),
      ev({ type: "session/revert", turn: 1, targetSeq: 2, phase: "revert" }),
      ev({ type: "turn/start", turn: 2 }),
      ev({ type: "user/message", turn: 2, message: { content: "重新问" }, source: "user", promptId: "p2" }),
      ev(header(2, 1, "resume")),
      ev({ type: "assistant/message", turn: 2, step: 1, message: { content: "重答" }, stream: [] }),
      ev({ type: "turn/end", turn: 2, reason: { kind: "completed" } }),
    ];
    const entries = replaySession(events);
    expect(entries).toHaveLength(3);
    // resume 请求：有效视窗切回 seq≤2——只看到 user/message"第一问"（同内容）
    const msgs = entries[2]!.messages;
    expect(msgs.filter((m) => m.role === "user").map((m) => ("content" in m ? m.content : ""))).toEqual([
      "第一问",
      "重新问",
    ]);
  });

  it("纯读面：输入流零改写（事件对象与数组不变）", () => {
    const events = fullTurn();
    const snapshot = JSON.stringify(events);
    replaySession(events);
    expect(JSON.stringify(events)).toBe(snapshot);
  });

  it("事件计数（P2/T-P2-102 #22 后 27）：replay 纯读面零扩展复核", async () => {
    const { EVENT_TYPES } = await import("../kernel/events.js");
    expect(EVENT_TYPES).toHaveLength(27);
  });
});

