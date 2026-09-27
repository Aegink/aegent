/**
 * host server 测试（K5/T-P1-128）——WS 传输定形的验收面：真实 ws 客户端
 * 连真实 HTTP/WS 端口，逐信封断言。agent 通道两种注入（bridge.test 先例）：
 * 内存桥（runAgentChildStdio——与 CLI repl 同一内核接线，K5"共用内核"机验）
 * 与 fake 通道（脚本化消息泵——审批广播/source 透传的可控注入面）。
 * helper（agent 注入件 / rig / ws 客户端）在 server.test-utils.ts。
 */

import { describe, expect, it } from "vitest";
import WebSocket from "ws";

import { echoProvider } from "../kernel/agent-process.js";
import type { AgentRequest } from "../kernel/agent-protocol.js";
import { InMemoryEventStorage } from "../session/store.js";
import { handles, makeUiFixture, startMemoryChild, fakeAgent, uiFixtures, type FakeAgent } from "./server.test-utils.js";
import { HostServer, type HostServerHandle } from "./server.js";
import type { EventStorage } from "../session/store.js";
import type { AgentChannel } from "./bridge.js";


async function startServer(options: {
  agent?: AgentChannel;
  storage?: EventStorage;
}): Promise<{ handle: HostServerHandle; port: number }> {
  const uiDir = makeUiFixture();
  uiFixtures.push(uiDir);
  const server = new HostServer({
    sessionId: "s-h1",
    port: 0,
    uiDir,
    storage: options.storage ?? new InMemoryEventStorage(),
    ...(options.agent !== undefined ? { agent: options.agent } : {}),
  });
  const handle = await server.start();
  handles.push(handle);
  return { handle, port: handle.port };
}


interface WsClient {
  out: Array<Record<string, unknown>>;
  hello(surfaceId: string): Promise<void>;
  raw(envelope: Record<string, unknown>): void;
  request(sessionId: string, call: Record<string, unknown>): Promise<Record<string, unknown>>;
  waitFor(predicate: (envelope: Record<string, unknown>) => boolean, label: string): Promise<Record<string, unknown>>;
  close(): void;
}

