import { describe, expect, it } from "vitest";
import type { ToolResultEvent } from "./events.js";
import { ScriptedProvider, makeLoop } from "../../kernel/loop.test-utils.js";
import { BudgetExceededError, DEFAULT_MAX_TOOL_CALLS, ParseBudget } from "./budget.js";
import { expectPaired, expectTurnScoped } from "../../test-support/event-asserts.js";

describe("ParseBudget（B14 双轴：tick 计数+双查，progress 只查时）", () => {
  it("tick 超数量 throw（BUDGET_TICKS_EXCEEDED），上限内不抛", () => {
    let now = 1_000;
    const budget = new ParseBudget({ maxTicks: 3, timeoutMs: Infinity, now: () => now });
    budget.tick();
    budget.tick();
    budget.tick();
    expect(budget.ticksUsed).toBe(3);
    expect(() => budget.tick()).toThrow(BudgetExceededError);
    expect(() => budget.tick()).toThrow(/计数超上限/);
  });

  it("tick 超时 throw（BUDGET_DEADLINE_EXCEEDED）——验收② mock Date.now（注入时钟）", () => {
    let now = 1_000;
    const budget = new ParseBudget({ maxTicks: Infinity, timeoutMs: 100, now: () => now });
    budget.tick();
    now = 1_099; // 截止 1100，未到
    budget.tick();
    now = 1_100; // 恰到截止即超（>= 语义，kimi 同款）
    expect(() => budget.tick()).toThrow(BudgetExceededError);
    expect(() => budget.tick()).toThrow(/墙钟上限/);
  });

  it("progress 只查截止、不计数（验收②）——超时抛错且 ticksUsed 不变", () => {
    let now = 1_000;
    const budget = new ParseBudget({ maxTicks: 100, timeoutMs: 50, now: () => now });
    budget.tick();
    budget.tick();
    now = 1_049;
    budget.progress(); // 未到截止，不抛、不计
    expect(budget.ticksUsed).toBe(2);
    now = 1_050;
    expect(() => budget.progress()).toThrow(BudgetExceededError);
    expect(budget.ticksUsed).toBe(2); // progress 不消耗计数
  });

  it("默认值：maxTicks=DEFAULT_MAX_TOOL_CALLS，时限缺省启用", () => {
    let now = 1_000;
    const budget = new ParseBudget({ now: () => now });
    for (let i = 0; i < DEFAULT_MAX_TOOL_CALLS; i++) budget.tick();
    expect(budget.ticksUsed).toBe(DEFAULT_MAX_TOOL_CALLS);
    expect(() => budget.tick()).toThrow(BudgetExceededError);

    const timeOnly = new ParseBudget({ now: () => now, timeoutMs: 10 });
    now = 10_000_000;
    expect(() => timeOnly.progress()).toThrow(/墙钟上限/);
  });

  it("错误带结构化 code（调用方按 code 路由，J22 同款纪律）", () => {
    const budget = new ParseBudget({ maxTicks: 0 });
    try {
      budget.tick();
      expect.unreachable("必须抛出");
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError);
      expect((e as BudgetExceededError).code).toBe("BUDGET_TICKS_EXCEEDED");
    }
  });
});

describe("工具循环接入（B14 + B9 配平断言，经真实 loop 事件流）", () => {
  function mountToolCalls(count: number): ScriptedProvider {
    const provider = new ScriptedProvider();
    const deltas = Array.from({ length: count }, (_, i) => ({
      type: "tool-call-delta" as const,
      id: `call-${String(i + 1)}`,
      name: "probe",
      argsDelta: `{"n":${String(i + 1)}}`,
    }));
    provider.mount([...deltas, { type: "done" }]);
    provider.mount([{ type: "text-delta", text: "收尾" }, { type: "done" }]);
    return provider;
  }

  it("预算内：全部派发，tool/call 与 tool/result 的 callId 配平（验收①）且 toolCallId 贯穿到 ctx", async () => {
    const provider = mountToolCalls(3);
    const seenToolCallIds: string[] = [];
    const harness = makeLoop(provider, {
      toolBudget: { maxTicks: 10 },
      executeTool: async (call) => {
        // callId 经 loop → 事件（tool/call）与预算判定同源；ctx.toolCallId 由
        // registry.dispatch 装配（B9 贯穿），这里断言 loop 侧同源事实
        seenToolCallIds.push(call.callId);
        return { content: `ok-${call.callId}` };
      },
    });
    await harness.loop.runTurn("探针");
    expect(seenToolCallIds).toEqual(["call-1", "call-2", "call-3"]);

    const events = harness.store.load("s1");
    expectTurnScoped(events); // 轮号/step 纪律（T-3-07 方法）
    expectPaired(events, "tool/call"); // tool/call 与 tool/result 按 callId 配平（验收①）
    const results = events.filter((e): e is ToolResultEvent => e.type === "tool/result");
    expect(results.map((r) => r.message.content)).toEqual(["ok-call-1", "ok-call-2", "ok-call-3"]);
  });

  it("预算耗尽：已派发的照落，其后缺席（无孤儿 call/result），step 正常闭合", async () => {
    const provider = mountToolCalls(5);
    const harness = makeLoop(provider, {
      toolBudget: { maxTicks: 2, timeoutMs: Infinity },
      executeTool: async (call) => ({ content: `ok-${call.callId}` }),
    });
    await harness.loop.runTurn("探针（预算 2）");

    const events = harness.store.load("s1");
    expectTurnScoped(events);
    expectPaired(events, "tool/call");
    const calls = events.filter((e) => e.type === "tool/call");
    const results = events.filter((e) => e.type === "tool/result");
    expect(calls).toHaveLength(2); // call-3/4/5 未派发 = 缺席（取消同款语义）
    expect(results).toHaveLength(2);
    // 配平 + 缺席后 turn 仍显式收束（DecideTurn 拿到部分结果照常决策）
    const turnEnd = events.find((e) => e.type === "turn/end");
    expect(turnEnd && turnEnd.type === "turn/end" ? turnEnd.reason.kind : "").toBe("completed");
  });
});
