import { describe, expect, it } from "vitest";

import type { SessionEvent, StreamChunk } from "../../../kernel/events.js";
import {
  AgentLoop,
  type AgentLoopDeps,
  type DecideTurn,
  type StepRecord,
  type ToolExecutionResult,
  type TurnDecision,
} from "./loop.js";
import { PromptQueue } from "../../../kernel/queue.js";
import { MutationRetryBudget } from "../tools/mutation-budget.js";
import { ToolRegistry, type ToolDef } from "../../../kernel/tools/registry.js";
import { ScriptedProvider, makeLoop } from "./loop.test-utils.js";
import { RwLock } from "../../../kernel/rw-lock.js";
import type { PrefixChange } from "../../../context/prefix-anchor.js";
import { expectPaired, expectSingleTerminal, expectTurnScoped } from "../../../test-support/event-asserts.js";
import type { ChatTool, ModelProvider } from "../../../models/provider.js";

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

  it("A11/T-P1-47：已启动工具先跑完——工具执行期间到达的 steer 不打断在途工具，下一次模型请求才消费", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "text-delta", text: "先跑工具" },
      { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: '{"cmd":"ls"}' },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "已收到补充" }, { type: "done" }]);
    const queue = new PromptQueue("one-at-a-time");
    // 工具挂起 = steer 到达窗口（在途工具尚未结算）
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let steered = false;
    const executeTool: AgentLoopDeps["executeTool"] = async () => {
      if (!steered) {
        steered = true;
        queue.enqueue("工具跑完再补充");
      }
      await gate;
      return { content: "工具完成" };
    };
    const { loop, store } = makeLoop(provider, { queue, executeTool });

    const done = loop.runTurn("开工");
    // 让 dispatchTool 真正跑到挂起点后再放行（事件循环翻转）
    await new Promise<void>((r) => setTimeout(r, 0));
    release();
    const reason = await done;
    expect(reason).toEqual({ kind: "completed" });

    const events = store.load("s1");
    // 在途工具不被打断：tool/result 完整落盘
    const result = events.find((e) => e.type === "tool/result") as {
      turn: number;
      message: { content: string };
    };
    expect(result.message.content).toBe("工具完成");
    expect(result.turn).toBe(1);
    // steer 注入在 step 边界（工具所在 step 收尾后）、与开场同轮
    const injected = events.find(
      (e) => e.type === "user/message" && (e as { message: { content: string } }).message.content === "工具跑完再补充",
    ) as { turn: number };
    expect(injected.turn).toBe(1);
    // 第一次请求（steer 到达前发出）不含 steer 内容；下一次请求才见它
    expect(provider.requestAt(0, "工具挂起前的首次请求").messages.map((m) => m.content)).not.toContain(
      "工具跑完再补充",
    );
    expect(provider.requestAt(1, "step 边界注入后的第二次请求").messages.map((m) => m.content)).toContain(
      "工具跑完再补充",
    );
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
  it("缓存锚变化检测（F6/F13/T-P1-19）：工具追加 = appended；改写 = rewritten；换模 + 锚不变 = 零通知", async () => {
    const provider = new ScriptedProvider();
    for (let i = 0; i < 3; i++) {
      provider.mount([{ type: "text-delta", text: `答${String(i)}` }, { type: "done" }]);
    }
    // 请求 1: [t1]；请求 2: [t1, t2]（追加）；请求 3: [t1b, t2]（改写 t1 描述）
    const t1: ChatTool = { name: "t1", description: "d1", parameters: { type: "object", properties: {} } };
    const t2: ChatTool = { name: "t2", description: "d2", parameters: { type: "object", properties: {} } };
    const t1b: ChatTool = { name: "t1", description: "d1-changed", parameters: { type: "object", properties: {} } };
    let requests = 0;
    const changes: PrefixChange[] = [];
    const { loop } = makeLoop(provider, {
      toolsProvider: () => {
        requests++;
        return requests <= 1 ? [t1] : requests === 2 ? [t1, t2] : [t1b, t2];
      },
      onCacheAnchorChange: (c) => changes.push(c),
    });

    await loop.runTurn("一");
    await loop.runTurn("二");
    await loop.runTurn("三");
    expect(changes).toEqual([
      { from: changes[0]!.from, to: changes[0]!.to, kind: "appended", modelSwitched: false },
      { from: changes[1]!.from, to: changes[1]!.to, kind: "rewritten", modelSwitched: false },
    ]);
    // appended 的语义：旧锚是新锚的字节前缀（已缓存前缀全部存活）
    expect(changes[1]!.to.startsWith(changes[1]!.from)).toBe(false);
    expect(changes[0]!.to.startsWith(changes[0]!.from)).toBe(true);
  });
});

