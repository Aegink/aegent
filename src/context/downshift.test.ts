/**
 * T-7-06 验收（F24）：小上下文目标 + 超限投影 → 压缩先于"切换"发生
 * （次序断言），compaction 事件 reason=model_downshift。
 * 换模本体（J6）是 P1——测试里"切换"是注入的记录函数。
 */

import { describe, expect, it } from "vitest";
import { modelIdentity } from "../models/identity.js";
import { SessionStore } from "../session/store.js";
import { Projector } from "../session/project.js";
import { startNewContextWindow } from "./new-window.js";
import { CompactionEngine } from "./compaction.js";
import { maybeDownshift } from "./downshift.js";

const SESSION = "s-downshift";
const target = modelIdentity("openai", "gpt-mini");

function appendTurn(store: SessionStore, turn: number, user: string, assistant: string): void {
  store.append(SESSION, [
    { type: "turn/start", turn },
    { type: "user/message", turn, message: { content: user }, source: "user" },
    { type: "step/start", turn, step: 1 },
    {
      type: "assistant/message",
      turn,
      step: 1,
      message: { content: assistant },
      stream: [],
    },
    { type: "step/end", turn, step: 1 },
    { type: "turn/end", turn, reason: { kind: "completed" } },
  ]);
}

function engineFor(store: SessionStore, log?: string[]): CompactionEngine {
  return new CompactionEngine({
    sessionId: SESSION,
    store,
    summarizer: async () => {
      log?.push("compaction-entry");
      return "换模前压缩摘要";
    },
    keepRules: { retainedFromEnd: 1 },
  });
}

describe("验收：压缩先于切换（次序断言）+ 事件 reason=model_downshift", () => {
  it("超限投影 → maybeDownshift 内压缩完成 resolve 后,调用方才执行切换", async () => {
    const store = new SessionStore();
    appendTurn(store, 1, "长问题", "长回答");
    // 投影带 lastUsage：totalTokens=9000 > 目标窗口 8000
    const projection = Projector.fold(store.load(SESSION)).projection;
    projection.lastUsage = { inputTokens: 8900, outputTokens: 100, totalTokens: 9000 };

    const log: string[] = [];
    const decision = await maybeDownshift({
      targetModel: target,
      targetContextWindow: 8000,
      projection,
      engine: engineFor(store, log),
      turn: 2,
    });
    expect(decision.needsCompaction).toBe(true);
    // 切换发生在 maybeDownshift resolve 之后（压缩已 await 完成）
    log.push("switch");
    expect(log).toEqual(["compaction-entry", "switch"]);

    // compaction 事件 reason=model_downshift（F24 验收字面）
    const events = store.load(SESSION);
    const compaction = events.find((e) => e.type === "compaction");
    expect(compaction).toBeDefined();
    if (compaction?.type !== "compaction") return;
    expect(compaction.reason).toBe("model_downshift");
    if (decision.compaction?.kind !== "compacted") throw new Error("应当压缩成功");
    expect(decision.compaction.seq).toBe(compaction.seq);

    // 压缩后新窗口显著下降（F3 语义的旁证）：turn 1 内容原文只保留尾部边界起的
    // [user, assistant]，更早的内容（本例没有）进摘要
    const window = startNewContextWindow(events);
    expect(window).toHaveLength(3); // 摘要 + 保留尾部（user + assistant）
    expect(window[0]!.content).toContain("换模前压缩摘要");
    expect(window[1]).toMatchObject({ role: "user", content: "长问题" });
  });

  it("目标窗口装得下当前内容 → 不压缩直接切换（needsCompaction=false,零事件）", async () => {
    const store = new SessionStore();
    appendTurn(store, 1, "短问题", "短回答");
    const projection = Projector.fold(store.load(SESSION)).projection;
    projection.lastUsage = { inputTokens: 100, outputTokens: 10, totalTokens: 110 };

    const log: string[] = [];
    const decision = await maybeDownshift({
      targetModel: target,
      targetContextWindow: 8000,
      projection,
      engine: engineFor(store, log),
      turn: 2,
    });
    expect(decision.needsCompaction).toBe(false);
    expect(decision.compaction).toBeUndefined();
    log.push("switch");
    expect(log).toEqual(["switch"]); // 没有压缩入口被调
    expect(store.load(SESSION).some((e) => e.type === "compaction")).toBe(false);
  });

  it("无 lastUsage 的投影 → 本地估算兜底判定（保守方向）", async () => {
    const store = new SessionStore();
    // 大量内容:估算 > 500
    store.append(SESSION, []);
    appendTurn(store, 1, "x".repeat(2000), "y".repeat(2000));
    const projection = Projector.fold(store.load(SESSION)).projection;
    expect(projection.lastUsage).toBeNull();

    const decision = await maybeDownshift({
      targetModel: target,
      targetContextWindow: 500,
      projection,
      engine: engineFor(store),
      turn: 2,
    });
    expect(decision.needsCompaction).toBe(true);
    const compaction = store.load(SESSION).find((e) => e.type === "compaction");
    expect(compaction).toBeDefined();
  });

  it("边界:恰好装下（tokens == window）不压（严格大于判定）", async () => {
    const store = new SessionStore();
    appendTurn(store, 1, "q", "a");
    const projection = Projector.fold(store.load(SESSION)).projection;
    projection.lastUsage = { inputTokens: 1000, outputTokens: 0, totalTokens: 1000 };
    const decision = await maybeDownshift({
      targetModel: target,
      targetContextWindow: 1000,
      projection,
      engine: engineFor(store),
      turn: 2,
    });
    expect(decision.needsCompaction).toBe(false);
  });
});
