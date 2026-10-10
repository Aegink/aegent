import { PassThrough } from "node:stream";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { decodeMessage, type AgentMessage, type AgentRequest } from "../kernel/agent-protocol.js";
import type { SessionEvent } from "../kernel/events.js";
import type { ModelProvider } from "../models/provider.js";
import { runAgentChildStdio, type AgentChildOptions } from "../kernel/agent-process.js";
import {InMemoryEventStorage, SessionEventStore, type SessionStore} from "../session/store.js";
import { HostRegistry } from "./registry.js";
import { HostBridge } from "./bridge.js";
import type { ServerEnvelope } from "./protocol.js";

// ---------------------------------------------------------------------------
// 内存桥 helper（cli.test 同款形状——不经真实 spawn）
// ---------------------------------------------------------------------------

function startMemoryChild(childOptions: AgentChildOptions): {
  agent: { send: (request: AgentRequest) => void; messages: AsyncIterable<AgentMessage> };
  kill: () => Promise<void>;
  done: Promise<void>;
} {
  const childInput = new PassThrough();
  const childOutput = new PassThrough();
  childOutput.setEncoding("utf8");
  const done = runAgentChildStdio({
    ...childOptions,
    input: childInput,
    output: childOutput,
    exit: () => {
      childOutput.end();
    },
  }).then(
    () => undefined,
    () => undefined,
  );
  const messages = (async function* () {
    let buffer = "";
    for await (const chunk of childOutput) {
      buffer += chunk as string;
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl < 0) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim() === "") continue;
        yield decodeMessage(line);
      }
    }
  })();
  return {
    agent: {
      send: (request) => childInput.write(`${JSON.stringify(request)}\n`),
      messages,
    },
    /** 关闭 stdin（触发 readline close → 优雅收尾 → exit）并等子侧结束。 */
    kill: async () => {
      childInput.end();
      await done;
    },
    done,
  };
}

function scriptedProvider(steps: Array<Array<{ type: string } & Record<string, unknown>>>): ModelProvider {
  let call = 0;
  return {
    async *streamChat() {
      const script = steps[Math.min(call, steps.length - 1)] ?? [];
      call += 1;
      for (const chunk of script) {
        yield chunk as never;
      }
    },
  };
}

function waitForEnvelope(
  out: ServerEnvelope[],
  predicate: (envelope: ServerEnvelope) => boolean,
  timeoutMs = 4000,
): Promise<ServerEnvelope> {
  const found = out.find(predicate);
  if (found !== undefined) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const hit = out.find(predicate);
      if (hit !== undefined) {
        clearInterval(timer);
        resolve(hit);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`等待信封超时：${JSON.stringify(out.map((o) => o.type))}`));
      }
    }, 10);
  });
}

interface TestRig {
  bridge: HostBridge;
  host: ReturnType<HostRegistry["register"]>;
  store: SessionStore;
  connect(surfaceId: string): {
    out: ServerEnvelope[];
    server: ReturnType<HostBridge["connectSurface"]>["server"];
    close(): void;
  };
  kill(): Promise<void>;
}

async function startRig(
  provider: ModelProvider,
  workspace: string,
  extra: { agentFactory?: (sessionId: string) => import("./protocol.js").AgentChannel } = {},
): Promise<TestRig> {
  const { agent, kill: killChild } = startMemoryChild({
    sessionId: "s-a",
    provider,
    assembly: {
      workspaceRoot: workspace,
      contextWindow: 200_000,
      approvalTimeoutMs: 5000,
    },
  });
  const registry = new HostRegistry();
  const host = registry.register({ sessionId: "s-a" });
  const store = new SessionEventStore(new InMemoryEventStorage()); // host 侧 roster 流
  const bridge = new HostBridge({ host, agent, store, ...(extra.agentFactory !== undefined ? { agentFactory: extra.agentFactory } : {}) });
  return {
    bridge,
    host,
    store,
    connect(surfaceId: string) {
      const out: ServerEnvelope[] = [];
      const connection = bridge.connectSurface({
        surfaceId,
        deliveryKind: "push",
        write: (line) => out.push(JSON.parse(line) as ServerEnvelope),
      });
      connection.server.handleLine(JSON.stringify({ type: "hello", version: 1 }));
      return { out, server: connection.server, close: connection.close };
    },
    kill: () => killChild(),
  };
}