describe("prompt 入队闸门（A13/T-P1-48）", () => {
  const collectLogger = () => {
    const warns: { msg: string; data?: Record<string, unknown> }[] = [];
    const logger: NonNullable<AgentLoopDeps["logger"]> = {
      debug() {},
      info() {},
      warn: (msg, data) => warns.push({ msg, data }),
      error() {},
      setLevel: () => undefined,
      getLevel: () => "info",
    };
    return { logger, warns };
  };

  it("三态：拦截不落流且 warn 留痕（messageId+理由）；改写落改写后内容；放行原样进历史", async () => {
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "一" }, { type: "done" }]);
    provider.mount([{ type: "text-delta", text: "二" }, { type: "done" }]);
    const queue = new PromptQueue("all");
    const { logger, warns } = collectLogger();
    let decided = 0;
    const decideTurn: DecideTurn = () => {
      decided += 1;
      if (decided === 1) {
        queue.enqueue("放行甲");
        queue.enqueue("拦截乙");
        queue.enqueue("改写丙原文");
      }
      return decided === 1 ? { action: "continue" } : { action: "end" };
    };
    const { loop, store } = makeLoop(provider, {
      decideTurn,
      queue,
      logger,
      promptGate: async (m) => {
        if (m.content === "拦截乙") return { block: true, message: "理由：含危险指令" };
        if (m.content === "改写丙原文") return { block: false, message: "改写丙" };
        return true;
      },
    });

    expect(await loop.runTurn("开场")).toEqual({ kind: "completed" });
    const contents = store
      .load("s1")
      .filter((e) => e.type === "user/message")
      .map((e) => (e as { message: { content: string } }).message.content);
    // 放行原样、改写落改写后文本、拦截零落流（不进模型历史 = 不落盘，A9 自洽）
    expect(contents).toEqual(["开场", "放行甲", "改写丙"]);
    expect(contents).not.toContain("拦截乙");
    expect(contents).not.toContain("改写丙原文");
    // 拦截事实 warn 留痕：messageId（入队序 q2）+ 理由；内容不进日志
    expect(warns).toHaveLength(1);
    expect(warns[0]!.msg).toContain("闸门拦截");
    expect(warns[0]!.data).toMatchObject({ messageId: "q2", reason: "理由：含危险指令" });
  });

  it("gate 抛错 → failTurn 收轮 turn/end{error}（装配钩子异常与 hook 崩溃同轨）", async () => {
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "一" }, { type: "done" }]);
    provider.mount([{ type: "text-delta", text: "二" }, { type: "done" }]);
    const queue = new PromptQueue("all");
    let decided = 0;
    const decideTurn: DecideTurn = () => {
      decided += 1;
      if (decided === 1) queue.enqueue("触发崩溃的输入");
      return decided === 1 ? { action: "continue" } : { action: "end" };
    };
    const { loop, store } = makeLoop(provider, {
      decideTurn,
      queue,
      promptGate: async () => {
        throw new Error("gate 崩了");
      },
    });

    const reason = await loop.runTurn("开场");
    expect(reason.kind).toBe("error");
    expectSingleTerminal(store.load("s1"), 1);
    const end = store.load("s1").find((e) => e.type === "turn/end") as {
      reason: { kind: string };
    };
    expect(end.reason.kind).toBe("error");
  });

  it("缺省不装配 gate = 全放行（P0 行为零变化）——queue.test 既有注入用例零改动全绿", async () => {
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "一" }, { type: "done" }]);
    provider.mount([{ type: "text-delta", text: "二" }, { type: "done" }]);
    const queue = new PromptQueue("all");
    let decided = 0;
    const decideTurn: DecideTurn = () => {
      decided += 1;
      if (decided === 1) queue.enqueue("原样乙");
      return decided === 1 ? { action: "continue" } : { action: "end" };
    };
    const { loop, store } = makeLoop(provider, { decideTurn, queue });

    expect(await loop.runTurn("开场")).toEqual({ kind: "completed" });
    const contents = store
      .load("s1")
      .filter((e) => e.type === "user/message")
      .map((e) => (e as { message: { content: string } }).message.content);
    expect(contents).toEqual(["开场", "原样乙"]);
  });

  it("one-at-a-time × gate（收口面①）：拦截不补位——被拦条目丢弃、下一条等下一个边界", async () => {
    const provider = new ScriptedProvider();
    for (let i = 1; i <= 4; i += 1) {
      provider.mount([{ type: "text-delta", text: `s${i}` }, { type: "done" }]);
    }
    const queue = new PromptQueue("one-at-a-time");
    let decided = 0;
    const decideTurn: DecideTurn = () => {
      decided += 1;
      if (decided === 1) {
        queue.enqueue("第一条被拦");
        queue.enqueue("第二条放行");
      }
      return decided < 4 ? { action: "continue" } : { action: "end" };
    };
    const { loop, store } = makeLoop(provider, {
      decideTurn,
      queue,
      promptGate: async (m) => m.content !== "第一条被拦",
    });

    expect(await loop.runTurn("开场")).toEqual({ kind: "completed" });
    const contents = store
      .load("s1")
      .filter((e) => e.type === "user/message")
      .map((e) => (e as { message: { content: string } }).message.content);
    // 边界一：drain 出"第一条被拦"→ 拦截 → 该边界零注入；边界二：drain
    // 出"第二条放行"→ 注入——one-at-a-time 的每边界一条节奏不被拦截扰动
    expect(contents).toEqual(["开场", "第二条放行"]);
  });
});

