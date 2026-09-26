import { describe, expect, it } from "vitest";

import type { SessionEvent, StreamChunk } from "./events.js";
import {
  AgentLoop,
  type AgentLoopDeps,
  type DecideTurn,
  type StepRecord,
  type ToolExecutionResult,
  type TurnDecision,
} from "./loop.js";
import { ScriptedProvider, makeLoop } from "./loop.test-utils.js";
import { RwLock } from "./rw-lock.js";
import { expectPaired, expectSingleTerminal, expectTurnScoped } from "../test-support/event-asserts.js";
import type { ChatTool, ModelProvider } from "../models/provider.js";

/**
 * 前置说明（A6 措辞映射，卡面要求写明）：本文件的 "step" 是 l0-events 三级
 * 生命周期里的一次模型调用 + 其工具执行；pi 上游管它叫 "turn"。我方的 turn
 * 是用户轮（runTurn 一次），由 turn/start…turn/end 包裹。
 */

describe("AgentLoop —— A1/A6 显式停止条件与两级生命周期", () => {
  it("验收①：模型持续要工具 → continue；空手而归 → 仍由 DecideTurn 显式给 end", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "text-delta", text: "先看目录" },
      {
        type: "tool-call-delta",
        id: "c1",
        name: "bash",
        argsDelta: '{"cmd":"ls"}',
      },
      { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "完成了" }, { type: "done" }]);
    const { loop, store, decideCalls } = makeLoop(provider);

    const reason = await loop.runTurn("列出文件");
    expect(reason).toEqual({ kind: "completed" });

    // end 是 DecideTurn 给的：被调两次，第二次面对"无 toolCall"的 step 显式 end
    expect(decideCalls).toHaveLength(2);
    expect(decideCalls[0]!.toolCalls).toHaveLength(1);
    expect(decideCalls[1]!.toolCalls).toHaveLength(0);

    const events = store.load("s1");
    expect(events.map((e) => e.type)).toEqual([
      "turn/start",
      "user/message",
      "step/start",
      "request/header",
      "assistant/message",
      "tool/call",
      "tool/result",
      "step/end",
      "step/start",
      "request/header",
      "assistant/message",
      "step/end",
      "turn/end",
    ]);
    // A6：配对/轮号/终态不变量由 T-3-07 的事件断言方法承担（O7：断言关系不断言列表）
    expectTurnScoped(events);
    expectPaired(events, "step/start");
    expectSingleTerminal(events, 1);

    // request/header：首步 initial、续步 series；config 是 J4 身份二元组
    const headers = events.filter((e) => e.type === "request/header");
    expect(headers.map((e) => (e as { reason: string }).reason)).toEqual([
      "initial",
      "series",
    ]);
    expect((headers[0] as { config: unknown }).config).toEqual({
      provider: "mock",
      modelId: "m-1",
    });

    // assistant/message 带无损流与 usage；tool/call 原样保留模型 arguments 串
    const assistant = events.find((e) => e.type === "assistant/message") as {
      message: { content: string };
      stream: { chunk: StreamChunk }[];
      usage?: { inputTokens: number };
    };
    expect(assistant.message.content).toBe("先看目录");
    expect(assistant.stream.map((t) => t.chunk.type)).toEqual([
      "text-delta",
      "tool-call-delta",
      "usage",
      "done",
    ]);
    expect(assistant.usage?.inputTokens).toBe(10);
    const toolCall = events.find((e) => e.type === "tool/call") as {
      arguments: string;
    };
    expect(toolCall.arguments).toBe('{"cmd":"ls"}');

    // 第二次请求的消息从事件投影重建：user → assistant(带 toolCalls) → tool
    const second = provider.requests[1]!.messages;
    expect(second).toEqual([
      { role: "user", content: "列出文件" },
      {
        role: "assistant",
        content: "先看目录",
        toolCalls: [{ id: "c1", name: "bash", arguments: '{"cmd":"ls"}' }],
      },
      { role: "tool", callId: "c1", content: "ran bash {\"cmd\":\"ls\"}" },
    ]);
  });

  it("验收②：第一轮即 end（一次模型回复即完成用户轮）", async () => {
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "直接回答" }, { type: "done" }]);
    const { loop, store, decideCalls } = makeLoop(provider);

    const reason = await loop.runTurn("你好");
    expect(reason).toEqual({ kind: "completed" });
    expect(decideCalls).toHaveLength(1);
    expect(store.load("s1").map((e) => e.type)).toEqual([
      "turn/start",
      "user/message",
      "step/start",
      "request/header",
      "assistant/message",
      "step/end",
      "turn/end",
    ]);
  });

  it("A1 反向钉死：无 toolCall 且 DecideTurn 给 continue → loop 必须继续（不自行推断停止）", async () => {
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "第一答" }, { type: "done" }]);
    provider.mount([{ type: "text-delta", text: "第二答" }, { type: "done" }]);
    let calls = 0;
    const { loop, store, decideCalls } = makeLoop(provider, {
      decideTurn: () => {
        calls += 1;
        return calls === 1 ? { action: "continue" } : { action: "end" };
      },
    });

    const reason = await loop.runTurn("继续聊");
    expect(reason).toEqual({ kind: "completed" });
    // 决策点被问了两轮，且第一轮没有任何 toolCall——loop 依然继续了
    expect(decideCalls).toHaveLength(2);
    expect(decideCalls[0]!.toolCalls).toHaveLength(0);
    expect(store.load("s1").filter((e) => e.type === "step/end")).toHaveLength(2);
  });

  it("loop 按链写（Q14）：三个点位都被走到，层拿到链上下文与载荷", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: "{}" },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "ok" }, { type: "done" }]);
    const touched: string[] = [];
    const layers: AgentLoopDeps["layers"] = {
      modelRequest: [
        async ($, e, next) => {
          touched.push(`modelRequest:${e.step}`);
          expect($.sessionId).toBe("s1");
          return next(e);
        },
      ],
      toolCall: [
        async ($, e, next) => {
          touched.push(`toolCall:${e.name}`);
          expect($.sessionId).toBe("s1");
          return next(e);
        },
      ],
      turnEnd: [
        async ($, e, next) => {
          touched.push(`turnEnd:${e.reason.kind}`);
          expect($.sessionId).toBe("s1");
          await next(e);
        },
      ],
    };
    const { loop } = makeLoop(provider, { layers });

    await loop.runTurn("跑一下");
    // 时序：模型请求1 → 工具 → 模型请求2 → 轮收尾
    expect(touched).toEqual([
      "modelRequest:1",
      "toolCall:bash",
      "modelRequest:2",
      "turnEnd:completed",
    ]);
  });

  it("模型调用失败是硬退出：assistant/attempt 落盘、step 闭合、turn/end{error}", async () => {
    const provider: ModelProvider = {
      async *streamChat() {
        yield { type: "text-delta", text: "半截" };
        throw new Error("boom");
      },
    };
    const { loop, store } = makeLoop(provider);

    const reason = await loop.runTurn("会失败");
    expect(reason).toEqual({
      kind: "error",
      error: { code: "MODEL_UNKNOWN_ERROR", message: "boom" },
    });
    // attempt 保留已产出的半截流；没有伪造的 assistant/message
    const events = store.load("s1");
    expect(events.map((e) => e.type)).toEqual([
      "turn/start",
      "user/message",
      "step/start",
      "request/header",
      "assistant/attempt",
      "step/end",
      "turn/end",
    ]);
    const attempt = events.find((e) => e.type === "assistant/attempt") as {
      stream: { chunk: StreamChunk }[];
    };
    expect(attempt.stream.map((t) => t.chunk.type)).toEqual(["text-delta"]);
    const turnEnd = events.at(-1) as { reason: { kind: string } };
    expect(turnEnd.reason.kind).toBe("error");
  });

  it("工具执行崩溃 ≠ turn 失败：落 isError 的 tool/result 并回喂模型", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: "{}" },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "知道了" }, { type: "done" }]);
    const executeTool = async (): Promise<ToolExecutionResult> => {
      throw new Error("工具炸了");
    };
    const { loop, store } = makeLoop(provider, { executeTool });

    const reason = await loop.runTurn("执行");
    expect(reason).toEqual({ kind: "completed" });
    const result = store.load("s1").find((e) => e.type === "tool/result") as {
      message: { content: string; isError?: boolean };
      error?: { code: string };
    };
    expect(result.message.isError).toBe(true);
    expect(result.message.content).toBe("工具炸了");
    expect(result.error?.code).toBe("TOOL_EXECUTE_FAILED");
    // 错误以 tool 消息回喂模型（isError 透传）
    const second = provider.requests[1]!.messages.at(-1) as {
      role: string;
      isError?: boolean;
    };
    expect(second.role).toBe("tool");
    expect(second.isError).toBe(true);
  });

  it("连续两个用户轮：轮号自增（turn=1、turn=2），前轮闭合后才能开新轮", async () => {
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "一" }, { type: "done" }]);
    provider.mount([{ type: "text-delta", text: "二" }, { type: "done" }]);
    const { loop, store } = makeLoop(provider);

    await loop.runTurn("第一问");
    await loop.runTurn("第二问");
    const turnStarts = store
      .load("s1")
      .filter((e) => e.type === "turn/start") as { turn: number }[];
    expect(turnStarts.map((e) => e.turn)).toEqual([1, 2]);
    const secondTurnEnd = store
      .load("s1")
      .filter((e) => e.type === "turn/end")
      .at(-1) as { turn: number };
    expect(secondTurnEnd.turn).toBe(2);
  });

  it("modelRequest 层截断：请求不放行，step 空过，turn 以 blocked 终止", async () => {
    const provider = new ScriptedProvider();
    const layers: AgentLoopDeps["layers"] = {
      modelRequest: [() => ({ content: "", toolCalls: [], timed: [] })],
    };
    const { loop, store } = makeLoop(provider, { layers });

    const reason = await loop.runTurn("被拦");
    expect(reason).toEqual({ kind: "blocked" });
    expect(provider.requests).toHaveLength(0);
    expect(store.load("s1").map((e) => e.type)).toEqual([
      "turn/start",
      "user/message",
      "step/start",
      "step/end",
      "turn/end",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 工具并发（B17+B6，T-P1-15）：parallel 模式 = preflight 顺序、执行并发，
// 一把 RwLock 分组（声明读=并行、未声明写=排他）
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("工具并发（B17+B6 / T-P1-15）", () => {
  /** 挂一份"两个工具调用"的剧本（c1 慢、c2 快）。 */
  function mountTwoCalls(provider: ScriptedProvider): void {
    provider.mount([
      { type: "tool-call-delta", id: "c1", name: "r1", argsDelta: "{}" },
      { type: "tool-call-delta", id: "c2", name: "r2", argsDelta: "{}" },
      { type: "done" },
    ]);
  }

  it("验收①：parallel 模式下已声明只读组并发——启动重叠、完成序 ≠ 提交序；tool/result 按完成序落流、record 按提交序（验收④配平）", async () => {
    const provider = new ScriptedProvider();
    mountTwoCalls(provider);
    provider.mount([{ type: "text-delta", text: "完成" }, { type: "done" }]);
    const trace: string[] = [];
    const { loop, store, decideCalls } = makeLoop(provider, {
      toolExecution: "parallel",
      isParallelTool: (name) => name === "r1" || name === "r2",
      executeTool: async (call) => {
        trace.push(`start:${call.callId}`);
        await sleep(call.callId === "c1" ? 60 : 10);
        trace.push(`end:${call.callId}`);
        return { content: `out-${call.callId}` };
      },
    });

    const reason = await loop.runTurn("并发");
    expect(reason).toEqual({ kind: "completed" });
    // 并发：两个执行都在任一结束前启动（读锁共享）
    expect(trace.slice(0, 2).sort()).toEqual(["start:c1", "start:c2"]);
    // 完成序 ≠ 提交序：快的 c2 先完成
    expect(trace).toEqual(["start:c1", "start:c2", "end:c2", "end:c1"]);

    const events = store.load("s1");
    // tool/call 按提交序、tool/result 按完成序（pi 同款双序）
    expect(
      events.filter((e) => e.type === "tool/call").map((e) => (e as { callId: string }).callId),
    ).toEqual(["c1", "c2"]);
    expect(
      events.filter((e) => e.type === "tool/result").map((e) => (e as { callId: string }).callId),
    ).toEqual(["c2", "c1"]);
    // 验收④：并行下配平不变量成立（call/result 按 callId 一一配对）
    expectPaired(events, "tool/call");
    expectTurnScoped(events);
    expectSingleTerminal(events, 1);
    // StepRecord.toolResults 按提交序（pi "assistant source order" 同款）
    expect(decideCalls[0]!.toolResults.map((r) => r.callId)).toEqual(["c1", "c2"]);
  });

  it("验收②：未声明工具被排他化——不与任何执行重叠（fail-closed）", async () => {
    const provider = new ScriptedProvider();
    // 批次 [r1（声明）、w1（未声明）、r2（声明）]：w1 持写锁独占，
    // r2 排在 w1 之后也不得越过它（FIFO：防写者饿死）
    provider.mount([
      { type: "tool-call-delta", id: "c1", name: "r1", argsDelta: "{}" },
      { type: "tool-call-delta", id: "c2", name: "w1", argsDelta: "{}" },
      { type: "tool-call-delta", id: "c3", name: "r2", argsDelta: "{}" },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "完成" }, { type: "done" }]);
    const trace: string[] = [];
    const { loop } = makeLoop(provider, {
      toolExecution: "parallel",
      isParallelTool: (name) => name === "r1" || name === "r2",
      executeTool: async (call) => {
        trace.push(`start:${call.callId}`);
        await sleep(call.callId === "c2" ? 30 : 20);
        trace.push(`end:${call.callId}`);
        return { content: `out-${call.callId}` };
      },
    });

    await loop.runTurn("排他");
    // r1 独启动（c2/c3 被 w1 的写锁挡住）→ r1 结束 → w1 独占 → w1 结束 → r2
    expect(trace).toEqual([
      "start:c1",
      "end:c1",
      "start:c2",
      "end:c2",
      "start:c3",
      "end:c3",
    ]);
  });

  it("验收③：sequential 缺省零行为变化——call/result 交错、完成序 = 提交序（P0 回归）", async () => {
    const provider = new ScriptedProvider();
    mountTwoCalls(provider);
    provider.mount([{ type: "text-delta", text: "完成" }, { type: "done" }]);
    const trace: string[] = [];
    const { loop, store } = makeLoop(provider, {
      executeTool: async (call) => {
        trace.push(`start:${call.callId}`);
        await sleep(call.callId === "c1" ? 30 : 5);
        trace.push(`end:${call.callId}`);
        return { content: `out-${call.callId}` };
      },
    });

    await loop.runTurn("串行");
    // 不传 toolExecution（缺省 sequential）：完全串行，逐段交错
    expect(trace).toEqual(["start:c1", "end:c1", "start:c2", "end:c2"]);
    expect(
      store
        .load("s1")
        .map((e) => e.type)
        .filter((t) => t === "tool/call" || t === "tool/result"),
    ).toEqual(["tool/call", "tool/result", "tool/call", "tool/result"]);
  });
});

describe("RwLock（B17 一把锁的语义）", () => {
  it("读读并发；写者与一切互斥；FIFO 序 + 头部连续读者成批放行", async () => {
    const lock = new RwLock();
    const order: string[] = [];
    const rel1 = await lock.read();
    const rel2 = await lock.read(); // 立即获得：读锁共享
    order.push("2-readers");

    const writer = lock.write().then((rel) => {
      order.push("writer-in");
      return rel;
    });
    const reader3 = lock.read().then((rel) => {
      order.push("reader3-in");
      return rel;
    });
    await sleep(5);
    // 写者等读全释放；排在写者后的读者3不得越位（防写者饿死）
    expect(order).toEqual(["2-readers"]);

    rel1();
    rel2();
    const relW = await writer;
    expect(order).toEqual(["2-readers", "writer-in"]); // 写者独占入写

    relW();
    const rel3 = await reader3;
    expect(order).toEqual(["2-readers", "writer-in", "reader3-in"]); // FIFO 唤醒
    rel3();

    // 写者持锁时排队的两个读者，写者释放后一并入读（成批放行）
    const writer2 = lock.write().then((rel) => {
      order.push("writer2-in");
      return rel;
    });
    const b1 = lock.read().then((rel) => {
      order.push("b1-in");
      return rel;
    });
    const b2 = lock.read().then((rel) => {
      order.push("b2-in");
      return rel;
    });
    await sleep(5);
    expect(order).toEqual(["2-readers", "writer-in", "reader3-in", "writer2-in"]);
    const relW2 = await writer2;
    relW2();
    await Promise.all([b1, b2]);
    expect(order.slice(-2)).toEqual(["b1-in", "b2-in"]);
  });
});

// ---------------------------------------------------------------------------
// 工具进度上报（B7 / T-P1-16）：reportProgress → tool/progress 事件
// ---------------------------------------------------------------------------

describe("工具进度上报（B7 / T-P1-16）", () => {
  it("验收①：进度事件按 callId 聚合后 seqInCall 有序、store seq 单调（按序到达）且先于本调用的 result", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "tool-call-delta", id: "c1", name: "work", argsDelta: "{}" },
      { type: "tool-call-delta", id: "c2", name: "work", argsDelta: "{}" },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "完成" }, { type: "done" }]);
    const { loop, store } = makeLoop(provider, {
      executeTool: async (call) => {
        call.report?.(`进度 A`);
        call.report?.(`进度 B`);
        return { content: `done-${call.callId}` };
      },
    });

    await loop.runTurn("进度");
    const events = store.load("s1");
    const progress = events.filter((e) => e.type === "tool/progress") as Extract<
      SessionEvent,
      { type: "tool/progress" }
    >[];
    expect(progress).toHaveLength(4);
    for (const callId of ["c1", "c2"]) {
      const mine = progress.filter((e) => e.callId === callId);
      // 调用内序号 1,2 单调递增（按序到达）
      expect(mine.map((e) => e.seqInCall)).toEqual([1, 2]);
      // store seq 严格递增（落流顺序 = 上报顺序）
      const seqs = mine.map((e) => e.seq);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
      // 进度全部先于本调用的 tool/result（调用未闭合才可上报）
      const resultSeq = events.find(
        (e) => e.type === "tool/result" && (e as { callId: string }).callId === callId,
      )!.seq;
      expect(mine.every((e) => e.seq < resultSeq)).toBe(true);
    }
    // 事件序整体：call c1 → 进度×2 → result c1 → call c2 → 进度×2 → result c2
    const relevant = events
      .filter((e) => e.type === "tool/call" || e.type === "tool/result" || e.type === "tool/progress")
      .map((e) => (e as { type: string; callId: string }).type + ":" + (e as { callId: string }).callId);
    expect(relevant).toEqual([
      "tool/call:c1",
      "tool/progress:c1",
      "tool/progress:c1",
      "tool/result:c1",
      "tool/call:c2",
      "tool/progress:c2",
      "tool/progress:c2",
      "tool/result:c2",
    ]);
    // 配平不受进度事件影响
    expectPaired(events, "tool/call");
  });

  it("验收②：不调 reportProgress 的工具零新事件（回归：精确事件列表与 P0 一致）", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "tool-call-delta", id: "c1", name: "silent", argsDelta: "{}" },
      { type: "usage", usage: { inputTokens: 3, outputTokens: 1 } },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "ok" }, { type: "done" }]);
    const { loop, store } = makeLoop(provider, {
      executeTool: async (call) => ({ content: `ran ${call.callId}` }),
    });

    await loop.runTurn("安静");
    const types = store.load("s1").map((e) => e.type);
    expect(types).not.toContain("tool/progress");
    expect(types).toEqual([
      "turn/start",
      "user/message",
      "step/start",
      "request/header",
      "assistant/message",
      "tool/call",
      "tool/result",
      "step/end",
      "step/start",
      "request/header",
      "assistant/message",
      "step/end",
      "turn/end",
    ]);
  });

  it("调用内条数上限：MAX_TOOL_PROGRESS_PER_CALL=10，超限静默丢弃（卡内定形）", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "tool-call-delta", id: "c1", name: "chatty", argsDelta: "{}" },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "ok" }, { type: "done" }]);
    const { loop, store } = makeLoop(provider, {
      executeTool: async (call) => {
        for (let i = 1; i <= 12; i++) {
          // 经过微任务边界模拟真实工具的分段上报
          await Promise.resolve();
          call.report?.(`第 ${String(i)} 段`);
        }
        return { content: `done-${call.callId}` };
      },
    });

    await loop.runTurn("上限");
    const progress = store.load("s1").filter((e) => e.type === "tool/progress") as Extract<
      SessionEvent,
      { type: "tool/progress" }
    >[];
    expect(progress).toHaveLength(10);
    expect(progress.map((e) => e.seqInCall)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("toolsProvider 每请求现取（F12/F14 wiring）：工具增减在后续请求可见、request/header.tools 如实记录", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "tool-call-delta", id: "c1", name: "tool_load", argsDelta: '{"name":"big"}' },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "完成" }, { type: "done" }]);
    // 模拟注册表面：第一次请求 1 个工具，tool_load 执行"后"清单长出第二个
    let generation = 0;
    const handle: ChatTool = {
      name: "tool_load",
      description: "检索柄",
      parameters: { type: "object", properties: {} },
    };
    const withBig: ChatTool[] = [
      handle,
      {
        name: "big",
        description: "大工具",
        parameters: { type: "object", properties: { q: { type: "string" } } },
      },
    ];
    const { loop, store } = makeLoop(provider, {
      toolsProvider: () => (generation === 0 ? [handle] : withBig),
      executeTool: async () => {
        generation = 1; // tool_load 索取 = 注册表面变化
        return { content: "已加载" };
      },
    });

    await loop.runTurn("延迟加载");
    const headers = store.load("s1").filter((e) => e.type === "request/header") as unknown as Array<{
      tools?: Array<{ name: string }>;
    }>;
    expect(headers[0]!.tools).toHaveLength(1);
    expect(headers[1]!.tools).toHaveLength(2);
    expect(headers[1]!.tools![1]!.name).toBe("big");
  });
});

// 类型引用保持（防止误删导出的编译期契约）
void ({} as AgentLoop | AgentLoopDeps | TurnDecision | undefined);
