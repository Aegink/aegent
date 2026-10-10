import { describe, expect, it } from "vitest";

import type { DecideTurn } from "../primitives/loop/loop.js";
import { PromptQueue, QueueFullError } from "./queue.js";
import { ScriptedProvider, makeLoop } from "../primitives/loop/loop.test-utils.js";

describe("PromptQueue —— A9 turn 只能入队", () => {
  it("入队即收执：同步返回 {messageId}，多次入队 id 互异", () => {
    const queue = new PromptQueue();
    const a = queue.enqueue("第一条");
    const b = queue.enqueue("第二条");
    // 收执只有 messageId——没有 promise、没有完成句柄（A9 的协议面）
    expect(Object.keys(a)).toEqual(["messageId"]);
    expect(a.messageId).not.toBe(b.messageId);
    expect(queue.size).toBe(2);
  });

  it("A9 类型层钉死：协议不存在 finished()（无 per-prompt 完成语义）", () => {
    const queue = new PromptQueue();
    // 若有人给 PromptQueue 加回 finished()，@ts-expect-error 会因"未用"而编译失败
    // @ts-expect-error —— A9：入队只有收执，没有完成句柄/完成查询
    void queue.finished;
    expect(queue.size).toBe(0);
  });

  it("M9/T-P1-48 有限队列：上限可配、超限入队 QueueFullError 类型化拒绝（fail-closed 不静默丢）", () => {
    const queue = new PromptQueue("all", 2);
    queue.enqueue("甲");
    queue.enqueue("乙");
    // 第 3 条超限：类型化拒绝、消息不入队不收执
    expect(() => queue.enqueue("丙")).toThrowError(QueueFullError);
    expect(queue.size).toBe(2);
    // 错误面带 code 与上限（协议层转 error 行）
    try {
      queue.enqueue("丁");
    } catch (e) {
      expect((e as QueueFullError).code).toBe("QUEUE_FULL");
      expect((e as QueueFullError).maxSize).toBe(2);
      expect((e as Error).message).toContain("上限 2");
    }
    // 拒绝不毒化队列：drain 后可继续入队
    expect(queue.drain().map((p) => p.content)).toEqual(["甲", "乙"]);
    expect(queue.enqueue("戊")).toEqual({ messageId: expect.any(String) });
  });

  it("M9/T-P1-48 缺省上限 64：宽松但有限（the queue is finite）", () => {
    const queue = new PromptQueue();
    for (let i = 0; i < 64; i += 1) queue.enqueue(`m${i}`);
    expect(queue.size).toBe(64);
    expect(() => queue.enqueue("第 65 条")).toThrowError(QueueFullError);
  });

  it("drain 的两档节奏：all 全量 FIFO 出；one-at-a-time 只出最旧一条", () => {
    const all = new PromptQueue("all");
    all.enqueue("甲");
    all.enqueue("乙");
    all.enqueue("丙");
    expect(all.drain().map((p) => p.content)).toEqual(["甲", "乙", "丙"]);
    expect(all.size).toBe(0);

    const one = new PromptQueue("one-at-a-time");
    one.enqueue("甲");
    one.enqueue("乙");
    one.enqueue("丙");
    expect(one.drain().map((p) => p.content)).toEqual(["甲"]);
    expect(one.drain().map((p) => p.content)).toEqual(["乙"]);
    expect(one.size).toBe(1);
  });
});

