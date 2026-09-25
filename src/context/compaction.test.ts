/**
 * T-7-02 验收（F3/F20/F21）：
 * ① 压缩产生 `compaction` 事件（载荷含 summary/retainedTail/tokensBefore，
 *    对齐 l0-events.md §3.2#11）；
 * ② hook 可中止（中止后无新窗口——无 compaction 事件）；
 * ③ MidTurn 相位在 step 边界触发可断言（phaseForCompletedSteps 判定 +
 *    hook invocation.phase 断言）。
 * 摘要生成用假 provider 剧本（注入 Summarizer；真实摘要质量属 F5 P1 不验收）。
 */

import { describe, expect, it } from "vitest";
import type { NewSessionEvent, TokenUsage } from "../kernel/events.js";
import { buildChatMessages, effectiveEvents } from "../session/messages.js";
import { SessionStore } from "../session/store.js";
import { expectPaired, expectTurnScoped } from "../test-support/event-asserts.js";
import {
  CompactionEngine,
  type CompactionRunInput,
  type CompactionSettled,
  type PreCompactOutcome,
  type Summarizer,
  phaseForCompletedSteps,
} from "./compaction.js";

const SESSION = "s-compaction";

/** 组一条完整的 user turn：user 消息 → assistant（可选 usage）→ turn/end。 */
function turnEvents(turn: number, user: string, assistant: string, usage?: TokenUsage): NewSessionEvent[] {
  return [
    { type: "turn/start", turn },
    { type: "user/message", turn, message: { content: user }, source: "user" },
    { type: "step/start", turn, step: 1 },
    {
      type: "assistant/message",
      turn,
      step: 1,
      message: { content: assistant },
      stream: [],
      ...(usage ? { usage } : {}),
    },
    { type: "step/end", turn, step: 1 },
    { type: "turn/end", turn, reason: { kind: "completed" } },
  ];
}

/** 假 provider 剧本的 Summarizer：返回剧本摘要并记录收到的覆盖区间。 */
function scriptedSummarizer(script: string, log: string[][] = []): Summarizer {
  return async ({ messages }) => {
    log.push(messages.map((m) => m.content));
    return script;
  };
}

const localOverflowRequest: CompactionRunInput["request"] = {
  reason: "local-overflow",
  estimatedTokens: 9000,
  contextWindow: 8000,
};