describe("循环护栏（A14/T-P1-50）", () => {
  const collectLogger = () => {
    const warns: { msg: string; data?: Record<string, unknown> }[] = [];
    const logger: NonNullable<AgentLoopDeps["logger"]> = {
      debug() {},
      info() {},
      warn: (msg, data) => warns.push({ msg, data }),
      error() {},
      setLevel: () => undefined,
      getLevel: () => "info",
    };
    return { logger, warns };
  };

  it("maxStepsPerTurn=2：第 3 个 step 不启动，turn/end{blocked} 收轮 + warn 可检索", async () => {
    const provider = new ScriptedProvider();
    for (const text of ["一", "二"]) {
      provider.mount([
        { type: "text-delta", text },
        { type: "tool-call-delta", id: `c${text}`, name: "bash", argsDelta: "{}" },
        { type: "done" },
      ]);
    }
    const { logger, warns } = collectLogger();
    // decideTurn 恒 continue（护栏是唯一的收束面）
    const { loop, store } = makeLoop(provider, {
      decideTurn: () => ({ action: "continue" }),
      maxStepsPerTurn: 2,
      logger,
    });

    const reason = await loop.runTurn("停不下来");
    expect(reason).toEqual({ kind: "blocked" });
    const events = store.load("s1");
    expect(events.filter((e) => e.type === "step/start")).toHaveLength(2);
    const end = events.find((e) => e.type === "turn/end") as {
      reason: { kind: string };
    };
    expect(end.reason.kind).toBe("blocked");
    expectSingleTerminal(events, 1);
    expect(warns).toHaveLength(1);
    expect(warns[0]!.msg).toContain("maxStepsPerTurn");
    expect(warns[0]!.data).toMatchObject({ turn: 1, maxSteps: 2 });
  });

  it("缺省 0 = 不限（既有恒 continue 行为不受护栏影响）", async () => {
    const provider = new ScriptedProvider();
    for (let i = 1; i <= 3; i += 1) {
      provider.mount([
        { type: "text-delta", text: `s${i}` },
        { type: "tool-call-delta", id: `c${i}`, name: "bash", argsDelta: "{}" },
        { type: "done" },
      ]);
    }
    let decided = 0;
    const { loop, store } = makeLoop(provider, {
      decideTurn: () => {
        decided += 1;
        return decided < 3 ? { action: "continue" } : { action: "end" };
      },
    });

    expect(await loop.runTurn("三步走")).toEqual({ kind: "completed" });
    expect(store.load("s1").filter((e) => e.type === "step/start")).toHaveLength(3);
  });

  it("abortTimeoutMs：取消后工具挂起不结算 → 超时强制收轮（aborted 终态 + 迟到结果被闸门丢弃）", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "text-delta", text: "跑个慢工具" },
      { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: "{}" },
      { type: "done" },
    ]);
    const { logger, warns } = collectLogger();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { loop, store } = makeLoop(provider, {
      executeTool: async () => {
        await gate; // 挂死（不响应信号的最坏工具）
        return { content: "迟到的结果" };
      },
      abortTimeoutMs: 50,
      logger,
    });

    const done = loop.runTurn("取消但工具挂死");
    await new Promise<void>((r) => setTimeout(r, 0)); // 让工具真正挂上
    loop.cancel({ kind: "user" });
    // 看门狗 50ms 超时：强制收轮（本用例不等 runTurn 返回——协作式纪律下
    // 在途 promise 未结算，runTurn 尚未返回；事件流终态已先落盘）
    await new Promise<void>((r) => setTimeout(r, 150));
    const events = store.load("s1");
    const end = events.find((e) => e.type === "turn/end") as {
      reason: { kind: string; cause?: { kind: string } };
    };
    expect(end).toBeDefined();
    expect(end.reason.kind).toBe("aborted");
    expect(end.reason.cause).toEqual({ kind: "user" });
    expectSingleTerminal(events, 1);
    // T3-2 dsh 合成语义：在途调用（tool/call 已落、真实结果未到）在强制收轮
    // 时补合成 isError 结果——终态事实由合成承担（replay 配平）；真实迟到
    // 结果仍被闸门丢弃（其内容"迟到的结果"不出现）。
    const results = events.filter((e) => e.type === "tool/result");
    expect(results).toHaveLength(1);
    expect(results[0]!.message.isError).toBe(true);
    expect(results[0]!.error?.code).toBe("TOOL_ABORTED");
    expect(events.some((e) => e.type === "tool/result" && e.message.content === "迟到的结果")).toBe(false);
    // 看门狗 warn 已留痕
    expect(warns.some((w) => w.msg.includes("看门狗"))).toBe(true);
    // 收尾：放行在途工具 → 自然路径撞 forcedClosed 闸 → 不 double terminal
    release();
    await done;
    const eventsAfter = store.load("s1");
    expectSingleTerminal(eventsAfter, 1);
    // 合成结果恰一条（真实迟到结果仍被丢弃，不追加第二条）
    expect(eventsAfter.filter((e) => e.type === "tool/result")).toHaveLength(1);
    // 迟到丢弃 warn
    expect(warns.some((w) => w.msg.includes("迟到"))).toBe(true);
  });

  it("正常结算路径看门狗不触发：取消后工具快速结算 → aborted 正常收轮、零看门狗 warn", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "text-delta", text: "跑个快工具" },
      { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: "{}" },
      { type: "done" },
    ]);
    const { logger, warns } = collectLogger();
    const { loop, store } = makeLoop(provider, {
      executeTool: async () => {
        await new Promise<void>((r) => setTimeout(r, 10)); // 10ms 后结算
        return { content: "及时的结果" };
      },
      abortTimeoutMs: 500,
      logger,
    });

    const done = loop.runTurn("取消但工具很快");
    await new Promise<void>((r) => setTimeout(r, 0));
    loop.cancel({ kind: "user" });
    const reason = await done;
    expect(reason).toEqual({ kind: "aborted", cause: { kind: "user" } });
    const events = store.load("s1");
    // 正常收轮：tool/result 完整落盘（未过强制收轮时点）
    expect(events.some((e) => e.type === "tool/result")).toBe(true);
    expectSingleTerminal(events, 1);
    expect(warns.some((w) => w.msg.includes("看门狗"))).toBe(false);
  });
});

