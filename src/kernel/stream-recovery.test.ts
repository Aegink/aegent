/**
 * F18/T-P1-102 验收：模型流中断恢复——
 * ①流中失败 → attempt 落盘 + retrying 落流 + 重发成功 turn 正常收束；
 * ②恢复重发的模型历史 = 锚点重建（失败前已提交的 tool result 在、半截文本
 *   不在）；
 * ③maxRetries 耗尽 → turn/end{error} 且尝试次数 = 1+maxRetries；
 * ④terminal 4xx（流中）→ turn/end{blocked} 零重试（显式护栏终态）；
 * ⑤取消在途 → 零恢复（取消是权威结局）；
 * ⑥失败 attempt 的 tool calls 零派发（安全前提——副作用歧义不存在）；
 * ⑦首 chunk 前失败仍走 provider 级 withRetry（D15 边界不回归）。
 * 判据单元：classifyStreamFailure（J26 显式可重试枚举之外的 HTTP 终态 =
 * non-retryable）。
 */

import { describe, expect, it } from "vitest";
import { ProviderHttpError, type ModelProvider } from "../models/provider.js";
import { isRetryableStatus, withRetry } from "../models/retry.js";
import { classifyStreamFailure, StreamRecoveryBlockedError } from "./stream-recovery.js";
import { makeLoop, type Harness } from "./loop.test-utils.js";
import type { StreamChunk } from "./events.js";

/** 可编程 provider：每个剧本 = chunk 序列 + 可选中途抛错；记录每次请求。 */
function flakyProvider(
  scripts: Array<{ chunks: StreamChunk[]; error?: Error }>,
): { provider: ModelProvider; requests: () => number } {
  let calls = 0;
  const requests: unknown[] = [];
  return {
    requests: () => calls,
    provider: {
      async *streamChat(req) {
        requests.push(req);
        const script = scripts[calls];
        calls += 1;
        if (script === undefined) throw new Error(`无剧本（第 ${String(calls)} 次调用）`);
        for (const chunk of script.chunks) yield chunk;
        if (script.error !== undefined) throw script.error;
      },
    } as ModelProvider,
  };
}

const STEP1_TOOL: StreamChunk[] = [
  { type: "text-delta", text: "调用工具" },
  { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: "{}" },
  { type: "done", finishReason: "tool_calls" },
];

describe("classifyStreamFailure（判据单元）", () => {
  it("J26 可重试 status → recoverable；枚举外 4xx/auth 终态 → non-retryable；非 HTTP 错 → recoverable", () => {
    expect(classifyStreamFailure(new ProviderHttpError(503, "overloaded"))).toBe("recoverable");
    expect(classifyStreamFailure(new ProviderHttpError(429, "rate limited"))).toBe("recoverable");
    expect(classifyStreamFailure(new ProviderHttpError(401, "unauthorized"))).toBe("non-retryable");
    expect(classifyStreamFailure(new ProviderHttpError(400, "bad request"))).toBe("non-retryable");
    expect(classifyStreamFailure(new Error("MODEL_WIRE_ERROR: 流中断"))).toBe("recoverable");
  });
});