describe("T-P3-170 多会话并发路由", () => {
  it("第二会话经 agentFactory 懒派生通道：prompt 路由到各自 child、事件归属各会话不串线", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-bridge-multi-"));
    const factoryChildren: ReturnType<typeof startMemoryChild>[] = [];
    const rig = await startRig(scriptedProvider([[{ type: "text-delta", text: "a1" }, { type: "done" }]]), workspace, {
      agentFactory: (sessionId: string) => {
        const child = startMemoryChild({ sessionId, provider: scriptedProvider([[{ type: "text-delta", text: "b1" }, { type: "done" }]]) });
        factoryChildren.push(child);
        return child.agent;
      },
    });
    try {
      const ui = rig.connect("u1");
      ui.server.handleLine(JSON.stringify({ type: "lease", op: "acquire", surfaceId: "u1" }));
      await waitForEnvelope(ui.out, (e) => e.type === "response" && e.requestId === "(lease)" && e.ok === true);

      // 主会话 s-a 一轮 + 新会话 s-b 一轮——两个 child 各自回声
      await rig.bridge.send("s-a", { type: "prompt", messageId: "m-a", content: "hello-a" } as never, { surfaceId: "u1" });
      const aDone = waitForEnvelope(ui.out, (e) => e.type === "event" && e.sessionId === "s-a" && e.event.type === "turn/end");
      await rig.bridge.send("s-b", { type: "prompt", messageId: "m-b", content: "hello-b" } as never, { surfaceId: "u1" });
      const bDone = waitForEnvelope(ui.out, (e) => e.type === "event" && e.sessionId === "s-b" && e.event.type === "turn/end");
      await aDone;
      await bDone;

      // 事件归属严格分流：s-a 流里没有 s-b 的事件，反之亦然
      const aSids = new Set(ui.out.filter((e) => e.type === "event").map((e) => (e as { sessionId: string }).sessionId));
      expect(aSids.has("s-a")).toBe(true);
      expect(aSids.has("s-b")).toBe(true);
      const bUser = ui.out.find((e) => e.type === "event" && e.sessionId === "s-b" && (e as { event?: { type?: string } }).event?.type === "user/message");
      expect(bUser).toBeDefined();

      // s-b 的 child 确实由工厂独立创建（池化——第二次 send 复用同一通道）
      expect(factoryChildren).toHaveLength(1);
    } finally {
      await rig.kill();
      for (const child of factoryChildren) await child.kill();
    }
  });
});