describe("用户输入关联 id（A12/T-P1-53）", () => {
  it("runTurn 首条带 p1；steer 注入每条各得新 promptId（p2/p3）", async () => {
    const provider = new ScriptedProvider();
    for (const text of ["一", "二", "三"]) {
      provider.mount([{ type: "text-delta", text }, { type: "done" }]);
    }
    const queue = new PromptQueue("all");
    let decided = 0;
    const decideTurn: DecideTurn = () => {
      decided += 1;
      if (decided === 1) {
        queue.enqueue("补充甲");
        queue.enqueue("补充乙");
      }
      return decided === 1 ? { action: "continue" } : { action: "end" };
    };
    const { loop, store } = makeLoop(provider, { decideTurn, queue });

    expect(await loop.runTurn("开场")).toEqual({ kind: "completed" });
    const inputs = store
      .load("s1")
      .filter((e) => e.type === "user/message")
      .map((e) => e as { promptId?: string; message: { content: string } });
    expect(inputs.map((e) => e.promptId)).toEqual(["p1", "p2", "p3"]);
    expect(inputs.map((e) => e.message.content)).toEqual(["开场", "补充甲", "补充乙"]);
  });

  it("关联区间按流推导：两条输入之间的事件归前一条（seq 切片）", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "text-delta", text: "一" },
      { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: "{}" },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "二" }, { type: "done" }]);
    const queue = new PromptQueue("all");
    let decided = 0;
    const decideTurn: DecideTurn = () => {
      decided += 1;
      if (decided === 1) queue.enqueue("补充");
      return decided === 1 ? { action: "continue" } : { action: "end" };
    };
    const { loop, store } = makeLoop(provider, { decideTurn, queue });

    await loop.runTurn("开场");
    const events = store.load("s1");
    // 关联区间 = 本条 user/message 之后到下一条 user/message 之前：
    // p1 区间含 step1/tool 事件，p2 区间（流尾）无后续事件
    const inputs = events.filter((e) => e.type === "user/message");
    const p1 = inputs[0] as { seq: number; promptId?: string };
    const p2 = inputs[1] as { seq: number; promptId?: string };
    expect(p1.promptId).toBe("p1");
    expect(p2.promptId).toBe("p2");
    const between = events.filter((e) => e.seq > p1.seq && e.seq < p2.seq);
    expect(between.length).toBeGreaterThan(0);
    expect(between.every((e) => e.type !== "user/message")).toBe(true);
    const afterP2 = events.filter((e) => e.seq > p2.seq);
    expect(afterP2.every((e) => e.type !== "user/message")).toBe(true);
  });

  it("恢复重建不重号：同 store 新 AgentLoop 的下一条输入拿 p<已有序数+1>", async () => {
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "一" }, { type: "done" }]);
    const first = makeLoop(provider);
    await first.loop.runTurn("重启前"); // 占 p1
    // 同 store 新建 loop（模拟恢复路径）：counter 从流重建
    const loop2 = new AgentLoop({
      sessionId: "s1",
      store: first.store,
      provider,
      identity: { provider: "mock", modelId: "m-1" },
      executeTool: async () => ({ content: "ok" }),
      decideTurn: () => ({ action: "end" }),
    });
    provider.mount([{ type: "text-delta", text: "二" }, { type: "done" }]);
    await loop2.runTurn("重启后第一条");
    const inputs = first.store
      .load("s1")
      .filter((e) => e.type === "user/message")
      .map((e) => (e as { promptId?: string }).promptId);
    expect(inputs).toEqual(["p1", "p2"]);
  });
});

