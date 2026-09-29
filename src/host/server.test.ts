/**
 * host server 测试（K5/T-P1-128）——WS 传输定形的验收面：真实 ws 客户端
 * 连真实 HTTP/WS 端口，逐信封断言。agent 通道两种注入（bridge.test 先例）：
 * 内存桥（runAgentChildStdio——与 CLI repl 同一内核接线，K5"共用内核"机验）
 * 与 fake 通道（脚本化消息泵——审批广播/source 透传的可控注入面）。
 * helper（agent 注入件 / rig / ws 客户端）在 server.test-utils.ts。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, afterEach } from "vitest";
import WebSocket from "ws";

import { echoProvider } from "../kernel/agent-process.js";
import type { AgentRequest } from "../kernel/agent-protocol.js";
import { InMemoryEventStorage } from "../session/store.js";
import { SqliteEventStorage } from "../session/db.js";
import { FileSettingsGateway } from "./settings-gateway.js";
import { PlainFileCredentialStore } from "../session/credentials.js";
import { NotificationHub } from "./notify.js";
import { handles, makeUiFixture, startMemoryChild, fakeAgent, uiFixtures, type FakeAgent } from "./server.test-utils.js";
import { HostServer, type HostServerHandle } from "./server.js";
import type { EventStorage } from "../session/store.js";
import type { AgentChannel } from "./bridge.js";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";

const settingsTmpDirs: string[] = [];
let settingsCallSeq = 1;
afterEach(() => {
  while (settingsTmpDirs.length > 0) {
    const dir = settingsTmpDirs.pop();
    // maxRetries：Windows 上 SQLite close 后句柄释放有缓冲——重试面防 EBUSY
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});


async function startServer(options: {
  agent?: AgentChannel;
  storage?: EventStorage;
  settingsGateway?: import("./settings-gateway.js").SettingsGateway;
  sessionsLibrary?: SqliteEventStorage;
  workspaceRoot?: string;
  contextWindow?: number;
  notifyHub?: NotificationHub;
}): Promise<{ handle: HostServerHandle; port: number }> {
  const uiDir = makeUiFixture();
  uiFixtures.push(uiDir);
  const server = new HostServer({
    sessionId: "s-h1",
    port: 0,
    uiDir,
    storage: options.storage ?? new InMemoryEventStorage(),
    ...(options.agent !== undefined ? { agent: options.agent } : {}),
    ...(options.settingsGateway !== undefined ? { settingsGateway: options.settingsGateway } : {}),
    ...(options.sessionsLibrary !== undefined ? { sessionsLibrary: options.sessionsLibrary } : {}),
    ...(options.workspaceRoot !== undefined ? { workspaceRoot: options.workspaceRoot } : {}),
    ...(options.contextWindow !== undefined ? { contextWindow: options.contextWindow } : {}),
    ...(options.notifyHub !== undefined ? { notifyHub: options.notifyHub } : {}),
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

    // U3 起 events 放宽为任意会话只读（历史查看入口）：查镜像外的会话 =
    // 空流（内存镜像无数据）而非拒绝；写命令仍限本会话（send 校验不变）
    client.raw({ type: "query", requestId: "q-3", sessionId: "s-other", op: "events" });
    const otherResponse = await client.waitFor((e) => e.type === "response" && e.requestId === "q-3", "他会话回执");
    expect(otherResponse.ok).toBe(true);
    expect((otherResponse.result as { events: unknown[] }).events).toEqual([]);

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

  // ---------------------------------------------------------------------------
  // U14/T-P3-103 settings 直答：get/update/credentials-* 信封端到端 + 快照即
  // 规格（UI 改 → 文件变 → 重启生效——真临时文件 FileSettingsGateway）。
  // ---------------------------------------------------------------------------

  it("settings 信封：get → update 落文件 → 重新 loadSettings（重启生效）→ credentials 往返", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "aegent-host-settings-"));
    settingsTmpDirs.push(tmp);
    const settingsPath = path.join(tmp, "settings.json");
    const gateway = new FileSettingsGateway(
      settingsPath,
      new PlainFileCredentialStore(path.join(tmp, "credentials.bin")),
    );
    const { port } = await startServer({ agent: fakeAgent(), settingsGateway: gateway });
    const client = await wsConnect(port);
    await client.hello("web-s1");

    const settingsCall = (call: Record<string, unknown>) => {
      const requestId = `s-test-${settingsCallSeq++}`;
      client.raw({ type: "settings", requestId, ...call });
      return client.waitFor(
        (e) => e.type === "response" && e.requestId === requestId,
        `settings response(${requestId})`,
      ) as Promise<Record<string, unknown>>;
    };

    // get：文件缺失 → 缺省配置
    const got = await settingsCall({ op: "get" });
    expect(got.ok).toBe(true);
    expect((got.result as { settings: { version: number } }).settings.version).toBe(1);

    // update：段级补丁 → 返回合并结果 + 文件真变化
    const updated = await settingsCall({
      op: "update",
      patch: {
        providers: [{ name: "main", adapter: "anthropic", baseUrl: "https://x.example.com", model: "m1" }],
        defaultProvider: "main",
        appearance: { theme: "light", language: "zh-CN" },
      },
    });
    expect(updated.ok).toBe(true);
    const merged = (updated.result as { settings: { defaultProvider?: string; appearance?: { theme?: string } } }).settings;
    expect(merged.defaultProvider).toBe("main");
    expect(merged.appearance?.theme).toBe("light");
    const onDisk = JSON.parse(readFileSync(settingsPath, "utf8")) as { defaultProvider?: string };
    expect(onDisk.defaultProvider).toBe("main");
    // 重启生效模拟：重新 loadSettings 读同一文件
    const { loadSettings } = await import("../session/settings.js");
    expect((await loadSettings(settingsPath)).settings.defaultProvider).toBe("main");

    // logging 段（U14/T-P3-132 #28 补落）：白名单往返 → 文件变 → 重启读回一致
    const logUpdate = await settingsCall({
      op: "update",
      patch: { logging: { rawLogDir: path.join(tmp, "raw-logs") } },
    });
    expect(logUpdate.ok).toBe(true);
    const logMerged = (
      logUpdate.result as { settings: { logging?: { rawLogDir?: string } } }
    ).settings;
    expect(logMerged.logging?.rawLogDir).toBe(path.join(tmp, "raw-logs"));
    expect(
      (JSON.parse(readFileSync(settingsPath, "utf8")) as { logging?: { rawLogDir?: string } }).logging
        ?.rawLogDir,
    ).toBe(path.join(tmp, "raw-logs"));
    expect((await loadSettings(settingsPath)).settings.logging?.rawLogDir).toBe(
      path.join(tmp, "raw-logs"),
    );

    // projects/activeProject 段（U11/T-P3-110）：项目档 patch → 文件变 → 重启读回
    const projUpdate = await settingsCall({
      op: "update",
      patch: {
        projects: [{ name: "p1", workspace: path.join(tmp, "p1-ws"), instructions: "遵守 AGENTS.md" }],
        activeProject: "p1",
      },
    });
    expect(projUpdate.ok).toBe(true);
    const projMerged = (
      projUpdate.result as {
        settings: { projects?: { name: string; workspace: string }[]; activeProject?: string };
      }
    ).settings;
    expect(projMerged.projects?.[0]?.name).toBe("p1");
    expect(projMerged.activeProject).toBe("p1");
    const reloaded = await loadSettings(settingsPath);
    expect(reloaded.settings.projects?.[0]?.workspace).toBe(path.join(tmp, "p1-ws"));
    expect(reloaded.settings.activeProject).toBe("p1");

    // 凭据面：set 回掩码（明文不回信封）→ list 见掩码 → delete
    const setCred = await settingsCall({ op: "credentials-set", provider: "main", key: "sk-e2e-0123456789abcdefghij" });
    expect(setCred.ok).toBe(true);
    expect((setCred.result as { masked: string }).masked).not.toContain("sk-e2e-0123456789abcdefghij");
    const listCred = await settingsCall({ op: "credentials-list" });
    const credentials = (listCred.result as { credentials: { name: string; masked?: string }[] }).credentials;
    expect(credentials).toHaveLength(1);
    expect(credentials[0]?.name).toBe("main");
    // 凭据库文件真在位（PlainFile 结构），删除后清单为空
    expect(readFileSync(path.join(tmp, "credentials.bin"), "utf8")).toContain("version");
    const delCred = await settingsCall({ op: "credentials-delete", provider: "main" });
    expect(delCred.ok).toBe(true);
    const listAfter = await settingsCall({ op: "credentials-list" });
    expect((listAfter.result as { credentials: unknown[] }).credentials).toHaveLength(0);
    client.close();
  });

  it("settings 信封坏形状：未知 patch 段类型化拒绝且不落盘；未知 op 协议拒绝；无 gateway 回 SETTINGS_UNSUPPORTED", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "aegent-host-settings-"));
    settingsTmpDirs.push(tmp);
    const settingsPath = path.join(tmp, "settings.json");
    const { port } = await startServer({
      agent: fakeAgent(),
      settingsGateway: new FileSettingsGateway(settingsPath, new PlainFileCredentialStore(path.join(tmp, "credentials.bin"))),
    });
    const client = await wsConnect(port);
    await client.hello("web-s2");
    const settingsCall = (call: Record<string, unknown>) => {
      const requestId = `s-test-${settingsCallSeq++}`;
      client.raw({ type: "settings", requestId, ...call });
      return client.waitFor(
        (e) => e.type === "response" && e.requestId === requestId,
        `settings response(${requestId})`,
      ) as Promise<Record<string, unknown>>;
    };

    const badSection = await settingsCall({ op: "update", patch: { hax: 1 } });
    expect(badSection.ok).toBe(false);
    expect((badSection.error as { code: string }).code).toBe("SETTINGS_PATCH_SECTION_UNKNOWN");
    expect(existsSync(settingsPath)).toBe(false); // 拒绝即不落盘

    // U16/T-P3-118：prompts 段已入册白名单（整段替换 + 其他段隔离）
    const promptsPatch = await settingsCall({
      op: "update",
      patch: { prompts: [{ name: "review", content: "评审 {{file}}" }] },
    });
    expect(promptsPatch.ok).toBe(true);
    expect((promptsPatch.result as { settings: { prompts?: unknown[] } }).settings.prompts).toEqual([
      { name: "review", content: "评审 {{file}}" },
    ]);
    // 重名模板在 parse 层 fail-closed
    const dupPrompt = await settingsCall({
      op: "update",
      patch: {
        prompts: [
          { name: "a", content: "x" },
          { name: "a", content: "y" },
        ],
      },
    });
    expect(dupPrompt.ok).toBe(false);

    client.raw({ type: "settings", requestId: "s-bad-op", op: "frobnicate" });
    // op 闭集校验在 parse 层——坏行回 PROTOCOL_MALFORMED（requestId "(unparsed)"）
    const badOp = await client.waitFor(
      (e) => e.type === "response" && e.requestId === "(unparsed)",
      "坏 op 回执",
    );
    expect(badOp.ok).toBe(false);
    expect((badOp.error as { code: string }).code).toBe("PROTOCOL_MALFORMED");
    client.close();

    // 无 gateway 的 host → SETTINGS_UNSUPPORTED（功能面缺省关闭）
    const { port: port2 } = await startServer({ agent: fakeAgent() });
    const client2 = await wsConnect(port2);
    await client2.hello("web-s3");
    client2.raw({ type: "settings", requestId: "s-no-gw", op: "get" });
    const unsupported = await client2.waitFor((e) => e.type === "response" && e.requestId === "s-no-gw", "无 gateway 回执");
    expect((unsupported.error as { code: string }).code).toBe("SETTINGS_UNSUPPORTED");
    client2.close();
  });

  // ---------------------------------------------------------------------------
  // U5/T-P3-104 会话期切换 + 健康徽标（J6 换模 × J16 探测的 wire 消费面）
  // ---------------------------------------------------------------------------

  it("model/switch 往返（内存桥真内核）：受理后下一轮 request/header modelId 变化", async () => {
    // 双 echo 注册表（两条 identity——J6 ModelSwitchService 的最小多模型面）
    const mkEcho = (tag: string) => {
      const base = echoProvider();
      return {
        async *streamChat(req: import("../models/provider.js").ChatRequest) {
          for await (const chunk of base.streamChat(req)) {
            yield chunk.type === "text-delta" ? { type: "text-delta" as const, text: `${tag}:${chunk.text}` } : chunk;
          }
        },
      };
    };
    const agent = startMemoryChild({
      sessionId: "s-h1",
      assembly: {
        workspaceRoot: process.cwd(),
        contextWindow: 200_000,
        approvalTimeoutMs: 5000,
        models: [
          { identity: { provider: "echo", modelId: "echo-1" }, provider: mkEcho("one") },
          { identity: { provider: "echo", modelId: "echo-2" }, provider: mkEcho("two") },
        ],
        initialIdentity: { provider: "echo", modelId: "echo-1" },
      },
    });
    const { port } = await startServer({ agent });
    const client = await wsConnect(port);
    await client.hello("web-u5");
    // prompt 是写命令（N7）——先取写租约
    client.raw({ type: "lease", op: "acquire", surfaceId: "web-u5" });
    await client.waitFor((e) => e.type === "response" && e.requestId === "(lease)", "lease 回执");

    // 切换请求往返（model/switch 非写命令——无需租约，J6 立即受理）
    const switchResponse = await client.request("s-h1", {
      type: "model/switch",
      identity: { provider: "echo", modelId: "echo-2" },
    });
    expect(switchResponse.ok).toBe(true);

    // 下一轮 request/header：modelId 变化（在途语义 = 新 turn 生效）
    await client.request("s-h1", { type: "prompt", messageId: "m-u5", content: "你好" });
    const header = await client.waitFor(
      (e) =>
        e.type === "event" &&
        (e.event as { type?: string }).type === "request/header" &&
        (e.event as { turn?: number }).turn === 1,
      "turn1 request/header",
    );
    const config = ((header.event as { config?: { modelId?: string } }).config ?? {}) as { modelId?: string };
    expect(config.modelId).toBe("echo-2");
    // model/switch 落流事件（J9）
    await client.waitFor(
      (e) => e.type === "event" && (e.event as { type?: string }).type === "model/switch",
      "model/switch 事件",
    );
    client.close();
    await agent.kill();
  });

  it("settings op=probe：条目存在走探测依赖（fake）；条目缺失类型化拒绝", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "aegent-host-probe-"));
    settingsTmpDirs.push(tmp);
    const gateway = new FileSettingsGateway(
      path.join(tmp, "settings.json"),
      new PlainFileCredentialStore(path.join(tmp, "credentials.bin")),
      async (name, baseUrl) => ({
        status: "operational",
        success: true,
        message: `${name} 可达`,
        responseTimeMs: 12,
        httpStatus: 200,
        testedAt: 0,
        ...(baseUrl ? {} : {}),
      }),
    );
    await gateway.update({
      providers: [{ name: "main", baseUrl: "https://probe.example.com", model: "m1" }],
      defaultProvider: "main",
    });
    const { port } = await startServer({ agent: fakeAgent(), settingsGateway: gateway });
    const client = await wsConnect(port);
    await client.hello("web-u5b");
    const probeCall = (call: Record<string, unknown>) => {
      const requestId = `s-probe-${settingsCallSeq++}`;
      client.raw({ type: "settings", requestId, ...call });
      return client.waitFor(
        (e) => e.type === "response" && e.requestId === requestId,
        `probe response(${requestId})`,
      ) as Promise<Record<string, unknown>>;
    };
    const ok = await probeCall({ op: "probe", provider: "main" });
    expect(ok.ok).toBe(true);
    const health = (ok.result as { health: { status: string; message: string } }).health;
    expect(health.status).toBe("operational");
    expect(health.message).toContain("main");

    const missing = await probeCall({ op: "probe", provider: "ghost" });
    expect(missing.ok).toBe(false);
    expect((missing.error as { code: string }).code).toBe("PROVIDER_NOT_FOUND");
    client.close();
  });

  // ---------------------------------------------------------------------------
  // U3/T-P3-105 会话历史 wire 面：query op:"sessions"（SQLite 库清单）+
  // events 任意会话只读放宽 + settings op:"session-delete"
  // ---------------------------------------------------------------------------

  it("query op=sessions 清单 + events 任意会话只读 + session-delete 删除", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "aegent-host-hist-"));
    settingsTmpDirs.push(tmp);
    const dbPath = path.join(tmp, "sessions.db");
    // 预置历史会话（host 自己的 SQLite 库；appendBatch 不分配 seq/ts——写面纪律）
    const seed = SqliteEventStorage.open({ path: dbPath });
    seed.appendBatch("s-old1", [
      { type: "user/message", turn: 1, message: { content: "历史会话一" }, source: "user", seq: 1, ts: 1_700_000_000_000 } as never,
    ]);
    seed.appendBatch("s-old2", [
      { type: "user/message", turn: 1, message: { content: "历史会话二" }, source: "user", seq: 1, ts: 1_700_000_000_001 } as never,
    ]);
    seed.close();
    const sessionDb = SqliteEventStorage.open({ path: dbPath });
    const gateway = new FileSettingsGateway(
      path.join(tmp, "settings.json"),
      new PlainFileCredentialStore(path.join(tmp, "credentials.bin")),
      undefined,
      sessionDb,
    );
    // 生产语义：host storage 与 gateway 的删除目标库、会话清单库是同一 SQLite 实例
    const { port } = await startServer({
      agent: fakeAgent(),
      storage: sessionDb,
      settingsGateway: gateway,
      sessionsLibrary: sessionDb,
    });
    const client = await wsConnect(port);
    await client.hello("web-h1");

    const queryCall = (call: Record<string, unknown>) => {
      const requestId = `h-${settingsCallSeq++}`;
      client.raw({ type: "query", requestId, ...call });
      return client.waitFor((e) => e.type === "response" && e.requestId === requestId, `query(${requestId})`) as Promise<Record<string, unknown>>;
    };
    const settingsCall = (call: Record<string, unknown>) => {
      const requestId = `s-hist-${settingsCallSeq++}`;
      client.raw({ type: "settings", requestId, ...call });
      return client.waitFor((e) => e.type === "response" && e.requestId === requestId, `settings(${requestId})`) as Promise<Record<string, unknown>>;
    };

    // 清单：历史会话在列（host 自己的 s-h1 也会因 roster/镜像进索引）
    const listed = await queryCall({ sessionId: "-", op: "sessions" });
    if (!listed.ok) console.warn("清单回执错误：", JSON.stringify(listed.error));
    expect(listed.ok).toBe(true);
    const sessions = (listed.result as { sessions: { sessionId: string; title?: string }[] }).sessions;
    const listedIds = sessions.map((s) => s.sessionId);
    expect(listedIds).toContain("s-old1");
    expect(listedIds).toContain("s-old2");
    expect(sessions.find((s) => s.sessionId === "s-old1")?.title).toBe("历史会话一");

    // events 任意会话只读（历史查看入口——写命令仍限本会话）
    const view = await queryCall({ sessionId: "s-old1", op: "events" });
    expect(view.ok).toBe(true);
    const events = (view.result as { events: { type: string }[] }).events;
    expect(events.some((e) => e.type === "user/message")).toBe(true);

    // U9/T-P3-108：跨会话检索（Q2 消费面）——contentLike 命中 + 摘要行无整值
    const search = await queryCall({
      sessionId: "-",
      op: "search",
      criteria: { contentLike: "历史会话" },
    });
    expect(search.ok).toBe(true);
    const searchResult = search.result as {
      rows: { sessionId: string; type: string; excerpt: string; event?: unknown }[];
      total: number;
    };
    expect(searchResult.total).toBeGreaterThanOrEqual(2);
    expect(searchResult.rows.some((r) => r.sessionId === "s-old1")).toBe(true);
    expect(searchResult.rows.every((r) => r.excerpt.includes("历史会话"))).toBe(true);
    expect(searchResult.rows.every((r) => r.event === undefined)).toBe(true); // 事件整值不出检索面
    // 坏条件协议层拒绝（parse 层——坏信封回执 requestId 恒 "(unparsed)"）
    const sendBad = (requestId: string, call: Record<string, unknown>) => {
      client.raw({ type: "query", requestId, ...call });
      return client.waitFor(
        (e) => e.type === "response" && e.requestId === "(unparsed)",
        `坏信封回执(${requestId})`,
      ) as Promise<Record<string, unknown>>;
    };
    const badEmpty = await sendBad("h-bad1", { sessionId: "-", op: "search", criteria: { contentLike: "" } });
    expect((badEmpty.error as { code: string }).code).toBe("PROTOCOL_MALFORMED");
    const badMissing = await sendBad("h-bad2", { sessionId: "-", op: "search" });
    expect((badMissing.error as { code: string }).code).toBe("PROTOCOL_MALFORMED");
    const badCriteriaOnEvents = await sendBad("h-bad3", {
      sessionId: "s-old1",
      op: "events",
      criteria: { contentLike: "x" },
    });
    expect((badCriteriaOnEvents.error as { code: string }).code).toBe("PROTOCOL_MALFORMED");

    // 删除：session-delete → 清单只剩一个
    const del = await settingsCall({ op: "session-delete", sessionId: "s-old2" });
    expect(del.ok).toBe(true);
    expect((del.result as { deleted: boolean }).deleted).toBe(true);
    const relisted = await queryCall({ sessionId: "-", op: "sessions" });
    const rest = (relisted.result as { sessions: { sessionId: string }[] }).sessions.map((s) => s.sessionId);
    expect(rest).toContain("s-old1");
    expect(rest).not.toContain("s-old2");

    // 内存库 host（无 SQLite 库）→ 会话清单/删除类型化不可用
    const { port: port2 } = await startServer({
      agent: fakeAgent(),
      settingsGateway: new FileSettingsGateway(
        path.join(tmp, "settings2.json"),
        new PlainFileCredentialStore(path.join(tmp, "credentials2.bin")),
      ),
    });
    const client2 = await wsConnect(port2);
    await client2.hello("web-h2");
    client2.raw({ type: "query", requestId: "h-no-db", sessionId: "-", op: "sessions" });
    const noDb = await client2.waitFor((e) => e.type === "response" && e.requestId === "h-no-db", "无库清单回执");
    expect((noDb.error as { code: string }).code).toBe("SESSIONS_UNAVAILABLE");
    client2.raw({
      type: "query",
      requestId: "h-no-search",
      sessionId: "-",
      op: "search",
      criteria: { contentLike: "x" },
    });
    const noSearch = await client2.waitFor(
      (e) => e.type === "response" && e.requestId === "h-no-search",
      "无库检索回执",
    );
    expect((noSearch.error as { code: string }).code).toBe("SESSIONS_UNAVAILABLE");
    client2.raw({ type: "settings", requestId: "s-no-db", op: "session-delete", sessionId: "s-old1" });
    const noDel = await client2.waitFor((e) => e.type === "response" && e.requestId === "s-no-db", "无库删除回执");
    expect((noDel.error as { code: string }).code).toBe("SESSION_DB_UNAVAILABLE");
    client2.close();
    client.close();
    sessionDb.close();
    await new Promise((r) => setTimeout(r, 50)); // Windows 句柄释放缓冲
  });

  it("query op=files/meta（U10/T-P3-109）：workspace 只读列举 + ready 注册表清单曝光", async () => {
    const ws = mkdtempSync(path.join(tmpdir(), "aegent-host-ws-"));
    settingsTmpDirs.push(ws);
    mkdirSync(path.join(ws, "sub"), { recursive: true });
    writeFileSync(path.join(ws, "a.txt"), "x");
    writeFileSync(path.join(ws, "sub", "b.md"), "y");
    const agent = fakeAgent();
    // ready 清单先入泵（bridge 捕获 → op:"meta" 曝光——/ 补全的清单来源）
    agent.emit({
      type: "ready",
      tools: ["read", "bash"],
      skills: [{ name: "demo", description: "演示技能" }],
    });
    const { port } = await startServer({ agent, workspaceRoot: ws });
    const client = await wsConnect(port);
    await client.hello("web-f1");

    const queryCall = (call: Record<string, unknown>) => {
      const requestId = `f-${settingsCallSeq++}`;
      client.raw({ type: "query", requestId, ...call });
      return client.waitFor((e) => e.type === "response" && e.requestId === requestId, `query(${requestId})`) as Promise<Record<string, unknown>>;
    };

    const files = await queryCall({ sessionId: "-", op: "files" });
    expect(files.ok).toBe(true);
    const fileList = files.result as { root: string; entries: { path: string; dir: boolean }[]; truncated: boolean };
    expect(fileList.root).toBe(path.resolve(ws));
    expect(fileList.entries.some((e) => e.path === "a.txt" && !e.dir)).toBe(true);
    expect(fileList.entries.some((e) => e.path === "sub/" && e.dir)).toBe(true);
    expect(fileList.entries.some((e) => e.path === "sub/b.md")).toBe(true);

    const meta = await queryCall({ sessionId: "-", op: "meta" });
    expect(meta.ok).toBe(true);
    const caps = meta.result as { tools: string[]; skills: { name: string; description: string }[] };
    expect(caps.tools).toContain("read");
    expect(caps.skills).toEqual([{ name: "demo", description: "演示技能" }]);
    client.close();
  });

  it("query op=usage（U12/T-P3-111）：token/成本/压缩单源聚合 + 无库类型化拒绝", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "aegent-host-usage-"));
    settingsTmpDirs.push(tmp);
    const dbPath = path.join(tmp, "sessions.db");
    const sessionDb = SqliteEventStorage.open({ path: dbPath });
    // 预置用量事实（单源 = events 表：request/header 定价身份 + assistant/message usage）
    sessionDb.appendBatch("s-h1", [
      { type: "request/header", turn: 1, config: { provider: "openai", modelId: "gpt-x" }, seq: 1, ts: 1 } as never,
      {
        type: "assistant/message",
        turn: 1,
        message: { content: "r1" },
        usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110, cacheReadTokens: 50 },
        seq: 2,
        ts: 2,
      } as never,
      { type: "request/header", turn: 2, config: { provider: "openai", modelId: "gpt-x" }, seq: 3, ts: 3 } as never,
      {
        type: "assistant/message",
        turn: 2,
        message: { content: "r2" },
        usage: { inputTokens: 200, outputTokens: 20, totalTokens: 220 },
        seq: 4,
        ts: 4,
      } as never,
    ]);
    // 预置第二个会话（成本页按会话聚合面）
    sessionDb.appendBatch("s-other", [
      { type: "request/header", turn: 1, config: { provider: "openai", modelId: "gpt-x" }, seq: 1, ts: 1 } as never,
      {
        type: "assistant/message",
        turn: 1,
        message: { content: "s2" },
        usage: { inputTokens: 50, outputTokens: 5, totalTokens: 55 },
        seq: 2,
        ts: 2,
      } as never,
    ]);
    // settings：pricing 计价段（成本页数据源——文件即真源）
    writeFileSync(
      path.join(tmp, "settings.json"),
      JSON.stringify({
        version: 1,
        providers: [],
        pricing: [{ provider: "openai", modelId: "gpt-x", inputPerMTok: 1, cachedInputPerMTok: 0.1, outputPerMTok: 2 }],
      }),
    );
    const gateway = new FileSettingsGateway(
      path.join(tmp, "settings.json"),
      new PlainFileCredentialStore(path.join(tmp, "credentials.bin")),
      undefined,
      sessionDb,
    );
    const agent = fakeAgent();
    agent.emit({
      type: "event",
      event: { type: "compaction", turn: 1, summary: "s", retainedTail: 0, tokensBefore: 100, trigger: "auto", status: "completed" } as never,
    });
    const { port } = await startServer({
      agent,
      storage: sessionDb,
      settingsGateway: gateway,
      sessionsLibrary: sessionDb,
      contextWindow: 200_000,
    });
    const client = await wsConnect(port);
    await client.hello("web-u1");
    const queryCall = (call: Record<string, unknown>) => {
      const requestId = `u-${settingsCallSeq++}`;
      client.raw({ type: "query", requestId, ...call });
      return client.waitFor((e) => e.type === "response" && e.requestId === requestId, `query(${requestId})`) as Promise<Record<string, unknown>>;
    };

    const usage = await queryCall({ sessionId: "-", op: "usage" });
    expect(usage.ok).toBe(true);
    const u = usage.result as {
      contextWindow?: number;
      currentSession: { contextTokens?: number; turns: unknown[]; compaction: { total: number } };
      sessions: { sessionId: string; totalTokens: number }[];
      costs: { sessionId: string; costUsd: number; byTurn: { turn: number; costUsd: number }[] }[];
      byDay: { day: string; requests: number; totalTokens: number }[];
      byModel: { modelId: string; requests: number; totalTokens: number }[];
    };
    expect(u.contextWindow).toBe(200_000);
    // 本会话末轮 totalTokens = 上下文占用投影；压缩统计来自流内 compaction 事件
    expect(u.currentSession.contextTokens).toBe(220);
    expect(u.currentSession.turns).toHaveLength(2);
    expect(u.currentSession.compaction.total).toBe(1);
    // 按会话聚合（两库会话 + host 自身——host 会话无 usage 不入聚合）
    expect(u.sessions.some((s) => s.sessionId === "s-h1" && s.totalTokens === 330)).toBe(true);
    // 成本：轮 1 = 非缓存输入 50×1/1M + 缓存读 50×0.1/1M + 输出 10×2/1M
    const s1 = u.costs.find((c) => c.sessionId === "s-h1");
    expect(s1).toBeDefined();
    expect(s1!.costUsd).toBeCloseTo((50 * 1 + 50 * 0.1 + 10 * 2) / 1e6 + (200 * 1 + 20 * 2) / 1e6, 10);
    expect(s1!.byTurn).toHaveLength(2);
    // T-P3-135 批 B⑩：byDay 每日聚合（host 路线定形——预置事件 ts 同日，
    // 本地日分组恰一组；总量 = 110+220+55）+ byModel 归因（request/header
    // 末次——全部轮 gpt-x）
    expect(u.byDay).toHaveLength(1);
    expect(u.byDay[0]!.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(u.byDay[0]!.totalTokens).toBe(385);
    expect(u.byDay[0]!.requests).toBe(3);
    expect(u.byModel).toEqual([{ modelId: "gpt-x", requests: 3, totalTokens: 385 }]);
    client.close();
    await new Promise((r) => setTimeout(r, 50)); // 镜像 write-behind flush 先于 close
    sessionDb.close();

    // 内存库 host → 用量面类型化不可用
    const { port: port2 } = await startServer({
      agent: fakeAgent(),
      settingsGateway: new FileSettingsGateway(
        path.join(tmp, "settings2.json"),
        new PlainFileCredentialStore(path.join(tmp, "credentials2.bin")),
      ),
    });
    const client2 = await wsConnect(port2);
    await client2.hello("web-u2");
    client2.raw({ type: "query", requestId: "u-no-db", sessionId: "-", op: "usage" });
    const noUsage = await client2.waitFor((e) => e.type === "response" && e.requestId === "u-no-db", "无库用量回执");
    expect((noUsage.error as { code: string }).code).toBe("SESSIONS_UNAVAILABLE");
    client2.close();
    await new Promise((r) => setTimeout(r, 50)); // Windows 句柄释放缓冲
  });

  it("settings op=provider-models/provider-test（T-P3-137）：host 代理拉模型清单 + 真实发你好实测（openai/anthropic 双协议）", async () => {
    // mock 上游端点：记录收到的请求头与路径——协议形状的实测断言面
    const seen: { method: string; url: string; auth: string | undefined; xKey: string | undefined; version: string | undefined; extra: string | undefined }[] = [];
    const httpMocks: HttpServer[] = [];
    const mock = createHttpServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        seen.push({
          method: req.method ?? "",
          url: req.url ?? "",
          auth: req.headers["authorization"] as string | undefined,
          xKey: req.headers["x-api-key"] as string | undefined,
          version: req.headers["anthropic-version"] as string | undefined,
          extra: req.headers["x-custom-tag"] as string | undefined,
        });
        const json = (obj: unknown) => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(obj));
        };
        if (req.url === "/v1/models" || req.url === "/models") {
          json({ data: [{ id: "mock-b" }, { id: "mock-a" }, { id: "mock-a" }, { display_name: "无 id 忽略" }] });
        } else if (req.url === "/v1/chat/completions") {
          json({ choices: [{ message: { content: "你好！我可以帮你。" } }] });
        } else if (req.url === "/v1/messages") {
          json({ content: [{ type: "text", text: "你好，anthropic 测试成功" }] });
        } else {
          res.statusCode = 404;
          json({ error: "not found" });
        }
      });
    });
    await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
    httpMocks.push(mock);
    const mockPort = (mock.address() as { port: number }).port;
    const mockBase = `http://127.0.0.1:${mockPort}/v1`;

    const tmp = mkdtempSync(path.join(tmpdir(), "aegent-provider-test-"));
    settingsTmpDirs.push(tmp);
    const gateway = new FileSettingsGateway(
      path.join(tmp, "settings.json"),
      new PlainFileCredentialStore(path.join(tmp, "credentials.bin")),
    );
    const { port } = await startServer({ settingsGateway: gateway });
    const client = await wsConnect(port);
    await client.hello("web-p1");
    const call = (payload: Record<string, unknown>) => {
      const requestId = `p-${settingsCallSeq++}`;
      client.raw({ type: "settings", requestId, ...payload });
      return client.waitFor((e) => e.type === "response" && e.requestId === requestId, `settings(${requestId})`) as Promise<Record<string, unknown>>;
    };
    // key 经凭据面（credentials-set——wire 面 key 一次、后续测试走凭据）
    const saved = await call({ op: "credentials-set", provider: "mock-svc", key: "sk-test-123" });
    const masked = ((saved.result as { masked?: string }) ?? {}).masked ?? "";
    expect(masked).not.toContain("sk-test-123"); // 回执掩码——零明文

    // provider-models：openai 协议拉取（Bearer 鉴权 + 自定义头穿透 + 去重排序）
    const models = await call({
      op: "provider-models",
      provider: "mock-svc",
      baseUrl: mockBase,
      adapter: "openai",
      headers: { "X-Custom-Tag": "aegent", authorization: "hijack" }, // 保留键剔除
    });
    expect(models.ok).toBe(true);
    expect((models.result as { models: { id: string }[] }).models).toEqual([{ id: "mock-a" }, { id: "mock-b" }]);
    expect(seen.at(-1)!.auth).toBe("Bearer sk-test-123"); // 鉴权不旁路
    expect(seen.at(-1)!.extra).toBe("aegent"); // 自定义头穿透

    // provider-test：真实发"你好"——200 + content 非空才算成功
    const test = await call({
      op: "provider-test",
      provider: "mock-svc",
      baseUrl: mockBase,
      adapter: "openai",
      modelId: "mock-a",
    });
    expect(test.ok).toBe(true);
    const t = test.result as { ok: boolean; reply?: string; latencyMs?: number };
    expect(t.ok).toBe(true);
    expect(t.reply).toContain("你好");
    expect(typeof t.latencyMs).toBe("number");
    expect(seen.at(-1)!.url).toBe("/v1/chat/completions");

    // anthropic 协议：x-api-key + anthropic-version 头 + /v1/messages 形状
    const testA = await call({
      op: "provider-test",
      provider: "mock-svc",
      baseUrl: `http://127.0.0.1:${mockPort}`, // 不带 /v1——自动补
      adapter: "anthropic",
      modelId: "mock-a",
    });
    expect(testA.ok).toBe(true);
    expect((testA.result as { reply?: string }).reply).toContain("anthropic");
    expect(seen.at(-1)!.xKey).toBe("sk-test-123");
    expect(seen.at(-1)!.version).toBe("2023-06-01");
    expect(seen.at(-1)!.url).toBe("/v1/messages");

    // 未设 key 的条目：业务层类型化失败（envelope ok 但 result.ok=false——不抛内部错误）
    const noKey = await call({
      op: "provider-test",
      provider: "no-such-key",
      baseUrl: mockBase,
      adapter: "openai",
      modelId: "mock-a",
    });
    expect(noKey.ok).toBe(true); // 信封层成功——业务失败在 result 内
    const noKeyResult = noKey.result as { ok: boolean; error?: string };
    expect(noKeyResult.ok).toBe(false);
    expect(noKeyResult.error).toContain("key");
    client.close();

    // provider-test 鉴权失败路：401 → 鉴权失败文案
    const badMock = createHttpServer((req, res) => {
      res.statusCode = 401;
      res.end("{}");
    });
    await new Promise<void>((resolve) => badMock.listen(0, "127.0.0.1", resolve));
    httpMocks.push(badMock);
    const badPort = (badMock.address() as { port: number }).port;
    const bad = await (async () => {
      const c2 = await wsConnect(port);
      await c2.hello("web-p2");
      const requestId = `p-${settingsCallSeq++}`;
      c2.raw({
        type: "settings",
        requestId,
        op: "provider-test",
        provider: "mock-svc",
        baseUrl: `http://127.0.0.1:${badPort}/v1`,
        adapter: "openai",
        modelId: "mock-a",
      });
      const r = (await c2.waitFor((e) => e.type === "response" && e.requestId === requestId, "401 路回执")) as Record<string, unknown>;
      c2.close();
      return r;
    })();
    expect(((bad.result as { error?: string }) ?? {}).error).toContain("鉴权失败");
    for (const m of httpMocks) m.close();
  }, 30_000);

  it("query op=review/file（U15/T-P3-117）：工作面板聚合面 + 预览边界", async () => {
    const ws = mkdtempSync(path.join(tmpdir(), "aegent-host-work-"));
    settingsTmpDirs.push(ws);
    writeFileSync(path.join(ws, "a.txt"), "hello");
    mkdirSync(path.join(ws, "sub"), { recursive: true });
    writeFileSync(path.join(ws, "sub", "b.md"), "body");
    const agent = fakeAgent();
    // 流内写事实：write a.ts 成功 + edit a.ts 失败 + task 委派完成（经
    // agent.emit 进镜像流——seq/ts 由 store 分配，与生产事件路径同源）。
    // E16：step/turn 域事件须 turn/step 依次开启（嵌套完整序列）。
    const emitEvent = (event: Record<string, unknown>): void => {
      agent.emit({ type: "event", event: event as never });
    };
    emitEvent({ type: "turn/start", turn: 1 });
    emitEvent({ type: "step/start", turn: 1, step: 1 });
    emitEvent({ type: "tool/call", turn: 1, step: 1, callId: "c1", name: "write", arguments: JSON.stringify({ path: "a.txt", content: "x" }) });
    emitEvent({ type: "tool/result", turn: 1, step: 1, callId: "c1", message: { content: "ok" } });
    emitEvent({ type: "step/end", turn: 1, step: 1 });
    emitEvent({ type: "step/start", turn: 1, step: 2 });
    emitEvent({ type: "tool/call", turn: 1, step: 2, callId: "c2", name: "edit", arguments: JSON.stringify({ path: "missing.txt", oldText: "a", newText: "b" }) });
    emitEvent({ type: "tool/result", turn: 1, step: 2, callId: "c2", message: { content: "not found", isError: true }, error: { name: "EditError", code: "EDIT_NOT_FOUND" } });
    emitEvent({ type: "step/end", turn: 1, step: 2 });
    emitEvent({ type: "turn/end", turn: 1, reason: { kind: "completed" } });
    emitEvent({ type: "turn/start", turn: 2 });
    emitEvent({ type: "step/start", turn: 2, step: 1 });
    emitEvent({ type: "tool/call", turn: 2, step: 1, callId: "t1", name: "task", arguments: JSON.stringify({ description: "探索目录", prompt: "ls" }) });
    emitEvent({ type: "tool/result", turn: 2, step: 1, callId: "t1", message: { content: "done" }, meta: { subagent: { sessionId: "s-child", stopReason: "completed" } } });
    const { port } = await startServer({ agent, workspaceRoot: ws });
    const client = await wsConnect(port);
    await client.hello("web-w1");

    const queryCall = (call: Record<string, unknown>, requestId: string) => {
      client.raw({ type: "query", requestId, ...call });
      return client.waitFor((e) => e.type === "response" && e.requestId === requestId, `query(${requestId})`) as Promise<Record<string, unknown>>;
    };

    // 变更评审：成功 write 入清单、失败 edit 排除、task 委派一览（含耗时面）
    const review = await queryCall({ sessionId: "s-h1", op: "review" }, "r1");
    expect(review.ok).toBe(true);
    const report = review.result as {
      review: {
        changes: { path: string; op: string; via: string }[];
        operations: { path: string; op: string }[];
        delegations: { description: string; status: string; subagentSessionId?: string; durationMs?: number }[];
      };
    };
    expect(report.review.changes).toEqual([{ path: "a.txt", op: "write", via: "write", lastSeq: expect.any(Number) }]);
    expect(report.review.delegations).toHaveLength(1);
    expect(report.review.delegations[0]).toMatchObject({
      description: "探索目录",
      status: "completed",
      subagentSessionId: "s-child",
    });
    expect(report.review.delegations[0]!.durationMs).toBeGreaterThanOrEqual(0);

    // 文件预览：workspace 内可读；逃逸路径与目录类型化拒绝
    const preview = await queryCall({ sessionId: "-", op: "file", path: "sub/b.md" }, "r2");
    expect(preview.ok).toBe(true);
    expect((preview.result as { file: { content: string; truncated: boolean } }).file).toEqual({
      path: "sub/b.md",
      content: "body",
      truncated: false,
    });
    const escape = await queryCall({ sessionId: "-", op: "file", path: "../escape.txt" }, "r3");
    expect((escape.error as { code: string }).code).toBe("WORKSPACE_FILE_ESCAPES");
    const dirPreview = await queryCall({ sessionId: "-", op: "file", path: "sub" }, "r4");
    expect((dirPreview.error as { code: string }).code).toBe("WORKSPACE_FILE_UNAVAILABLE");
    client.close();
  });

  it("settings op=mcp-check（U17/T-P3-119）：MCP 向导连接校验两路（通过/失败）", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "aegent-host-mcp-"));
    settingsTmpDirs.push(tmp);
    // 真 stdio MCP stub server（registry-bridge.test 同款形状——echo 型演示面）
    writeFileSync(
      path.join(tmp, "stub-mcp-server.js"),
      `let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  buf += c;
  for (;;) {
    const nl = buf.indexOf("\\n");
    if (nl === -1) break;
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "stub" } } }) + "\\n");
    } else if (msg.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo", description: "回显", inputSchema: { type: "object" } }] } }) + "\\n");
    }
  }
});\n`,
      "utf8",
    );
    const { port } = await startServer({
      agent: fakeAgent(),
      settingsGateway: new FileSettingsGateway(
        path.join(tmp, "settings.json"),
        new PlainFileCredentialStore(path.join(tmp, "credentials.bin")),
      ),
    });
    const client = await wsConnect(port);
    await client.hello("web-m1");
    const settingsCall = (call: Record<string, unknown>, requestId: string) => {
      client.raw({ type: "settings", requestId, ...call });
      return client.waitFor((e) => e.type === "response" && e.requestId === requestId, `settings(${requestId})`) as Promise<Record<string, unknown>>;
    };
    // 通过路：stub server 握手 + 列工具
    const okCheck = await settingsCall(
      { op: "mcp-check", name: "demo", command: process.execPath, args: [path.join(tmp, "stub-mcp-server.js")] },
      "m1",
    );
    expect(okCheck.ok).toBe(true);
    const check = (okCheck.result as { check: { ok: boolean; protocolVersion: string; tools: unknown[] } }).check;
    expect(check.ok).toBe(true);
    expect(check.protocolVersion).toBe("2024-11-05");
    expect(check.tools).toHaveLength(1);
    // 失败路：不存在的命令 → 类型化失败回执（不上抛）
    const badCheck = await settingsCall({ op: "mcp-check", name: "bad", command: "aegent-nonexistent-cmd-xyz" }, "m2");
    expect(badCheck.ok).toBe(true);
    expect((badCheck.result as { check: { ok: boolean; error?: { code: string } } }).check.ok).toBe(false);
    client.close();
  });

  it("settings op=skills-list/skill-save（U22/T-P3-125）：技能管理（写回/清单/停用过滤）", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "aegent-host-skills-"));
    settingsTmpDirs.push(tmp);
    const ws = mkdtempSync(path.join(tmpdir(), "aegent-host-skills-ws-"));
    settingsTmpDirs.push(ws);
    const { port } = await startServer({
      agent: fakeAgent(),
      settingsGateway: new FileSettingsGateway(
        path.join(tmp, "settings.json"),
        new PlainFileCredentialStore(path.join(tmp, "credentials.bin")),
        undefined,
        undefined,
        ws, // U22：workspace 根（技能目录扫描/写入面）
      ),
    });
    const client = await wsConnect(port);
    await client.hello("web-k1");
    const settingsCall = (call: Record<string, unknown>, requestId: string) => {
      client.raw({ type: "settings", requestId, ...call });
      return client.waitFor((e) => e.type === "response" && e.requestId === requestId, `settings(${requestId})`) as Promise<Record<string, unknown>>;
    };

    // 空清单（roots 报告含 workspace 主技能目录）
    const empty = await settingsCall({ op: "skills-list" }, "k0");
    expect(empty.ok).toBe(true);
    const emptyView = empty.result as { skills: unknown[]; roots: string[]; disabled: string[] };
    expect(emptyView.skills).toEqual([]);
    expect(emptyView.roots[0]).toBe(path.join(ws, ".zcode", "skills"));

    // skill-save 写回 → SKILL.md 在位（frontmatter + tools 行 + 正文）
    const save = await settingsCall(
      {
        op: "skill-save",
        skill: { name: "review-pr", description: "评审 PR", body: "逐文件检查", tools: ["read", "grep"] },
      },
      "k1",
    );
    expect(save.ok).toBe(true);
    const savedPath = (save.result as { path: string }).path;
    expect(savedPath).toBe(path.join(ws, ".zcode", "skills", "review-pr", "SKILL.md"));
    const written = readFileSync(savedPath, "utf8");
    expect(written).toContain("name: review-pr");
    expect(written).toContain("description: 评审 PR");
    expect(written).toContain("tools: read, grep");
    expect(written).toContain("逐文件检查");

    // skills-list 再查：技能在清单（origin = 主目录）+ body 回填
    const listed = await settingsCall({ op: "skills-list" }, "k2");
    const view = listed.result as {
      skills: { name: string; description: string; tools?: string[]; origin: string; body: string }[];
      roots: string[];
    };
    expect(view.skills).toHaveLength(1);
    expect(view.skills[0]).toMatchObject({ name: "review-pr", description: "评审 PR", body: "逐文件检查" });
    expect(view.skills[0]!.tools).toEqual(["read", "grep"]);
    expect(view.skills[0]!.origin).toBe(path.join(ws, ".zcode", "skills"));

    // 停用开关（settings skills.disabled patch）→ 清单过滤
    const disable = await settingsCall({ op: "update", patch: { skills: { disabled: ["review-pr"] } } }, "k3");
    expect(disable.ok).toBe(true);
    const off = await settingsCall({ op: "skills-list" }, "k4");
    expect((off.result as { skills: unknown[]; disabled: string[] }).skills).toEqual([]);
    expect((off.result as { disabled: string[] }).disabled).toEqual(["review-pr"]);

    // 坏名 fail-closed：slug 外形状 parse 层拒绝——坏信封整拒，回执恒
    // "(unparsed)" PROTOCOL_MALFORMED（T-P3-108 同款纪律）
    client.raw({
      type: "settings",
      requestId: "k5",
      op: "skill-save",
      skill: { name: "../escape", description: "x", body: "y" },
    });
    const unparsed1 = await client.waitFor((e) => e.type === "response" && e.requestId === "(unparsed)", "坏名回执1");
    expect((unparsed1.error as { code: string }).code).toBe("PROTOCOL_MALFORMED");
    client.raw({
      type: "settings",
      requestId: "k6",
      op: "skill-save",
      skill: { name: "Bad Name", description: "x", body: "y" },
    });
    await client.waitFor((e) => e.type === "response" && e.requestId === "(unparsed)", "坏名回执2");
    // 坏信封拒后技能面仍可用（k2 的清单已被停用 patch 清空——保存一个好名验证链活）
    const alive = await settingsCall(
      { op: "skill-save", skill: { name: "still-alive", description: "坏信封后", body: "ok" } },
      "k7",
    );
    expect(alive.ok).toBe(true);
    client.close();
  });

  it("settings op=instructions-list/instruction-save（U24/T-P3-127）：指令中心三文件位", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "aegent-host-instr-"));
    settingsTmpDirs.push(tmp);
    const ws = mkdtempSync(path.join(tmpdir(), "aegent-host-instr-ws-"));
    settingsTmpDirs.push(ws);
    const { port } = await startServer({
      agent: fakeAgent(),
      settingsGateway: new FileSettingsGateway(
        path.join(tmp, "settings.json"),
        new PlainFileCredentialStore(path.join(tmp, "credentials.bin")),
        undefined,
        undefined,
        ws, // U22/U24：workspace 根（项目 AGENTS.md 位）
        tmp, // U24：home 注入（全局 AGENTS.md / rules.txt 落临时目录）
      ),
    });
    const client = await wsConnect(port);
    await client.hello("web-n1");
    const settingsCall = (call: Record<string, unknown>, requestId: string) => {
      client.raw({ type: "settings", requestId, ...call });
      return client.waitFor((e) => e.type === "response" && e.requestId === requestId, `settings(${requestId})`) as Promise<Record<string, unknown>>;
    };

    // 空清单：三文件位路径正确、全部不存在
    const empty = await settingsCall({ op: "instructions-list" }, "n0");
    expect(empty.ok).toBe(true);
    const view = empty.result as {
      project: { path: string; exists: boolean; content: string };
      global: { path: string; exists: boolean; content: string };
      rules: { path: string; exists: boolean; content: string; issues: unknown[] };
    };
    expect(view.project.path).toBe(path.join(ws, "AGENTS.md"));
    expect(view.global.path).toBe(path.join(tmp, ".aegent", "AGENTS.md"));
    expect(view.rules.path).toBe(path.join(tmp, ".aegent", "rules.txt"));
    expect(view.project.exists).toBe(false);

    // 写回项目 AGENTS.md → 文件在位（tmp 原子替换后无 .tmp 残留）
    const saveProject = await settingsCall(
      { op: "instruction-save", target: "project-agents", content: "## 代码风格\n- 最小改动" },
      "n1",
    );
    expect(saveProject.ok).toBe(true);
    expect(existsSync(path.join(ws, "AGENTS.md"))).toBe(true);
    expect(existsSync(path.join(ws, "AGENTS.md.tmp"))).toBe(false);

    // 写回规则文件（含一行坏形状）→ list 回读并 lint 点名
    const saveRules = await settingsCall(
      { op: "instruction-save", target: "user-rules", content: "Bash(git status) -> allow\n没有箭头的行\n" },
      "n2",
    );
    expect(saveRules.ok).toBe(true);
    const listed = await settingsCall({ op: "instructions-list" }, "n3");
    const v2 = listed.result as typeof view;
    expect(v2.project.exists).toBe(true);
    expect(v2.project.content).toContain("最小改动");
    expect(v2.rules.exists).toBe(true);
    expect((v2.rules.issues as { line: number }[]).map((i) => i.line)).toEqual([2]);

    // 非法 target → parse 层拒绝（坏信封 (unparsed) 回执）
    client.raw({ type: "settings", requestId: "n4", op: "instruction-save", target: "../escape", content: "x" });
    const unparsed = await client.waitFor((e) => e.type === "response" && e.requestId === "(unparsed)", "非法 target 回执");
    expect((unparsed.error as { code: string }).code).toBe("PROTOCOL_MALFORMED");
    client.close();
  });

  it("settings op=stt-transcribe（U26/T-P3-129）：语音转写代理（配置/未配置/白名单外）", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "aegent-host-stt-"));
    settingsTmpDirs.push(tmp);
    // fake STT fetch（OpenAI 协议响应形状——真实端点联调随 U8）
    const fakeSttFetch = (async () =>
      new Response(JSON.stringify({ text: "转写出的文本" }), { status: 200 })) as typeof fetch;
    const { port } = await startServer({
      agent: fakeAgent(),
      settingsGateway: new FileSettingsGateway(
        path.join(tmp, "settings.json"),
        new PlainFileCredentialStore(path.join(tmp, "credentials.bin")),
        undefined,
        undefined,
        undefined,
        tmp,
        fakeSttFetch,
      ),
    });
    const client = await wsConnect(port);
    await client.hello("web-t1");
    const settingsCall = (call: Record<string, unknown>, requestId: string) => {
      client.raw({ type: "settings", requestId, ...call });
      return client.waitFor((e) => e.type === "response" && e.requestId === requestId, `settings(${requestId})`) as Promise<Record<string, unknown>>;
    };

    // 未配置 → 类型化 STT_NOT_CONFIGURED
    const unconfigured = await settingsCall(
      { op: "stt-transcribe", mediaType: "audio/webm", content: Buffer.from("hi").toString("base64") },
      "t1",
    );
    expect(unconfigured.ok).toBe(false);
    expect((unconfigured.error as { code: string }).code).toBe("STT_NOT_CONFIGURED");

    // 配置 stt 段（即改即存通道）→ 转写回执
    const configure = await settingsCall(
      { op: "update", patch: { stt: { baseUrl: "https://stt.example/v1", model: "whisper-1" } } },
      "t2",
    );
    expect(configure.ok).toBe(true);
    const transcribed = await settingsCall(
      { op: "stt-transcribe", mediaType: "audio/webm", content: Buffer.from("hi").toString("base64") },
      "t3",
    );
    expect(transcribed.ok).toBe(true);
    expect(transcribed.result).toEqual({ text: "转写出的文本", model: "whisper-1" });

    // 白名单外 mediaType → P4 类型化拒绝（STT_UNSUPPORTED_MEDIA_TYPE）
    const badType = await settingsCall(
      { op: "stt-transcribe", mediaType: "audio/ogg", content: Buffer.from("hi").toString("base64") },
      "t4",
    );
    expect(badType.ok).toBe(false);
    expect((badType.error as { code: string }).code).toBe("STT_UNSUPPORTED_MEDIA_TYPE");
    client.close();
  });

  it("settings op=import（U20/T-P3-122）：配置包导入 + 备份滚动 + 坏包拒绝", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "aegent-host-import-"));
    settingsTmpDirs.push(tmp);
    const settingsPath = path.join(tmp, "settings.json");
    // 预置现有配置（导入后应被覆盖且 onboardingDone 保留）
    writeFileSync(
      settingsPath,
      JSON.stringify({ version: 1, providers: [], onboardingDone: true }),
      "utf8",
    );
    const { port } = await startServer({
      agent: fakeAgent(),
      settingsGateway: new FileSettingsGateway(
        settingsPath,
        new PlainFileCredentialStore(path.join(tmp, "credentials.bin")),
      ),
    });
    const client = await wsConnect(port);
    await client.hello("web-i1");
    const settingsCall = (call: Record<string, unknown>, requestId: string) => {
      client.raw({ type: "settings", requestId, ...call });
      return client.waitFor((e) => e.type === "response" && e.requestId === requestId, `settings(${requestId})`) as Promise<Record<string, unknown>>;
    };

    // 好包：providers + prompts 导入，onboardingDone 本地态保留，备份滚动落 bak.0
    const good = await settingsCall(
      {
        op: "import",
        settings: {
          version: 1,
          providers: [{ name: "main", adapter: "openai", baseUrl: "https://x", model: "m" }],
          defaultProvider: "main",
          prompts: [{ name: "r", content: "评审" }],
        },
      },
      "i1",
    );
    expect(good.ok).toBe(true);
    const applied = good.result as { applied: true; summary: string[] };
    expect(applied.applied).toBe(true);
    expect(applied.summary.some((l) => l.includes("供应商条目 1 个"))).toBe(true);
    // 落盘验证：配置被覆盖、本地态保留、备份滚动落 bak.0
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).defaultProvider).toBe("main");
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).onboardingDone).toBe(true);
    expect(existsSync(`${settingsPath}.bak.0`)).toBe(true);
    expect(JSON.parse(readFileSync(`${settingsPath}.bak.0`, "utf8")).onboardingDone).toBe(true);

    // 坏包：providers 形状非法 → 拒绝且不落盘（fail-closed——原配置仍可读）
    const bad = await settingsCall(
      { op: "import", settings: { version: 1, providers: "x" } },
      "i2",
    );
    expect(bad.ok).toBe(false);
    const still = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(still.defaultProvider).toBe("main"); // 坏包未覆盖
    client.close();
  });

  it("notification name=n5（U13/T-P3-112）：notifyHub 分类通知全端 WS 广播", async () => {
    const hub = new NotificationHub();
    const agent = fakeAgent();
    const { port } = await startServer({ agent, notifyHub: hub });
    const client = await wsConnect(port);
    await client.hello("web-n1");
    // turn/end 事件经 bridge → turn_settled 分型发布 → n5 信封回端
    agent.emit({
      type: "event",
      event: { type: "turn/end", seq: 1, ts: 1, turn: 1, reason: { kind: "completed" } } as never,
    });
    const n5 = await client.waitFor(
      (e) => e.type === "notification" && e.name === "n5",
      "n5 通知信封",
    );
    expect((n5.payload as { kind: string }).kind).toBe("turn_settled");
    expect((n5.payload as { data: { turn: number } }).data.turn).toBe(1);
    client.close();
  });
});

