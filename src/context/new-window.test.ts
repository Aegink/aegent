/**
 * T-7-03 验收（F22/F23）：
 * ① 压缩后投影里"注入的系统提示"仍在且不被摘要改写；
 * ② 新窗口首请求的消息集 = 保留规则产出的集合（逐条断言）；
 * ③ F23 developer 注入消息独立预算（从新到旧保留、至少保一条）；
 * ④ F22 "压缩那一刻"现算语义：压缩后追加的新事件自然进入重建结果；
 *    只认最新压缩；revert 掉压缩即全量重建。
 */

import { describe, expect, it } from "vitest";
import type { NewSessionEvent } from "../kernel/events.js";
import {SessionEventStore, type SessionStore} from "../session/store.js";
import { buildChatMessages } from "../session/messages.js";
import { CompactionEngine } from "./compaction.js";
import { DEFAULT_DEVELOPER_BUDGET_TOKENS, startNewContextWindow } from "./new-window.js";

const SESSION = "s-new-window";

function run() {
  return new SessionEventStore();
}

/** 组一条完整 turn；allowInjected 控制是否插入 injected user 消息。 */
function turnEvents(
  turn: number,
  user: string,
  assistant: string,
  extra: NewSessionEvent[] = [],
): NewSessionEvent[] {
  return [
    { type: "turn/start", turn },
    ...extra,
    { type: "user/message", turn, message: { content: user }, source: "user" },
    { type: "step/start", turn, step: 1 },
    { type: "assistant/message", turn, step: 1, message: { content: assistant }, stream: [] },
    { type: "step/end", turn, step: 1 },
    { type: "turn/end", turn, reason: { kind: "completed" } },
  ];
}

async function compact(store: SessionStore, turn: number): Promise<void> {
  const engine = new CompactionEngine({
    sessionId: SESSION,
    store,
    summarizer: async () => "此前对话：用户讨论了 X 与 Y，得出结论 Z。",
  });
  const result = await engine.run({
    turn,
    phase: "PreTurn",
    request: { reason: "local-overflow", estimatedTokens: 9000, contextWindow: 8000 },
  });
  if (result.kind !== "compacted") throw new Error("压缩应当成功");
}

describe("无压缩 / 基线", () => {
  it("没有 compaction 事件 → 全量现算（与 buildChatMessages 等价），不抛错", () => {
    const store = run();
    store.append(SESSION, turnEvents(1, "q1", "a1"));
    const messages = startNewContextWindow(store.load(SESSION));
    expect(messages).toEqual(buildChatMessages(store.load(SESSION)));
  });
});

