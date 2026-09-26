import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionEvent } from "./events.js";
import {
  InvariantRegistry,
  createDefaultRegistry,
  expectSingleTerminalPerTurn,
  type Invariant,
} from "./invariants.js";
// re-export 面（T-P1-30 偏离②）：测试既有 import 面零改动
import { expectTurnScoped } from "../test-support/event-asserts.js";
import { createChildAssembly } from "./assembly.js";
import { SessionStore } from "../session/store.js";

/** 合法两轮流：轮 1 带 tool 配平、轮 2 纯文本（服务内建的好流样例）。 */
function goodStream(): SessionEvent[] {
  let seq = 0;
  const mk = (fields: Record<string, unknown>): SessionEvent =>
    ({ seq: ++seq, ts: 0, ...fields }) as SessionEvent;
  return [
    mk({ type: "turn/start", turn: 1 }),
    mk({ type: "user/message", turn: 1, message: { content: "跑一下" }, source: "user" }),
    mk({ type: "step/start", turn: 1, step: 1 }),
    mk({
      type: "assistant/message",
      turn: 1,
      step: 1,
      message: { content: "好" },
      stream: [],
    }),
    mk({ type: "tool/call", turn: 1, step: 1, callId: "c1", name: "bash", arguments: "{}" }),
    mk({ type: "tool/result", turn: 1, step: 1, callId: "c1", message: { content: "ok" } }),
    mk({ type: "step/end", turn: 1, step: 1 }),
    mk({ type: "step/start", turn: 1, step: 2 }),
    mk({
      type: "assistant/message",
      turn: 1,
      step: 2,
      message: { content: "完成" },
      stream: [],
    }),
    mk({ type: "step/end", turn: 1, step: 2 }),
    mk({ type: "turn/end", turn: 1, reason: { kind: "completed" } }),
  ];
}

describe("InvariantRegistry（O12）", () => {
  it("坏流逐不变量收集失败且互不吞错——一处违例不掩盖另一处", () => {
    // 孤儿 tool/result（配平违例）+ 悬挂 turn（作用域违例）同流
    const bad: SessionEvent[] = [
      { seq: 1, ts: 0, type: "turn/start", turn: 1 },
      {
        seq: 2,
        ts: 0,
        type: "tool/result",
        turn: 1,
        step: 1,
        callId: "c9",
        message: { content: "无源之果" },
      },
    ] as SessionEvent[];
    const reports = createDefaultRegistry().check(bad);
    const byName = new Map(reports.map((r) => [r.name, r]));
    expect(byName.get("turn-scoped")!.ok).toBe(false); // 流末悬挂 turn 1
    expect(byName.get("turn-scoped")!.failures[0]).toContain("仍开启");
    expect(byName.get("paired-tool-calls")!.ok).toBe(false);
    expect(byName.get("paired-tool-calls")!.failures[0]).toContain("没有前置 tool/call");
    expect(byName.get("paired-steps")!.ok).toBe(true);
    expect(byName.get("single-terminal-per-turn")!.ok).toBe(false); // turn 1 无终态
  });

  it("好流内建四件全 ok（event-asserts 三断言器经注册表可跑，验收②）", () => {
    const reports = createDefaultRegistry().check(goodStream());
    expect(reports).toHaveLength(4);
    for (const report of reports) {
      expect(report.ok, `${report.name} 不该失败`).toBe(true);
      expect(report.failures).toHaveLength(0);
    }
  });

  it("一个不变量抛异常被收集，其余不变量照常跑（不炸注册表）", () => {
    const registry = new InvariantRegistry()
      .register({
        name: "炸裂不变量",
        validate: () => {
          throw new Error("校验器自身编程错误");
        },
      })
      .register({ name: "正常不变量", validate: (_events, fail) => fail("真违例") });
    const reports = registry.check([]);
    const byName = new Map(reports.map((r) => [r.name, r]));
    expect(byName.get("炸裂不变量")!.ok).toBe(false);
    expect(byName.get("炸裂不变量")!.failures).toEqual(["校验器自身编程错误"]);
    expect(byName.get("正常不变量")!.failures).toEqual(["真违例"]);
  });

  it("自定义不变量多次 fail 收集为完整失败清单（不首错即抛）", () => {
    const custom: Invariant = {
      name: "双失败",
      validate: (_events, fail) => {
        fail("第一处");
        fail("第二处");
      },
    };
    const [report] = new InvariantRegistry().register(custom).check([]);
    expect(report!.ok).toBe(false);
    expect(report!.failures).toEqual(["第一处", "第二处"]);
  });

  it("重复注册名拒绝（名字是一等身份）", () => {
    const registry = new InvariantRegistry().register({ name: "x", validate: () => undefined });
    expect(() => registry.register({ name: "x", validate: () => undefined })).toThrow(
      /重复注册/,
    );
  });

  it("终态恰一的按轮形态：多轮各查各的，单轮双终态被抓", () => {
    const okTwoTurns: SessionEvent[] = [
      { seq: 1, ts: 0, type: "turn/start", turn: 1 },
      { seq: 2, ts: 0, type: "turn/end", turn: 1, reason: { kind: "completed" } },
      { seq: 3, ts: 0, type: "turn/start", turn: 2 },
      { seq: 4, ts: 0, type: "turn/end", turn: 2, reason: { kind: "completed" } },
    ] as SessionEvent[];
    expect(() => expectSingleTerminalPerTurn(okTwoTurns)).not.toThrow();
    const doubleTerminal = [
      ...okTwoTurns,
      { seq: 5, ts: 0, type: "turn/end", turn: 2, reason: { kind: "completed" } },
    ] as SessionEvent[];
    expect(() => expectSingleTerminalPerTurn(doubleTerminal)).toThrow(/2 条 turn\/end/);
  });

  it("re-export 面与实现同源：expectTurnScoped 对坏流人话抛错（验收②）", () => {
    expect(() =>
      expectTurnScoped([
        { seq: 1, ts: 0, type: "turn/end", turn: 1, reason: { kind: "completed" } },
      ] as SessionEvent[]),
    ).toThrow(/要闭合 turn 1，但当前开启的是/);
  });
});

describe("装配接线（T-P1-30：显式启用检查既有流，缺省零行为变化）", () => {
  function makeStore(): { store: SessionStore; root: string } {
    const root = mkdtempSync(join(tmpdir(), "aegent-invariants-"));
    return { store: new SessionStore(), root };
  }

  it("未启用（缺省）：装配零行为变化（好流也无任何检查副作用）", () => {
    const { store, root } = makeStore();
    try {
      store.append("s-inv", goodStream());
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      expect(() =>
        createChildAssembly({
          sessionId: "s-inv",
          store,
          workspaceRoot: root,
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
          logger,
        }),
      ).not.toThrow();
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("显式启用：好流装配成功且零告警（诊断面不误报合法流，验收④回归）", () => {
    const { store, root } = makeStore();
    try {
      store.append("s-inv2", goodStream());
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      expect(() =>
        createChildAssembly({
          sessionId: "s-inv2",
          store,
          workspaceRoot: root,
          contextWindow: 200_000,
          approvalTimeoutMs: 5_000,
          invariants: true,
          logger,
        }),
      ).not.toThrow();
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