describe("step 边界注入 —— A2 steer 节奏（loop 接线）", () => {
  it("验收①：all 模式注入 3 条 → 下一步全量消费且事件顺序与入队一致", async () => {
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "第一答" }, { type: "done" }]);
    provider.mount([{ type: "text-delta", text: "第二答" }, { type: "done" }]);
    const queue = new PromptQueue("all");
    let decided = 0;
    // 模拟模型工作期间用户连发 3 条 steer（第一次决策时入队）
    const decideTurn: DecideTurn = () => {
      decided += 1;
      if (decided === 1) {
        queue.enqueue("steer-甲");
        queue.enqueue("steer-乙");
        queue.enqueue("steer-丙");
      }
      return decided === 1 ? { action: "continue" } : { action: "end" };
    };
    const { loop, store } = makeLoop(provider, { decideTurn, queue });

    const reason = await loop.runTurn("开场");
    expect(reason).toEqual({ kind: "completed" });
    expect(queue.size).toBe(0);

    const events = store.load("s1");
    const types = events.map((e) => e.type);
    // 注入点在 step 边界：step1 收尾后、step2 开启前
    const firstBoundary = types.indexOf("step/end");
    expect(types.slice(firstBoundary + 1, firstBoundary + 4)).toEqual([
      "user/message",
      "user/message",
      "user/message",
    ]);
    const steers = events.slice(firstBoundary + 1, firstBoundary + 4) as {
      turn: number;
      message: { content: string };
      source: string;
    }[];
    expect(steers.map((e) => e.message.content)).toEqual([
      "steer-甲",
      "steer-乙",
      "steer-丙",
    ]);
    // 与开场 prompt 同轮；source="user"（人类原话——source 记来源不记机制，
    // "发生在 step 边界"由事件在流中的位置自证）
    expect(steers.every((e) => e.turn === 1 && e.source === "user")).toBe(true);

    // 下一次请求按序带上三条 steer（不丢不重）
    expect(provider.requests[1]!.messages.map((m) => m.content)).toEqual([
      "开场",
      "第一答",
      "steer-甲",
      "steer-乙",
      "steer-丙",
    ]);
  });

  it("验收②：one-at-a-time 每个边界只消费最旧 1 条，其余留给后面的边界", async () => {
    const provider = new ScriptedProvider();
    for (const text of ["一", "二", "三"]) {
      provider.mount([{ type: "text-delta", text }, { type: "done" }]);
    }
    const queue = new PromptQueue("one-at-a-time");
    expect(queue.queueMode).toBe("one-at-a-time");
    let decided = 0;
    const decideTurn: DecideTurn = () => {
      decided += 1;
      if (decided === 1) {
        queue.enqueue("甲");
        queue.enqueue("乙");
        queue.enqueue("丙");
      }
      return decided === 3 ? { action: "end" } : { action: "continue" };
    };
    const { loop, store } = makeLoop(provider, { decideTurn, queue });

    await loop.runTurn("开场");
    // 边界一（step2 前）出"甲"、边界二（step3 前）出"乙"；边界三不再有
    // （decideTurn 给了 end），"丙"留在队列——消费顺序 = 入队顺序
    const contents = store
      .load("s1")
      .filter((e) => e.type === "user/message")
      .map((e) => (e as { message: { content: string } }).message.content);
    expect(contents).toEqual(["开场", "甲", "乙"]);
    expect(queue.size).toBe(1);
    expect(queue.drain()[0]!.content).toBe("丙");
    // 第三个请求只带上了"乙"，"丙"从未进入任何请求
    expect(provider.requests[2]!.messages.map((m) => m.content)).toEqual([
      "开场",
      "一",
      "甲",
      "二",
      "乙",
    ]);
  });

  it("跨边界不丢不重：all 模式下两条在边界一、一条在边界二，FIFO 全量消化", async () => {
    const provider = new ScriptedProvider();
    for (const text of ["一", "二", "三"]) {
      provider.mount([{ type: "text-delta", text }, { type: "done" }]);
    }
    const queue = new PromptQueue("all");
    let decided = 0;
    const decideTurn: DecideTurn = () => {
      decided += 1;
      if (decided === 1) {
        queue.enqueue("甲");
        queue.enqueue("乙");
      }
      if (decided === 2) queue.enqueue("丙");
      return decided === 3 ? { action: "end" } : { action: "continue" };
    };
    const { loop, store } = makeLoop(provider, { decideTurn, queue });

    await loop.runTurn("开场");
    expect(queue.size).toBe(0);
    const contents = store
      .load("s1")
      .filter((e) => e.type === "user/message")
      .map((e) => (e as { message: { content: string } }).message.content);
    // 开场 + 三条 steer 全部落盘，顺序与入队一致（甲乙先于丙），无丢失无重复
    expect(contents).toEqual(["开场", "甲", "乙", "丙"]);
    expect(provider.requests[2]!.messages.map((m) => m.content)).toEqual([
      "开场",
      "一",
      "甲",
      "乙",
      "二",
      "丙",
    ]);
  });
});