describe("F18 流中断恢复（loop 级，streamRecovery 启用）", () => {
  it("验收①：流中失败 → attempt + retrying 落流 + 重发成功 turn 正常收束", async () => {
    const { provider } = flakyProvider([
      { chunks: [{ type: "text-delta", text: "半截" }], error: new Error("network reset mid-stream") },
      { chunks: [{ type: "text-delta", text: "完整回答" }, { type: "done", finishReason: "stop" }] },
    ]);
    const harness: Harness = makeLoop(provider, { streamRecovery: { maxRetries: 2 } });
    const reason = await harness.loop.runTurn("问题");
    expect(reason.kind).toBe("completed");
    const events = harness.store.load("s1");
    // 失败尝试：assistant/attempt 连分片落盘（"被丢弃的 tail"）
    const attempts = events.filter((e) => e.type === "assistant/attempt");
    expect(attempts).toHaveLength(1);
    // 恢复重试：retrying 落流（loop 级生产者——attempt 0、delayMs 0）
    const retrying = events.find((e) => e.type === "assistant/retrying") as
      | { attempt: number; delayMs: number; error: { name: string; message: string } }
      | undefined;
    expect(retrying).toBeDefined();
    expect(retrying!.attempt).toBe(0);
    expect(retrying!.delayMs).toBe(0);
    expect(retrying!.error.message).toContain("network reset");
    // 成功产出恰一次入库
    const messages = events.filter((e) => e.type === "assistant/message");
    expect(messages).toHaveLength(1);
    expect((messages[0] as { message: { content: string } }).message.content).toBe("完整回答");
    // 两次真实请求（每次尝试各一枚 request/header）
    const headers = events.filter((e) => e.type === "request/header");
    expect(headers).toHaveLength(2);
  });

  it("验收②：恢复重发的请求历史 = 锚点重建——失败前已提交的 tool result 在、半截文本不在", async () => {
    const { provider, requests } = flakyProvider([
      { chunks: STEP1_TOOL }, // step1：工具调用成功落盘（锚点）
      { chunks: [{ type: "text-delta", text: "半截恢复文本" }], error: new Error("stream aborted") },
      { chunks: [{ type: "text-delta", text: "恢复后回答" }, { type: "done", finishReason: "stop" }] },
    ]);
    const toolLog: string[] = [];
    const harness = makeLoop(provider, {
      streamRecovery: { maxRetries: 2 },
      executeTool: async (call) => {
        toolLog.push(call.name);
        return { content: `工具输出(${call.name})`, isError: false };
      },
    });
    const reason = await harness.loop.runTurn("问题");
    expect(reason.kind).toBe("completed");
    // 断言重发请求（第 3 次调用）的消息面：已提交 tool/result 在历史里
    // （模型不重调——"锚点先于故障持久化"），失败 attempt 的半截文本不在。
    expect(requests()).toBe(3);
    // 直接从 store 校验锚点语义：step1 的 tool/result 已落盘、失败 attempt 的
    // 文本不在 assistant/message（只在 attempt.stream 里）
    const events = harness.store.load("s1");
    const resultEvent = events.find((e) => e.type === "tool/result");
    expect(resultEvent).toBeDefined();
    const msgs = events.filter((e) => e.type === "assistant/message") as Array<{
      message: { content: string };
    }>;
    expect(msgs.some((m) => m.message.content.includes("半截恢复文本"))).toBe(false);
    expect(msgs.at(-1)!.message.content).toBe("恢复后回答");
    // 工具恰被派发一次（step1），失败 attempt 的 zero 派发见验收⑥
    expect(toolLog).toEqual(["bash"]);
  });

  it("验收③：maxRetries 耗尽 → turn/end{error} 且尝试次数 = 1+maxRetries（耗尽 ≠ blocked）", async () => {
    const { provider, requests } = flakyProvider([
      { chunks: [{ type: "text-delta", text: "x" }], error: new Error("stream died") },
      { chunks: [{ type: "text-delta", text: "x" }], error: new Error("stream died") },
      { chunks: [{ type: "text-delta", text: "x" }], error: new Error("stream died") },
    ]);
    const harness = makeLoop(provider, { streamRecovery: { maxRetries: 2 } });
    const reason = await harness.loop.runTurn("问题");
    expect(reason).toEqual({
      kind: "error",
      error: expect.objectContaining({ message: "stream died" }),
    });
    expect(requests()).toBe(3);
    const events = harness.store.load("s1");
    expect(events.filter((e) => e.type === "assistant/retrying")).toHaveLength(2);
    // 无 blocked 终态
    const turnEnd = events.find((e) => e.type === "turn/end") as { reason: { kind: string } };
    expect(turnEnd.reason.kind).toBe("error");
  });

  it("验收④：流中 4xx 终态 → turn/end{blocked} 零重试（显式护栏终态）", async () => {
    const { provider, requests } = flakyProvider([
      {
        chunks: [{ type: "text-delta", text: "半" }],
        error: new ProviderHttpError(401, "quota exhausted mid-stream"),
      },
      { chunks: [{ type: "text-delta", text: "不应到达" }] },
    ]);
    const harness = makeLoop(provider, { streamRecovery: { maxRetries: 2 } });
    const reason = await harness.loop.runTurn("问题");
    expect(reason.kind).toBe("blocked");
    expect(requests()).toBe(1); // 零重试
    const turnEnd = harness.store.load("s1").find((e) => e.type === "turn/end") as {
      reason: { kind: string };
    };
    expect(turnEnd.reason).toEqual({ kind: "blocked" });
    // 失败事实仍在流内（attempt 落盘）
    expect(harness.store.load("s1").filter((e) => e.type === "assistant/attempt")).toHaveLength(1);
  });

  it("验收⑤：取消在途 → 零恢复（取消是权威结局）", async () => {
    // provider 在产出首个 chunk 后先置取消再抛错——catch 命中时 cancelCause
    // 已置位，恢复必须不启动（无论终态落 aborted/error，零 retrying 是判据）。
    const harnessRef: { loop?: ReturnType<typeof makeLoop>["loop"] } = {};
    let calls = 0;
    const provider: ModelProvider = {
      async *streamChat() {
        calls += 1;
        yield { type: "text-delta", text: "半截" };
        await harnessRef.loop!.cancel({ kind: "user" });
        throw new Error("died after cancel");
      },
    } as ModelProvider;
    const harness = makeLoop(provider, { streamRecovery: { maxRetries: 2 } });
    harnessRef.loop = harness.loop;
    await harness.loop.runTurn("问题");
    expect(calls).toBe(1); // 零重发
    expect(harness.store.load("s1").filter((e) => e.type === "assistant/retrying")).toHaveLength(0);
  });

  it("验收⑥：失败 attempt 的 tool calls 零派发（副作用歧义不存在——安全前提断言）", async () => {
    const { provider } = flakyProvider([
      {
        chunks: [
          { type: "text-delta", text: "派发前" },
          { type: "tool-call-delta", id: "cx", name: "bash", argsDelta: '{"x":1}' },
          { type: "done", finishReason: "tool_calls" },
        ],
        error: new Error("died right after tool call frames"),
      },
      { chunks: [{ type: "text-delta", text: "恢复" }, { type: "done", finishReason: "stop" }] },
    ]);
    const toolLog: string[] = [];
    const harness = makeLoop(provider, {
      streamRecovery: { maxRetries: 2 },
      executeTool: async (call) => {
        toolLog.push(call.name);
        return { content: "ok", isError: false };
      },
    });
    const reason = await harness.loop.runTurn("问题");
    expect(reason.kind).toBe("completed");
    // 失败 attempt 带着完整 tool-call 帧，但从未派发；恢复后由成功 attempt 决定派发
    expect(toolLog).toEqual([]);
    const attempts = harness.store.load("s1").filter((e) => e.type === "assistant/attempt");
    expect(attempts).toHaveLength(1);
    expect(harness.store.load("s1").filter((e) => e.type === "tool/call")).toHaveLength(0);
  });

  it("验收⑦：首 chunk 前失败仍走 provider 级 withRetry（D15 边界不回归、loop 不双计）", async () => {
    // provider 级：首次调用头阶段 503（零 chunk），withRetry 内部重试后成功
    let upstreamCalls = 0;
    const retriedProvider: ModelProvider = {
      async *streamChat(req) {
        upstreamCalls += 1;
        if (upstreamCalls === 1) {
          throw new ProviderHttpError(503, "header-stage 503");
        }
        expect(isRetryableStatus(503)).toBe(true);
        yield { type: "text-delta", text: "首次 chunk 前失败被 withRetry 接住" };
        yield { type: "done", finishReason: "stop" };
        void req;
      },
    };
    const harness = makeLoop(withRetry(retriedProvider), {
      streamRecovery: { maxRetries: 2 },
    });
    const reason = await harness.loop.runTurn("问题");
    expect(reason.kind).toBe("completed");
    // loop 无感知：零 attempt / 零 retrying / 单次 request/header
    const events = harness.store.load("s1");
    expect(events.filter((e) => e.type === "assistant/attempt")).toHaveLength(0);
    expect(events.filter((e) => e.type === "assistant/retrying")).toHaveLength(0);
    expect(events.filter((e) => e.type === "request/header")).toHaveLength(1);
  });

  it("未配 streamRecovery（deps 缺省）→ 流中失败照抛 turn/end{error}（零行为变化）", async () => {
    const { provider } = flakyProvider([
      { chunks: [{ type: "text-delta", text: "半" }], error: new Error("died") },
    ]);
    const harness = makeLoop(provider);
    const reason = await harness.loop.runTurn("问题");
    expect(reason.kind).toBe("error");
    expect(harness.store.load("s1").filter((e) => e.type === "assistant/retrying")).toHaveLength(0);
  });

  it("StreamRecoveryBlockedError 携带原始错误（runStep 翻译为 blocked 的契约面）", () => {
    const original = new ProviderHttpError(403, "forbidden");
    const err = new StreamRecoveryBlockedError(original);
    expect(err.original).toBe(original);
    expect(err.message).toContain("non_retryable_failure");
  });
});

