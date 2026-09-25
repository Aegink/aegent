/**
 * T-7-07 验收（F28）：连续 N 次（默认 3，可配）"压缩后几乎无进展又压缩" →
 * 硬失败，错误对象含 consecutiveRapidRefills/toolTurnsSinceCompact 全计数。
 * ZCode 独家机制，无条件采纳（turn-loop-state.ts 同构语义）。
 */

import { describe, expect, it } from "vitest";
import { SessionStore } from "../session/store.js";
import { CompactionEngine } from "./compaction.js";
import {
  MAX_CONSECUTIVE_RAPID_REFILLS,
  RAPID_REFILL_TOOL_TURN_THRESHOLD,
  RapidRefillError,
  RapidRefillGuard,
} from "./rapid-refill.js";

const SESSION = "s-refill";

function appendTurn(store: SessionStore, turn: number, user: string, assistant: string): void {
  store.append(SESSION, [
    { type: "turn/start", turn },
    { type: "user/message", turn, message: { content: user }, source: "user" },
    { type: "step/start", turn, step: 1 },
    { type: "assistant/message", turn, step: 1, message: { content: assistant }, stream: [] },
    { type: "step/end", turn, step: 1 },
    { type: "turn/end", turn, reason: { kind: "completed" } },
  ]);
}

/** 每次压缩后立刻又压（零工具步骤）的典型抖动场景引擎。 */
function churningEngine(store: SessionStore, guard: RapidRefillGuard): CompactionEngine {
  return new CompactionEngine({
    sessionId: SESSION,
    store,
    summarizer: async () => "抖动摘要",
    keepRules: { retainedFromEnd: 1 },
    rapidRefillGuard: guard,
  });
}

async function compactOnce(engine: CompactionEngine, turn: number): Promise<void> {
  await engine.run({
    turn,
    phase: "PreTurn",
    request: { reason: "local-overflow", estimatedTokens: 9000, contextWindow: 8000 },
  });
  
}

describe("状态机单元（zcode 同构语义）", () => {
  it("默认阈值 3/3；零进展连续压缩 → evaluate 计数逐次 +1，第 3 次 shouldBlock", () => {
    expect(MAX_CONSECUTIVE_RAPID_REFILLS).toBe(3);
    expect(RAPID_REFILL_TOOL_TURN_THRESHOLD).toBe(3);
    const guard = new RapidRefillGuard();
    const d1 = guard.evaluate();
    expect(d1.consecutiveRapidRefills).toBe(1);
    expect(d1.shouldBlock).toBe(false);
    guard.recordCompactSuccess(d1);
    const d2 = guard.evaluate();
    expect(d2.consecutiveRapidRefills).toBe(2);
    guard.recordCompactSuccess(d2);
    const d3 = guard.evaluate();
    expect(d3.consecutiveRapidRefills).toBe(3);
    expect(d3.shouldBlock).toBe(true);
  });

  it("足够工具步骤后再压 → 计数归 0（干活解锁断路器）", () => {
    const guard = new RapidRefillGuard();
    const d1 = guard.evaluate();
    guard.recordCompactSuccess(d1);
    // 压缩后干了 3 个工具步骤（达到阈值）
    for (let i = 0; i < RAPID_REFILL_TOOL_TURN_THRESHOLD; i++) {
      guard.recordCompletedToolStep();
    }
    const d2 = guard.evaluate();
    expect(d2.toolTurnsSinceCompact).toBe(3);
    expect(d2.consecutiveRapidRefills).toBe(0); // 归 0,不累计
    expect(d2.shouldBlock).toBe(false);
  });

  it("evaluate 是纯拟算：不落账，阻断时状态冻结（计数不虚增）", () => {
    const guard = new RapidRefillGuard();
    const d1 = guard.evaluate();
    guard.recordCompactSuccess(d1);
    const d2 = guard.evaluate(); // 拟算 2
    expect(d2.consecutiveRapidRefills).toBe(2);
    const d2again = guard.evaluate(); // 再拟算仍是 2(没落账)
    expect(d2again.consecutiveRapidRefills).toBe(2);
    expect(guard.snapshot.consecutiveRapidRefills).toBe(1); // 状态还在 d1 落的账上
  });

  it("可配阈值：max=2 时第 2 次极小进展压缩即 shouldBlock", () => {
    const guard = new RapidRefillGuard(2, 3);
    guard.recordCompactSuccess(guard.evaluate());
    const d2 = guard.evaluate();
    expect(d2.consecutiveRapidRefills).toBe(2);
    expect(d2.shouldBlock).toBe(true);
  });
});

