import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { AgentMessage, AgentRequest } from "../kernel/agent-protocol.js";
import {
  encodeResponse,
  parseIncoming,
} from "./jsonrpc.js";
import { AcpAgent, type AcpAgentChannel } from "./acp-agent.js";
import { runAcpStdio } from "./main.js";

// ---------------------------------------------------------------------------
// 结构红线（K4 验收机内化——"仅 8 个文件；不塞进 CLI 包"）
// ---------------------------------------------------------------------------

describe("K4/T-P1-117 独立包结构红线", () => {
  const acpDir = path.join(path.dirname(fileURLToPath(import.meta.url)));
  const srcDir = path.resolve(acpDir, "..");

  it("src/acp/ 文件数 ≤ 8（硬约束）", () => {
    const files = readdirSync(acpDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeLessThanOrEqual(8);
  });

  it("cli/ 目录零 import acp（不塞进 CLI 包——fs 扫描断言）", () => {
    const cliDir = path.join(srcDir, "cli");
    const offenders: string[] = [];
    for (const file of readdirSync(cliDir)) {
      if (!file.endsWith(".ts")) continue;
      const text = readFileSync(path.join(cliDir, file), "utf8");
      if (/from\s+["'].*\/acp\//.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("acp → kernel 单向依赖（acp 域内不 import cli/host）", () => {
    for (const file of readdirSync(acpDir)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const text = readFileSync(path.join(acpDir, file), "utf8");
      expect(text).not.toMatch(/from\s+["'].*\/(cli|host)\//);
    }
  });
});

// ---------------------------------------------------------------------------
// JSON-RPC 编解码
// ---------------------------------------------------------------------------

describe("K4/T-P1-117 JSON-RPC 行编解码", () => {
  it("request/notification/response 三形状往返", () => {
    const req = parseIncoming(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    expect(req).toMatchObject({ kind: "request", id: 1, method: "initialize" });
    const note = parseIncoming(JSON.stringify({ jsonrpc: "2.0", method: "session/cancel", params: {} }));
    expect(note).toMatchObject({ kind: "notification", method: "session/cancel" });
    const resp = parseIncoming(JSON.stringify({ jsonrpc: "2.0", id: "x", method: "m", params: {} }));
    expect(resp).toMatchObject({ kind: "request", id: "x" });
  });

  it("坏行类型化拒绝（非 JSON / jsonrpc 缺失 / params 非对象）", () => {
    expect(() => parseIncoming("nope{")).toThrowError(/非 JSON/);
    expect(() => parseIncoming(JSON.stringify({ id: 1, method: "m" }))).toThrowError(/jsonrpc/);
    expect(() => parseIncoming(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "m", params: [1] }))).toThrowError(/params/);
  });
});

// ---------------------------------------------------------------------------
// 方法映射（假 agent 通道——记录 AgentRequest、可控产出 AgentMessage）
// ---------------------------------------------------------------------------

function fakeChannel(): AcpAgentChannel & {
  sent: AgentRequest[];
  emit(message: AgentMessage): void;
} {
  const sent: AgentRequest[] = [];
  const waiters: Array<(m: IteratorResult<AgentMessage>) => void> = [];
  const queue: AgentMessage[] = [];
  return {
    sent,
    send: (request) => sent.push(request),
    messages: {
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            new Promise<IteratorResult<AgentMessage>>((resolve) => {
              const item = queue.shift();
              if (item !== undefined) resolve({ value: item, done: false });
              else waiters.push(resolve);
            }),
        };
      },
    },
    emit: (message) => {
      const w = waiters.shift();
      if (w !== undefined) w({ value: message, done: false });
      else queue.push(message);
    },
  };
}

function linesOf(out: string[]): unknown[] {
  return out.map((l) => JSON.parse(l));
}

describe("K4/T-P1-117 方法映射", () => {
  it("initialize → 能力面回执；session/new → sessionId", () => {
    const channel = fakeChannel();
    const out: string[] = [];
    new AcpAgent({ agent: channel, sessionId: "s-acp", write: (l) => out.push(l) });
    const init = parseIncoming(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    const r1 = new AcpAgent({ agent: channel, sessionId: "s-acp", write: (l) => out.push(l) }).handleIncoming(init);
    expect(r1.respond).toMatchObject({ protocolVersion: 1 });
    const fresh = new AcpAgent({ agent: channel, sessionId: "s-acp", write: (l) => out.push(l) });
    const r2 = fresh.handleIncoming(
      parseIncoming(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new", params: { sessionId: "s-x" } })),
    );
    expect(r2.respond).toEqual({ sessionId: "s-x" });
    void out;
  });

  it("session/prompt → 我方 prompt；assistant/message → session/update；turn/end → 长请求 response{stopReason}", async () => {
    const channel = fakeChannel();
    const out: string[] = [];
    const acp = new AcpAgent({ agent: channel, sessionId: "s-acp", write: (l) => out.push(l) });
    acp.handleIncoming(
      parseIncoming(JSON.stringify({
        jsonrpc: "2.0",
        id: "p1",
        method: "session/prompt",
        params: { content: [{ type: "text", text: "你好" }] },
      })),
    );
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]).toMatchObject({ type: "prompt", content: "你好" });
    const messageId = (channel.sent[0] as { messageId: string }).messageId;

    channel.emit({
      type: "event",
      event: { type: "turn/start", turn: 1 },
    } as unknown as AgentMessage);
    channel.emit({
      type: "event",
      event: { type: "assistant/message", turn: 1, step: 1, message: { content: "回复文本" } },
    } as unknown as AgentMessage);
    channel.emit({
      type: "event",
      event: { type: "turn/end", turn: 1, reason: { kind: "completed" } },
    } as unknown as AgentMessage);
    await new Promise((r) => setTimeout(r, 10));
    const messages = linesOf(out) as Array<{ method?: string; id?: unknown; result?: unknown }>;
    const update = messages.find((m) => m.method === "session/update");
    expect(update).toMatchObject({
      params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "回复文本" } } },
    });
    const response = messages.find((m) => m.id === "p1");
    expect(response).toMatchObject({ result: { stopReason: "end_turn" } });
    void messageId;
  });

  it("approval_requested → session/request_permission 请求；client response → approve{source:'acp'}", async () => {
    const channel = fakeChannel();
    const out: string[] = [];
    const acp = new AcpAgent({ agent: channel, sessionId: "s-acp", write: (l) => out.push(l) });
    channel.emit({
      type: "approval_requested",
      requestId: "call_1",
      tool: "write",
      args: {},
      timeoutMs: 5000,
      category: "tool",
    } as unknown as AgentMessage);
    await new Promise((r) => setTimeout(r, 10));
    const messages = linesOf(out) as Array<{ id?: number; method?: string }>;
    const permReq = messages.find((m) => m.method === "session/request_permission");
    expect(permReq).toBeDefined();
    // client 答复 → approve 转达（source 审计）
    acp.handleClientResponse(permReq!.id!, {
      outcome: { outcome: "selected", optionId: "allow" },
    });
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]).toMatchObject({ type: "approve", requestId: "call_1", action: "allow", source: "acp" });
  });

  it("session/cancel 通知 → cancel；未知方法 request → 空回执不崩", () => {
    const channel = fakeChannel();
    const out: string[] = [];
    const acp = new AcpAgent({ agent: channel, sessionId: "s-acp", write: (l) => out.push(l) });
    acp.handleIncoming(parseIncoming(JSON.stringify({ jsonrpc: "2.0", method: "session/cancel" })));
    expect(channel.sent).toEqual([{ type: "cancel", cause: { kind: "user" } }]);
    const r = acp.handleIncoming(parseIncoming(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "future/method", params: {} })));
    expect(r.respond).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// stdio 循环（runAcpStdio——内存流）