// ---------------------------------------------------------------------------
// 快照即规格（T-P1-109 收口⑧）：F18 恢复全链一条——事件类型序列即规格，
// 新相位缺位/次序漂移即红（O22 语义延续）
// ---------------------------------------------------------------------------

describe("快照即规格：F18 恢复全链（流中失败 → attempt → retrying → 重发 → 收束）", () => {
  it("事件类型序列逐位钉死（attempt 之后的 retrying 与第二枚 header 是恢复的证据位）", async () => {
    const { provider } = flakyProvider([
      { chunks: [{ type: "text-delta", text: "半" }], error: new Error("mid-stream reset") },
      { chunks: [{ type: "text-delta", text: "恢复后完整" }, { type: "done", finishReason: "stop" }] },
    ]);
    const harness = makeLoop(provider, { streamRecovery: { maxRetries: 2 } });
    const reason = await harness.loop.runTurn("问题");
    expect(reason.kind).toBe("completed");
    const types = harness.store
      .load("s1")
      .filter((e) => e.type !== "tool/progress")
      .map((e) => e.type);
    expect(types).toEqual([
      "turn/start",
      "user/message",
      "step/start",
      "request/header", // 尝试 1（失败）
      "assistant/attempt", // 被丢弃的 tail（含 timed chunks）
      "assistant/retrying", // 恢复重发的证据位
      "request/header", // 尝试 2（每次尝试各一枚 header）
      "assistant/message", // 重发成功产出
      "step/end",
      "turn/end",
    ]);
  });
});