function wsConnect(port: number): Promise<WsClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const out: Array<Record<string, unknown>> = [];
  ws.on("message", (data: unknown) => {
    const text = typeof data === "string" ? data : (data as Buffer).toString("utf8");
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      out.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  let nextRequestId = 1;
  return new Promise((resolve) => {
    ws.once("open", () => {
      const client: WsClient = {
        out,
        hello: async (surfaceId) => {
          ws.send(JSON.stringify({ type: "hello", version: 1, surfaceId, deliveryKind: "push" }));
          await client.waitFor((e) => e.type === "hello", "hello 回执");
        },
        raw: (envelope) => ws.send(JSON.stringify(envelope)),
        request: (sessionId, call) => {
          const requestId = `r-${nextRequestId++}`;
          ws.send(JSON.stringify({ type: "request", requestId, sessionId, call }));
          return client.waitFor(
            (e) => e.type === "response" && e.requestId === requestId,
            `response(${requestId})`,
          ) as Promise<Record<string, unknown>>;
        },
        waitFor: (predicate, label) =>
          new Promise((resolve, reject) => {
            const hit = out.find(predicate);
            if (hit !== undefined) {
              resolve(hit);
              return;
            }
            const started = Date.now();
            const timer = setInterval(() => {
              const found = out.find(predicate);
              if (found !== undefined) {
                clearInterval(timer);
                resolve(found);
              } else if (Date.now() - started > 4000) {
                clearInterval(timer);
                reject(new Error(`等待 ${label} 超时（已收：${out.map((o) => o.type).join(",")}）`));
              }
            }, 10);
          }),
        close: () => ws.close(),
      };
      resolve(client);
    });
  });
}

// ---------------------------------------------------------------------------


describe("K5/T-P1-128 · host server（WS 传输定形）", () => {
  it("WS e2e 全链：hello → 租约 → prompt → 事件流（与 CLI 同一内核接线）", async () => {
    // 真实子进程内存桥（echo provider）——CLI repl 的 connection 同形状：
    // 经同一 runAgentChildStdio 内核（"与 CLI 共用内核"的机验面）。
    const agent = startMemoryChild({
      sessionId: "s-h1",
      provider: echoProvider(),
      assembly: { workspaceRoot: process.cwd(), contextWindow: 200_000, approvalTimeoutMs: 5000 },
    });
    const { port } = await startServer({ agent });
    const client = await wsConnect(port);

    await client.hello("web-t1");
    const hello = client.out.find((e) => e.type === "hello");
    expect(hello?.sessionId).toBe("s-h1");

    client.raw({ type: "lease", op: "acquire", surfaceId: "web-t1" });
    const lease = await client.waitFor((e) => e.type === "response" && e.requestId === "(lease)", "lease 回执");
    expect(lease.ok).toBe(true);

    const response = await client.request("s-h1", { type: "prompt", messageId: "m1", content: "你好 host" });
    expect(response.ok).toBe(true);
    expect((response.result as { accepted?: string }).accepted).toBe("m1");

    const turnEnd = await client.waitFor((e) => e.type === "event" && (e.event as { type?: string }).type === "turn/end", "turn/end 事件");
    expect(turnEnd.sessionId).toBe("s-h1");
    await client.waitFor(
      (e) => e.type === "event" && (e.event as { type?: string }).type === "assistant/message",
      "assistant/message 事件",
    );
    client.close();
    await agent.kill();
  });

  it("query events 恢复视图：镜像可查 + afterSeq 游标 + 未知会话拒绝", async () => {
    const agent = fakeAgent();
    const storage = new InMemoryEventStorage();
    const { port } = await startServer({ agent, storage });
    // agent 事件泵 → 镜像落 host store（非 roster 事件；E16 流校验——
    // 镜像序列必须完整合法：turn/start 开轮）
    agent.emit({ type: "event", event: { type: "turn/start", turn: 1 } as never });
    agent.emit({ type: "event", event: { type: "user/message", turn: 1, message: { content: "一" }, source: "user" } as never });
    agent.emit({ type: "event", event: { type: "step/start", turn: 1, step: 1 } as never });
    agent.emit({
      type: "event",
      event: { type: "request/header", turn: 1, step: 1, config: { provider: "echo", modelId: "echo-1" }, reason: "turn" } as never,
    });
    agent.emit({
      type: "event",
      event: { type: "assistant/message", turn: 1, step: 1, message: { content: "答" }, stream: [] } as never,
    });
    agent.emit({ type: "event", event: { type: "turn/end", turn: 1, reason: { kind: "completed" } } as never });
    const client = await wsConnect(port);
    await client.hello("web-t2");
    await new Promise((r) => setTimeout(r, 50)); // 镜像 append 是同步面——缓冲拍平

    const requestId = "q-1";
    client.raw({ type: "query", requestId, sessionId: "s-h1", op: "events" });
    const response = await client.waitFor((e) => e.type === "response" && e.requestId === requestId, "query 回执");
    expect(response.ok).toBe(true);
    const events = (response.result as { events: Array<{ seq: number; type: string }> }).events;
    expect(events.map((e) => e.type)).toEqual([
      "turn/start",
      "user/message",
      "step/start",
      "request/header",
      "assistant/message",
      "turn/end",
      "surface/attach", // 连接时的 roster 落流（emitRoster——host 面事实）
    ]);

    // afterSeq 游标：只回 seq 更大的部分
    const afterId = "q-2";
    client.raw({ type: "query", requestId: afterId, sessionId: "s-h1", op: "events", afterSeq: events[1]?.seq });
    const afterResponse = await client.waitFor((e) => e.type === "response" && e.requestId === afterId, "afterSeq 回执");
    const afterEvents = (afterResponse.result as { events: Array<{ type: string }> }).events;
    expect(afterEvents.map((e) => e.type)).toEqual([
      "step/start",
      "request/header",
      "assistant/message",
      "turn/end",
      "surface/attach",
    ]);

    // 未知会话 → 类型化拒绝（bridge 直答面）
    client.raw({ type: "query", requestId: "q-3", sessionId: "s-other", op: "events" });
    const errorResponse = await client.waitFor((e) => e.type === "response" && e.requestId === "q-3", "坏会话回执");
    expect((errorResponse.error as { code: string }).code).toBe("UNKNOWN_HOST_SESSION");

    // 坏 afterSeq（负数）→ 协议校验拒绝（坏行回执 requestId 统一 "(unparsed)"）
    client.raw({ type: "query", requestId: "q-4", sessionId: "s-h1", op: "events", afterSeq: -1 });
    const badResponse = await client.waitFor(
      (e) => e.type === "response" && (e.error as { code?: string } | undefined)?.code === "PROTOCOL_MALFORMED",
      "坏游标回执",
    );
    expect(badResponse.requestId).toBe("(unparsed)");
    client.close();
    await agent.kill();
  });

  it("审批广播到 WS 端 + approve source 透传（答复端 web）", async () => {
    const agent = fakeAgent();
    const { port } = await startServer({ agent });
    const client = await wsConnect(port);
    await client.hello("web-t3");

    client.raw({ type: "lease", op: "acquire", surfaceId: "web-t3" });
    await client.waitFor((e) => e.type === "response" && e.requestId === "(lease)", "lease 回执");

    // prompt（写命令，持约通过）→ fake agent 记录并自动回 accepted（A9）
    const promptResponse = await client.request("s-h1", { type: "prompt", messageId: "m1", content: "删文件" });
    expect(promptResponse.ok).toBe(true);
    agent.emit({
      type: "approval_requested",
      requestId: "ar-1",
      tool: "bash",
      args: { command: "rm x" },
      timeoutMs: 5000,
      category: "tool",
    } as never);
    const notification = await client.waitFor(
      (e) => e.type === "notification" && e.name === "approval_requested",
      "审批广播",
    );
    expect((notification.payload as { requestId: string }).requestId).toBe("ar-1");

    const response = await client.request("s-h1", {
      type: "approve",
      requestId: "ar-1",
      action: "allow",
      source: "web",
    });
    expect(response.ok).toBe(true);
    // source 透传到 agent 通道（replySource 审计链的来源端）
    const approve = agent.sent.find((r: AgentRequest) => r.type === "approve");
    expect(approve).toMatchObject({ requestId: "ar-1", action: "allow", source: "web" });

    agent.emit({ type: "approval_settled", requestId: "ar-1", allowed: true } as never);
    await client.waitFor((e) => e.type === "notification" && e.name === "approval_settled", "结算广播");
    client.close();
    await agent.kill();
  });

  it("两 surface 租约互斥（真实传输复验）：LeaseBusy + 断线自动释放", async () => {
    const agent = fakeAgent();
    const { port } = await startServer({ agent });
    const a = await wsConnect(port);
    const b = await wsConnect(port);
    await a.hello("web-a");
    await b.hello("web-b");

    a.raw({ type: "lease", op: "acquire", surfaceId: "web-a" });
    const aLease = await a.waitFor((e) => e.type === "response" && e.requestId === "(lease)", "A 租约");
    expect(aLease.ok).toBe(true);

    b.raw({ type: "lease", op: "acquire", surfaceId: "web-b" });
    const bLease = await b.waitFor((e) => e.type === "response" && e.requestId === "(lease)", "B 租约");
    expect(bLease.ok).toBe(false);
    expect((bLease.error as { code: string }).code).toBe("OWNER_LEASE_BUSY");

    // A 断线 → 租约自动释放（N7 贯穿）→ B 可取得
    a.close();
    await new Promise((r) => setTimeout(r, 50));
    b.raw({ type: "lease", op: "acquire", surfaceId: "web-b" });
    const bLease2 = await b.waitFor(
      (e) => e.type === "response" && e.requestId === "(lease)" && e.ok === true,
      "B 二次租约",
    );
    expect(bLease2.ok).toBe(true);
    b.close();
    await agent.kill();
  });

  it("静态托管：index 200 + content-type + 路径穿越防呆 + 404", async () => {
    const { port } = await startServer({ agent: fakeAgent() });
    const base = `http://127.0.0.1:${port}`;

    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(await index.text()).toContain("<title>aegent-test</title>");

    const appJs = await fetch(`${base}/app.js`);
    expect(appJs.status).toBe(200);
    expect(appJs.headers.get("content-type")).toContain("text/javascript");

    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
    // 编码穿越（%2e%2e = ..；%5c = \）与字面 ..：统一 404/403，不出 uiDir
    const escaped = await fetch(`${base}/..%2f..%2fpackage.json`);
    expect([403, 404]).toContain(escaped.status);
    const backslash = await fetch(`${base}/..%5c..%5cpackage.json`);
    expect([403, 404]).toContain(backslash.status);
    const plain = await fetch(`${base}/../package.json`);
    expect([200, 403, 404]).toContain(plain.status); // fetch 可能先规范化；200 也只能落在 uiDir 内
    if (plain.status === 200) {
      expect(await plain.text()).not.toContain("name"); // 非仓库 package.json
    }
  });
});

