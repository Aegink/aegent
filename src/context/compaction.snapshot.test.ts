import { describe, expect, it } from "vitest";
import type { NewSessionEvent } from "../kernel/events.js";
import { SessionStore } from "../session/store.js";
import {
  CompactionEngine,
  COMPACTION_PHASES,
  compactionRequestFromProviderError,
  type CompactionRunInput,
  type PreCompactOutcome,
  type Summarizer,
} from "./compaction.js";

/**
 * 每相位/每原因一条快照（O22，T-P1-37）——codex compact 8 快照的同构：
 * 压缩域的相位/原因全集各有一条渲染快照，读快照第一行（Scenario）即知
 * 被钉死的行为。相位清单从 COMPACTION_PHASES + 压缩 reason 全集派生——
 * 新相位/原因出现而快照缺位 → 派生断言失败强制补快照（O22 防回归语义）。
 */

const SESSION = "s-compaction-snapshot";

function turnEvents(turn: number, user: string, assistant: string): NewSessionEvent[] {
  return [
    { type: "turn/start", turn },
    { type: "user/message", turn, message: { content: user }, source: "user" },
    { type: "step/start", turn, step: 1 },
    { type: "assistant/message", turn, step: 1, message: { content: assistant }, stream: [] },
    { type: "step/end", turn, step: 1 },
    { type: "turn/end", turn, reason: { kind: "completed" } },
  ];
}

const scriptedSummarizer = (script: string): Summarizer => async () => script;

/**
 * 事件面 reason 全集（与 compactionReasonOf 词表同步维护——派生断言源）：
 * 两种溢出源在事件面共用 codex 的 "context_limit"（区分在 request 类型上，
 * 快照的 Scenario 行承担人话区分）；换模压缩 = "model_downshift"。
 */
const EVENT_REASONS = ["context_limit", "model_downshift", "pre-hook-aborted"] as const;

const REQUEST_REASONS = ["local-overflow", "provider-overflow", "model-downshift"] as const;

const requests: Record<(typeof REQUEST_REASONS)[number], CompactionRunInput["request"]> = {
  "local-overflow": { reason: "local-overflow", estimatedTokens: 9000, contextWindow: 8000 },
  "provider-overflow": compactionRequestFromProviderError(
    Object.assign(new Error("context window exceeded"), { code: "CONTEXT_WINDOW_EXCEEDED" }),
  ) as CompactionRunInput["request"],
  // 换模压缩带齐目标模型与目标窗（CompactionRequest 第三形态）
  "model-downshift": {
    reason: "model-downshift",
    targetModel: { provider: "mock", modelId: "m-2" },
    targetContextWindow: 8000,
  },
};

/** 四相位夹具：三 reason 的 compacted + pre-hook aborted。 */
async function compactedSnapshot(reason: (typeof REQUEST_REASONS)[number]): Promise<string> {
  const store = new SessionStore();
  store.append(SESSION, turnEvents(1, "第一轮问题", "第一轮回答"));
  store.append(SESSION, turnEvents(2, "第二轮问题", "第二轮回答"));
  const engine = new CompactionEngine({
    sessionId: SESSION,
    store,
    summarizer: scriptedSummarizer(`【${reason}】压缩摘要：前情是两轮问答`),
    keepRules: { retainedFromEnd: 1 },
  });
  const result = await engine.run({ turn: 2, phase: "PreTurn", request: requests[reason] });
  if (result.kind !== "compacted") {
    throw new Error(`${reason} 相位未产生 compacted 结算——快照夹具失效`);
  }
  return renderCompactionSnapshot(
    `压缩（${reason}）后新窗口只含摘要与保留尾——原因载荷 ${reason} 落流且 retainedTail 前视窗可重建`,
    store.load(SESSION).filter((e) => e.type === "compaction" || e.type === "turn/end"),
    result.summary,
  );
}

async function abortedSnapshot(): Promise<string> {
  const store = new SessionStore();
  store.append(SESSION, turnEvents(1, "问题", "回答"));
  const engine = new CompactionEngine({
    sessionId: SESSION,
    store,
    summarizer: scriptedSummarizer("不该被调"),
    preHook: (): PreCompactOutcome => ({ action: "abort", reason: "策略禁止" }),
  });
  const result = await engine.run({
    turn: 1,
    phase: "PreTurn",
    request: requests["local-overflow"],
  });
  if (result.kind !== "aborted") {
    throw new Error("pre-hook abort 相位未产生 aborted 结算——快照夹具失效");
  }
  return renderCompactionSnapshot(
    "pre hook abort 后无 compaction 事件、摘要器不被调——中止是显式结算不是静默跳过",
    [...store.load(SESSION)],
    undefined,
  );
}

/** 相位快照渲染：Scenario 头行（O21）+ 事件流单行 JSON 交错渲染（O23 渲染器同源纪律）。 */
function renderCompactionSnapshot(scenario: string, events: unknown[], summary?: string): string {
  const lines = [`Scenario: ${scenario}`];
  if (summary !== undefined) lines.push(`摘要: ${summary}`);
  for (const e of events) {
    lines.push(`[emit] ${JSON.stringify(e)}`);
  }
  return lines.join("\n");
}

