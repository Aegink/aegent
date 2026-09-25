import { describe, expect, it } from "vitest";

import {
  decodeMessage,
  decodeRequest,
  ProtocolError,
} from "./agent-protocol.js";
import type { SessionEvent } from "./events.js";

describe("agent-protocol —— T9 可序列化协议", () => {
  it("验收②：协议类型逐一 assignable to JsonValue（型证 + 运行时复证）", () => {
    // 型证在 agent-protocol.ts 底部（_REQUEST_IS_JSON / _MESSAGE_ENVELOPE_IS_JSON，
    // AssertNever 闸门）——tsc 通过即证明 AgentRequest 整体与 AgentMessage 的
    // 包络变体 ⊆ JsonValue。这里对包络值做运行时复证。
    expect(JSON.parse(JSON.stringify({ type: "ready" }))).toEqual({ type: "ready" });
    expect(JSON.parse(JSON.stringify({ type: "accepted", messageId: "m1" }))).toEqual({
      type: "accepted",
      messageId: "m1",
    });
    expect(JSON.parse(JSON.stringify({ type: "dispose" }))).toEqual({ type: "dispose" });
    expect(
      JSON.parse(JSON.stringify({ type: "cancel", cause: { kind: "user" } })),
    ).toEqual({ type: "cancel", cause: { kind: "user" } });
  });

  it("event 载荷（SessionEvent）JSON 往返无损——含 TurnEndReason/CancelCause/stream", () => {
    // SessionEvent 是接口联合（无隐式索引签名）无法型证 JsonValue；
    // 其 JSON 安全由 C14 在 append 源头保证，这里按 wire 往返复证代表性成员。
    const events: SessionEvent[] = [
      { type: "turn/start", seq: 1, ts: 1, turn: 1 },
      {
        type: "turn/end",
        seq: 2,
        ts: 2,
        turn: 1,
        reason: {
          kind: "aborted",
          cause: { kind: "hook", reason: { hook: "sec", code: "DENY" }, message: "拒绝" },
        },
      },
      {
        type: "assistant/message",
        seq: 3,
        ts: 3,
        turn: 1,
        step: 1,
        message: { content: "回声" },
        stream: [{ time: 5, chunk: { type: "text-delta", text: "回" } }],
        usage: { inputTokens: 1, outputTokens: 1 },
        interrupted: true,
      },
      {
        type: "session/revert",
        seq: 4,
        ts: 4,
        turn: 0,
        targetSeq: 2,
        phase: "revert",
      },
    ];
    for (const event of events) {
      const line = JSON.stringify({ type: "event", event });
      expect(decodeMessage(line)).toEqual({ type: "event", event });
    }
  });

  it("decodeRequest：合法请求放行，外部输入逐项校验", () => {
    expect(decodeRequest('{"type":"prompt","messageId":"m1","content":"hi"}')).toEqual({
      type: "prompt",
      messageId: "m1",
      content: "hi",
    });
    expect(decodeRequest('{"type":"cancel","cause":{"kind":"user"}}')).toEqual({
      type: "cancel",
      cause: { kind: "user" },
    });
    expect(decodeRequest('{"type":"dispose"}')).toEqual({ type: "dispose" });

    expect(() => decodeRequest("not json")).toThrow(ProtocolError);
    expect(() => decodeRequest('{"type":"explode"}')).toThrow(/未知请求类型/);
    expect(() => decodeRequest('{"type":"prompt","messageId":"","content":"hi"}')).toThrow(
      /messageId/,
    );
    expect(() => decodeRequest('{"type":"prompt","messageId":"m","content":""}')).toThrow(
      /content/,
    );
    expect(() => decodeRequest('{"type":"cancel","cause":{"kind":"nuclear"}}')).toThrow(
      /kind 白名单/,
    );
    expect(() => decodeRequest('{"type":"cancel","cause":{"kind":"hook"}}')).toThrow(
      /reason/,
    );
  });

  it("decodeRequest：model/switch（J6）identity 校验——非空 provider/modelId", () => {
    expect(
      decodeRequest('{"type":"model/switch","identity":{"provider":"openai","modelId":"m2"}}'),
    ).toEqual({
      type: "model/switch",
      identity: { provider: "openai", modelId: "m2" },
    });
    // 外部输入逐项校验：缺 identity / 空 provider / 空 modelId / 非对象
    expect(() => decodeRequest('{"type":"model/switch"}')).toThrow(/identity/);
    expect(() =>
      decodeRequest('{"type":"model/switch","identity":{"provider":"","modelId":"m"}}'),
    ).toThrow(/identity/);
    expect(() =>
      decodeRequest('{"type":"model/switch","identity":{"provider":"p","modelId":""}}'),
    ).toThrow(/identity/);
    expect(() =>
      decodeRequest('{"type":"model/switch","identity":"openai:m2"}'),
    ).toThrow(/identity/);
    // JsonValue 往返（wire 面可序列化）
    const req = { type: "model/switch", identity: { provider: "p", modelId: "m" } };
    expect(decodeRequest(JSON.stringify(req))).toEqual(req);
  });

  it("decodeMessage：error 校验与未知类型拒绝", () => {
    expect(decodeMessage('{"type":"error","code":"X","message":"m"}')).toEqual({
      type: "error",
      code: "X",
      message: "m",
    });
    expect(() => decodeMessage('{"type":"error"}')).toThrow(/code 与 message/);
    expect(() => decodeMessage('{"type":"wtf"}')).toThrow(/未知消息类型/);
  });
});
