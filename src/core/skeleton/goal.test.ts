/**
 * goal 跨轮驱动测试（G3/G6，T-P1-12）——状态机 invariant（迁移守卫合法
 * 表 + 非法迁移抛错）/ 落流与流重建（验收①跨轮保持、④重启仍在）/
 * tickBeforeTurn 提醒（验收②注入位）/ 到期动作三选一（验收③ abandon/
 * report/renew 可断言）/ 投影可查 + revert 切割 / 装配级注入位与重启
 * 不重复落初始事实。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SessionEvent } from "./events.js";
import {
  GoalStateError,
  createGoalService,
  goalFromEvents,
  nextGoalState,
  type GoalAction,
  type GoalState,
} from "./goal.js";
import { Projector, project } from "../../session/project.js";
import {
  createChildAssembly,
  type ChildAssembly,
} from "../../kernel/assembly.js";
import {InMemoryEventStorage, SessionEventStore, type SessionStore} from "../../session/store.js";

describe("状态机（invariant 自校验：迁移守卫纯函数）", () => {
  const from = (status: "active" | "achieved" | "abandoned") => ({
    text: "发版",
    deadline: 1000,
    status,
  });

  it("合法表：set 任意时刻可设且覆盖旧 goal；renew/achieve/abandon 仅 active", () => {
    expect(
      nextGoalState(from("active"), { kind: "renew", deadline: 2000 }),
    ).toEqual({ text: "发版", deadline: 2000, status: "active" });
    expect(nextGoalState(from("active"), { kind: "achieve" })).toEqual({
      text: "发版",
      deadline: 1000,
      status: "achieved",
    });
    expect(nextGoalState(from("active"), { kind: "abandon" })).toEqual({
      text: "发版",
      deadline: 1000,
      status: "abandoned",
    });
    // set 覆盖：终态也能被新目标重新开局
    expect(
      nextGoalState(from("abandoned"), { kind: "set", text: " 新目标 " }),
    ).toEqual({ text: "新目标", status: "active" });
    // null 起点只能 set
    expect(nextGoalState(null, { kind: "set", text: "起步" })).toEqual({
      text: "起步",
      status: "active",
    });
  });

  it("非法迁移抛 GoalStateError：终态不可 renew/结算、空文本拒绝", () => {
    const cases: Array<[GoalState | null, GoalAction]> = [
      [from("achieved"), { kind: "renew", deadline: 2000 }],
      [from("achieved"), { kind: "abandon" }],
      [from("abandoned"), { kind: "achieve" }],
      [null, { kind: "renew", deadline: 2000 }],
      [null, { kind: "achieve" }],
      [null, { kind: "abandon" }],
    ];
    for (const [state, action] of cases) {
      expect(() => nextGoalState(state, action), JSON.stringify(action.kind)).toThrow(
        GoalStateError,
      );
    }
    expect(() => nextGoalState(null, { kind: "set", text: "   " })).toThrow(
      GoalStateError,
    );
  });
});

describe("落流与跨轮保持（验收①④）", () => {
  it("每次变更 emit 整值事实；current 与流重建一致（重启等价）", () => {
    const emitted: Array<{ text: string; deadline?: number; status: string }> = [];
    const service = createGoalService({ emit: (s) => emitted.push({ ...s }) });
    service.set("完成词汇表扩展", 5000);
    service.achieve();
    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toEqual({ text: "完成词汇表扩展", deadline: 5000, status: "active" });
    expect(emitted[1]).toEqual({ text: "完成词汇表扩展", deadline: 5000, status: "achieved" });
    expect(service.current?.status).toBe("achieved");
  });

  it("验收①：goal 跨多轮保持——多轮 tick 不丢（轮结束不改变 goal 事实）", () => {
    const emitted: Array<{ text: string; status: string }> = [];
    const service = createGoalService({
      emit: (s) => emitted.push({ text: s.text, status: s.status }),
    });
    service.set("跨轮目标");
    for (let turn = 1; turn <= 5; turn++) {
      const reminder = service.tickBeforeTurn(1000 + turn);
      expect(reminder, `turn ${turn}`).toContain("跨轮目标");
    }
    expect(service.current).toEqual({ text: "跨轮目标", status: "active" });
  });

  it("验收④：goalFromEvents 按流重建——重启后 goal 仍在（流内最新为准）", () => {
    const store = new SessionEventStore();
    const service = createGoalService({
      emit: (s) => {
        const events = store.load("s0");
        const turn = events.length > 0 ? events[events.length - 1]!.turn : 0;
        store.append("s0", [
          {
            type: "goal/set",
            turn,
            text: s.text,
            ...(s.deadline !== undefined ? { deadline: s.deadline } : {}),
            status: s.status,
          },
        ]);
      },
    });
    service.set("第一目标");
    service.set("第二目标", 9000);
    const restored = goalFromEvents(store.load("s0"));
    expect(restored).toEqual({ text: "第二目标", deadline: 9000, status: "active" });
  });
});

describe("tickBeforeTurn 与到期动作（验收②③）", () => {
  it("验收②：active 每轮注入提醒（含目标文本与截止）；无 goal / 非 active → null", () => {
    const service = createGoalService({ emit: () => undefined });
    expect(service.tickBeforeTurn(1000)).toBeNull(); // 无 goal
    service.set("写内核", 5000);
    const reminder = service.tickBeforeTurn(3000);
    expect(reminder).toContain("写内核");
    expect(reminder).toContain("截止");
    service.abandon();
    expect(service.tickBeforeTurn(6000)).toBeNull(); // 非 active
  });

  it("验收③ abandon：到期即放弃——当轮报告一次，此后不再提醒", () => {
    const service = createGoalService({ emit: () => undefined, expiryAction: "abandon" });
    service.set("会过期的目标", 2000);
    const report = service.tickBeforeTurn(3000);
    expect(report).toContain("已到期");
    expect(report).toContain("放弃");
    expect(service.current?.status).toBe("abandoned");
    expect(service.tickBeforeTurn(4000)).toBeNull();
  });

  it("验收③ report（缺省）：状态不动、每轮持续催办", () => {
    const service = createGoalService({ emit: () => undefined }); // 缺省 report
    service.set("等决策的目标", 2000);
    const first = service.tickBeforeTurn(3000);
    const second = service.tickBeforeTurn(4000);
    expect(first).toContain("已到期");
    expect(second).toContain("已到期");
    expect(service.current?.status).toBe("active");
    expect(service.current?.deadline).toBe(2000); // 不动
  });

  it("验收③ renew：自动续期 renewExtendMs（落 renew 事件），状态保持 active", () => {
    const emitted: Array<{ deadline?: number; status: string }> = [];
    const service = createGoalService({
      emit: (s) => emitted.push({ ...(s.deadline !== undefined ? { deadline: s.deadline } : {}), status: s.status }),
      expiryAction: "renew",
      renewExtendMs: 60_000,
    });
    service.set("会自动续期的目标", 2000);
    const report = service.tickBeforeTurn(3000);
    expect(report).toContain("自动续期");
    expect(service.current?.status).toBe("active");
    expect(service.current?.deadline).toBe(3000 + 60_000);
    expect(emitted.at(-1)?.status).toBe("active");
  });

  it("未到期不触发动作；无 deadline 永不到期", () => {
    const service = createGoalService({ emit: () => undefined, expiryAction: "abandon" });
    service.set("未来截止", 5000);
    expect(service.tickBeforeTurn(4999)).toContain("目标提醒"); // 常规提醒
    expect(service.current?.status).toBe("active");
    service.set("无截止");
    expect(service.tickBeforeTurn(999_999)).toContain("目标提醒");
    expect(service.current?.status).toBe("active");
  });
});

describe("投影（词汇表 16→17 同步面）", () => {
  it("goal/set 投影可查（历史 + 当前=最新）；revert 切点切割", () => {
    const mk = (seq: number, text: string, status: "active" | "achieved"): SessionEvent =>
      ({ type: "goal/set", seq, ts: 0, turn: 0, text, status });
    const projection = project([mk(1, "目标甲", "active"), mk(2, "目标乙", "achieved")]);
    expect(projection.goals).toHaveLength(2);
    expect(projection.goals[1]!.text).toBe("目标乙");
    // revert 到目标乙之前 → 有效投影只剩目标甲
    const reverted = project([
      mk(1, "目标甲", "active"),
      mk(2, "目标乙", "achieved"),
      { type: "session/revert", seq: 3, ts: 0, turn: 0, targetSeq: 1, phase: "revert" },
    ]);
    expect(reverted.goals).toHaveLength(1);
    expect(reverted.goals[0]!.text).toBe("目标甲");
    // Projector 校验面：goal/set 不要求轮开合上下文
    const fresh = Projector.fresh();
    expect(() => fresh.append([mk(1, "空流落点", "active")])).not.toThrow();
  });
});

describe("装配接线（验收②注入位 + 重启不重复落初始事实）", () => {
  const tmpRoots: string[] = [];
  afterEach(() => {
    for (const dir of tmpRoots.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeAssembly(store: SessionStore): ChildAssembly {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "aegent-goal-"));
    tmpRoots.push(workspaceRoot);
    return createChildAssembly({
      sessionId: "s-goal",
      store,
      workspaceRoot,
      contextWindow: 200_000,
      approvalTimeoutMs: 5_000,
      goal: { text: "装配级初始目标" },
    });
  }

  it("新会话：初始 goal 落流 + beforeFirstModelRequest 每轮注入提醒", async () => {
    const store = new SessionEventStore();
    const assembly = makeAssembly(store);
    store.append("s-goal", [{ type: "turn/start", turn: 1 }]);
    await assembly.beforeFirstModelRequest(1);
    // 注入位断言：user/message{source:"injected"} 落流、内容含目标
    const events = store.load("s-goal");
    const injected = events.filter(
      (e): e is Extract<SessionEvent, { type: "user/message" }> =>
        e.type === "user/message" && e.source === "injected",
    );
    expect(injected).toHaveLength(1);
    expect(injected[0]!.message.content).toContain("装配级初始目标");
    // 第二轮再注入（每轮提醒）
    store.append("s-goal", [
      { type: "turn/end", turn: 1, reason: { kind: "completed" } },
      { type: "turn/start", turn: 2 },
    ]);
    await assembly.beforeFirstModelRequest(2);
    expect(
      store.load("s-goal").filter((e) => e.type === "user/message" && e.source === "injected"),
    ).toHaveLength(2);
    // 词汇表事实在流内（G3④）
    expect(store.load("s-goal").some((e) => e.type === "goal/set")).toBe(true);
  });

  it("已有 goal 事实的会话：按流重建，不重复落初始 goal/set", async () => {
    const store = new SessionEventStore();
    const first = makeAssembly(store);
    store.append("s-goal", [{ type: "turn/start", turn: 1 }]);
    await first.beforeFirstModelRequest(1);
    const countAfterFirst = store.load("s-goal").filter((e) => e.type === "goal/set").length;
    expect(countAfterFirst).toBe(1);
    // 重启等价：同 store 再装配（流内已有 goal/set）——不落第二条初始事实
    const second = makeAssembly(store);
    expect(second.goal?.current?.text).toBe("装配级初始目标");
    store.append("s-goal", [
      { type: "turn/end", turn: 1, reason: { kind: "completed" } },
      { type: "turn/start", turn: 2 },
    ]);
    await second.beforeFirstModelRequest(2);
    expect(store.load("s-goal").filter((e) => e.type === "goal/set").length).toBe(1);
  });
});
