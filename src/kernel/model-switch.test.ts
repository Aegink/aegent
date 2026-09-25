/**
 * T-P1-04（J6/J7）验收——运行时换模 + 在途 turn 模型捕获。
 *
 * 三层证据：
 *  1. 服务级：ModelSwitchService 的受理/捕获/两值观测/类型化错误（卡面
 *     验收②③ + 验收①的状态语义）；
 *  2. loop 级：验收①执行面——turn 进行中发换模，在途 turn 全程用启动时
 *     捕获的旧模型（request/header 的身份是事件流上的 captured 断言），
 *     下一 turn 用新模型；
 *  3. 协议级：model/switch 命令经 agent-process 全链（内存流，管道零
 *     mock）——合法换模下一 turn 生效、未注册模型类型化 error 行、未装配
 *     换模能力显式报错不静默。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import {
  ModelNotRegisteredError,
  ModelSwitchService,
  type RegisteredModel,
} from "./model-switch.js";
import { AgentLoop } from "./loop.js";
import { runAgentChildStdio, type AgentChildOptions } from "./agent-process.js";
import {
  decodeMessage,
  type AgentMessage,
  type AgentRequest,
} from "./agent-protocol.js";
import type { ModelProvider } from "../models/provider.js";
import type { SessionEvent } from "./events.js";
import { InMemoryEventStorage, SessionStore } from "../session/store.js";
import { drainUntil, recvWithTimeout } from "../test-support/event-asserts.js";

const identityA = { provider: "p", modelId: "m1" };
const identityB = { provider: "p", modelId: "m2" };

type HeaderEvent = Extract<SessionEvent, { type: "request/header" }>;

/** 可区分的假 provider：每次调用产 `label#次数`；A 首次调用带一个工具调用。 */
function scriptedProvider(label: string, onFirstCall?: () => void): ModelProvider {
  let calls = 0;
  return {
    async *streamChat() {
      calls += 1;
      yield { type: "text-delta", text: `${label}#${calls}` };
      if (label === "A" && calls === 1) {
        onFirstCall?.();
        yield { type: "tool-call-delta", id: "c1", name: "noop", argsDelta: "{}" };
      }
      yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
      yield { type: "done" };
    },
  };
}

/** 两模型注册表：provider 的 onFirstCall 闭包延迟引用 service（构造后再赋值）。 */
function makeService(onFirstCall?: () => void): ModelSwitchService {
  const providerA = scriptedProvider("A", onFirstCall);
  const providerB = scriptedProvider("B");
  const models: RegisteredModel[] = [
    { identity: identityA, provider: providerA },
    { identity: identityB, provider: providerB },
  ];
  return new ModelSwitchService({ initial: identityA, models });
}

describe("ModelSwitchService —— J6/J7 会话级模型选择状态", () => {
  it("验收②：换模到未注册模型抛类型化错误，不静默", () => {
    const service = makeService();
    expect(service.configured).toEqual(identityA);
    try {
      service.switch({ provider: "p", modelId: "nope" });
      expect.unreachable("应抛 ModelNotRegisteredError");
    } catch (e) {
      expect(e).toBeInstanceOf(ModelNotRegisteredError);
      expect((e as ModelNotRegisteredError).code).toBe("MODEL_NOT_REGISTERED");
      expect((e as ModelNotRegisteredError).identity).toEqual({
        provider: "p",
        modelId: "nope",
      });
    }
    // 失败的换模不改变 configured（受理是原子的：要么换成功要么不动）
    expect(service.configured).toEqual(identityA);
  });

  it("装配期防线：初始身份未注册即抛错，不给静默坏状态", () => {
    expect(
      () =>
        new ModelSwitchService({
          initial: { provider: "p", modelId: "nope" },
          models: [
            { identity: identityA, provider: scriptedProvider("A") },
          ],
        }),
    ).toThrow(ModelNotRegisteredError);
  });

  it("验收①（状态语义）：turn 启动捕获后，在途换模不影响捕获、下一 turn 生效", () => {
    const service = makeService();
    const capture1 = service.captureForTurn(1);
    expect(capture1.identity).toEqual(identityA);

    // turn 1 进行中：换模立即受理（configured 更新），但捕获不动
    service.switch(identityB);
    expect(service.configured).toEqual(identityB);
    expect(service.capturedFor(1)?.identity).toEqual(identityA);

    // turn 2 启动：从新 configured 捕获——生效点在新 turn
    const capture2 = service.captureForTurn(2);
    expect(capture2.identity).toEqual(identityB);
    expect(service.capturedFor(2)?.identity).toEqual(identityB);
  });

  it("验收③：configured 与 captured 两值可分别观测（captured 单槽语义）", () => {
    const service = makeService();
    expect(service.capturedFor(1)).toBeUndefined(); // 未开轮无捕获
    service.captureForTurn(7);
    expect(service.capturedFor(7)?.provider).toBeDefined();
    expect(service.capturedFor(6)).toBeUndefined(); // 非在途 turn 无捕获
    // 同一 turn 重复捕获（覆盖单槽，不养每 turn 历史——历史事实由
    // T-P1-06 的流内事件承载）
    service.switch(identityB);
    service.captureForTurn(7);
    expect(service.capturedFor(7)?.identity).toEqual(identityB);
  });
});