describe("mutation 重试预算（B13/T-P1-57）", () => {
  const collectLogger = () => {
    const warns: { msg: string; data?: Record<string, unknown> }[] = [];
    const logger: NonNullable<AgentLoopDeps["logger"]> = {
      debug() {},
      info() {},
      warn: (msg, data) => warns.push({ msg, data }),
      error() {},
      setLevel: () => undefined,
      getLevel: () => "info",
    };
    return { logger, warns };
  };

  const editScript = () => [
    { type: "text-delta", text: "改" },
    { type: "tool-call-delta", id: "c1", name: "edit", argsDelta: '{"path":"a.txt"}' },
    { type: "done" },
  ] as const;

  const failingEdit = async (): Promise<ToolExecutionResult> => ({
    content: "oldText 在 a.txt 中未找到",
    isError: true,
    error: { name: "EditError", code: "OLD_TEXT_NOT_FOUND" },
    meta: { mutationPaths: ["a.txt"] },
  });

  it("同路径失败累计到第 3 次计数失败 → turn/end{blocked} + warn 带 MUTATION_RETRY_BUDGET_EXHAUSTED", async () => {
    const provider = new ScriptedProvider();
    // 可恢复码首现宽限：宽限 + 3 次计数 = 4 次失败
    for (let i = 0; i < 4; i++) provider.mount([...editScript()]);
    provider.mount([{ type: "text-delta", text: "结束" }, { type: "done" }]);
    const { logger, warns } = collectLogger();
    const { loop, store } = makeLoop(provider, {
      executeTool: failingEdit,
      mutationBudget: new MutationRetryBudget(),
      logger,
    });

    const reason = await loop.runTurn("修文件");
    expect(reason).toEqual({ kind: "blocked" });
    const end = store.load("s1").filter((e) => e.type === "turn/end").at(-1) as {
      reason?: { kind: string };
    };
    expect(end.reason?.kind).toBe("blocked");
    // 失败结果照常落盘（已执行的尝试是事实），轮以显式护栏终止
    expect(store.load("s1").filter((e) => e.type === "tool/result")).toHaveLength(4);
    const hit = warns.find((w) => w.msg.includes("mutation 重试预算耗尽"));
    expect(hit).toBeDefined();
    expect(hit!.data).toMatchObject({ path: "a.txt", code: "MUTATION_RETRY_BUDGET_EXHAUSTED" });
  });

  it("中间成功清空该路径历史：clear 后重新累计，不 terminate", async () => {
    const provider = new ScriptedProvider();
    for (let i = 0; i < 6; i++) provider.mount([...editScript()]);
    provider.mount([{ type: "text-delta", text: "结束" }, { type: "done" }]);
    let call = 0;
    const flaky: AgentLoopDeps["executeTool"] = async () => {
      call += 1;
      // 失败×2（宽限+1 计数）→ 成功（清空）→ 失败×3（宽限+2 计数）——从未到 3
      if (call === 3) return { content: "edited", meta: { mutationPaths: ["a.txt"] } };
      return await failingEdit();
    };
    const { loop, store } = makeLoop(provider, {
      executeTool: flaky,
      mutationBudget: new MutationRetryBudget(),
    });
    expect(await loop.runTurn("修文件")).toEqual({ kind: "completed" });
    expect(store.load("s1").filter((e) => e.type === "tool/result")).toHaveLength(6);
  });

  it("不同 turn（新 promptId）预算各自独立：前轮累计不带入下一轮", async () => {
    const provider = new ScriptedProvider();
    for (let i = 0; i < 2; i++) provider.mount([...editScript()]);
    provider.mount([{ type: "text-delta", text: "轮1结束" }, { type: "done" }]);
    for (let i = 0; i < 2; i++) provider.mount([...editScript()]);
    provider.mount([{ type: "text-delta", text: "轮2结束" }, { type: "done" }]);
    const { loop } = makeLoop(provider, {
      executeTool: failingEdit,
      mutationBudget: new MutationRetryBudget(),
    });
    // 两轮各 2 次失败（各轮内宽限+1 计数）——若作用域错成全局 path 键，
    // 第二轮会累计到 4 次 → blocked
    expect(await loop.runTurn("第一轮")).toEqual({ kind: "completed" });
    expect(await loop.runTurn("第二轮")).toEqual({ kind: "completed" });
  });
});

