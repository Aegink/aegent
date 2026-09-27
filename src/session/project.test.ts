import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import type { NewSessionEvent, SessionEvent } from "../kernel/events.js";
import { Projector, project, ProjectError } from "./project.js";
import { SessionStore } from "./store.js";

/** 一轮完整 turn 的 8 个事件（turn → user → step → assistant → tool 对 → step 闭 → turn 闭）。 */
function oneTurn(turn: number, seq0: number): SessionEvent[] {
  const seq = () => seq0++;
  const ts = 1_700_000_000_000 + turn;
  const mk = (event: NewSessionEvent): SessionEvent => ({ ...event, seq: seq(), ts } as SessionEvent);
  return [
    mk({ type: "turn/start", turn }),
    mk({ type: "user/message", turn, message: { content: `q${turn}` }, source: "user" }),
    mk({ type: "step/start", turn, step: turn }),
    mk({
      type: "assistant/message",
      turn,
      step: turn,
      message: { content: `a${turn}` },
      stream: [],
      usage: { inputTokens: 10, outputTokens: 5 },
    }),
    mk({ type: "tool/call", turn, step: turn, callId: `c${turn}`, name: "bash", arguments: "{}" }),
    mk({
      type: "tool/result",
      turn,
      step: turn,
      callId: `c${turn}`,
      message: { content: "ok" },
    }),
    mk({ type: "step/end", turn, step: turn }),
    mk({ type: "turn/end", turn, reason: { kind: "completed" } }),
  ];
}

function fullStream(turnCount: number): SessionEvent[] {
  const events: SessionEvent[] = [];
  let seq = 1;
  for (let turn = 1; turn <= turnCount; turn++) {
    events.push(...oneTurn(turn, seq));
    seq += 8; // oneTurn 恰好消费 8 个连续 seq
  }
  return events;
}

