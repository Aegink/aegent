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
  ModelSwitchStateError,
  nextSwitchPhase,
  type ModelSwitchOptions,
  type RegisteredModel,
} from "./model-switch.js";
import { AgentLoop } from "./loop.js";
import { createChildAssembly, type ChildAssembly } from "./assembly.js";
import type { LlmFailure, SessionEvent } from "./events.js";
import { runAgentChildStdio, type AgentChildOptions } from "./agent-process.js";
import {
  decodeMessage,
  type AgentMessage,
  type AgentRequest,
} from "./agent-protocol.js";
import type { ModelProvider } from "../models/provider.js";
import { InMemoryEventStorage, SessionStore } from "../session/store.js";
import { project } from "../session/project.js";
import {
  drainUntil,
  expectTurnScoped,
  recvWithTimeout,
} from "../test-support/event-asserts.js";

const identityA = { provider: "p", modelId: "m1" };
const identityB = { provider: "p", modelId: "m2" };
const identityC = { provider: "p", modelId: "m3" };

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

/** 三模型注册表：provider 的 onFirstCall 闭包延迟引用 service（构造后再赋值）。 */
function makeService(onFirstCall?: () => void): ModelSwitchService {
  const models: RegisteredModel[] = [
    { identity: identityA, provider: scriptedProvider("A", onFirstCall) },
    { identity: identityB, provider: scriptedProvider("B") },
    { identity: identityC, provider: scriptedProvider("C") },
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
// T-P1-05（J8/J11）：换模事务性与四态状态机
// ---------------------------------------------------------------------------

/** 装配级测试的临时工作区根（afterEach 统一清理）。 */
const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("J8 迁移守卫 —— nextSwitchPhase 纯函数（验收①）", () => {
  it("四态各自可达（合法迁移逐条断言）", () => {
    // deferred：initial 且会话未建立时受理
    expect(nextSwitchPhase("initial", "switch", false)).toBe("deferred");
    // pending：initial 且会话已建立；preference/incompatible 开新事务
    expect(nextSwitchPhase("initial", "switch", true)).toBe("pending");
    expect(nextSwitchPhase("preference", "switch", true)).toBe("pending");
    expect(nextSwitchPhase("incompatible", "switch", true)).toBe("pending");
    // preference：deferred 应用（会话建立即生效）+ pending 生效确认
    expect(nextSwitchPhase("deferred", "capture", false)).toBe("preference");
    expect(nextSwitchPhase("pending", "capture", true)).toBe("preference");
    // incompatible：pending/preference 下请求失败判不兼容
    expect(nextSwitchPhase("pending", "incompatible-failure", true)).toBe(
      "incompatible",
    );
    expect(nextSwitchPhase("preference", "incompatible-failure", true)).toBe(
      "incompatible",
    );
    // 事务修订：deferred/pending 自迁移（重复换模不迁移状态）
    expect(nextSwitchPhase("deferred", "switch", false)).toBe("deferred");
    expect(nextSwitchPhase("pending", "switch", true)).toBe("pending");
    // 捕获对无事务态是自迁移（合法）
    expect(nextSwitchPhase("initial", "capture", false)).toBe("initial");
    expect(nextSwitchPhase("preference", "capture", true)).toBe("preference");
    expect(nextSwitchPhase("incompatible", "capture", true)).toBe("incompatible");
  });

  it("非法迁移被拒：类型化 ModelSwitchStateError（含 from 与事件详情）", () => {
    // 未生效的事务不接受失败报告（deferred/initial 下请求不可能已发出）
    for (const from of ["initial", "deferred", "incompatible"] as const) {
      try {
        nextSwitchPhase(from, "incompatible-failure", true);
        expect.unreachable(`${from} 应拒 incompatible-failure`);
      } catch (e) {
        expect(e).toBeInstanceOf(ModelSwitchStateError);
        expect((e as ModelSwitchStateError).code).toBe("MODEL_SWITCH_STATE_ERROR");
        expect((e as ModelSwitchStateError).from).toBe(from);
      }
    }
  });
});

describe("J8 deferred 暂存（验收②）", () => {
  it("会话未建立时换模暂存（configured 不变），首个 turn 捕获即应用", () => {
    const service = makeService();
    service.switch(identityB);
    expect(service.phase).toBe("deferred");
    expect(service.configured).toEqual(identityA); // configured 不变
    expect(service.lastSwitch).toEqual({ target: identityB, prev: identityA });
    // 会话建立（首个 turn 捕获）即应用——本 turn 就用新模型
    const capture = service.captureForTurn(1);
    expect(capture.identity).toEqual(identityB);
    expect(service.configured).toEqual(identityB);
    expect(service.phase).toBe("preference");
  });

  it("deferred 事务修订：覆盖 target，应用时用最新目标", () => {
    const service = makeService();
    service.switch(identityB);
    service.switch(identityC);
    expect(service.lastSwitch).toEqual({ target: identityC, prev: identityA });
    expect(service.captureForTurn(1).identity).toEqual(identityC);
  });
});

describe("J11 失败回滚（验收③）", () => {
  it("换模生效后请求失败判不兼容 → 回滚 prev 且回滚可观测", () => {
    const service = makeService();
    service.captureForTurn(1);
    service.switch(identityB); // pending：configured=B、prev=A
    // 对照：无关失败码不回滚（transient 错误不是回滚理由）
    expect(service.reportRequestFailure(1, { code: "MODEL_HTTP_ERROR" })).toBe(false);
    expect(service.configured).toEqual(identityB);
    expect(service.reportRequestFailure(1, { code: "MODEL_INCOMPATIBLE" })).toBe(true);
    expect(service.configured).toEqual(identityA); // 恢复 prev
    expect(service.phase).toBe("incompatible");
    expect(service.lastRollback).toEqual({
      rolledBackTo: identityA,
      from: identityB,
      failureCode: "MODEL_INCOMPATIBLE",
      turn: 1,
    });
    // 回滚后下一 turn 捕获到 prev；incompatible 态可再换模开新事务
    expect(service.captureForTurn(2).identity).toEqual(identityA);
    service.switch(identityB);
    expect(service.phase).toBe("pending");
  });

  it("preference 态（换模已生效）同样可回滚", () => {
    const service = makeService();
    service.captureForTurn(1);
    service.switch(identityB);
    service.captureForTurn(2); // 生效确认 → preference
    expect(service.reportRequestFailure(2, { code: "MODEL_INCOMPATIBLE" })).toBe(true);
    expect(service.configured).toEqual(identityA);
  });

  it("对照：无换模事务时失败报告无事发生（initial 态）", () => {
    const service = makeService();
    service.captureForTurn(1);
    expect(service.phase).toBe("initial");
    expect(service.reportRequestFailure(1, { code: "MODEL_INCOMPATIBLE" })).toBe(false);
    expect(service.lastRollback).toBeUndefined();
  });
});

describe("J8 事务修订（验收④：同 turn 重复换模不产生中间半态）", () => {
  it("A→B→C 同事务修订：prev 保持 A，回滚直接到 A（不经过 B）", () => {
    const service = makeService();
    service.captureForTurn(1); // 会话建立
    service.switch(identityB); // 事务：A→B
    service.switch(identityC); // 同 turn 修订：target=C、prev 保持 A
    expect(service.phase).toBe("pending");
    expect(service.lastSwitch).toEqual({ target: identityC, prev: identityA });
    // 中间模型 B 从未成为回滚目标——生效后失败直接回 A
    service.captureForTurn(2);
    expect(service.configured).toEqual(identityC);
    expect(service.reportRequestFailure(2, { code: "MODEL_INCOMPATIBLE" })).toBe(true);
    expect(service.lastRollback?.rolledBackTo).toEqual(identityA);
  });
});

describe("J11 装配与 loop 接线 —— 失败观测到回滚的闭环", () => {
  it("装配级：onTurnError（不兼容判据命中）→ 下一 turn 捕获 prev；无关失败不回滚", () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "model-switch-"));
    tmpRoots.push(workspaceRoot);
    const store = new SessionStore(new InMemoryEventStorage());
    const a = createChildAssembly({
      sessionId: "s0",
      store,
      workspaceRoot,
      contextWindow: 100_000,
      approvalTimeoutMs: 5_000,
      initialIdentity: identityA,
      models: [
        { identity: identityA, provider: scriptedProvider("A") },
        { identity: identityB, provider: scriptedProvider("B") },
      ],
    });
    expect(a.handleModelSwitch).toBeDefined();
    a.handleModelSwitch!(identityB);
    expect(a.modelForTurn!(1)!.identity).toEqual(identityB); // deferred 应用
    a.onTurnError!(1, { code: "MODEL_HTTP_ERROR", message: "transient" });
    expect(a.modelForTurn!(2)!.identity).toEqual(identityB); // 无关失败不回滚
    a.onTurnError!(2, { code: "MODEL_INCOMPATIBLE", message: "不兼容" });
    expect(a.modelForTurn!(3)!.identity).toEqual(identityA); // 回滚 prev
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("loop 级：turn 失败时 onTurnError 收到类型化 LlmFailure（观测点在 failTurn）", async () => {
    const failures: LlmFailure[] = [];
    const store = new SessionStore(new InMemoryEventStorage());
    const loop = new AgentLoop({
      sessionId: "s0",
      store,
      provider: {
        async *streamChat() {
          yield { type: "text-delta", text: "x" };
          throw new Error("boom");
        },
      },
      identity: identityA,
      executeTool: async () => ({ content: "ok" }),
      decideTurn: () => ({ action: "end" }),
      onTurnError: (turn, failure) => {
        failures.push({ ...failure });
        void turn;
      },
    });
    const r = await loop.runTurn("问");
    expect(r).toMatchObject({ kind: "error", error: { code: "MODEL_UNKNOWN_ERROR" } });
    expect(failures).toEqual([{ code: "MODEL_UNKNOWN_ERROR", message: "boom" }]);
  });
});

// ---------------------------------------------------------------------------
// T-P1-06（J9/J10/J14）：换模进事件流 + 会话级/全局分离 + 回放保护
// ---------------------------------------------------------------------------

/** emit 落流的装配同款实现（turn 挂流内最后事件，空流兜 0）。 */
function emitToStore(store: SessionStore, sessionId: string): NonNullable<ModelSwitchOptions["emit"]> {
  return (emission) => {
    const events = store.load(sessionId);
    const turn = events.length > 0 ? events[events.length - 1]!.turn : 0;
    store.append(sessionId, [
      {
        type: "model/switch",
        turn,
        from: { ...emission.from },
        to: { ...emission.to },
        reason: emission.reason,
      },
    ]);
  };
}

const isModelSwitch = (
  e: SessionEvent,
): e is Extract<SessionEvent, { type: "model/switch" }> => e.type === "model/switch";

describe("J9 换模进事件流（T-P1-06 验收①）", () => {
  it("受理与回滚都落 model/switch 事件：seq 连续、可投影、事实源可查", () => {
    const store = new SessionStore(new InMemoryEventStorage());
    const service = new ModelSwitchService({
      initial: identityA,
      models: [
        { identity: identityA, provider: scriptedProvider("A") },
        { identity: identityB, provider: scriptedProvider("B") },
      ],
      emit: emitToStore(store, "s0"),
    });
    service.captureForTurn(1);
    service.switch(identityB); // 受理 → reason="user"
    expect(
      service.reportRequestFailure(1, { code: "MODEL_INCOMPATIBLE" }),
    ).toBe(true); // 回滚 → reason="rollback"

    const events = store.load("s0");
    const switches = events.filter(isModelSwitch);
    expect(switches).toHaveLength(2);
    expect(switches[0]).toMatchObject({ from: identityA, to: identityB, reason: "user" });
    expect(switches[1]).toMatchObject({ from: identityB, to: identityA, reason: "rollback" });
    // seq 连续（store 权威分配）+ 可投影 + 流内最新 to 即事实源
    const proj = project(events);
    expect(proj.modelSwitches).toHaveLength(2);
    expect(proj.modelSwitches[proj.modelSwitches.length - 1]!.to).toEqual(identityA);
    // 事件可过 O7 断言器（会话级元事件豁免面）——不因轮外落盘误报
    expectTurnScoped(events);
  });

  it("协议级：model/switch 事件经子进程转发为 event 行（ForwardingStore 通道）", async () => {
    const h = harnessWithRegistry();
    await h.recv(isReady, "ready");
    h.send({ type: "prompt", messageId: "a", content: "甲" });
    await h.drain(isTurnEnd, "turn/end(a)");
    h.send({ type: "model/switch", identity: { provider: "echo", modelId: "m2" } });
    h.send({ type: "prompt", messageId: "b", content: "乙" });
    const turn2 = await h.drain(isTurnEnd, "turn/end(b)");
    const switchEvent = eventsOf(turn2.items).find(isModelSwitch);
    expect(switchEvent).toMatchObject({
      from: { provider: "echo", modelId: "m1" },
      to: { provider: "echo", modelId: "m2" },
      reason: "user",
    });
    await h.stop();
  }, 30_000);
});

describe("J10/J14 两存储位分离与回放保护（T-P1-06 验收②③）", () => {
  function assemblyWith(
    store: SessionStore,
    opts: {
      globalDefaultIdentity?: { provider: string; modelId: string };
      initialIdentity?: { provider: string; modelId: string };
    },
  ): ChildAssembly {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "model-switch-"));
    tmpRoots.push(workspaceRoot);
    return createChildAssembly({
      sessionId: "s0",
      store,
      workspaceRoot,
      contextWindow: 100_000,
      approvalTimeoutMs: 5_000,
      models: [
        { identity: identityA, provider: scriptedProvider("A") },
        { identity: identityB, provider: scriptedProvider("B") },
        { identity: identityC, provider: scriptedProvider("C") },
      ],
      ...opts,
    });
  }

  it("验收②：会话级选择存在时全局默认变更不改变本会话（保留用户选择）", () => {
    // 上一会话的用户选择：A → B（落流）
    const store = new SessionStore(new InMemoryEventStorage());
    store.append("s0", [
      { type: "model/switch", turn: 0, from: identityA, to: identityB, reason: "user" },
    ]);
    // 新装配：全局默认改回 A——会话级选择（流内 B）必须原样保留
    const a = assemblyWith(store, { globalDefaultIdentity: identityA });
    expect(a.modelForTurn!(1)!.identity).toEqual(identityB);
  });

  it("验收③：杀进程重启（restore 同 store 重建装配）后模型仍是用户选的那个", () => {
    const store = new SessionStore(new InMemoryEventStorage());
    store.append("s0", [
      { type: "model/switch", turn: 0, from: identityA, to: identityC, reason: "user" },
    ]);
    // 全新装配（生产等价：SQLite restore 后重跑 createChildAssembly），
    // 不传 initialIdentity——初始身份只由流内事实源决定
    const a = assemblyWith(store, {});
    expect(a.modelForTurn!(1)!.identity).toEqual(identityC);
  });

  it("对照：无流内选择时回退装配初始身份；流内选择不在注册表 → 装配失败不静默", () => {
    // 无事件 → initialIdentity（缺省注册表首项）
    const empty = assemblyWith(new SessionStore(new InMemoryEventStorage()), {
      initialIdentity: identityB,
    });
    expect(empty.modelForTurn!(1)!.identity).toEqual(identityB);

    // 流内选择不在本次装配的注册表 → fail-closed（绝不静默回退全局默认）
    const stale = new SessionStore(new InMemoryEventStorage());
    stale.append("s0", [
      {
        type: "model/switch",
        turn: 0,
        from: identityA,
        to: { provider: "gone", modelId: "ghost" },
        reason: "user",
      },
    ]);
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "model-switch-"));
    tmpRoots.push(workspaceRoot);
    expect(
      () =>
        createChildAssembly({
          sessionId: "s0",
          store: stale,
          workspaceRoot,
          contextWindow: 100_000,
          approvalTimeoutMs: 5_000,
          globalDefaultIdentity: identityA,
          models: [{ identity: identityA, provider: scriptedProvider("A") }],
        }),
    ).toThrow(ModelNotRegisteredError);
  });
});