describe("N2/T-P1-116 审批跨端（协议线场景③）", () => {
  it("A 端开轮挂起 → 审批广播两端 → A 断开 → B 端 acquire+approve → 轮继续完成", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-bridge-approve-"));
    const target = path.join(workspace, "hello.txt");
    const provider = scriptedProvider([
      [
        {
          type: "tool-call-delta",
          id: "call_1",
          name: "write",
          argsDelta: JSON.stringify({ path: target, content: "你好，场景③" }),
        },
        { type: "done" },
      ],
      [
        { type: "text-delta", text: "已写入。" },
        { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } },
        { type: "done" },
      ],
    ]);
    const rig = await startRig(provider, workspace);

    // B 端（飞书）先连接（挂起广播的双端可见性——"任何通道可答"）
    const b = rig.connect("feishu");
    // 端 A（桌面）注册 + 握手 + acquire 租约 + 开轮
    const a = rig.connect("desktop");
    a.server.handleLine(JSON.stringify({ type: "lease", op: "acquire", surfaceId: "desktop" }));
    await waitForEnvelope(a.out, (e) => e.type === "response" && e.ok === true);
    a.server.handleLine(
      JSON.stringify({
        type: "request",
        requestId: "r1",
        sessionId: "s-a",
        call: { type: "prompt", messageId: "m1", content: "把场景③写进文件" },
      }),
    );
    // accepted 回执（request/response 关联）
    const accepted = await waitForEnvelope(
      a.out,
      (e) => e.type === "response" && (e as { requestId?: string }).requestId === "r1",
    );
    expect(accepted).toMatchObject({ ok: true, result: { accepted: "m1" } });
    // 审批挂起广播两端
    await waitForEnvelope(a.out, (e) => e.type === "notification" && (e as { name?: string }).name === "approval_requested");
    const bAsked = await waitForEnvelope(
      b.out,
      (e) => e.type === "notification" && (e as { name?: string }).name === "approval_requested",
    );
    expect((bAsked as { payload?: { requestId?: string } }).payload?.requestId).toBe("call_1");

    // A 端断线（未答复）——租约自动释放 + roster detach
    a.close();
    expect(rig.host.surfaces.currentLeaseHolder()).toBeUndefined();

    // B 端（飞书）acquire + 跨连接答复（source 审计）
    b.server.handleLine(JSON.stringify({ type: "lease", op: "acquire", surfaceId: "feishu" }));
    await waitForEnvelope(b.out, (e) => e.type === "response" && e.ok === true && (e as { result?: { held?: boolean } }).result?.held === true);
    b.server.handleLine(
      JSON.stringify({
        type: "request",
        requestId: "r2",
        sessionId: "s-a",
        call: { type: "approve", requestId: "call_1", action: "allow", source: "feishu" },
      }),
    );
    // 放行后工具真实执行 → 第二轮文本 → turn/end completed 事件广播
    const turnEnd = await waitForEnvelope(
      b.out,
      (e) => e.type === "event" && (e as { event?: SessionEvent }).event?.type === "turn/end",
    );
    expect((turnEnd as { event: SessionEvent & { reason?: { kind?: string } } }).event.reason?.kind).toBe("completed");
    expect(await readFile(target, "utf8")).toBe("你好，场景③");
    // settled 广播（A 已断开，B 收到）
    const settled = b.out.find(
      (e) => e.type === "notification" && (e as { name?: string }).name === "approval_settled",
    );
    expect(settled).toBeDefined();
    // roster 落流（host 侧流面）：attach desktop → detach desktop → attach feishu
    const rosterEvents = rig.store.load("s-a").map((e) => `${e.type}:${(e as { surfaceId?: string }).surfaceId ?? ""}`);
    // B 端先于 A 连接（挂起广播的双端可见性），A 断开即 detach
    expect(rosterEvents).toEqual([
      "surface/attach:feishu",
      "surface/attach:desktop",
      "surface/detach:desktop",
    ]);
    await rig.kill();
  }, 15000);

  it("非持约连接写命令 → NotLeaseHolderError response；匿名连接同样被拒", async () => {
    const provider = scriptedProvider([[{ type: "text-delta", text: "ok" }, { type: "done" }]]);
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-bridge-lease-"));
    const rig = await startRig(provider, workspace);
    const a = rig.connect("desktop");
    const b = rig.connect("feishu");
    a.server.handleLine(JSON.stringify({ type: "lease", op: "acquire", surfaceId: "desktop" }));
    await waitForEnvelope(a.out, (e) => e.type === "response" && e.ok === true);

    // B（未 acquire）发写命令 → 非持约
    b.server.handleLine(
      JSON.stringify({
        type: "request",
        requestId: "rb1",
        sessionId: "s-a",
        call: { type: "prompt", messageId: "mb1", content: "hi" },
      }),
    );
    const bDenied = await waitForEnvelope(
      b.out,
      (e) => e.type === "response" && (e as { requestId?: string }).requestId === "rb1",
    );
    expect(bDenied).toMatchObject({
      ok: false,
      error: { code: "OWNER_NOT_LEASE_HOLDER" },
    });
    // A（持约）同命令照常受理
    a.server.handleLine(
      JSON.stringify({
        type: "request",
        requestId: "ra1",
        sessionId: "s-a",
        call: { type: "prompt", messageId: "ma1", content: "hi" },
      }),
    );
    const aAccepted = await waitForEnvelope(
      a.out,
      (e) => e.type === "response" && (e as { requestId?: string }).requestId === "ra1",
    );
    expect(aAccepted).toMatchObject({ ok: true, result: { accepted: "ma1" } });
    await rig.kill();
  }, 15000);

  it("lease 信封：双端争抢 → LeaseBusy；release 后另一端可获取", async () => {
    const provider = scriptedProvider([[{ type: "text-delta", text: "ok" }, { type: "done" }]]);
    const workspace = mkdtempSync(path.join(tmpdir(), "aegent-bridge-lease2-"));
    console.log("DBG: rig start");
    const rig = await startRig(provider, workspace);
    console.log("DBG: rig up");
    const a = rig.connect("desktop");
    const b = rig.connect("feishu");
    console.log("DBG: connected");
    a.server.handleLine(JSON.stringify({ type: "lease", op: "acquire", surfaceId: "desktop" }));
    b.server.handleLine(JSON.stringify({ type: "lease", op: "acquire", surfaceId: "feishu" }));
    console.log("DBG: acquire sent", JSON.stringify(a.out), JSON.stringify(b.out));
    const busy = await waitForEnvelope(
      b.out,
      (e) => e.type === "response" && (e as { error?: { code?: string } }).error?.code === "OWNER_LEASE_BUSY",
    );
    expect(busy).toMatchObject({ ok: false, error: { code: "OWNER_LEASE_BUSY" } });
    // A 释放 → B 可获取
    a.server.handleLine(JSON.stringify({ type: "lease", op: "release", surfaceId: "desktop" }));
    await waitForEnvelope(
      a.out,
      (e) => e.type === "response" && (e as { result?: { released?: boolean } }).result?.released === true,
    );
    b.server.handleLine(JSON.stringify({ type: "lease", op: "acquire", surfaceId: "feishu" }));
    const bHeld = await waitForEnvelope(
      b.out,
      (e) => e.type === "response" && (e as { result?: { held?: boolean } }).result?.held === true,
    );
    expect(bHeld).toMatchObject({ ok: true, result: { held: true, surfaceId: "feishu" } });
    await rig.kill();
  }, 15000);
});

describe("B3 补口：settings 分发尾 fail-closed（结构红线）", () => {
  it("credentials-list 是显式分支；其余分发尾抛 SETTINGS_OP_UNDISPATCHED 而非静默兜底", () => {
    // 说明：未知 op 在 protocol-parse 层即被拒（op 闭集校验），闭集内 op
    // 均有显式分支——分发尾在 e2e 上不可达，属"防御未来漏分发"的结构
    // 红线；按 tauri-shell.test 先例以源码断言钉住（防静默兜底回潮）。
    // 注：server.test 的 credentials 往返用例是"显式分支在位"的行为级验证
    // （曾误把该分支当兜底删除——e2e 立即抓出，两条防线互补）；分发体已
    // 下沉 bridge-surface-options.ts（行数纪律拆分），断言随代码位置。
    const source = readFile(new URL("./bridge-surface-options.ts", import.meta.url), "utf8");
    return source.then((lib) => {
      expect(lib).toContain("SETTINGS_OP_UNDISPATCHED");
      expect(lib).toMatch(/if \(call\.op === "credentials-list"\)/);
    });
  });
});