// ---------------------------------------------------------------------------

describe("K4/T-P1-117 stdio 循环", () => {
  it("initialize 往返 + 坏行回 error response 不崩", async () => {
    const { PassThrough } = await import("node:stream");
    const input = new PassThrough();
    const output = new PassThrough();
    output.setEncoding("utf8");
    const sent: AgentRequest[] = [];
    const channel: AcpAgentChannel = {
      send: (r) => sent.push(r),
      messages: (async function* () {})(),
    };
    let closed = false;
    runAcpStdio({
      agent: channel,
      sessionId: "s-acp",
      input,
      output,
      onClosed: () => {
        closed = true;
      },
    });
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    input.write("garbage{{{\n");
    await new Promise((r) => setTimeout(r, 20));
    const lines = (output.read() as string).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ id: 1, result: { protocolVersion: 1 } });
    expect(lines[1]).toMatchObject({ error: { code: -32700 } });
    expect(closed).toBe(false); // 坏行不崩连接
    input.end();
    await new Promise((r) => setTimeout(r, 10));
    expect(closed).toBe(true);
  });

  it("encodeResponse 形状（jsonrpc 2.0 信封）", () => {
    expect(JSON.parse(encodeResponse(7, { ok: true }))).toEqual({ jsonrpc: "2.0", id: 7, result: { ok: true } });
  });
});