describe("验收①：压缩产生 compaction 事件（载荷对齐词汇表 §3.2#11）", () => {
  it("压缩落盘 compaction 事件：summary/retainedTail/tokensBefore 整值载荷；事件流不变量不破", async () => {
    const store = new SessionStore();
    store.append(SESSION, turnEvents(1, "第一轮问题", "第一轮回答", {
      inputTokens: 700,
      outputTokens: 100,
      totalTokens: 800,
    }));
    store.append(SESSION, turnEvents(2, "第二轮问题", "第二轮回答"));

    const summarizerLog: string[][] = [];
    const engine = new CompactionEngine({
      sessionId: SESSION,
      store,
      summarizer: scriptedSummarizer("剧情摘要", summarizerLog),
      keepRules: { retainedFromEnd: 1 },
    });
    const result = await engine.run({ turn: 2, phase: "PreTurn", request: localOverflowRequest });

    expect(result.kind).toBe("compacted");
    if (result.kind !== "compacted") return;
    const events = store.load(SESSION);
    const compaction = events.find((e) => e.type === "compaction");
    expect(compaction).toBeDefined();
    if (compaction?.type !== "compaction") return;
    expect(compaction.summary).toBe("剧情摘要");
    expect(compaction.tokensBefore).toBe(800); // E12 整值：来自 usage.totalTokens
    expect(result.seq).toBe(compaction.seq);
    // retainedTail = 从尾数第 1 条 user 消息（"第二轮问题"）前一条事件的 seq；
    // 新窗口从该 seq 之后重建（T-7-03），保留最后一个用户请求原文。
    const lastUser = [...events].reverse().find((e) => e.type === "user/message");
    expect(compaction.retainedTail).toBe(lastUser!.seq - 1);
    expect(result.retainedTail).toBe(compaction.retainedTail);
    // 被摘要区间 = 切点之前的消息（第一轮的 user + assistant）
    expect(summarizerLog[0]).toEqual(["第一轮问题", "第一轮回答"]);
    // 词汇表结构纪律：压缩后整条流仍过不变量断言
    expectTurnScoped(events);
    expectPaired(events, "step/start");
  });

  it("tool 调用块整块保留或整块摘要（user/system 边界切点不劈开配平）", async () => {
    const store = new SessionStore();
    store.append(SESSION, [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "跑个命令" }, source: "user" },
      { type: "step/start", turn: 1, step: 1 },
      { type: "assistant/message", turn: 1, step: 1, message: { content: "" }, stream: [] },
      { type: "tool/call", turn: 1, step: 1, callId: "c1", name: "bash", arguments: "{}" },
      { type: "tool/result", turn: 1, step: 1, callId: "c1", message: { content: "输出" } },
      { type: "step/end", turn: 1, step: 1 },
      { type: "turn/end", turn: 1, reason: { kind: "completed" } },
      { type: "turn/start", turn: 2 },
      { type: "user/message", turn: 2, message: { content: "下一问" }, source: "user" },
      { type: "turn/end", turn: 2, reason: { kind: "completed" } },
    ]);
    const engine = new CompactionEngine({
      sessionId: SESSION,
      store,
      summarizer: scriptedSummarizer("s"),
      keepRules: { retainedFromEnd: 1 },
    });
    await engine.run({ turn: 2, phase: "PreTurn", request: localOverflowRequest });
    const compaction = store.load(SESSION).find((e) => e.type === "compaction");
    if (compaction?.type !== "compaction") throw new Error("应当落盘 compaction 事件");
    // 被摘要区间 = 切点之前（seq ≤ retainedTail）——tool 配对块整块在内
    const covered = buildChatMessages(effectiveEvents(store.load(SESSION)), {
      upToSeq: compaction.retainedTail,
    });
    expect(covered).toHaveLength(3); // user + assistant(+toolCalls) + tool
    expect(covered[1]).toMatchObject({ role: "assistant", toolCalls: [{ id: "c1" }] });
    expect(covered[2]).toMatchObject({ role: "tool", callId: "c1" });
    expectPaired(store.load(SESSION), "tool/call");
  });
});

describe("验收②：hook 可中止（中止后无新窗口）", () => {
  it("pre hook abort → 无 compaction 事件、summarizer 不被调、结果 aborted", async () => {
    const store = new SessionStore();
    store.append(SESSION, turnEvents(1, "q", "a"));
    let summarizerCalled = false;
    const engine = new CompactionEngine({
      sessionId: SESSION,
      store,
      summarizer: async () => {
        summarizerCalled = true;
        return "不该出现";
      },
      preHook: (): PreCompactOutcome => ({ action: "abort", reason: "策略禁止" }),
    });
    const result = await engine.run({ turn: 1, phase: "PreTurn", request: localOverflowRequest });
    expect(result).toEqual({ kind: "aborted", by: "pre-hook", reason: "策略禁止" });
    expect(summarizerCalled).toBe(false);
    expect(store.load(SESSION).some((e) => e.type === "compaction")).toBe(false);
  });

  it("post hook 观察结算事实（summary/retainedTail/seq = compaction 事件 seq）", async () => {
    const store = new SessionStore();
    store.append(SESSION, turnEvents(1, "q", "a", { inputTokens: 10, outputTokens: 5 }));
    const seen: CompactionSettled[] = [];
    const engine = new CompactionEngine({
      sessionId: SESSION,
      store,
      summarizer: scriptedSummarizer("摘要"),
      postHook: async (s) => {
        seen.push(s);
      },
    });
    const result = await engine.run({ turn: 1, phase: "PreTurn", request: localOverflowRequest });
    if (result.kind !== "compacted") throw new Error("应当压缩成功");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      summary: "摘要",
      retainedTail: result.retainedTail,
      seq: result.seq,
      tokensBefore: 15, // totalTokens 缺失 → input+output 折算
      phase: "PreTurn",
    });
  });
});

