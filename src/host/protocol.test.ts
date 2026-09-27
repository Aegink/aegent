import { describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "../kernel/events.js";
import { PROTOCOL_VERSION, HostProtocolServer, parseClientEnvelope, type SessionRouter } from "./protocol.js";

function ev(seq: number): SessionEvent {
  return { type: "turn/start", turn: 1, seq, ts: 1 } as unknown as SessionEvent;
}

/** 假路由：send 记录请求、可控 resolve/reject；onEvent 给出推送通道。 */
function fakeRouter(): SessionRouter & {
  calls: Array<{ sessionId: string; type: string }>;
  resolveAt: (index: number, value: unknown) => void;
  rejectAt: (index: number, error: Error) => void;
  emitEvent: (sessionId: string, event: SessionEvent) => void;
} {
  const calls: Array<{ sessionId: string; type: string }> = [];
  const pendingQueue: Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }> = [];
  const listeners = new Set<(sessionId: string, event: SessionEvent) => void>();
  return {
    calls,
    send: (sessionId, request) => {
      calls.push({ sessionId, type: request.type });
      return new Promise((resolve, reject) => {
        pendingQueue.push({ resolve, reject });
      });
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resolveAt: (index, value) => pendingQueue[index]?.resolve(value),
    rejectAt: (index, error) => pendingQueue[index]?.reject(error),
    emitEvent: (sessionId, event) => {
      for (const l of listeners) l(sessionId, event);
    },
  };
}

function serverWith(router: SessionRouter) {
  const out: Array<Record<string, unknown>> = [];
  const server = new HostProtocolServer(router, {
    write: (line) => out.push(JSON.parse(line)),
  });
  return { server, out };
}

describe("K8/T-P1-115 端间协议层", () => {
  it("hello 握手：版本匹配 → hello 回执；不匹配 → hello_error", () => {
    const router = fakeRouter();
    const { server, out } = serverWith(router);
    server.handleLine(JSON.stringify({ type: "hello", version: PROTOCOL_VERSION }));
    expect(out).toEqual([{ type: "hello", version: PROTOCOL_VERSION }]);

    const { server: s2, out: out2 } = serverWith(fakeRouter());
    s2.handleLine(JSON.stringify({ type: "hello", version: 99 }));
    expect(out2).toEqual([
      {
        type: "hello_error",
        error: { code: "PROTOCOL_VERSION_MISMATCH", message: expect.stringContaining("99") },
      },
    ]);
  });

  it("hello 前发 request → HELLO_REQUIRED（握手前置）", async () => {
    const router = fakeRouter();
    const { server, out } = serverWith(router);
    server.handleLine(
      JSON.stringify({ type: "request", requestId: "r1", sessionId: "s-a", call: { type: "prompt", messageId: "m1", content: "hi" } }),
    );
    await Promise.resolve();
    expect(out[0]).toMatchObject({ type: "response", requestId: "r1", ok: false, error: { code: "HELLO_REQUIRED" } });
    expect(router.calls).toHaveLength(0);
  });

  it("request/response requestId 关联（并发请求不串线）", async () => {
    const router = fakeRouter();
    const { server, out } = serverWith(router);
    server.handleLine(JSON.stringify({ type: "hello", version: PROTOCOL_VERSION }));
    server.handleLine(
      JSON.stringify({ type: "request", requestId: "r1", sessionId: "s-a", call: { type: "prompt", messageId: "m1", content: "a" } }),
    );
    server.handleLine(
      JSON.stringify({ type: "request", requestId: "r2", sessionId: "s-a", call: { type: "cancel", cause: { kind: "user" } } }),
    );
    expect(router.calls.map((c) => c.type)).toEqual(["prompt", "cancel"]);
    // 乱序结算：r2 先成功、r1 后失败——requestId 各自对应
    router.resolveAt(1, { accepted: "m2" });
    await Promise.resolve();
    await Promise.resolve();
    router.rejectAt(0, Object.assign(new Error("坏参数"), { code: "TURN_NOT_ACTIVE" }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(out.filter((o) => o.type === "response")).toEqual([
      { type: "response", requestId: "r2", ok: true, result: { accepted: "m2" } },
      {
        type: "response",
        requestId: "r1",
        ok: false,
        error: { code: "TURN_NOT_ACTIVE", message: "坏参数" },
      },
    ]);
  });

  it("事件推送按 sessionId 路由（event 信封）", () => {
    const router = fakeRouter();
    const { server, out } = serverWith(router);
    router.emitEvent("s-a", ev(1));
    router.emitEvent("s-b", ev(2));
    expect(out).toEqual([
      { type: "event", sessionId: "s-a", event: ev(1) },
      { type: "event", sessionId: "s-b", event: ev(2) },
    ]);
  });

  it("坏行不崩连接：非 JSON / 未知类型 / 未知属性 → error response 且后续可用", async () => {
    const router = fakeRouter();
    const { server, out } = serverWith(router);
    server.handleLine("not-json{{");
    server.handleLine(JSON.stringify({ type: "mystery" }));
    server.handleLine(JSON.stringify({ type: "hello", version: PROTOCOL_VERSION, extra: true }));
    server.handleLine(JSON.stringify({ type: "hello", version: PROTOCOL_VERSION }));
    expect(out[0]).toMatchObject({ type: "response", ok: false, error: { code: "PROTOCOL_MALFORMED" } });
    expect(out[1]).toMatchObject({ type: "response", ok: false, error: { code: "PROTOCOL_MALFORMED" } });
    expect((out[1] as { error: { message: string } }).error.message).toContain("未知信封类型");
    expect(out[2]).toMatchObject({ type: "response", ok: false, error: { code: "PROTOCOL_MALFORMED" } });
    expect((out[2] as { error: { message: string } }).error.message).toContain("未知属性");
    expect(out[3]).toEqual({ type: "hello", version: PROTOCOL_VERSION }); // 连接存活
  });

  it("超长行拒绝（MAX_LINE_BYTES 复用）", () => {
    const router = fakeRouter();
    const { server, out } = serverWith(router);
    server.handleLine("x".repeat(4 * 1024 * 1024 + 1));
    expect(out[0]).toMatchObject({
      type: "response",
      ok: false,
      error: { code: "PROTOCOL_MALFORMED", message: expect.stringContaining("行超长") },
    });
  });

  it("close 后停止订阅与输出（断连在协议之外）", () => {
    const router = fakeRouter();
    const { server, out } = serverWith(router);
    server.close();
    router.emitEvent("s-a", ev(1));
    expect(out).toEqual([]);
    server.handleLine(JSON.stringify({ type: "hello", version: PROTOCOL_VERSION }));
    expect(out).toEqual([]);
    server.close(); // 幂等
  });

  it("parseClientEnvelope：call 缺 type / requestId 空串拒绝", () => {
    expect(() => parseClientEnvelope(JSON.stringify({ type: "request", requestId: "", sessionId: "s", call: { type: "prompt" } }))).toThrowError(/requestId/);
    expect(() => parseClientEnvelope(JSON.stringify({ type: "request", requestId: "r", sessionId: "s", call: {} }))).toThrowError(/type 字段/);
    expect(() => parseClientEnvelope(JSON.stringify({ type: "hello", version: 1.5 }))).toThrowError(/version 整数/);
    expect(() => parseClientEnvelope("[]")).toThrowError(/JSON 对象/);
  });
});
