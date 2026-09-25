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
import type { ModelProvider } from "../models/provider.js";

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
    // A6：step/start 与 step/end 成对、同 turn 同号，都落在同一个用户轮 turn=1
    const stepOf = (e: SessionEvent) => (e as { step: number }).step;
    const starts = events.filter((e) => e.type === "step/start");
    const ends = events.filter((e) => e.type === "step/end");
    expect(starts.map(stepOf)).toEqual([1, 2]);
    expect(ends.map(stepOf)).toEqual([1, 2]);
    expect(
      [...starts, ...ends].every((e) => (e as { turn: number }).turn === 1),
    ).toBe(true);

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

// 类型引用保持（防止误删导出的编译期契约）
void ({} as AgentLoop | AgentLoopDeps | TurnDecision | undefined);
