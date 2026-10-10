/**
 * 启动期对账测试（Q5，T-8-04）——构造崩溃态事件流（孤儿 step/turn）→
 * reconcileBootState → 全部 interrupted 且错误码按类型细分；杀进程重启路径
 * 走 store.restore（seq 断层即抛）；重启后新 prompt 开新轮、不触发旧任务
 * 续跑（场景⑤的前半）。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STEP_INTERRUPTED_CODE,
  TURN_INTERRUPTED_CODE,
  findInterruptedTurn,
  reconcileBootState,
} from "./boot-maintenance.js";
import { Projector } from "./project.js";
import { SqliteEventStorage } from "./db.js";
import {SessionEventStore, type SessionStore} from "./store.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aegent-boot-"));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 句柄释放滞后的 EBUSY（T-1-03 已知坑），不影响断言
  }
});

describe("reconcileBootState（T-8-04 · Q5）", () => {
  it("崩溃态（孤儿 step + 孤儿 turn）→ 对账全闭合且错误码按类型细分", () => {
    const store = new SessionEventStore();
    // 崩溃残留：turn 1 开了、step 1 开着（assistant 消息落了一半）——进程死亡
    store.append("s0", [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "崩溃前的指令" }, source: "user" },
      { type: "step/start", turn: 1, step: 1 },
      { type: "assistant/message", turn: 1, step: 1, message: { content: "半截" }, stream: [] },
    ]);
    expect(Projector.fold(store.load("s0")).projection.openTurn).not.toBeNull();

    const report = reconcileBootState(store, "s0");
    expect(report.closedSteps).toBe(1);
    expect(report.closedTurns).toBe(1);
    expect(report.codes).toEqual([STEP_INTERRUPTED_CODE, TURN_INTERRUPTED_CODE]);
    // 投影干净：全部闭合
    const after = Projector.fold(store.load("s0")).projection;
    expect(after.openTurn).toBeNull();
    expect(after.openSteps.size).toBe(0);
    // 闭合事件以 interrupted 落流（append-only，历史未动）
    const events = store.load("s0");
    expect(events.map((e) => e.type).slice(-2)).toEqual(["step/end", "turn/end"]);
    const turnEnd = events[events.length - 1]!;
    expect(turnEnd.type === "turn/end" ? turnEnd.reason : undefined).toEqual({
      kind: "interrupted",
    });
  });

  it("干净启动是 no-op（零追加、零错误码）", () => {
    const store = new SessionEventStore();
    store.append("s0", [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "hi" }, source: "user" },
      { type: "step/start", turn: 1, step: 1 },
      { type: "assistant/message", turn: 1, step: 1, message: { content: "答" }, stream: [] },
      { type: "step/end", turn: 1, step: 1 },
      { type: "turn/end", turn: 1, reason: { kind: "completed" } },
    ]);
    const before = store.load("s0").length;
    const report = reconcileBootState(store, "s0");
    expect(report.codes).toEqual([]);
    expect(report.closedSteps).toBe(0);
    expect(report.closedTurns).toBe(0);
    expect(store.load("s0").length).toBe(before);
  });

  it("多个未闭合 step 逐一闭合、每步一个细分码", () => {
    const store = new SessionEventStore();
    store.append("s0", [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "hi" }, source: "user" },
      { type: "step/start", turn: 1, step: 1 },
      { type: "step/start", turn: 1, step: 2 },
    ]);
    const report = reconcileBootState(store, "s0");
    expect(report.closedSteps).toBe(2);
    expect(report.closedTurns).toBe(1);
    expect(report.codes).toEqual([
      STEP_INTERRUPTED_CODE,
      STEP_INTERRUPTED_CODE,
      TURN_INTERRUPTED_CODE,
    ]);
    expect(Projector.fold(store.load("s0")).projection.openTurn).toBeNull();
  });

  it("幂等：对账后再跑一遍是 no-op", () => {
    const store = new SessionEventStore();
    store.append("s0", [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "hi" }, source: "user" },
      { type: "step/start", turn: 1, step: 1 },
    ]);
    reconcileBootState(store, "s0");
    const count = store.load("s0").length;
    const again = reconcileBootState(store, "s0");
    expect(again.codes).toEqual([]);
    expect(store.load("s0").length).toBe(count);
  });

  it("杀进程重启：restore（seq 断层即抛的路径）→ 对账 → 新 prompt 开新轮不续跑旧任务", async () => {
    // "上一个进程"：塞崩溃态 + flush 落库
    const storage = SqliteEventStorage.open({ path: path.join(dir, "events.db") });
    const crashed = new SessionEventStore(storage);
    crashed.append("s0", [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "旧进程没跑完的指令" }, source: "user" },
      { type: "step/start", turn: 1, step: 1 },
    ]);
    await crashed.flush("s0");
    storage.db.close(); // 杀进程

    // "新进程"：重开同一库 → restore（含 seq 连续性校验）→ 对账
    const storage2 = SqliteEventStorage.open({ path: path.join(dir, "events.db") });
    const store = new SessionEventStore(storage2);
    await store.restore("s0");
    const report = reconcileBootState(store, "s0");
    expect(report.codes).toEqual([STEP_INTERRUPTED_CODE, TURN_INTERRUPTED_CODE]);

    // 重启后新 prompt：开的是新 turn（turn 2），旧 turn 已是历史、不被续跑
    store.append("s0", [
      { type: "turn/start", turn: 2 },
      { type: "user/message", turn: 2, message: { content: "新指令" }, source: "user" },
      { type: "step/start", turn: 2, step: 1 },
      { type: "step/end", turn: 2, step: 1 },
      { type: "turn/end", turn: 2, reason: { kind: "completed" } },
    ]);
    const projection = Projector.fold(store.load("s0")).projection;
    expect(projection.turnCount).toBe(2);
    expect(projection.openTurn).toBeNull();
    // 事件流上旧轮闭合（interrupted）与新轮完整共存——事件是唯一真相
    const reasons = store
      .load("s0")
      .filter((e) => e.type === "turn/end")
      .map((e) => (e.type === "turn/end" ? e.reason.kind : ""));
    expect(reasons).toEqual(["interrupted", "completed"]);
    storage2.db.close();
  });

  it("T-P1-13 G4：plan 会话崩溃重启——对账 interrupted、不自动重放，计划 artifact 仍可读", async () => {
    const artifactDir = mkdtempSync(path.join(tmpdir(), "aegent-planart-"));
    const artifactPath = path.join(artifactDir, "s0", "plan.md");
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, "# 批准的计划\n只读研究已完成", "utf8");

    // "上一个进程"：plan 会话（checkpoint 记 artifact 路径）+ 崩溃孤儿 turn
    const storage = SqliteEventStorage.open({ path: path.join(dir, "plan-events.db") });
    const crashed = new SessionEventStore(storage);
    crashed.append("s0", [
      { type: "checkpoint", turn: 0, provider: "plan", ref: { path: artifactPath } },
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "继续按计划实施" }, source: "user" },
      { type: "step/start", turn: 1, step: 1 },
    ]);
    await crashed.flush("s0");
    storage.db.close(); // 杀进程（实施中途崩溃）

    // "新进程"：restore → 对账 → 计划可见、旧工作不重放
    const storage2 = SqliteEventStorage.open({ path: path.join(dir, "plan-events.db") });
    const store = new SessionEventStore(storage2);
    await store.restore("s0");
    const report = reconcileBootState(store, "s0");
    expect(report.codes).toEqual([STEP_INTERRUPTED_CODE, TURN_INTERRUPTED_CODE]);
    // 计划 artifact 按流找回且可读（G4：重启后计划仍在）
    const events = store.load("s0");
    const planCheckpoint = events.find(
      (e): e is Extract<typeof e, { type: "checkpoint" }> =>
        e.type === "checkpoint" && e.provider === "plan",
    );
    expect(planCheckpoint).toBeDefined();
    const ref = planCheckpoint!.ref as { path: string };
    expect(readFileSync(ref.path, "utf8")).toContain("只读研究已完成");
    // 崩溃的执行轮按 Q5 闭合为 interrupted——不自动续跑，绝不重放旧 host 的工作
    expect(
      events.filter((e) => e.type === "turn/end").map((e) => (e as { reason: { kind: string } }).reason.kind),
    ).toEqual(["interrupted"]);
    // 流内 plan 模式事实（无 plan_enter/exit 工具调用 → 普通模式）不受崩溃影响
    expect(events.filter((e) => e.type === "tool/call" && e.name === "plan_enter")).toHaveLength(0);
    storage2.db.close();
  });
});

describe("findInterruptedTurn（M3/T-P1-86 崩溃续跑定位）", () => {
  const seed = (store: SessionStore, sessionId: string, opts: { skipReconcile?: boolean } = {}): void => {
    // 崩溃前缀：turn 1 的 step 1 完成（含工具执行）→ step 2 开着 → 进程死亡
    store.append(sessionId, [
      { type: "turn/start", turn: 1 },
      {
        type: "user/message",
        turn: 1,
        message: { content: "查一下配置再改" },
        source: "user",
        promptId: "p1",
      },
      { type: "step/start", turn: 1, step: 1 },
      { type: "tool/call", turn: 1, step: 1, callId: "c1", name: "read", arguments: "{}" },
      {
        type: "tool/result",
        turn: 1,
        step: 1,
        callId: "c1",
        message: { content: "配置内容 X" },
      },
      {
        type: "assistant/message",
        turn: 1,
        step: 1,
        message: { content: "第一步完成" },
        stream: [],
      },
      { type: "step/end", turn: 1, step: 1 },
      { type: "step/start", turn: 1, step: 2 },
    ]);
    if (!opts.skipReconcile) reconcileBootState(store, sessionId); // resume 的前置：对账闭合
  };

  it("对账后的最新 interrupted 轮 → 返回该轮原始输入（turn/content/promptId）", () => {
    const store = new SessionEventStore();
    seed(store, "s0");
    const info = findInterruptedTurn(store, "s0");
    expect(info).not.toBeNull();
    expect(info!.turn).toBe(1);
    expect(info!.content).toBe("查一下配置再改");
    expect(info!.promptId).toBe("p1");
  });

  it("多条 user/message（step 注入在后）取首条 = 崩溃前的输入", () => {
    const store = new SessionEventStore();
    // 崩溃前缀（同 seed）+ 崩溃前最后一刻的 steer 注入（同轮第二条 user/message）
    seed(store, "s0", { skipReconcile: true });
    store.append("s0", [
      {
        type: "user/message",
        turn: 1,
        message: { content: "（注入）补充要求" },
        source: "injected",
      },
    ]);
    reconcileBootState(store, "s0");
    expect(findInterruptedTurn(store, "s0")?.content).toBe("查一下配置再改");
  });

  it("最新轮已正常收束 → 旧 interrupted 轮过期，返回 null", () => {
    const store = new SessionEventStore();
    seed(store, "s0");
    // 用户重启后继续对话：turn 2 正常完成
    store.append("s0", [
      { type: "turn/start", turn: 2 },
      { type: "user/message", turn: 2, message: { content: "新指令" }, source: "user" },
      { type: "turn/end", turn: 2, reason: { kind: "completed" } },
    ]);
    expect(findInterruptedTurn(store, "s0")).toBeNull();
  });

  it("空流 / 从无崩溃 → null", () => {
    const store = new SessionEventStore();
    expect(findInterruptedTurn(store, "s0")).toBeNull();
    store.append("s0", [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "hi" }, source: "user" },
      { type: "turn/end", turn: 1, reason: { kind: "completed" } },
    ]);
    expect(findInterruptedTurn(store, "s0")).toBeNull();
  });
});