describe("验收：接入压缩入口的硬失败", () => {
  it("连续 3 次零进展压缩 → 第 4 次入口硬失败,错误含全计数", async () => {
    const store = new SessionStore();
    appendTurn(store, 1, "q1", "a1");
    const guard = new RapidRefillGuard();
    const engine = churningEngine(store, guard);

    // 连续 3 次压缩成功(零工具步骤——典型抖动):第 1、2、3 次 evaluate
    // 拟算 1、2、3,但第 3 次 shouldBlock → 入口直接抛,压缩不发生
    await compactOnce(engine, 1); // consecutive 拟算 1,成功落账
    await compactOnce(engine, 1); // 拟算 2,成功落账
    let caught: unknown;
    try {
      await compactOnce(engine, 1); // 拟算 3 → shouldBlock → 硬失败
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RapidRefillError);
    const err = caught as RapidRefillError;
    expect(err.code).toBe("COMPACTION_RAPID_REFILL");
    // 验收字面:错误对象含 consecutiveRapidRefills/toolTurnsSinceCompact 全计数
    expect(err.consecutiveRapidRefills).toBe(3);
    expect(err.toolTurnsSinceCompact).toBe(0);
    // 硬失败的压缩未发生:只有 2 次 compaction 落盘
    expect(store.load(SESSION).filter((e) => e.type === "compaction")).toHaveLength(2);
  });

  it("干活解锁:熔断后记录足够工具步骤 → 压缩放行", async () => {
    const store = new SessionStore();
    appendTurn(store, 1, "q1", "a1");
    const guard = new RapidRefillGuard(2); // 低阈值快速熔断
    const engine = churningEngine(store, guard);
    await compactOnce(engine, 1);
    let caught: unknown;
    try {
      await compactOnce(engine, 1); // 连续第 2 次 → 熔断
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RapidRefillError);
    // 用户真实干活:3 个工具步骤
    for (let i = 0; i < RAPID_REFILL_TOOL_TURN_THRESHOLD; i++) {
      guard.recordCompletedToolStep();
    }
    await compactOnce(engine, 1); // evaluate 拟算 0 → 放行
    expect(store.load(SESSION).filter((e) => e.type === "compaction")).toHaveLength(2);
    expect(guard.snapshot.consecutiveRapidRefills).toBe(0);
  });

  it("压缩成功才落账:熔断抛错路径不 recordCompactSuccess(状态冻结)", async () => {
    const guard = new RapidRefillGuard();
    guard.recordCompactSuccess(guard.evaluate()); // consecutive=1
    guard.recordCompactSuccess(guard.evaluate()); // consecutive=2
    expect(guard.snapshot).toEqual({ consecutiveRapidRefills: 2, toolTurnsSinceCompact: 0 });
    // 熔断那次(evaluate 拟算 3)抛错,状态不前进
    const engine = new CompactionEngine({
      sessionId: SESSION,
      store: new SessionStore(),
      summarizer: async () => "不该被调",
      rapidRefillGuard: guard,
    });
    await expect(compactOnce(engine, 1)).rejects.toThrow(RapidRefillError);
    expect(guard.snapshot.consecutiveRapidRefills).toBe(2); // 冻结,不虚增到 3
  });
});