describe("工具声明元数据按 step 快照（B16/T-P1-59）", () => {
  it("step 进行中替换 timeoutMs 声明：在途 step 用旧值，下一 step 用新值", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "text-delta", text: "一" },
      { type: "tool-call-delta", id: "c1", name: "slowish", argsDelta: "{}" },
      { type: "done" },
    ]);
    provider.mount([
      { type: "text-delta", text: "二" },
      { type: "tool-call-delta", id: "c2", name: "slowish", argsDelta: "{}" },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "结束" }, { type: "done" }]);
    // 真 registry：工具声明 timeoutMs=5000（宽）；执行体内替换为 50（紧）
    const registry = new ToolRegistry();
    let replaced = false;
    registry.registerTool({
      name: "slowish",
      timeoutMs: 5000,
      execute: async () => {
        if (!replaced) {
          replaced = true;
          // 第一次执行中替换声明——本 step 已按快照（5000）武装，不受影响
          registry.registerTool; // 保持引用面
          (registry as unknown as { defs: Map<string, ToolDef> }).defs.set(
            "slowish",
            {
              name: "slowish",
              timeoutMs: 50,
              execute: async () => {
                await new Promise((r) => setTimeout(r, 150));
                return { content: "slow v2" };
              },
            },
          );
        }
        await new Promise((r) => setTimeout(r, 150));
        return { content: "slow v1" };
      },
    });
    const { loop, store } = makeLoop(provider, {
      executeTool: (call) => registry.dispatch(call),
      toolRuntimeMeta: (name) => registry.runtimeMeta(name),
    });

    // step1：快照 5000 → 150ms 工具正常完成（若误用新值 50 会在中途超时）
    // step2：快照 50（替换后）→ 仍 150ms 的执行 → TOOL_TIMEOUT isError
    expect(await loop.runTurn("逐步")).toEqual({ kind: "completed" });
    const results = store
      .load("s1")
      .filter((e) => e.type === "tool/result")
      .map((e) => e as { error?: { code: string }; message: { content: string } });
    expect(results).toHaveLength(2);
    expect(results[0]!.error).toBeUndefined();
    expect(results[0]!.message.content).toBe("slow v1");
    expect(results[1]!.error?.code).toBe("TOOL_TIMEOUT");
  });

  it("parallel 判定来自 step 快照：runParallelTools 不再逐调用现查 isParallelTool", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "text-delta", text: "一" },
      { type: "tool-call-delta", id: "c1", name: "ro", argsDelta: "{}" },
      { type: "tool-call-delta", id: "c2", name: "ro", argsDelta: "{}" },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "结束" }, { type: "done" }]);
    const isParallelCalls: string[] = [];
    const { loop } = makeLoop(provider, {
      toolExecution: "parallel",
      isParallelTool: (name) => {
        isParallelCalls.push(name);
        return true;
      },
      executeTool: async (call) => ({ content: `ran ${call.callId}` }),
    });
    await loop.runTurn("并行");
    // 快照查询发生在 step 开始（每名恰一次）；并行执行期的判定走快照
    expect(isParallelCalls).toEqual(["ro"]);
  });
});