describe("增量投影（E3）", () => {
  it("验收①：1 万事件 project() < 200ms（硬编码阈值，vitest 计时断言）", () => {
    const events = fullStream(1250); // 1250 × 8 = 10000
    expect(events).toHaveLength(10_000);
    const t0 = performance.now();
    const projection = project(events);
    const elapsed = performance.now() - t0;
    expect(projection.lastSeq).toBe(10_000);
    expect(elapsed).toBeLessThan(200);
    console.info(`[基准基线] project(10k) = ${elapsed.toFixed(1)}ms（阈值 200ms）`);
  });

  it("增量 append 与全量 fold 结果一致（快照+尾巴路径的语义等价）", () => {
    const events = fullStream(50);
    const head = events.slice(0, 200);
    const tail = events.slice(200);
    const incremental = Projector.fresh();
    incremental.append(head);
    incremental.append(tail);
    expect(incremental.projection.messages).toEqual(project(events).messages);
    expect(incremental.projection.lastUsage).toEqual(project(events).lastUsage);
    expect(incremental.projection.lastSeq).toBe(400);
  });

  it("投影内容抽查：消息 / 工具配对 / lastUsage 落位", () => {
    const projection = project(fullStream(3));
    expect(projection.turnCount).toBe(3);
    expect(projection.openTurn).toBeNull();
    expect(projection.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"]);
    expect(projection.toolResults.get("c2")?.content).toBe("ok");
    expect(projection.lastUsage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(projection.openToolCalls.size).toBe(0);
  });
});

describe("fold 即校验（E16）", () => {
  it("验收②：乱序 seq 在 append 前 reject，投影状态原地不动", () => {
    const projector = Projector.fresh();
    projector.append(oneTurn(1, 1)); // 占用 seq 1..8
    const outOfOrder = oneTurn(2, 10); // 期望从 9 开始，10 即乱序
    expect(() => projector.append(outOfOrder)).toThrow(ProjectError);
    expect(() => projector.append(outOfOrder)).toThrow(/seq 不连续/);
    // 回滚证据：合法流接着上一条继续仍然可行
    expect(() => projector.append(oneTurn(2, 9))).not.toThrow();
    expect(projector.projection.lastSeq).toBe(16);
  });

  it("验收②：未知事件类型在 append 前 reject", () => {
    const projector = Projector.fresh();
    const ghost = { type: "ghost/event", seq: 1, ts: 0, turn: 1 } as unknown as SessionEvent;
    expect(() => projector.append([ghost])).toThrow(/未知事件类型/);
  });

  it("session/fork（E5/T-P1-40）：合法 lineage 标记放行（会话级元事件），坏载荷三路类型化拒绝", () => {
    const projector = Projector.fresh();
    const mark = {
      type: "session/fork",
      seq: 1,
      ts: 0,
      turn: 0,
      parentSessionId: "s0",
      position: "after",
      cutSeq: 12,
    } as unknown as SessionEvent;
    expect(() => projector.append([mark])).not.toThrow();

    // 坏载荷：空 parentSessionId / position 闭集外 / cutSeq 非法——全部在 append 前拒
    const bads = [
      { parentSessionId: "", position: "after", cutSeq: 1 },
      { parentSessionId: "s0", position: "middle", cutSeq: 1 },
      { parentSessionId: "s0", position: "before", cutSeq: -1 },
      { parentSessionId: "s0", position: "before", cutSeq: 2.5 },
    ];
    let seq = 2;
    for (const bad of bads) {
      const p2 = Projector.fresh();
      const badEvent = { type: "session/fork", seq: seq++, ts: 0, turn: 0, ...bad } as unknown as SessionEvent;
      expect(() => p2.append([badEvent])).toThrow(ProjectError);
    }
  });

  it("plugin（C17/T-P1-72）：合法逃生舱载荷放行（log-only 投影不消费），坏载荷两路类型化拒绝", () => {
    const projector = Projector.fresh();
    const ok = {
      type: "plugin",
      seq: 1,
      ts: 0,
      turn: 0,
      namespace: "my-plugin",
      payload: { key: "value", nested: [1, "two", null, true] },
    } as unknown as SessionEvent;
    expect(() => projector.append([ok])).not.toThrow();

    // 坏载荷：namespace 空 / payload 不可序列化——append 前拒；payload 缺省合法
    const bads = [
      { namespace: "" },
      { namespace: "x", payload: () => 1 },
    ];
    let seq = 2;
    for (const bad of bads) {
      const p2 = Projector.fresh();
      const badEvent = { type: "plugin", seq: seq++, ts: 0, turn: 0, ...bad } as unknown as SessionEvent;
      expect(() => p2.append([badEvent])).toThrow(ProjectError);
    }
    const noPayload = {
      type: "plugin",
      seq: 1,
      ts: 0,
      turn: 0,
      namespace: "no-payload",
    } as unknown as SessionEvent;
    expect(() => Projector.fresh().append([noPayload])).not.toThrow();
    // C15：逃生舱只有一个——其他未知类型仍被拒（ghost 恒拒）
    const ghost = { type: "ghost/plugin", seq: 99, ts: 0, turn: 0 } as unknown as SessionEvent;
    expect(() => projector.append([ghost])).toThrow(/未知事件类型/);
  });

  it("批内配对可查：同批 [turn/start…turn/end] 合法；同批双开 turn 拒绝", () => {
    const projector = Projector.fresh();
    expect(() => projector.append(oneTurn(1, 1))).not.toThrow(); // 批内开合完整
    const doubleOpen = [
      { type: "turn/start", seq: 9, ts: 0, turn: 2 } as SessionEvent,
      { type: "turn/start", seq: 10, ts: 0, turn: 3 } as SessionEvent,
    ];
    expect(() => projector.append(doubleOpen)).toThrow(/尚未闭合/);
  });

  it("无开而合 / 无 call 而果：结构性配对拒绝", () => {
    const projector = Projector.fresh();
    expect(() =>
      projector.append([{ type: "turn/end", seq: 1, ts: 0, turn: 1, reason: { kind: "completed" } } as SessionEvent]),
    ).toThrow(/未开启/);

    const stepwise = Projector.fresh();
    stepwise.append(oneTurn(1, 1));
    const orphanResult = [
      { type: "turn/start", seq: 9, ts: 0, turn: 2 } as SessionEvent,
      { type: "step/start", seq: 10, ts: 0, turn: 2, step: 2 } as SessionEvent,
      {
        type: "tool/result",
        seq: 11,
        ts: 0,
        turn: 2,
        step: 2,
        callId: "no-such-call",
        message: { content: "x" },
      } as SessionEvent,
    ];
    expect(() => stepwise.append(orphanResult)).toThrow(/没有前置未闭合的 tool\/call/);
  });

  it("tool/progress 与 tool/call 同域校验（T-P1-16）：无未闭合 call 的进度拒绝；call 闭合后补报拒绝", () => {
    const stepwise = Projector.fresh();
    stepwise.append(oneTurn(1, 1));
    // 无前置 tool/call 的进度：拒绝
    const orphanProgress = [
      { type: "turn/start", seq: 9, ts: 0, turn: 2 } as SessionEvent,
      { type: "step/start", seq: 10, ts: 0, turn: 2, step: 2 } as SessionEvent,
      {
        type: "tool/progress",
        seq: 11,
        ts: 0,
        turn: 2,
        step: 2,
        callId: "no-such-call",
        seqInCall: 1,
        message: "x",
      } as SessionEvent,
    ];
    expect(() => stepwise.append(orphanProgress)).toThrow(/没有前置未闭合的 tool\/call/);
    // call 开启期间合法；result 闭合之后补报：拒绝
    const paired = Projector.fresh();
    paired.append(oneTurn(1, 1));
    const open = [
      { type: "turn/start", seq: 9, ts: 0, turn: 2 } as SessionEvent,
      { type: "step/start", seq: 10, ts: 0, turn: 2, step: 2 } as SessionEvent,
      {
        type: "tool/call",
        seq: 11,
        ts: 0,
        turn: 2,
        step: 2,
        callId: "c1",
        name: "work",
        arguments: "{}",
      } as SessionEvent,
      {
        type: "tool/progress",
        seq: 12,
        ts: 0,
        turn: 2,
        step: 2,
        callId: "c1",
        seqInCall: 1,
        message: "进行中",
      } as SessionEvent,
    ];
    expect(() => paired.append(open)).not.toThrow();
    const closed = [
      {
        type: "tool/result",
        seq: 13,
        ts: 0,
        turn: 2,
        step: 2,
        callId: "c1",
        message: { content: "ok" },
      } as SessionEvent,
      {
        type: "tool/progress",
        seq: 14,
        ts: 0,
        turn: 2,
        step: 2,
        callId: "c1",
        seqInCall: 2,
        message: "迟到的进度",
      } as SessionEvent,
    ];
    expect(() => paired.append(closed)).toThrow(/没有前置未闭合的 tool\/call/);
  });
});

describe("todo 投影（G2 / T-P1-10）", () => {
  /** 会话级元事件样本（会话级纪律：不要求 turn/step 开合上下文）。 */
  const todoUpdate = (
    seq: number,
    items: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>,
  ): SessionEvent => ({ type: "todo/update", seq, ts: 0, turn: 0, items });

  it("验收①：todo/update 落流后投影可查——todos 历史 + 当前值 = 最新一条", () => {
    const projection = project([
      todoUpdate(1, [
        { content: "a", status: "in_progress" },
        { content: "b", status: "pending" },
      ]),
      todoUpdate(2, [{ content: "a", status: "completed" }]),
    ]);
    expect(projection.todos).toHaveLength(2);
    expect(projection.todos[1]!.items).toEqual([{ content: "a", status: "completed" }]);
    // 会话级元事件不参与轮开合校验（空流可查）
    expect(projection.lastSeq).toBe(2);
  });

  it("验收④（revert 交互）：revert 到 todo/update 之前 → 有效投影的 todos 被切割", () => {
    const events: SessionEvent[] = [
      todoUpdate(1, [{ content: "被回退的清单", status: "in_progress" }]),
      { type: "session/revert", seq: 2, ts: 0, turn: 0, targetSeq: 0, phase: "revert" },
    ];
    const projection = project(events);
    expect(projection.revertedTo).toBe(0);
    expect(projection.todos).toEqual([]); // seq=1 > cut=0 → 切掉
    // undo 恢复全部
    const undone = project([
      ...events,
      { type: "session/revert", seq: 3, ts: 0, turn: 0, targetSeq: 0, phase: "undo" },
    ]);
    expect(undone.todos).toHaveLength(1);
  });

  it("todo/update 不进消息投影（模型上下文不含元事件，消息重建面隔离）", () => {
    const projection = project([
      todoUpdate(1, [{ content: "a", status: "pending" }]),
      { type: "turn/start", seq: 2, ts: 0, turn: 1 },
      { type: "user/message", seq: 3, ts: 0, turn: 1, message: { content: "q" }, source: "user" },
    ]);
    expect(projection.messages.map((m) => m.role)).toEqual(["user"]);
  });
});

describe("与 SessionStore 的接线（E16 写入前校验）", () => {
  it("A12/T-P1-53：user/message 的 promptId 载荷校验——合法值放行、空串拒绝、缺省前向兼容", () => {
    // 合法 promptId：投影/校验通过
    const ok = Projector.fresh();
    ok.append(oneTurn(1, 1).map((e) =>
      e.type === "user/message" ? { ...e, promptId: "p1" } : e,
    ));
    // 空串：拒绝
    const bad = Projector.fresh();
    expect(() =>
      bad.append(
        oneTurn(2, 1).map((e) =>
          e.type === "user/message" ? { ...e, promptId: "" } : e,
        ),
      ),
    ).toThrow(/promptId 非法/);
    // 缺省（旧流形状）：前向兼容照常通过
    const legacy = Projector.fresh();
    legacy.append(oneTurn(3, 1));
  });

  it("store.append 对非法流抛 ProjectError，内存序零提交", () => {
    const store = new SessionStore();
    store.append("s1", [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "hi" }, source: "user" },
    ]);
    // 乱序数据造不出来（store 自己发 seq）——用结构非法打：结果先于 call
    expect(() =>
      store.append("s1", [
        { type: "step/start", turn: 1, step: 1 },
        { type: "tool/result", turn: 1, step: 1, callId: "x", message: { content: "y" } },
      ]),
    ).toThrow(ProjectError);
    expect(store.load("s1")).toHaveLength(2); // 前两批完好，第三批整批未进
    // 合法流继续可用（校验失败不留毒）
    expect(() =>
      store.append("s1", [
        { type: "step/start", turn: 1, step: 1 },
        { type: "tool/call", turn: 1, step: 1, callId: "c1", name: "bash", arguments: "{}" },
        { type: "tool/result", turn: 1, step: 1, callId: "c1", message: { content: "ok" } },
        { type: "step/end", turn: 1, step: 1 },
        { type: "turn/end", turn: 1, reason: { kind: "completed" } },
      ]),
    ).not.toThrow();
    expect(store.load("s1")).toHaveLength(7);
  });
});
