/**
 * T-7-04 验收（F9/F10）：
 * ① 成功调用不带 usage → 仍产生压力记录（本地估算兜底）；
 * ② 压缩无法证明进展时抛出的错误 `cause` 是 provider 原始错误对象；
 * ③ turn 边界压缩次序（F9）：turnEnd 链上的压缩层在 next 之前作业 →
 *    compaction 事件先于 turn/end 落盘（chain.ts 头注释预言的断言）。
 */

import { describe, expect, it } from "vitest";
import { ProviderHttpError, type ChatMessage } from "../models/provider.js";
import { composeChain } from "../kernel/chain.js";
import type { TurnEndReason } from "../kernel/events.js";
import {SessionEventStore, type SessionStore} from "../session/store.js";
import { expectTurnScoped } from "../test-support/event-asserts.js";
import { CompactionEngine, type CompactionResult } from "./compaction.js";
import { CONTEXT_WINDOW_EXCEEDED_CODE } from "./overflow.js";
import {
  DEFAULT_PRESSURE_THRESHOLD_RATIO,
  OverflowRecoveryError,
  PressureMonitor,
  recoverFromOverflow,
} from "./pressure.js";

const SESSION = "s-pressure";

const bigMessages: ChatMessage[] = [{ role: "user", content: "x".repeat(7200) }]; // 估算 2000+8

function monitor(window = 1000, ratio?: number): PressureMonitor {
  return new PressureMonitor(ratio === undefined ? { contextWindow: window } : { contextWindow: window, thresholdRatio: ratio });
}

describe("压力测量（调用后）", () => {
  it("信号①：成功 + usage → tokens 取 totalTokens（缺失折算 input+output），overThreshold 按比率", () => {
    const m = monitor(1000);
    const r = m.recordSuccess({
      turn: 1,
      step: 1,
      messages: bigMessages,
      usage: { inputTokens: 700, outputTokens: 100, totalTokens: 800 },
    });
    expect(r.tokens).toBe(800);
    expect(r.source).toBe("usage");
    expect(r.overThreshold).toBe(true); // 800 ≥ 1000×0.8
    const r2 = m.recordSuccess({
      turn: 1,
      step: 2,
      messages: bigMessages,
      usage: { inputTokens: 300, outputTokens: 100 }, // 无 totalTokens
    });
    expect(r2.tokens).toBe(400);
    expect(r2.overThreshold).toBe(false);
  });

  it("验收①：成功调用不带 usage → 仍产生压力记录（本地估算兜底）", () => {
    const m = monitor(100000);
    const r = m.recordSuccess({ turn: 1, step: 1, messages: bigMessages });
    expect(r.source).toBe("local-estimate");
    expect(r.tokens).toBeGreaterThan(0); // 仍产生记录——无 usage 不是无压力信号
    expect(r.overThreshold).toBe(false);
    expect(m.history).toHaveLength(1);
  });

  it("信号③：超限拒绝 → provider-rejection 压力记录；无关错误 → null（非压力问题）", () => {
    const m = monitor(100);
    const overflowErr = new ProviderHttpError(400, "Bad request", {
      bodyPreview: "This model's maximum context length is 8192 tokens",
    });
    const r = m.recordRejection({ turn: 1, step: 1, messages: bigMessages, error: overflowErr });
    expect(r).not.toBeNull();
    expect(r!.source).toBe("provider-rejection");
    expect(r!.overThreshold).toBe(true);
    expect(m.recordRejection({ turn: 1, step: 2, messages: bigMessages, error: new Error("reset") })).toBeNull();
  });

  it("阈值比率默认 0.8（dsh 同款）、可配；历史可回放（append 序）", () => {
    expect(DEFAULT_PRESSURE_THRESHOLD_RATIO).toBe(0.8);
    const m = monitor(1000, 0.5);
    m.recordSuccess({ turn: 1, step: 1, messages: bigMessages, usage: { inputTokens: 450, outputTokens: 50 } });
    expect(m.history[0]!.overThreshold).toBe(true); // 500 ≥ 1000×0.5
    m.recordSuccess({ turn: 1, step: 2, messages: bigMessages, usage: { inputTokens: 40, outputTokens: 10 } });
    expect(m.history).toHaveLength(2);
    expect(m.history.map((r) => r.step)).toEqual([1, 2]);
  });
});