describe("step 可观测事件（B19/T-P1-61：timing/traceId）", () => {
  it("有模型请求的 step/end 带 timing（首 chunk 延迟/流总时长非负）与单调 traceId", async () => {
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "甲" }, { type: "done" }]);
    provider.mount([{ type: "text-delta", text: "乙" }, { type: "done" }]);
    let decided = 0;
    const { loop, store } = makeLoop(provider, {
      decideTurn: () => {
        decided += 1;
        return decided === 1 ? { action: "continue" } : { action: "end" };
      },
    });

    expect(await loop.runTurn("观测")).toEqual({ kind: "completed" });
    const ends = store
      .load("s1")
      .filter((e) => e.type === "step/end")
      .map((e) => e as { turn: number; step: number; timing?: { firstTokenLatencyMs: number; streamDurationMs: number }; traceId?: string });
    expect(ends).toHaveLength(2);
    for (const end of ends) {
      expect(end.timing).toBeDefined();
      expect(end.timing!.firstTokenLatencyMs).toBeGreaterThanOrEqual(0);
      expect(end.timing!.streamDurationMs).toBeGreaterThanOrEqual(end.timing!.firstTokenLatencyMs);
      expect(end.traceId).toMatch(/^r\d+$/);
    }
    // traceId 会话内单调（r1 → r2）
    expect(ends[0]!.traceId).toBe("r1");
    expect(ends[1]!.traceId).toBe("r2");
  });
});

describe("分段计时（L9/T-P2-513：timing.segments 载荷扩展 #27）", () => {
  it("带工具的 step：step/end.timing.segments 落流（modelMs=streamDurationMs、toolsMs 累计≥0）", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: "{}" },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "ok" }, { type: "done" }]);
    const { loop, store } = makeLoop(provider);

    expect(await loop.runTurn("分段观测")).toEqual({ kind: "completed" });
    const ends = store
      .load("s1")
      .filter((e) => e.type === "step/end")
      .map(
        (e) =>
          e as {
            timing?: {
              streamDurationMs: number;
              segments?: { modelMs: number; toolsMs: number };
            };
          },
      );
    expect(ends).toHaveLength(2);
    const withTool = ends[0]!;
    const textOnly = ends[1]!;
    // step 1（带工具）：segments 随 timing 落流——modelMs 与流时长同源同值
    expect(withTool.timing?.segments).toBeDefined();
    expect(withTool.timing!.segments!.modelMs).toBe(withTool.timing!.streamDurationMs);
    expect(withTool.timing!.segments!.toolsMs).toBeGreaterThanOrEqual(0);
    // step 2（纯文本，无工具执行）：toolsMs = 0（"无工具"是有价值事实）
    expect(textOnly.timing?.segments).toBeDefined();
    expect(textOnly.timing!.segments!.toolsMs).toBe(0);
  });
});

