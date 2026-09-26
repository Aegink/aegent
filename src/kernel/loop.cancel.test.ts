import { describe, expect, it } from "vitest";

import type { CancelCause } from "./events.js";
import type { AgentLoop } from "./loop.js";
import { ScriptedProvider, makeLoop } from "./loop.test-utils.js";
import { expectSingleTerminal } from "../test-support/event-asserts.js";
import type { ModelProvider } from "../models/provider.js";

/**
 * A7 取消/中断 —— 语义取 dsh·explicit-turn-cancellation：
 * - 运行时 cause 与 durable 终态分离：cause 原对象活在运行期（transport 可扩展），
 *   落盘只拷声明字段；
 * - 协作式：loop 在 await 边界检查，不弃在途 promise；
 * - 中断是写入时记录的事实（interrupted 标记），不是读取时的推导；
 * - cause 绝不冻结（undici 会给 abort reason 赋 stack，冻结让真因变 TypeError）。
 */

/** 让 provider 在流中途拿到 loop 引用（先建 loop 后挂 provider 的回环）。 */
function loopRef(): { loop?: AgentLoop } {
  return {};
}

describe("AgentLoop.cancel —— A7 取消 / 中断当前 turn", () => {
  it("验收：流中途取消 → 恰一条 turn/end{aborted}、其后无该 turn 事件、前缀带 interrupted 标记", async () => {
    const ref = loopRef();
    const provider: ModelProvider = {
      async *streamChat() {
        yield { type: "text-delta", text: "前半" };
        ref.loop!.cancel({ kind: "user" });
        yield { type: "text-delta", text: "后半" };
        yield { type: "text-delta", text: "不该被消费" };
      },
    };
    const { loop, store, decideCalls } = makeLoop(provider);
    ref.loop = loop;

    const reason = await loop.runTurn("取消我");
    expect(reason).toEqual({ kind: "aborted", cause: { kind: "user" } });

    const events = store.load("s1");
    expect(events.map((e) => e.type)).toEqual([
      "turn/start",
      "user/message",
      "step/start",
      "request/header",
      "assistant/message",
      "step/end",
      "turn/end",
    ]);
    // 恰一条终止记录、位于流末——终态不变量由 T-3-07 断言方法承担
    expectSingleTerminal(events, 1);
    // 已交付前缀以 interrupted 标记落盘；其后 chunk 未被消费
    const msg = events.find((e) => e.type === "assistant/message") as {
      interrupted?: true;
      message: { content: string };
    };
    expect(msg.interrupted).toBe(true);
    expect(msg.message.content).toBe("前半后半");
    // 中断先于决策点：DecideTurn 未被询问
    expect(decideCalls).toHaveLength(0);
  });

  it("step 边界取消：已完整的 step 照常落盘（不伪造 interrupted 标记），轮以 aborted 收", async () => {
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "完整回答" }, { type: "done" }]);
    const ref = loopRef();
    let decided = 0;
    const { loop, store } = makeLoop(provider, {
      decideTurn: () => {
        decided += 1;
        if (decided === 1) ref.loop!.cancel({ kind: "user" });
        return { action: "continue" };
      },
    });
    ref.loop = loop;

    const reason = await loop.runTurn("两步走");
    expect(reason).toEqual({ kind: "aborted", cause: { kind: "user" } });
    const events = store.load("s1");
    const msg = events.find((e) => e.type === "assistant/message") as {
      interrupted?: true;
    };
    // step 完整走完，消息没有中断标记——标记只给真正被截断的流
    expect(msg.interrupted).toBeUndefined();
    expectSingleTerminal(events, 1);
  });

  it("decideTurn 裁决后取消：aborted 收轮而非 completed（取消优先于正常终态——A17/T-P1-46）", async () => {
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "只此一步" }, { type: "done" }]);
    const ref = loopRef();
    const { loop, store, decideCalls } = makeLoop(provider, {
      decideTurn: async () => {
        // 取消恰好落在裁决期间（await 边界内）——end 分支此前会把它以
        // completed 收轮吞掉（缺口复现），显式检查后取消优先。
        ref.loop!.cancel({ kind: "user" });
        return { action: "end" };
      },
    });
    ref.loop = loop;

    const reason = await loop.runTurn("裁决前取消");
    expect(reason).toEqual({ kind: "aborted", cause: { kind: "user" } });
    const end = store.load("s1").find((e) => e.type === "turn/end") as {
      reason: { kind: string };
    };
    expect(end.reason.kind).toBe("aborted");
    expectSingleTerminal(store.load("s1"), 1);
    expect(decideCalls).toHaveLength(1);
  });

  it("beforeFirstModelRequest 挂点后取消：首步前 aborted 收轮（A17/T-P1-46 await 后显式检查）", async () => {
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "不该被请求" }, { type: "done" }]);
    const ref = loopRef();
    const { loop, store } = makeLoop(provider, {
      beforeFirstModelRequest: async () => {
        ref.loop!.cancel({ kind: "user" });
      },
    });
    ref.loop = loop;

    const reason = await loop.runTurn("挂点后取消");
    expect(reason).toEqual({ kind: "aborted", cause: { kind: "user" } });
    // 零 step：挂点期间的取消不等 step 边界兜底
    expect(store.load("s1").some((e) => e.type === "step/start")).toBe(false);
    expect(provider.requests).toHaveLength(0);
    expectSingleTerminal(store.load("s1"), 1);
  });

  it("cause 落盘只拷声明字段：transport 污染的 stack 不进 durable 事件；原对象不冻结", async () => {
    const ref = loopRef();
    const cause: CancelCause = {
      kind: "hook",
      reason: { hook: "sec", code: "DENY" },
      message: "拒绝",
    };
    const provider: ModelProvider = {
      async *streamChat() {
        yield { type: "text-delta", text: "x" };
        ref.loop!.cancel(cause);
        // undici 语义模拟：transport 在 abort reason 上赋 stack
        (cause as { stack?: string }).stack = "assigned by fetch";
        yield { type: "text-delta", text: "y" };
      },
    };
    const { loop, store } = makeLoop(provider);
    ref.loop = loop;

    const reason = await loop.runTurn("带 hook 取消");
    expect(reason).toEqual({
      kind: "aborted",
      cause: { kind: "hook", reason: { hook: "sec", code: "DENY" }, message: "拒绝" },
    });
    // 运行期对象被 transport 扩展了（loop 没有冻结它）……
    expect((cause as { stack?: string }).stack).toBe("assigned by fetch");
    expect(Object.isFrozen(cause)).toBe(false);
    // ……但 durable 终态只含声明字段（无 stack——C14 也兜底拒绝它）
    const turnEnd = store.load("s1").at(-1) as {
      reason: { kind: string; cause: Record<string, unknown> };
    };
    expect(turnEnd.reason.kind).toBe("aborted");
    expect(Object.keys(turnEnd.reason.cause)).toEqual(["kind", "reason", "message"]);
  });

  it("first-wins：重复 cancel 只认第一次；idle 期 cancel 是 no-op，不武装下一轮", async () => {
    const ref = loopRef();
    const provider: ModelProvider = {
      async *streamChat() {
        yield { type: "text-delta", text: "x" };
        ref.loop!.cancel({ kind: "user" });
        ref.loop!.cancel({ kind: "hook", reason: { hook: "late" } });
        yield { type: "text-delta", text: "y" };
      },
    };
    const { loop } = makeLoop(provider);
    ref.loop = loop;

    const reason = await loop.runTurn("一次就够");
    expect(reason).toEqual({ kind: "aborted", cause: { kind: "user" } });

    // 无活动 turn 时取消：下一次 runTurn 照常完成（槽随 runTurn 重置）
    const idle = new ScriptedProvider();
    idle.mount([{ type: "text-delta", text: "正常" }, { type: "done" }]);
    const { loop: loop2 } = makeLoop(idle);
    loop2.cancel({ kind: "user" });
    const reason2 = await loop2.runTurn("不受影响");
    expect(reason2).toEqual({ kind: "completed" });
  });

  it("工具间取消：已派发工具的结果照落盘，未派发的调用缺席", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: "{}" },
      { type: "tool-call-delta", id: "c2", name: "write", argsDelta: "{}" },
      { type: "done" },
    ]);
    const ref = loopRef();
    const { loop, store } = makeLoop(provider, {
      executeTool: async (call) => {
        if (call.callId === "c1") {
          ref.loop!.cancel({ kind: "user" }); // 工具 1 执行期间取消
          return { content: "c1 done" };
        }
        return { content: "c2 不该执行" };
      },
    });
    ref.loop = loop;

    const reason = await loop.runTurn("两个工具");
    expect(reason).toEqual({ kind: "aborted", cause: { kind: "user" } });
    const events = store.load("s1");
    expect(events.map((e) => e.type)).toEqual([
      "turn/start",
      "user/message",
      "step/start",
      "request/header",
      "assistant/message",
      "tool/call",
      "tool/result",
      "step/end",
      "turn/end",
    ]);
    // c1 走完（事实照落），c2 从未派发
    expect(events.filter((e) => e.type === "tool/call")).toHaveLength(1);
  });

  it("回归注释：冻结的 cause 会让 undici 式 transport 抛 TypeError 取代真因——cancel 绝不冻结", async () => {
    // undici 行为 mock：abort 时对 reason 赋 stack（Node fetch 的真实行为）
    const undiciLike = (reason: object): Promise<never> => {
      (reason as { stack?: string }).stack = "assigned by fetch";
      return Promise.reject(reason);
    };
    // 冻结对象：strict 模式赋值当场抛 TypeError，真因被吞（DSH 记录的事故形状）
    const frozen = Object.freeze({ kind: "user" });
    expect(() => undiciLike(frozen)).toThrow(TypeError);

    // loop 侧：cancel 后调用方对象未被冻结，transport 扩展可达、真因可达
    const cause: CancelCause = { kind: "user" };
    const { loop } = makeLoop(new ScriptedProvider());
    loop.cancel(cause);
    expect(Object.isFrozen(cause)).toBe(false);
    await expect(undiciLike(cause)).rejects.toBe(cause);
  });
});