describe("J7 loop 接线 —— 每轮启动捕获、在途换模不串轮（验收①执行面）", () => {
  it("turn1 流中途换模：turn1 两个 step 的 request/header 全是旧身份，turn2 用新模型", async () => {
    // turn1 step1 的流中途发换模（在途换模的精确时点：捕获早已发生）
    let service!: ModelSwitchService;
    const providerA = scriptedProvider("A", () => service.switch(identityB));
    const providerB = scriptedProvider("B");
    service = new ModelSwitchService({
      initial: identityA,
      models: [
        { identity: identityA, provider: providerA },
        { identity: identityB, provider: providerB },
      ],
    });
    const store = new SessionStore(new InMemoryEventStorage());
    const loop = new AgentLoop({
      sessionId: "s0",
      store,
      provider: providerA,
      identity: identityA,
      executeTool: async () => ({ content: "ok" }),
      decideTurn: (record) =>
        record.toolCalls.length > 0 ? { action: "continue" } : { action: "end" },
      modelForTurn: (turn) => service.captureForTurn(turn),
    });

    const r1 = await loop.runTurn("第一问");
    expect(r1.kind).toBe("completed");
    const r2 = await loop.runTurn("第二问");
    expect(r2.kind).toBe("completed");

    const headers = store
      .load("s0")
      .filter((e): e is HeaderEvent => e.type === "request/header");
    const turn1Headers = headers.filter((h) => h.turn === 1);
    const turn2Headers = headers.filter((h) => h.turn === 2);
    // captured 断言的事件侧面：在途 turn 的 header 保持旧身份
    expect(turn1Headers).toHaveLength(2); // step1 + step2 都由旧模型服务
    for (const h of turn1Headers) {
      expect(h.config).toEqual({ provider: "p", modelId: "m1" });
    }
    expect(turn2Headers).toHaveLength(1);
    expect(turn2Headers[0]!.config).toEqual({ provider: "p", modelId: "m2" });
    // 内容侧面：turn1 全程旧 provider（A#1/A#2），turn2 换新 provider（B#1）
    const contents = store
      .load("s0")
      .filter(
        (e): e is Extract<SessionEvent, { type: "assistant/message" }> =>
          e.type === "assistant/message",
      )
      .map((e) => e.message.content);
    expect(contents).toEqual(["A#1", "A#2", "B#1"]);
  });

  it("回归：无 modelForTurn 时 loop 用固定 provider/identity（P0 行为不变）", async () => {
    const store = new SessionStore(new InMemoryEventStorage());
    const loop = new AgentLoop({
      sessionId: "s0",
      store,
      provider: scriptedProvider("A"),
      identity: identityA,
      executeTool: async () => ({ content: "ok" }),
      decideTurn: () => ({ action: "end" }),
    });
    await loop.runTurn("问");
    const headers = store
      .load("s0")
      .filter((e): e is HeaderEvent => e.type === "request/header");
    expect(headers).toHaveLength(1);
    expect(headers[0]!.config).toEqual({ provider: "p", modelId: "m1" });
  });
});

// ---------------------------------------------------------------------------
// 协议级：model/switch 经 agent-process 全链（内存流，零 mock 管道）
// ---------------------------------------------------------------------------

function startChildHarness(options: AgentChildOptions): {
  send: (req: AgentRequest) => void;
  recv: <T extends AgentMessage>(
    predicate: (m: AgentMessage) => m is T,
    name: string,
    ms?: number,
  ) => Promise<T>;
  drain: (
    isTerminal: (m: AgentMessage) => boolean,
    name: string,
    ms?: number,
  ) => Promise<{ items: AgentMessage[]; last: AgentMessage }>;
  stop: () => Promise<void>;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const items: AgentMessage[] = [];
  const waiters: ((r: IteratorResult<AgentMessage>) => void)[] = [];
  let buf = "";
  output.setEncoding("utf-8");
  output.on("data", (chunk: string) => {
    buf += chunk;
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl < 0) break;
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = decodeMessage(line);
      const w = waiters.shift();
      if (w) w({ value: msg, done: false });
      else items.push(msg);
    }
  });
  const messages = {
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          const item = items.shift();
          if (item) return Promise.resolve({ value: item, done: false });
          return new Promise<IteratorResult<AgentMessage>>((resolve) =>
            waiters.push(resolve),
          );
        },
      };
    },
  };
  const running = runAgentChildStdio({ input, output, exit: () => {}, ...options });
  return {
    send: (req) => input.write(`${JSON.stringify(req)}\n`),
    recv: async <T extends AgentMessage>(
      predicate: (m: AgentMessage) => m is T,
      name: string,
      ms?: number,
    ): Promise<T> => {
      // recvWithTimeout 的 predicate 是 boolean 面；type guard 在此收窄返回
      const msg = await recvWithTimeout(messages, predicate, name, ms);
      return msg as T;
    },
    drain: (isTerminal, name, ms) => drainUntil(messages, isTerminal, name, ms),
    stop: async () => {
      input.write(`${JSON.stringify({ type: "dispose" })}\n`);
      input.end();
      await running;
    },
  };
}