describe("验收②：恢复失败不吞原始错误（F10）", () => {
  const providerError = Object.assign(
    new ProviderHttpError(400, "Bad request", { bodyPreview: "context_length_exceeded" }),
    { code: CONTEXT_WINDOW_EXCEEDED_CODE },
  );

  it("pre hook 中止（无进展）→ OverflowRecoveryError.cause === provider 原始错误对象", async () => {
    let caught: unknown;
    try {
      await recoverFromOverflow({
        providerError,
        compact: async (): Promise<CompactionResult> => ({ kind: "aborted", by: "pre-hook", reason: "策略" }),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OverflowRecoveryError);
    const err = caught as OverflowRecoveryError;
    expect(err.code).toBe("CONTEXT_OVERFLOW_RECOVERY_FAILED");
    expect(err.cause).toBe(providerError); // 同一对象——绝不吞
  });

  it("压缩自身抛错（无进展）→ cause 仍是 provider 原始错误", async () => {
    let caught: unknown;
    try {
      await recoverFromOverflow({
        providerError,
        compact: async () => {
          throw new Error("摘要 provider 失败");
        },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OverflowRecoveryError);
    expect((caught as OverflowRecoveryError).cause).toBe(providerError);
    expect((caught as Error).message).toContain("摘要 provider 失败"); // 恢复失败细节在 message
  });

  it("压缩成功（进展证明：compaction 事件已落盘）→ 返回结果不抛", async () => {
    const result: CompactionResult = {
      kind: "compacted",
      summary: "s",
      retainedTail: 3,
      tokensBefore: 100,
      seq: 9,
    };
    const out = await recoverFromOverflow({ providerError, compact: async () => result });
    expect(out).toBe(result);
  });
});

describe("F9：压缩发生在 turn 边界（turnEnd 点位）——次序断言", () => {
  it("turnEnd 链压缩层在 next 前作业 → compaction 事件先于 turn/end 落盘", async () => {
    const store = new SessionEventStore();
    store.append(SESSION, [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "旧问题" }, source: "user" },
      { type: "step/start", turn: 1, step: 1 },
      { type: "assistant/message", turn: 1, step: 1, message: { content: "旧回答" }, stream: [] },
      { type: "step/end", turn: 1, step: 1 },
    ]);
    const monitor_ = monitor(50); // 极小窗口：必超阈值
    // 调用后测量（本 step 的成功调用，无 usage → 本地兜底）
    const record = monitor_.recordSuccess({ turn: 1, step: 1, messages: bigMessages });
    expect(record.overThreshold).toBe(true);

    // turnEnd 链上的压缩层：next 之前跑压缩（F9 层自选在 next 前后——取前）
    const engine = new CompactionEngine({
      sessionId: SESSION,
      store,
      summarizer: async () => "turn 边界压缩摘要",
      keepRules: { retainedFromEnd: 1 },
    });
    const turnEndChain = composeChain<
      { sessionId: string },
      { turn: number; reason: TurnEndReason },
      void
    >({
      point: "turnEnd",
      layers: [
        async (_$, e, next) => {
          const latest = monitor_.history[monitor_.history.length - 1]!;
          if (latest.overThreshold) {
            await engine.run({
              turn: e.turn,
              phase: "PreTurn",
              request: { reason: "local-overflow", estimatedTokens: latest.tokens, contextWindow: latest.contextWindow },
            });
          }
          await next(e);
        },
      ],
      terminal: (_$, e) => {
        store.append(SESSION, [
          { type: "turn/end", turn: e.turn, reason: e.reason },
        ]);
      },
    });

    await turnEndChain.run({ sessionId: SESSION }, { turn: 1, reason: { kind: "max-tokens" } });
    const events = store.load(SESSION);
    // E17 两段化：settled 结算事件（最后一条）仍先于 turn/end（次序语义不变）
    const compaction = [...events].reverse().find((e) => e.type === "compaction");
    const turnEnd = events.find((e) => e.type === "turn/end");
    expect(compaction).toBeDefined();
    expect(turnEnd).toBeDefined();
    // 次序断言：压缩先于 turn/end（压缩在 turn 边界、turn/end 落盘前完成）
    expect(compaction!.seq).toBeLessThan(turnEnd!.seq);
    expect(events[events.length - 1]!.type).toBe("turn/end");
    expectTurnScoped(events);
  });
});