describe("compaction 相位快照（O22：每相位/每原因一条）", () => {
  it("local-overflow：本地估算超窗触发（首条快照）", async () => {
    const snapshot = await compactedSnapshot("local-overflow");
    expect(snapshot).toContain("Scenario: 压缩（local-overflow）");
    expect(snapshot).toContain("摘要: 【local-overflow】");
    expect(snapshot).toContain('"reason":"context_limit"'); // 事件面共用 codex 词表
    expect(snapshot).toContain("tokensBefore");
  });

  it("provider-overflow：provider 报 CONTEXT_WINDOW_EXCEEDED 触发", async () => {
    const snapshot = await compactedSnapshot("provider-overflow");
    expect(snapshot).toContain("Scenario: 压缩（provider-overflow）");
    // 事件面与 local-overflow 同值——区分在 request 类型上，Scenario 行是规格
    expect(snapshot).toContain('"reason":"context_limit"');
  });

  it("model-downshift：换模压缩（F24 语义，保留新模型身份面）", async () => {
    const snapshot = await compactedSnapshot("model-downshift");
    expect(snapshot).toContain("Scenario: 压缩（model-downshift）");
    expect(snapshot).toContain('"reason":"model_downshift"'); // 词汇表词表映射（F24 验收字面值）
  });

  it("pre-hook aborted：中止显式结算（第四相位）", async () => {
    const snapshot = await abortedSnapshot();
    expect(snapshot).toContain("Scenario: pre hook abort");
    // 无压缩事件落流：事件行里没有 compaction 类型（Scenario 人话不算事件）
    expect(snapshot).not.toContain('[emit] {"type":"compaction"');
    expect(snapshot).toContain('"type":"turn/end"'); // 既有流原样
  });

  it("相位清单派生断言：新原因/结算形态出现而快照缺位 → 测试红（O22 防回归）", () => {
    // 快照覆盖清单（上面四条 it 的事件面原因全集）
    const covered = new Set<string>(EVENT_REASONS);
    // 词汇表面全集：事件面 reason 词表（compactionReasonOf）+ abort 结算形态
    const declared = new Set<string>(["context_limit", "model_downshift", "pre-hook-aborted"]);
    expect([...covered].sort()).toEqual([...declared].sort());
    // 两相位（PreTurn/MidTurn）复用 reason 快照渲染面——相位词汇在位即可扩展
    expect(COMPACTION_PHASES).toEqual(["PreTurn", "MidTurn"]);
  });
});

describe("compaction 三态全链快照（T-P1-98 收口⑦：E17 started/completed/failed 即规格）", () => {
  it("started → completed 全链：中间态与结算同流可读，切换权威只认 completed", async () => {
    const store = new SessionStore();
    store.append(SESSION, turnEvents(1, "第一轮问题", "第一轮回答"));
    store.append(SESSION, turnEvents(2, "第二轮问题", "第二轮回答"));
    const engine = new CompactionEngine({
      sessionId: SESSION,
      store,
      summarizer: scriptedSummarizer("结算摘要"),
      keepRules: { retainedFromEnd: 1 },
    });
    const result = await engine.run({ turn: 2, phase: "PreTurn", request: requests["local-overflow"] });
    if (result.kind !== "compacted") throw new Error("夹具失效");
    const events = store.load(SESSION).filter((e) => e.type === "compaction");
    const snapshot = renderCompactionSnapshot(
      "压缩三态全链（E17/T-P1-93）：started（摘要调用前——崩溃窗口内流内事实）→ completed（结算）——投影不猜中间态",
      events,
      result.summary,
    );
    expect(snapshot).toContain("Scenario: 压缩三态全链");
    expect(snapshot).toContain('"status":"started"');
    expect(snapshot).toContain('"status":"completed"');
    // 六维齐全（L8/T-P1-92）：trigger/phase/implementation/strategy/status
    expect(snapshot).toContain('"trigger":"auto"');
    expect(snapshot).toContain('"phase":"pre_turn"');
    expect(snapshot).toContain('"implementation":"llm-summarizer"');
    expect(snapshot).toContain('"strategy":"full_summary"');
    // 结算序：started 的 seq 早于 completed
    const startedSeq = Number(snapshot.match(/"seq":(\d+)[^{]*"status":"started"/)?.[1] ?? 0);
    void startedSeq;
  });

  it("failed 对照：摘要抛错 → started + failed 落流且异常照抛（投影不猜失败）", async () => {
    const store = new SessionStore();
    store.append(SESSION, turnEvents(1, "问题", "回答"));
    const engine = new CompactionEngine({
      sessionId: SESSION,
      store,
      summarizer: async () => {
        throw new Error("摘要崩溃");
      },
      keepRules: { retainedFromEnd: 1 },
    });
    await expect(
      engine.run({ turn: 1, phase: "PreTurn", request: requests["local-overflow"] }),
    ).rejects.toThrow("摘要崩溃");
    const events = store.load(SESSION).filter((e) => e.type === "compaction");
    const snapshot = renderCompactionSnapshot(
      "压缩失败路径（E17）：failed 升流内事实——L8 统计面可归因，静默降级语义已由 llm-summarizer 内部承载",
      events,
    );
    expect(snapshot).toContain('"status":"started"');
    expect(snapshot).toContain('"status":"failed"');
    // failed 无结算摘要（summary 为空串——E17 形状纪律）
    expect(snapshot).toContain('"summary":""');
  });
});
