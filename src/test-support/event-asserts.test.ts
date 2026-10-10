import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../kernel/events.js";
import { ScriptedProvider, makeLoop } from "../core/primitives/loop/loop.test-utils.js";
import {
  drainUntil,
  expectPaired,
  expectSingleTerminal,
  expectTurnScoped,
  recvWithTimeout,
} from "./event-asserts.js";
import { createSnapshotter, snapshotToString } from "./snapshots.js";

/** 真 loop 剧本：step1 要工具、step2 空手——两步一收的典型事件流。 */
async function runTwoStepTurn() {
  const provider = new ScriptedProvider();
  provider.mount([
    { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: '{"cmd":"ls"}' },
    { type: "usage", usage: { inputTokens: 3, outputTokens: 2 } },
    { type: "done" },
  ]);
  provider.mount([{ type: "text-delta", text: "完成" }, { type: "done" }]);
  const { loop, store } = makeLoop(provider);
  const reason = await loop.runTurn("列目录");
  expect(reason).toEqual({ kind: "completed" });
  return { events: store.load("s1"), requests: provider.requests };
}

describe("事件流不变量断言（O7）——在真实 loop 流上", () => {
  it("验收：同 turn 共享轮号 / step 成对 / tool 配平 / 终态恰一，全部通过", async () => {
    const { events } = await runTwoStepTurn();
    // 不变量方法（不是事件列表断言）——新增事件类型不需要改这里
    expectTurnScoped(events);
    expectPaired(events, "step/start");
    expectPaired(events, "tool/call");
    expectSingleTerminal(events);
    expectSingleTerminal(events, 1);
  });

  it("断列流给可读失败（O9）：step 未闭合、孤儿 tool/result、双终态、终态后有事件、悬挂轮、跳号", async () => {
    // step/start 无 step/end
    const brokenStep = [
      { type: "turn/start", seq: 1, ts: 1, turn: 1 },
      { type: "step/start", seq: 2, ts: 2, turn: 1, step: 1 },
    ] as unknown as SessionEvent[];
    expect(() => expectPaired(brokenStep, "step/start")).toThrow(
      /1 个 step 未闭合：turn\/step 1:1（开启于 seq=2）——step\/start 与 step\/end 必须成对/,
    );

    // tool/result 无前置 tool/call
    const orphanResult = [
      { type: "turn/start", seq: 1, ts: 1, turn: 1 },
      { type: "step/start", seq: 2, ts: 2, turn: 1, step: 1 },
      { type: "tool/result", seq: 3, ts: 3, turn: 1, step: 1, callId: "c9", message: { content: "x" } },
    ] as unknown as SessionEvent[];
    expect(() => expectPaired(orphanResult, "tool/call")).toThrow(
      /tool\/result 的 callId=c9（seq=3）没有前置 tool\/call——调用与结果必须按 callId 配平/,
    );

    // 两条 turn/end
    const doubleTerminal = [
      { type: "turn/start", seq: 1, ts: 1, turn: 1 },
      { type: "turn/end", seq: 2, ts: 2, turn: 1, reason: { kind: "completed" } },
      { type: "turn/end", seq: 3, ts: 3, turn: 1, reason: { kind: "error", error: { code: "X", message: "y" } } },
    ] as unknown as SessionEvent[];
    expect(() => expectSingleTerminal(doubleTerminal)).toThrow(
      /事件流出现 2 条 turn\/end（seq=2、seq=3）——终止记录必须恰一条/,
    );

    // 终态之后同轮还有事件
    const tailAfterTerminal = [
      { type: "turn/start", seq: 1, ts: 1, turn: 1 },
      { type: "turn/end", seq: 2, ts: 2, turn: 1, reason: { kind: "completed" } },
      { type: "step/start", seq: 3, ts: 3, turn: 1, step: 1 },
    ] as unknown as SessionEvent[];
    expect(() => expectSingleTerminal(tailAfterTerminal)).toThrow(
      /终态（seq=2）之后仍有 1 条同轮事件：step\/start@seq=3——终态必须是该轮最后一条事件/,
    );

    // 悬挂轮（无 turn/end）
    const dangling = [
      { type: "turn/start", seq: 1, ts: 1, turn: 1 },
    ] as unknown as SessionEvent[];
    expect(() => expectTurnScoped(dangling)).toThrow(
      /事件流结束时 turn 1 仍开启（没有 turn\/end）——悬挂轮/,
    );

    // step 跳号 + 轮号跳号
    const stepJump = [
      { type: "turn/start", seq: 1, ts: 1, turn: 1 },
      { type: "step/start", seq: 2, ts: 2, turn: 1, step: 3 },
    ] as unknown as SessionEvent[];
    expect(() => expectTurnScoped(stepJump)).toThrow(
      /turn 1 的 step\/start 跳号：期望 step 1，实际 3（seq=2）/,
    );
    const turnJump = [
      { type: "turn/start", seq: 1, ts: 1, turn: 2 },
    ] as unknown as SessionEvent[];
    expect(() => expectTurnScoped(turnJump)).toThrow(/turn\/start 跳号：期望 turn 1，实际 turn 2/);
  });
});

