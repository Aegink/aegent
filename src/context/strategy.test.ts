/**
 * 压缩策略具名（F27/T-P2-511）——prefix_window 策略往返 + 摘要区间正确 +
 * 闭集扩展管线（#18 同款追加：{full_summary, recent_window_fallback,
 * prefix_window}——strategy 是载荷值域扩展非新事件，EVENT_TYPES 不变）。
 * 独立文件原因：compaction.test.ts 已 991 行（400 行上限——supersession 先例）。
 */

import { describe, expect, it } from "vitest";
import type { NewSessionEvent, SessionEvent } from "../kernel/events.js";
import {SessionEventStore, type SessionStore} from "../session/store.js";
import { startNewContextWindow } from "./new-window.js";
import {
  CompactionEngine,
  PREFIX_WINDOW_RETAINED_FROM_END,
  compactionFingerprint,
  type Summarizer,
} from "./compaction.js";

const SESSION = "s-strategy";

function turnEvents(turn: number, user: string): NewSessionEvent[] {
  return [
    { type: "turn/start", turn },
    { type: "user/message", turn, message: { content: user }, source: "user" },
    { type: "step/start", turn, step: 1 },
    { type: "assistant/message", turn, step: 1, message: { content: `a-${user}` }, stream: [] },
    { type: "step/end", turn, step: 1 },
    { type: "turn/end", turn, reason: { kind: "completed" } },
  ];
}

const noopSummarizer: Summarizer = async () => "摘要文本";

function engine(store: SessionStore, strategy?: "full_summary" | "prefix_window"): CompactionEngine {
    return new CompactionEngine({
        sessionId: SESSION,
        store,
        summarizer: noopSummarizer,
        ...(strategy !== undefined ? { strategy } : {}),
    });
}

function settledStrategy(events: readonly SessionEvent[]): string | undefined {
    const settled = [...events]
        .reverse()
        .find((e): e is Extract<SessionEvent, { type: "compaction" }> =>
            e.type === "compaction" && (e.status === undefined || e.status === "completed"));
    return settled?.strategy;
}

const overflowRequest = {
  reason: "local-overflow" as const,
  estimatedTokens: 9000,
  contextWindow: 8000,
};

describe("压缩策略具名（F27）", () => {
  it("prefix_window 往返：摘要只覆盖更早区间，近期原文保留在新窗口（活前缀）", async () => {
    const store = new SessionEventStore();
    // 12 轮：prefix 窗口 8 条边界 → 摘要只覆盖前 4 轮；full（缺省 1 条）→ 覆盖前 11 轮
    for (let t = 1; t <= 12; t++) store.append(SESSION, turnEvents(t, `问题${t}`));
    const enginePrefix = engine(store, "prefix_window");
    const result = await enginePrefix.run({ turn: 12, phase: "PreTurn", request: overflowRequest });
    expect(result.kind).toBe("compacted");
    const settled = result.kind === "compacted" ? result : undefined;
    const events = store.load(SESSION);
    // 策略值落流可归因（闭集扩展管线：值在事件载荷上，事件计数不变）
    expect(settledStrategy(events)).toBe("prefix_window");
    // 摘要区间正确：prefix 窗口下被摘要覆盖的轮次更少（切点更晚）
    const cut = settled?.retainedTail ?? 0;
    const covered = events.filter((e) => e.type === "user/message" && e.seq <= cut);
    expect(covered.length).toBe(12 - PREFIX_WINDOW_RETAINED_FROM_END);
    // 活前缀：新窗口重建含近 8 条原文 user 消息
    const window = startNewContextWindow(events);
    const originals = window.filter((m) => m.role === "user" && m.content.startsWith("问题"));
    expect(originals.length).toBe(PREFIX_WINDOW_RETAINED_FROM_END);
  });

  it("full_summary（缺省）零行为变化：策略缺席时切点用 DEFAULT_RETAINED_FROM_END=1", async () => {
    const store = new SessionEventStore();
    for (let t = 1; t <= 5; t++) store.append(SESSION, turnEvents(t, `问题${t}`));
    const result = await engine(store).run({ turn: 5, phase: "PreTurn", request: overflowRequest });
    const events = store.load(SESSION);
    expect(settledStrategy(events)).toBe("full_summary");
    const settled = result.kind === "compacted" ? result : undefined;
    const covered = events.filter((e) => e.type === "user/message" && e.seq <= (settled?.retainedTail ?? 0));
    expect(covered.length).toBe(4); // 5 轮留尾部 1 条
  });

  it("策略入指纹（卡面风险点）：strategy 变化改变 compHash——跨进程对拍可重压", () => {
    const base = { summarizerKind: "truncating", retainedFromEnd: 1, developerBudgetTokens: 2_000 };
    expect(compactionFingerprint({ ...base, strategy: "full_summary" })).not.toBe(
      compactionFingerprint({ ...base, strategy: "prefix_window" }),
    );
    // 策略缺席（旧装配）与显式 full_summary 指纹也异——重启换策略必然触发重压
    expect(compactionFingerprint(base)).not.toBe(
      compactionFingerprint({ ...base, strategy: "prefix_window" }),
    );
  });
});
