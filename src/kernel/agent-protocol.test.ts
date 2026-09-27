import { describe, expect, it } from "vitest";

import {
  decodeMessage,
  decodeRequest,
  ProtocolError,
} from "./agent-protocol.js";
const expectMalformed = (fn: () => unknown): void => {
  try {
    fn();
    expect.fail("应抛 ProtocolError");
  } catch (e) {
    expect((e as ProtocolError).code).toBe("PROTOCOL_MALFORMED");
  }
};
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

  it("decodeRequest：session/fork（E5/T-P1-40）targetId 必填 + position 闭集 + atSeq 正整数", () => {
    // 合法形状：全参数 / 仅 targetId / 带 position / 带 atSeq
    expect(decodeRequest('{"type":"session/fork","targetId":"f1"}')).toEqual({
      type: "session/fork",
      targetId: "f1",
    });
    expect(
      decodeRequest('{"type":"session/fork","targetId":"f1","position":"before","atSeq":7}'),
    ).toEqual({ type: "session/fork", targetId: "f1", position: "before", atSeq: 7 });
    // 外部输入逐项校验：缺 targetId / 空 targetId / position 闭集外 / atSeq 非正整数
    expect(() => decodeRequest('{"type":"session/fork"}')).toThrow(/targetId/);
    expect(() => decodeRequest('{"type":"session/fork","targetId":""}')).toThrow(/targetId/);
    expect(() =>
      decodeRequest('{"type":"session/fork","targetId":"f1","position":"middle"}'),
    ).toThrow(/position/);
    expect(() =>
      decodeRequest('{"type":"session/fork","targetId":"f1","atSeq":0}'),
    ).toThrow(/atSeq/);
    expect(() =>
      decodeRequest('{"type":"session/fork","targetId":"f1","atSeq":2.5}'),
    ).toThrow(/atSeq/);
  });

  it("decodeRequest：steer（A10/T-P1-47）expectedTurn 正整数必填 + content 非空", () => {
    // 合法形状
    expect(decodeRequest('{"type":"steer","expectedTurn":3,"content":"改走 B 路线"}')).toEqual({
      type: "steer",
      expectedTurn: 3,
      content: "改走 B 路线",
    });
    // 外部输入逐项校验：缺 expectedTurn / 非正整数 / 缺 content / 空 content
    expect(() => decodeRequest('{"type":"steer","content":"x"}')).toThrow(/expectedTurn/);
    expect(() => decodeRequest('{"type":"steer","expectedTurn":0,"content":"x"}')).toThrow(
      /expectedTurn/,
    );
    expect(() => decodeRequest('{"type":"steer","expectedTurn":1.5,"content":"x"}')).toThrow(
      /expectedTurn/,
    );
    expect(() => decodeRequest('{"type":"steer","expectedTurn":1}')).toThrow(/content/);
    expect(() => decodeRequest('{"type":"steer","expectedTurn":1,"content":""}')).toThrow(
      /content/,
    );
  });

  it("decodeMessage：forked 回执（E5）sessionId/cutSeq/eventCount 校验", () => {
    expect(
      decodeMessage('{"type":"forked","sessionId":"f1","cutSeq":12,"eventCount":13}'),
    ).toEqual({ type: "forked", sessionId: "f1", cutSeq: 12, eventCount: 13 });
    expect(() =>
      decodeMessage('{"type":"forked","sessionId":"","cutSeq":0,"eventCount":1}'),
    ).toThrow(/sessionId/);
    expect(() =>
      decodeMessage('{"type":"forked","sessionId":"f","cutSeq":-1,"eventCount":1}'),
    ).toThrow(/cutSeq/);
    expect(() =>
      decodeMessage('{"type":"forked","sessionId":"f","cutSeq":0,"eventCount":0}'),
    ).toThrow(/eventCount/);
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

describe("config/refresh 协议分型（B21/T-P1-63）", () => {
  it("合法 patch 往返；patch 缺失/非对象 → PROTOCOL_MALFORMED", () => {
    expect(decodeRequest(JSON.stringify({ type: "config/refresh", patch: { approvalTimeoutMs: 5_000 } }))).toEqual({
      type: "config/refresh",
      patch: { approvalTimeoutMs: 5_000 },
    });
    expect(() => decodeRequest(JSON.stringify({ type: "config/refresh" }))).toThrow(ProtocolError);
    expectMalformed(() => decodeRequest(JSON.stringify({ type: "config/refresh", patch: [1] })));
  });

  it("config_refreshed 回执往返：applied 数组；形状坏 → PROTOCOL_MALFORMED", () => {
    expect(decodeMessage(JSON.stringify({ type: "config_refreshed", applied: ["approvalTimeoutMs"] }))).toEqual({
      type: "config_refreshed",
      applied: ["approvalTimeoutMs"],
    });
    expect(() => decodeMessage(JSON.stringify({ type: "config_refreshed", applied: [1] }))).toThrow(
      ProtocolError,
    );
  });
});

describe("policy/check 协议分型（C19/T-P1-75）", () => {
  it("合法请求往返：tool + args 对象；缺 tool / args 非对象 → PROTOCOL_MALFORMED", () => {
    expect(
      decodeRequest(JSON.stringify({ type: "policy/check", tool: "bash", args: { command: "git status" } })),
    ).toEqual({ type: "policy/check", tool: "bash", args: { command: "git status" } });
    expectMalformed(() => decodeRequest(JSON.stringify({ type: "policy/check", args: {} })));
    expectMalformed(() => decodeRequest(JSON.stringify({ type: "policy/check", tool: "bash", args: [1] })));
  });

  it("policy_verdict 回执往返：action 三值闭集 + reason 必填 + rule 可选；形状坏 → PROTOCOL_MALFORMED", () => {
    expect(
      decodeMessage(
        JSON.stringify({
          type: "policy_verdict",
          tool: "bash",
          args: { command: "git status" },
          action: "allow",
          reason: "放行（依规则 bash(git status)）",
          rule: "bash(git status)",
        }),
      ),
    ).toEqual({
      type: "policy_verdict",
      tool: "bash",
      args: { command: "git status" },
      action: "allow",
      reason: "放行（依规则 bash(git status)）",
      rule: "bash(git status)",
    });
    // rule 缺席 = 非规则来源裁决（C18 同源语义）
    const noRule = decodeMessage(
      JSON.stringify({
        type: "policy_verdict",
        tool: "write",
        args: {},
        action: "ask",
        reason: "需审批",
      }),
    );
    expect(noRule.type === "policy_verdict" && noRule.rule === undefined).toBe(true);
    expectMalformed(() =>
      decodeMessage(
        JSON.stringify({ type: "policy_verdict", tool: "bash", args: {}, action: "abstain", reason: "x" }),
      ),
    );
    expectMalformed(() =>
      decodeMessage(JSON.stringify({ type: "policy_verdict", tool: "bash", args: {}, action: "allow" })),
    );
  });
});