/** 双模型注册表 harness（echo 前缀 A/B 区分身份；工作区走临时目录）。 */
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
  it("换模立即受理、下一 turn 生效：turn1 用 m1，model/switch 后 turn2 用 m2", async () => {
    const h = harnessWithRegistry();
    expect(await h.recv(isReady, "ready")).toMatchObject({ type: "ready" });

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

// ---------------------------------------------------------------------------
// 模型目录与选择器（J12 / T-P1-22）：去重 + 每厂商上限 + discovery 兜底
// ---------------------------------------------------------------------------

import { buildModelCatalog, MAX_MODELS_PER_PROVIDER } from "../models/catalog.js";
import { discoverOpenAiCompatModels } from "../models/openai-compat.js";
import { parseProviderConfig } from "../models/config.js";
import { HttpMock } from "../test-support/http-mock.js";
import { identityKey } from "../models/identity.js";

describe("模型目录与选择器（J12 / T-P1-22）", () => {
  const id = (provider: string, modelId: string) => ({ provider, modelId });

  it("验收①去重：同身份只一行（声明内重复 + 发现重叠都归一），声明行优先", async () => {
    const catalog = await buildModelCatalog({
      declared: [id("p", "m1"), id("p", "m1"), id("p", "m2"), id("q", "m1")],
      discover: async () => [id("p", "m2"), id("p", "m3")],
    });
    expect(catalog.map((e) => `${e.identity.provider}:${e.identity.modelId}`)).toEqual([
      "p:m1",
      "p:m2",
      "q:m1",
      "p:m3",
    ]);
    expect(catalog.find((e) => e.identity.modelId === "m2")?.source).toBe("declared");
    expect(catalog.find((e) => e.identity.modelId === "m3")?.source).toBe("discovered");
  });

  it("验收②每厂商上限：声明先于发现被保留，超限裁剪；当前模型豁免（hermes fallback insert）", async () => {
    const declared = [id("p", "m1"), id("p", "m2"), id("p", "m3")];
    const discover = async () => [id("p", "m4"), id("p", "m5")];
    // 上限 3：声明行全保留、发现行全裁
    const capped = await buildModelCatalog({ declared, discover, maxPerProvider: 3 });
    expect(capped.map((e) => e.identity.modelId)).toEqual(["m1", "m2", "m3"]);
    // 上限 2 + 当前模型 m3：m1/m2 保留、m3 豁免（current is always kept）
    const withCurrent = await buildModelCatalog({
      declared,
      discover,
      maxPerProvider: 2,
      current: id("p", "m3"),
    });
    expect(withCurrent.map((e) => e.identity.modelId)).toEqual(["m1", "m2", "m3"]);
    // 缺省上限常量在位（hermes ACP_MAX_MODELS_PER_PROVIDER 同款）
    expect(MAX_MODELS_PER_PROVIDER).toBe(200);
  });

  it("验收③discovery 兜底：/models 404 剧本（假 provider）时声明模型仍可用；200 剧本增量并入", async () => {
    const config = parseProviderConfig({
      name: "openai",
      settingsConfig: JSON.stringify({ baseUrl: "placeholder", apiKey: "k", model: "m" }),
    });
    // 404 剧本：discoverOpenAiCompatModels 上抛（不兜底），目录层兜底声明行
    const mock404 = new HttpMock();
    const base404 = await mock404.start();
    mock404.mountSequence([{ status: 404, body: "no /models route" }]);
    try {
      await expect(
        discoverOpenAiCompatModels(
          parseProviderConfig({
            name: "openai",
            settingsConfig: JSON.stringify({ baseUrl: base404, apiKey: "k", model: "m" }),
          }),
        ),
      ).rejects.toMatchObject({ status: 404 });

      const declared = [id("openai", "declared-a"), id("openai", "declared-b")];
      const catalog = await buildModelCatalog({
        declared,
        discover: (provider) =>
          provider === "openai"
            ? discoverOpenAiCompatModels(
                parseProviderConfig({
                  name: "openai",
                  settingsConfig: JSON.stringify({ baseUrl: base404, apiKey: "k", model: "m" }),
                }),
              )
            : Promise.resolve([]),
      });
      // 兜底：声明清单原样可用（hermes "declared models survive a failed discovery"）
      expect(catalog.map((e) => `${e.source}:${e.identity.modelId}`)).toEqual([
        "declared:declared-a",
        "declared:declared-b",
      ]);
    } finally {
      await mock404.stop();
    }

    // 200 剧本：/models 的 data[].id 增量并入（同身份去重、归属按 provider）
    const mock200 = new HttpMock();
    const base200 = await mock200.start();
    mock200.mountSequence([
      {
        status: 200,
        body: JSON.stringify({ data: [{ id: "declared-a" }, { id: "live-x" }, { id: "" }, "junk"] }),
      },
    ]);
    try {
      const live = await discoverOpenAiCompatModels(
        parseProviderConfig({
          name: "openai",
          settingsConfig: JSON.stringify({ baseUrl: base200, apiKey: "k", model: "m" }),
        }),
      );
      expect(live).toEqual([
        { provider: "openai", modelId: "declared-a" },
        { provider: "openai", modelId: "live-x" },
      ]);
      const catalog = await buildModelCatalog({
        declared: [id("openai", "declared-a")],
        discover: () => Promise.resolve(live),
      });
      expect(catalog.map((e) => `${e.source}:${e.identity.modelId}`)).toEqual([
        "declared:declared-a",
        "discovered:live-x",
      ]);
    } finally {
      await mock200.stop();
    }
  });

  it("验收④选择结果可换模（J6 联动）：声明条目 switch 成功；discovered-only 拒绝（fail-closed）", async () => {
    const provider: ModelProvider = { streamChat: async function* () {} };
    const service = new ModelSwitchService({
      initial: id("p", "m1"),
      models: [
        { identity: id("p", "m1"), provider },
        { identity: id("p", "m2"), provider },
      ],
    });
    // 选择器查询面：注册表内可换模清单
    expect(service.listSwitchableModels().map((m) => identityKey(m))).toEqual([
      "p:m1",
      "p:m2",
    ]);
    // 目录声明条目 → switch 成功（J6 联动）
    const catalog = await buildModelCatalog({
      declared: service.listSwitchableModels(),
      discover: () => Promise.resolve([id("p", "m3")]),
    });
    const declaredEntry = catalog.find((e) => e.source === "declared" && e.identity.modelId === "m2")!;
    service.switch(declaredEntry.identity);
    // 新服务无捕获 turn → deferred 受理（J8 语义：configured 不变、目标暂存）
    expect(service.phase).toBe("deferred");
    expect(service.lastSwitch?.target).toMatchObject({ provider: "p", modelId: "m2" });
    // discovered-only 条目没有 provider 实例——switch 拒绝（fail-closed）
    const discoveredEntry = catalog.find((e) => e.source === "discovered")!;
    expect(() => service.switch(discoveredEntry.identity)).toThrow(ModelNotRegisteredError);
  });
});