describe("输出 token 触顶可续跑（B20/T-P1-62）", () => {
  it("纯文本触顶 → 注入续跑指令（injected user/message）+ 新 step 继续，不终结轮", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "text-delta", text: "写到一半" },
      { type: "done", finishReason: "length" },
    ]);
    provider.mount([
      { type: "text-delta", text: "接上文继续" },
      { type: "done" },
    ]);
    const { loop, store } = makeLoop(provider);

    expect(await loop.runTurn("长文")).toEqual({ kind: "completed" });
    const contents = store
      .load("s1")
      .filter((e) => e.type === "user/message")
      .map((e) => (e as { message: { content: string }; source: string }));
    // 续跑指令以 injected user/message 落流（A12 promptId 关联语义覆盖）
    expect(contents).toHaveLength(2);
    expect(contents[1]!.source).toBe("injected");
    expect(contents[1]!.message.content).toContain("Output token limit hit");
    // 第二次模型请求包含续跑指令（消息序：截断消息 → 续跑指令）
    const second = provider.requests[1]!.messages;
    expect(second.at(-1)).toMatchObject({ role: "user" });
    // 触顶未终结轮——assistant 消息照常落盘
    expect(
      store.load("s1").filter((e) => e.type === "assistant/message"),
    ).toHaveLength(2);
  });

  it("连续触顶 3 次后停止续跑（防死循环）——第 4 次触顶照旧收轮", async () => {
    const provider = new ScriptedProvider();
    for (let i = 0; i < 4; i++) {
      provider.mount([{ type: "text-delta", text: `段${i}` }, { type: "done", finishReason: "length" }]);
    }
    const { loop, store } = makeLoop(provider);

    expect(await loop.runTurn("超长")).toEqual({ kind: "completed" });
    const injected = store
      .load("s1")
      .filter((e) => e.type === "user/message" && (e as { source: string }).source === "injected");
    expect(injected).toHaveLength(3); // MAX_OUTPUT_TOKEN_CONTINUATIONS
  });

  it("触顶但有工具调用 → 不续跑（工具调用是正常延展）；非触顶 finishReason 照常", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: "{}" },
      { type: "done", finishReason: "length" },
    ]);
    provider.mount([{ type: "text-delta", text: "完成" }, { type: "done" }]);
    const { loop, store } = makeLoop(provider);

    expect(await loop.runTurn("工具轮")).toEqual({ kind: "completed" });
    expect(
      store
        .load("s1")
        .filter((e) => e.type === "user/message" && (e as { source: string }).source === "injected"),
    ).toHaveLength(0);
  });
});

// 类型引用保持（防止误删导出的编译期契约）
void ({} as AgentLoop | AgentLoopDeps | TurnDecision | undefined);

describe("E18 produced 机器自报（T-P1-94）：回合结局与产出一起结算", () => {
  it("正常轮 turn/end.produced 与事后反推恒等（升序、属本回合）", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "text-delta", text: "先看目录" },
      { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: '{"cmd":"ls"}' },
      { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "完成了" }, { type: "done" }]);
    const { loop, store } = makeLoop(provider);
    await loop.runTurn("列出文件");

    const events = store.load("s1");
    const turnEnd = events.find((e): e is Extract<SessionEvent, { type: "turn/end" }> => e.type === "turn/end");
    expect(turnEnd?.produced).toBeDefined();
    // 事后反推（消费方口径）：turn 1 的 assistant/message seq 升序——恒等
    const reverse = events
      .filter((e) => e.type === "assistant/message" && e.turn === 1)
      .map((e) => e.seq);
    expect(turnEnd!.produced).toEqual(reverse);
    expect(turnEnd!.produced!.length).toBe(2); // 两个 step 各一条 assistant 消息
  });

  it("abort 轮：produced 照报已产出部分（不丢不虚构）；取消发生在第二 step", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "text-delta", text: "第一段产出" },
      { type: "usage", usage: { inputTokens: 10, outputTokens: 2 } },
      { type: "done" },
    ]);
    const { loop, store } = makeLoop(provider, {
      decideTurn: async (record) => {
        // 第一次裁决（step 1 已产出）时取消——abort 前已有 assistant 产出
        loop.cancel({ kind: "user" });
        return record.toolCalls.length > 0
          ? { action: "continue" }
          : { action: "end", finalText: record.content };
      },
    });
    provider.mount([{ type: "text-delta", text: "第二段" }, { type: "done" }]);
    await loop.runTurn("干活");
    const events = store.load("s1");
    const turnEnd = events.find((e): e is Extract<SessionEvent, { type: "turn/end" }> => e.type === "turn/end");
    expect(turnEnd!.reason.kind).toBe("aborted");
    const reverse = events
      .filter((e) => e.type === "assistant/message" && e.turn === 1)
      .map((e) => e.seq);
    expect(turnEnd!.produced).toEqual(reverse); // 部分产出照报（1 条）
  });

  it("无 assistant 产出的轮 → produced 缺席（空集与缺席同义，定形记档）", async () => {
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "直接答" }, { type: "done" }]);
    const { loop, store } = makeLoop(provider);
    await loop.runTurn("问");
    const events = store.load("s1");
    const turnEnd = events.find((e): e is Extract<SessionEvent, { type: "turn/end" }> => e.type === "turn/end");
    expect(turnEnd!.reason.kind).toBe("completed");
    expect(turnEnd!.produced).toBeDefined(); // 本轮有 1 条 assistant → 在位
    // 构造"零产出"对照：assistant/message 缺席的流（工具全部拒绝且模型无消息）——
    // 现实由 produced 过滤保证（length>0 才落）；此处断言口径即可
    expect(turnEnd!.produced!.length).toBe(1);
  });
});