describe("recv 超时与收集（O8）", () => {
  it("recvWithTimeout：命中即返回；不命中在时限内给具名可读失败；流提前结束也给可读失败", async () => {
    async function* source() {
      yield 1;
      yield 42;
      yield 3;
    }
    await expect(recvWithTimeout(source(), (n) => n === 42, "答案", 1_000)).resolves.toBe(42);

    async function* never() {
      yield 1;
      await new Promise(() => {});
    }
    await expect(recvWithTimeout(never(), () => false, "永不到来", 50)).rejects.toThrow(
      /等待「永不到来」超时（>50ms）——事件驱动测试最坏的失败是挂住/,
    );

    async function* ends() {
      yield 1;
    }
    await expect(recvWithTimeout(ends(), () => false, "被截断的流", 1_000)).rejects.toThrow(
      /事件流在等到「被截断的流」之前已结束/,
    );
  });

  it("drainUntil：收集到终态为止（含终态），超时消息带已收集条数", async () => {
    async function* source() {
      yield "a";
      yield "b";
      yield "END";
      yield "不该被收";
    }
    const { items, last } = await drainUntil(source(), (s) => s === "END", "END", 1_000);
    expect(items).toEqual(["a", "b", "END"]);
    expect(last).toBe("END");

    async function* noEnd() {
      yield "x";
      await new Promise(() => {});
    }
    await expect(drainUntil(noEnd(), () => false, "终点", 50)).rejects.toThrow(
      /等待「终点」超时（>50ms，已收集 1 条）/,
    );
  });

  it("真实进程协议流上的 drainUntil（agent-process 同款形态经事件断言复用）", async () => {
    // 用会话事件模拟协议流：drainUntil 对任意 AsyncIterable 生效
    const { events } = await runTwoStepTurn();
    async function* stream() {
      for (const e of events) yield e;
    }
    const { items, last } = await drainUntil(
      stream(),
      (e): e is SessionEvent => e.type === "turn/end",
      "turn/end",
      1_000,
    );
    expect(last).toMatchObject({ type: "turn/end", turn: 1 });
    expect(items.length).toBe(events.length);
  });
});

describe("窗口头与 previous 差分（O10/O11）——真实 loop 的两次模型调用", () => {
  it("快照自带 header（为何在此结束）与 previous（差分序列化时现算）", async () => {
    const { events, requests } = await runTwoStepTurn();
    const snap = createSnapshotter();
    const asCall = (req: (typeof requests)[number]) => ({
      system: "",
      tools: [],
      messages: req.messages as unknown[],
    });
    const first = snap(asCall(requests[0]!), undefined, {
      whyEnded: "step 1 结束：模型要了工具，窗口由工具结果续",
      cutAt: events.find((e) => e.type === "tool/result")?.seq,
    });
    const second = snap(asCall(requests[1]!), first.input, {
      whyEnded: "轮终态：completed",
      cutAt: events.at(-1)?.seq,
    });

    // O10：窗口头在快照里、进序列化文本
    expect(second.header.whyEnded).toBe("轮终态：completed");
    expect(snapshotToString(second)).toContain("轮终态：completed");
    // 未写头时缺省值大声提醒（O10 是"必须记录"）
    expect(snapshotToString(snap(asCall(requests[0]!)))).toContain("未说明窗口为何在此结束");

    // O11：previous 自带、差分序列化时现算——第二次调用比第一次多了 tool 消息
    expect(second.previous).not.toBeNull();
    expect(second.input.messages.length).toBeGreaterThan(first.input.messages.length);
    expect(snapshotToString(second)).not.toBe(snapshotToString(first));
  });
});