describe("验收①：注入的系统提示不被摘要改写", () => {
  it("摘要覆盖区间内的 system/message 原文保留，且不混入摘要文本", async () => {
    const store = run();
    store.append(SESSION, [
      { type: "turn/start", turn: 1 },
      { type: "step/start", turn: 1, step: 1 },
      { type: "system/message", turn: 1, step: 1, message: { content: "你是代码助手" } },
      { type: "user/message", turn: 1, message: { content: "q1" }, source: "user" },
      { type: "assistant/message", turn: 1, step: 1, message: { content: "a1" }, stream: [] },
      { type: "step/end", turn: 1, step: 1 },
      { type: "turn/end", turn: 1, reason: { kind: "completed" } },
    ]);
    await compact(store, 1);
    const messages = startNewContextWindow(store.load(SESSION));
    const systemMsg = messages.find((m) => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toBe("你是代码助手"); // 原文逐字，未被摘要改写
    const summaryMsg = messages.find((m) => m.content.includes("会话压缩摘要"));
    expect(summaryMsg).toBeDefined();
    expect(systemMsg!.content).not.toContain("会话压缩摘要");
  });
});

describe("验收②：新窗口消息集逐条断言", () => {
  it("组成顺序 = [system(若有)] → [摘要] → [developer 注入(预算内)] → [保留尾部]", async () => {
    const store = run();
    store.append(SESSION, [
      { type: "turn/start", turn: 1 },
      {
        type: "user/message",
        turn: 1,
        message: { content: "环境上下文：测试目录 /tmp/demo" },
        source: "injected",
      },
      { type: "user/message", turn: 1, message: { content: "第一问" }, source: "user" },
      { type: "step/start", turn: 1, step: 1 },
      { type: "system/message", turn: 1, step: 1, message: { content: "系统提示" } },
      { type: "assistant/message", turn: 1, step: 1, message: { content: "答一" }, stream: [] },
      { type: "step/end", turn: 1, step: 1 },
      { type: "turn/end", turn: 1, reason: { kind: "completed" } },
      { type: "turn/start", turn: 2 },
      { type: "user/message", turn: 2, message: { content: "第二问" }, source: "user" },
      { type: "turn/end", turn: 2, reason: { kind: "completed" } },
    ]);
    await compact(store, 2);
    const messages = startNewContextWindow(store.load(SESSION));
    // retainedTail = "第二问" 前一条 → 保留尾部 = [第二问]
    expect(messages.map((m) => (m.role === "tool" ? "tool" : `${m.role}:${m.content}`))).toEqual([
      "system:系统提示",
      expect.stringContaining("会话压缩摘要"),
      "user:环境上下文：测试目录 /tmp/demo",
      "user:第二问",
    ]);
    // 摘要文本来自最新 compaction 事件
    const summaryContent = messages[1]!.content;
    expect(summaryContent).toContain("得出结论 Z");
  });

  it("压缩后追加的新事件（seq > retainedTail）自然进入新窗口（F22 现算，不用压缩前快照）", async () => {
    const store = run();
    store.append(SESSION, turnEvents(1, "旧问题", "旧回答"));
    // 真实压缩时点（PreTurn）：下一轮 prompt 已入流、模型请求前——压缩保留
    // 的尾部 = 下一轮 user 起的原文
    store.append(SESSION, turnEvents(2, "压缩后的新问题", "新回答"));
    await compact(store, 2);
    // 压缩之后又有新轮（seq > retainedTail）
    store.append(SESSION, turnEvents(3, "更新的一问", "更新的一答"));
    const messages = startNewContextWindow(store.load(SESSION));
    // [摘要, t2 user, t2 assistant, t3 user, t3 assistant]
    expect(messages).toHaveLength(5);
    expect(messages[0]!.content).toContain("会话压缩摘要");
    expect(messages[1]).toMatchObject({ role: "user", content: "压缩后的新问题" });
    expect(messages[2]).toMatchObject({ role: "assistant", content: "新回答" });
    expect(messages[3]).toMatchObject({ role: "user", content: "更新的一问" });
    expect(messages[4]).toMatchObject({ role: "assistant", content: "更新的一答" });
  });
});

describe("验收③（F23）：developer 注入消息独立预算", () => {
  function withInjected(count: number, content: string): NewSessionEvent[] {
    const extra: NewSessionEvent[] = [];
    for (let i = 0; i < count; i++) {
      extra.push({
        type: "user/message",
        turn: 1,
        message: { content: `${content}#${i}` },
        source: "injected",
      });
    }
    return turnEvents(1, "q", "a", extra);
  }

  it("预算充足 → 全部保留（默认预算常量在位）", async () => {
    const store = run();
    store.append(SESSION, withInjected(3, "注入"));
    await compact(store, 1);
    const messages = startNewContextWindow(store.load(SESSION));
    const injected = messages.filter((m) => m.role === "user" && m.content.startsWith("注入"));
    expect(injected).toHaveLength(3);
    expect(DEFAULT_DEVELOPER_BUDGET_TOKENS).toBeGreaterThan(0);
  });

  it("预算紧张 → 从新到旧保留；最新一条超预算也保留（至少保一条）", async () => {
    const store = run();
    store.append(SESSION, withInjected(4, "注入消息内容"));
    await compact(store, 1);
    // 预算只够 2 条（每条约 5 token 级别的内容 + 本地估算放大）
    const messages = startNewContextWindow(store.load(SESSION), { developerBudgetTokens: 8 });
    const injected = messages.filter((m) => m.role === "user" && m.content.startsWith("注入"));
    expect(injected.length).toBeGreaterThanOrEqual(1);
    expect(injected.length).toBeLessThan(4);
    // 保留的是最新的（#2、#3），丢弃的是最旧的
    expect(injected.map((m) => m.content)).toContain("注入消息内容#3");
    expect(injected.map((m) => m.content)).not.toContain("注入消息内容#0");
  });

  it("source=user 的普通消息不享受 developer 预算（被摘要覆盖即不保留）", async () => {
    const store = run();
    // 两轮：t1 的普通 user 在摘要覆盖区间（t2 user 是保留尾部的边界）
    store.append(SESSION, turnEvents(1, "很老的普通问题", "旧回答"));
    store.append(SESSION, turnEvents(2, "新问题", "新回答"));
    await compact(store, 2);
    const messages = startNewContextWindow(store.load(SESSION));
    expect(messages.filter((m) => m.content === "很老的普通问题")).toHaveLength(0);
    expect(messages.filter((m) => m.content === "新问题")).toHaveLength(1);
  });
});

describe("多次压缩与 revert", () => {
  it("两次压缩只认最新 compaction（更早 compaction 在被摘要区间内）", async () => {
    const store = run();
    store.append(SESSION, turnEvents(1, "q1", "a1"));
    await compact(store, 1); // 压缩 1
    store.append(SESSION, turnEvents(2, "q2", "a2"));
    // 第二次压缩用不同摘要文本，覆盖到 q2 前
    const engine = new CompactionEngine({
      sessionId: SESSION,
      store,
      summarizer: async () => "第二次压缩摘要",
    });
    const r = await engine.run({
      turn: 2,
      phase: "PreTurn",
      request: { reason: "local-overflow", estimatedTokens: 9000, contextWindow: 8000 },
    });
    if (r.kind !== "compacted") throw new Error("第二次压缩应当成功");
    const messages = startNewContextWindow(store.load(SESSION));
    expect(messages.filter((m) => m.content.includes("会话压缩摘要"))).toHaveLength(1);
    expect(messages.find((m) => m.content.includes("第二次压缩摘要"))).toBeDefined();
    expect(messages.find((m) => m.content.includes("得出结论 Z"))).toBeUndefined();
  });

  it("revert 掉 compaction → 无压缩状态全量重建", async () => {
    const store = run();
    store.append(SESSION, turnEvents(1, "q1", "a1"));
    await compact(store, 1);
    const compactionSeq = store.load(SESSION).length;
    store.append(SESSION, [
      { type: "session/revert", turn: 1, targetSeq: compactionSeq - 1, phase: "revert" },
    ]);
    const messages = startNewContextWindow(store.load(SESSION));
    expect(messages.filter((m) => m.content.includes("会话压缩摘要"))).toHaveLength(0);
    expect(messages).toEqual(
      buildChatMessages(store.load(SESSION).filter((e) => e.seq <= compactionSeq - 1)),
    );
  });
});
// ---------------------------------------------------------------------------
// 缓存锚与前缀保真（F6/F13/F15 / T-P1-19）：换模锚不变 + 压缩 cache-safe
// ---------------------------------------------------------------------------

import { ScriptedProvider, makeLoop } from "../kernel/loop.test-utils.js";
import {
  computeCacheAnchor,
  type PrefixChange,
} from "./prefix-anchor.js";

describe("缓存锚与前缀保真（F6/F13 / T-P1-19）", () => {
  const TOOLS = [
    { name: "read", description: "读文件", parameters: { type: "object", properties: {} } },
  ];

  it("验收①锚稳定：换模前后 system/tools 块逐字节不变（锚检测零通知）", async () => {
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "答一" }, { type: "done" }]);
    provider.mount([{ type: "text-delta", text: "答二" }, { type: "done" }]);
    const changes: PrefixChange[] = [];
    const { loop, store } = makeLoop(provider, {
      // 换模：turn 2 用 m-1、turn 3 用 m-2（J6 modelForTurn 捕获面）
      modelForTurn: (turn) => ({
        provider,
        identity:
          turn === 2
            ? { provider: "mock", modelId: "m-1" }
            : { provider: "mock", modelId: "m-2" },
      }),
      onCacheAnchorChange: (c) => changes.push(c),
    });
    // 预置 turn 1（含 system 消息，锚的一部分在流内）→ runTurn 从 turn 2 起
    store.append("s1", [
      { type: "turn/start", turn: 1 },
      { type: "step/start", turn: 1, step: 1 },
      { type: "system/message", turn: 1, step: 1, message: { content: "你是代码助手" } },
      { type: "step/end", turn: 1, step: 1 },
      { type: "turn/end", turn: 1, reason: { kind: "completed" } },
    ]);

    await loop.runTurn("问一"); // turn 2 · m-1
    await loop.runTurn("问二"); // turn 3 · m-2（换模发生）

    // 换模但锚逐字节不变 → 零通知（identical 静默——F13 换模不作废前缀）
    expect(changes).toEqual([]);
    // wire 级逐字节：两次请求 system 消息与 tools 完全一致，身份确实切换
    const [r1, r2] = provider.requests;
    expect(r1!.identity).toEqual({ provider: "mock", modelId: "m-1" });
    expect(r2!.identity).toEqual({ provider: "mock", modelId: "m-2" });
    expect(r1!.messages.find((m) => m.role === "system")).toEqual(
      r2!.messages.find((m) => m.role === "system"),
    );
    expect(r1!.tools).toEqual(r2!.tools);
  });

  it("验收②压缩 cache-safe：新窗口保留锚（system+tools 逐字节不变，摘要只替换中段）", async () => {
    const store = run();
    store.append(SESSION, [
      { type: "turn/start", turn: 1 },
      { type: "step/start", turn: 1, step: 1 },
      { type: "system/message", turn: 1, step: 1, message: { content: "你是代码助手" } },
      { type: "user/message", turn: 1, message: { content: "长任务开始" }, source: "user" },
      { type: "assistant/message", turn: 1, step: 1, message: { content: "进展 A" }, stream: [] },
      { type: "step/end", turn: 1, step: 1 },
      { type: "turn/end", turn: 1, reason: { kind: "completed" } },
    ]);
    store.append(SESSION, turnEvents(2, "第二轮", "进展 B"));
    // 压缩前的请求锚（system + tools）
    const beforeMessages = buildChatMessages(store.load(SESSION));
    const beforeAnchor = computeCacheAnchor(
      beforeMessages.find((m) => m.role === "system")?.content,
      TOOLS,
    );

    await compact(store, 2);
    const afterMessages = startNewContextWindow(store.load(SESSION));
    const afterAnchor = computeCacheAnchor(
      afterMessages.find((m) => m.role === "system")?.content,
      TOOLS,
    );
    // F15"压缩不作废缓存"：锚逐字节不变——system 原文保留在首位，摘要
    // 只替换会话体中段（锚不含会话体）
    expect(afterAnchor).toBe(beforeAnchor);
    expect(afterMessages[0]).toMatchObject({ role: "system", content: "你是代码助手" });
    expect(afterMessages[1]!.content).toContain("会话压缩摘要");
  });
});
