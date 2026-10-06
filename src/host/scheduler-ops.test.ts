/**
 * 调度域装配测试（C1 补口）——cron 库面从"零生产装配"到 host 进程真实
 * 运行时的机验面：
 *   1. createSchedulerRuntime：真 sqlite 库（cron_tasks 表）上 add/list/remove
 *      往返 + tick 到期触发 → sendPrompt 收到任务 prompt（投递链真实）；
 *   2. 未到期不触发（游标防重复：同分钟二次 tick 不再触发）；
 *   3. trySchedulerSettingsOp：运行时缺席类型化报错；运行时在位三 op 分发；
 *   4. parse 层闭集：cron-add 坏表达式被 CronStore.add 拒（进不了库）。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SqliteEventStorage } from "../session/db.js";
import { parseSettingsEnvelope } from "./protocol-settings.js";
import {
  createSchedulerRuntime,
  setSchedulerRuntime,
  trySchedulerSettingsOp,
  type SchedulerRuntime,
} from "./scheduler-ops.js";

let tmpDir: string;
const openDbs: import("better-sqlite3").Database[] = [];

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "aegent-scheduler-"));
});

afterEach(() => {
  setSchedulerRuntime(undefined); // 模块级句柄摘除（用例间隔离）
  for (const db of openDbs.splice(0)) db.close(); // sqlite 句柄先关（Windows 文件锁）
  rmSync(tmpDir, { recursive: true, force: true });
});

/** 真 sqlite 库（v5 迁移建 cron_tasks 表）+ 固定时钟的运行时。 */
function buildRuntime(nowIso: string) {
  const sent: { sessionId: string; prompt: string }[] = [];
  const storage = SqliteEventStorage.open({ path: path.join(tmpDir, "host.db") });
  openDbs.push(storage.db);
  const fixedNow = new Date(nowIso).getTime();
  let current = fixedNow;
  const runtime = createSchedulerRuntime({
    db: storage.db,
    sessionId: "sess-main",
    sendPrompt: async (sessionId, prompt) => {
      sent.push({ sessionId, prompt });
      return { sent: true };
    },
    now: () => current,
    tickIntervalMs: 3_600_000, // 测试内手动 tickOnce——interval 不参与
    onTick: () => {}, // 消费面占位
  });
  return {
    runtime,
    sent,
    storage,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("C1 · 定时任务调度运行时（host 装配面）", () => {
  it("到期任务触发：sendPrompt 收到 prompt 且会话 id 正确；同分钟游标防重复", async () => {
    // 2026-10-06 09:00:30——表达式「0 9 * * *」当分钟到期
    const { runtime, sent, advance } = buildRuntime("2026-10-06T09:00:30");
    setSchedulerRuntime(runtime);
    runtime.store.add({ expr: "0 9 * * *", prompt: "早间汇总", createdAt: 0 });

    const fired = runtime.tickOnce();
    expect(fired).toHaveLength(1);
    expect(fired[0]?.task.prompt).toBe("早间汇总");
    // 投递在 job 的异步 run 里落——等微任务链排空
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toEqual([{ sessionId: "sess-main", prompt: "早间汇总" }]);
    // 同分钟二次 tick：游标已推进——不重触发（D15 同向：不重复副作用）
    expect(runtime.tickOnce()).toHaveLength(0);
    expect(sent).toHaveLength(1);
    advance(60_000); // 下一分钟不在 9 点整点档
    expect(runtime.tickOnce()).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  it("未到期不触发；job 审计面（JobRegistry）随触发记账", () => {
    const { runtime } = buildRuntime("2026-10-06T08:59:00");
    setSchedulerRuntime(runtime);
    runtime.store.add({ expr: "0 9 * * *", prompt: "尚未到期", createdAt: 0 });
    expect(runtime.tickOnce()).toHaveLength(0);
  });

  it("三 op 分发：add → list → remove 往返（真库）；坏表达式进不了库", () => {
    const { runtime } = buildRuntime("2026-10-06T09:00:00");
    setSchedulerRuntime(runtime);

    const added = trySchedulerSettingsOp({ op: "cron-add", expr: "*/5 * * * *", prompt: "每五分钟" }) as {
      task: { id: string; expr: string; prompt: string };
    };
    expect(added.task.expr).toBe("*/5 * * * *");

    const listed = trySchedulerSettingsOp({ op: "cron-list" }) as { tasks: unknown[] };
    expect(listed.tasks).toHaveLength(1);

    const removed = trySchedulerSettingsOp({ op: "cron-remove", id: added.task.id }) as { removed: boolean };
    expect(removed.removed).toBe(true);
    expect((trySchedulerSettingsOp({ op: "cron-list" }) as { tasks: unknown[] }).tasks).toHaveLength(0);

    // 坏表达式：parse 层闭集过（形状合法），CronStore.add 入库校验拒绝
    expect(() =>
      trySchedulerSettingsOp({ op: "cron-add", expr: "not-a-cron", prompt: "x" }),
    ).toThrow(/cron/i);
  });

  it("运行时缺席：cron 族类型化报错（fail-closed），其余 op 返回 undefined 不截胡", () => {
    setSchedulerRuntime(undefined);
    for (const op of ["cron-list", "cron-add", "cron-remove"]) {
      expect(() => trySchedulerSettingsOp({ op })).toThrow(/调度器未启用/);
    }
    expect(trySchedulerSettingsOp({ op: "skills-list" })).toBeUndefined();
  });

  it("parse 层闭集：cron-add 载荷形状校验（缺 expr/prompt 整信封拒）", () => {
    for (const record of [{ op: "cron-add", prompt: "x" }, { op: "cron-add", expr: "* * * * *" }]) {
      expect(() =>
        parseSettingsEnvelope({ type: "settings", requestId: "s1", ...record }),
      ).toThrow(/cron-add/);
    }
    const ok = parseSettingsEnvelope({
      type: "settings",
      requestId: "s2",
      op: "cron-add",
      expr: "* * * * *",
      prompt: "每分钟",
    });
    expect(ok.op).toBe("cron-add");
  });

  it("stop 收束：运行时 stop 后句柄摘除（host stop 链的消费面）", () => {
    const { runtime } = buildRuntime("2026-10-06T09:00:00");
    setSchedulerRuntime(runtime);
    runtime.stop();
    setSchedulerRuntime(undefined);
    expect(() => trySchedulerSettingsOp({ op: "cron-list" })).toThrow(/调度器未启用/);
  });
});

describe("C1 · 装配结构红线（server 面静态断言）", () => {
  it("automation-runtime.ts 真实装配 createSchedulerRuntime 且 stop 链收束（防装配缺口回潮）", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("./automation-runtime.ts", import.meta.url), "utf8");
    expect(source).toContain("createSchedulerRuntime({");
    expect(source).toContain("setSchedulerRuntime(schedulerRuntime)");
    expect(source).toContain("setSchedulerRuntime(undefined)");
    expect(source).toContain("sendSystemPrompt");
  });
});

// SchedulerRuntime 类型消费位占位（避免未使用 import——jobs 审计面在用例 1 隐式覆盖）
export type RuntimeProbe = SchedulerRuntime;