describe("验收③：相位（Q13 两相位）与 MidTurn 的 step 边界触发", () => {
  it("phaseForCompletedSteps：0 → PreTurn，已有完成 step → MidTurn（zcode 同款判定）", () => {
    expect(phaseForCompletedSteps(0)).toBe("PreTurn");
    expect(phaseForCompletedSteps(1)).toBe("MidTurn");
    expect(phaseForCompletedSteps(5)).toBe("MidTurn");
  });

  it("MidTurn 压缩在 step 边界触发：turn 进行中（未闭合）落盘且 invocation.phase 可断言", async () => {
    const store = new SessionStore();
    // turn 1 完整闭合；turn 2 进行中：step 1 已闭合、step 2 开着（step 边界 = step1.end 与 step2 之间）
    store.append(SESSION, turnEvents(1, "历史问题", "历史回答", { inputTokens: 1000, outputTokens: 200 }));
    store.append(SESSION, [
      { type: "turn/start", turn: 2 },
      { type: "user/message", turn: 2, message: { content: "进行中的问题" }, source: "user" },
      { type: "step/start", turn: 2, step: 1 },
      { type: "assistant/message", turn: 2, step: 1, message: { content: "中间回答" }, stream: [] },
      { type: "step/end", turn: 2, step: 1 },
    ]);
    const phases: string[] = [];
    const engine = new CompactionEngine({
      sessionId: SESSION,
      store,
      summarizer: scriptedSummarizer("轮中摘要"),
      preHook: (inv) => {
        phases.push(inv.phase);
        return { action: "proceed" };
      },
    });
    // 触发方按 zcode 判定算相位：turn 2 已完成 1 个模型 step → MidTurn
    const phase = phaseForCompletedSteps(1);
    expect(phase).toBe("MidTurn");
    const result = await engine.run({ turn: 2, phase, request: localOverflowRequest });
    expect(result.kind).toBe("compacted");
    expect(phases).toEqual(["MidTurn"]);
    const compaction = store.load(SESSION).find((e) => e.type === "compaction");
    expect(compaction?.turn).toBe(2); // 归属进行中的轮
  });

  it("PreTurn 压缩（turn 边界触发面）：invocation.phase === PreTurn", async () => {
    const store = new SessionStore();
    store.append(SESSION, turnEvents(1, "q", "a"));
    const phases: string[] = [];
    const engine = new CompactionEngine({
      sessionId: SESSION,
      store,
      summarizer: scriptedSummarizer("s"),
      preHook: (inv) => {
        phases.push(inv.phase);
        return { action: "proceed" };
      },
    });
    await engine.run({ turn: 1, phase: phaseForCompletedSteps(0), request: localOverflowRequest });
    expect(phases).toEqual(["PreTurn"]);
  });
});

describe("tokensBefore 来源与有效视窗", () => {
  it("无 usage 的流 → 本地估算兜底（保守系数方向见 overflow.ts）", async () => {
    const store = new SessionStore();
    store.append(SESSION, turnEvents(1, "问题内容", "回答内容"));
    const engine = new CompactionEngine({
      sessionId: SESSION,
      store,
      summarizer: scriptedSummarizer("s"),
    });
    const result = await engine.run({ turn: 1, phase: "PreTurn", request: localOverflowRequest });
    if (result.kind !== "compacted") throw new Error("应当压缩成功");
    const messages = buildChatMessages(store.load(SESSION));
    expect(result.tokensBefore).toBeGreaterThan(0);
    // 本地估算兜底值 ≥ 纯内容字符的粗估（保守方向），且为整数（E12）
    expect(Number.isInteger(result.tokensBefore)).toBe(true);
    expect(result.tokensBefore).toBeGreaterThanOrEqual(
      "问题内容回答内容".length / 4, // 基础密度下限
    );
    void messages;
  });

  it("revert 有效视窗：被 revert 的内容不进摘要覆盖区间", async () => {
    const store = new SessionStore();
    store.append(SESSION, turnEvents(1, "被撤销的问题", "被撤销的回答"));
    store.append(SESSION, [
      { type: "session/revert", turn: 1, targetSeq: 1, phase: "revert" }, // 只留 turn/start
    ]);
    const engine = new CompactionEngine({
      sessionId: SESSION,
      store,
      summarizer: scriptedSummarizer("s"),
    });
    const result = await engine.run({ turn: 1, phase: "PreTurn", request: localOverflowRequest });
    if (result.kind !== "compacted") throw new Error("应当压缩成功");
    // 有效视窗只剩 seq ≤ 1 的事件（无消息边界）→ 全摘要：retainedTail = 视窗内
    // 最后一条事件的 seq（=1，即被撤销内容不进摘要覆盖区间）
    expect(result.retainedTail).toBe(1);
  });
});