/** 协议级 echo provider：回声最后一条 user 消息，前缀 label 区分身份。 */
function labeledEcho(label: string): ModelProvider {
  return {
    async *streamChat(req) {
      let last = "";
      for (const m of req.messages) {
        if (m.role === "user") last = m.content;
      }
      yield { type: "text-delta", text: `${label}:${last}` };
      yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
      yield { type: "done" };
    },
  };
}

const isReady = (m: AgentMessage): m is Extract<AgentMessage, { type: "ready" }> =>
  m.type === "ready";
const isTurnEnd = (m: AgentMessage): m is Extract<AgentMessage, { type: "event" }> =>
  m.type === "event" && m.event.type === "turn/end";
const isError = (m: AgentMessage): m is Extract<AgentMessage, { type: "error" }> =>
  m.type === "error";

/** 消息集里的 SessionEvent（drain 收集面的投影 helper）。 */
function eventsOf(items: readonly AgentMessage[]): SessionEvent[] {
  return items.flatMap((m) => (m.type === "event" ? [m.event] : []));
}

describe("model/switch 协议命令 —— agent-process 全链", () => {
  const tmpRoots: string[] = [];
  afterEach(() => {
    for (const dir of tmpRoots.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function harnessWithRegistry(): ReturnType<typeof startChildHarness> {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "model-switch-"));
    tmpRoots.push(workspaceRoot);
    return startChildHarness({
      assembly: {
        workspaceRoot,
        contextWindow: 100_000,
        approvalTimeoutMs: 5_000,
        initialIdentity: { provider: "echo", modelId: "m1" },
        models: [
          { identity: { provider: "echo", modelId: "m1" }, provider: labeledEcho("A") },
          { identity: { provider: "echo", modelId: "m2" }, provider: labeledEcho("B") },
        ],
      },
    });
  }

  it("换模立即受理、下一 turn 生效：turn1 用 m1，model/switch 后 turn2 用 m2", async () => {
    const h = harnessWithRegistry();
    expect(await h.recv(isReady, "ready")).toEqual({ type: "ready" });

    h.send({ type: "prompt", messageId: "a", content: "甲" });
    await h.recv(
      (m): m is Extract<AgentMessage, { type: "accepted" }> => m.type === "accepted",
      "accepted(a)",
    );
    const turn1 = await h.drain(isTurnEnd, "turn/end(a)");
    expect(turn1.last).toMatchObject({ type: "event", event: { type: "turn/end", turn: 1 } });
    const assistant1 = eventsOf(turn1.items).find(
      (e): e is Extract<SessionEvent, { type: "assistant/message" }> =>
        e.type === "assistant/message",
    );
    expect(assistant1?.message.content).toBe("A:甲");

    // 换模命令无专用回执（同 cancel/revert 的 admission 语义）——生效事实
    // 由下一 turn 的模型行为证明
    h.send({ type: "model/switch", identity: { provider: "echo", modelId: "m2" } });
    h.send({ type: "prompt", messageId: "b", content: "乙" });
    const turn2 = await h.drain(isTurnEnd, "turn/end(b)");
    expect(turn2.last).toMatchObject({ type: "event", event: { type: "turn/end", turn: 2 } });
    const assistant2 = eventsOf(turn2.items).find(
      (e): e is Extract<SessionEvent, { type: "assistant/message" }> =>
        e.type === "assistant/message",
    );
    expect(assistant2?.message.content).toBe("B:乙");

    await h.stop();
  }, 30_000);

  it("换模到未注册模型回类型化 error 行（MODEL_NOT_REGISTERED），不静默", async () => {
    const h = harnessWithRegistry();
    await h.recv(isReady, "ready");
    h.send({ type: "model/switch", identity: { provider: "echo", modelId: "nope" } });
    const err = await h.recv(isError, "error(MODEL_NOT_REGISTERED)");
    expect(err.code).toBe("MODEL_NOT_REGISTERED");
    expect(err.message).toContain("nope");
    await h.stop();
  }, 30_000);

  it("未装配模型注册表时换模显式报错（MODEL_SWITCH_UNAVAILABLE）", async () => {
    const h = startChildHarness({}); // 最小装配：echo + 无权限层，无注册表
    await h.recv(isReady, "ready");
    h.send({ type: "model/switch", identity: { provider: "echo", modelId: "m2" } });
    const err = await h.recv(isError, "error(MODEL_SWITCH_UNAVAILABLE)");
    expect(err.code).toBe("MODEL_SWITCH_UNAVAILABLE");
    await h.stop();
  }, 30_000);
});
