import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { NewSessionEvent } from "../kernel/events.js";
import { readArchivedSession } from "./archive.js";
import { cleanupSessions, recordAudit, recordTaskRun } from "./cleanup.js";
import { SqliteEventStorage } from "./db.js";
import { SessionStore } from "./store.js";

const DAY = 24 * 3600 * 1000;
const NOW = 1_800_000_000_000;

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-cleanup-"));
  dirs.push(dir);
  return join(dir, "events.sqlite");
}

function sampleTurn(turn: number): NewSessionEvent[] {
  return [
    { type: "turn/start", turn },
    { type: "step/start", turn, step: turn },
    { type: "user/message", turn, message: { content: `q${turn}` }, source: "user" },
    { type: "assistant/message", turn, step: turn, message: { content: `a${turn}` }, stream: [] },
    { type: "step/end", turn, step: turn },
    { type: "turn/end", turn, reason: { kind: "completed" } },
  ];
}

/**
 * 造一个库：三个会话（两个"超保留"、一个"新鲜"——用 session_index
 * .updated_ts 伪造成旧活跃）+ 三条审计记录（两条超窗）+ 任务 A 105 条运行
 * （超 100 五条）+ 任务 B 3 条运行（不超）。
 */
async function seedDb(dbPath: string): Promise<void> {
  const storage = SqliteEventStorage.open({ path: dbPath });
  try {
    const store = new SessionStore(storage);
    for (const id of ["s-old1", "s-old2", "s-new"]) {
      store.append(id, sampleTurn(1));
      await store.flush(id);
    }
    const db = storage.db;
    db.prepare("UPDATE session_index SET updated_ts = ? WHERE session_id = ?").run(NOW - 100 * DAY, "s-old1");
    db.prepare("UPDATE session_index SET updated_ts = ? WHERE session_id = ?").run(NOW - 91 * DAY, "s-old2");
    db.prepare("UPDATE session_index SET updated_ts = ? WHERE session_id = ?").run(NOW - 1 * DAY, "s-new");

    for (let i = 0; i < 3; i++) {
      recordAudit(db, {
        kind: "approval",
        phase: i === 0 ? "asked" : "settled",
        requestId: `r${i}`,
        tool: "bash",
        surface: "cli",
        approver: "user",
        at: i < 2 ? NOW - 91 * DAY : NOW - 1 * DAY,
        payload: { note: `audit-${i}` },
      });
    }
    for (let i = 0; i < 105; i++) {
      recordTaskRun(db, { taskId: "task-A", status: "completed", startedAt: NOW - i * 1000, endedAt: NOW - i * 1000 + 5 });
    }
    for (let i = 0; i < 3; i++) {
      recordTaskRun(db, { taskId: "task-B", status: "failed", startedAt: NOW - i * 1000, detail: `err${i}` });
    }
  } finally {
    storage.close();
  }
}

describe("旧数据清理（Q4/T-P2-103）", () => {
  it("三类清理：审计按窗删 / 任务运行每任务留最新 100 / 超保留会话走归档（不直删）", async () => {
    const dbPath = tempDbPath();
    await seedDb(dbPath);

    const report = cleanupSessions(dbPath, NOW);
    expect(report.dryRun).toBe(false);
    expect(report.auditBefore).toBe(NOW - 90 * DAY);
    expect(report.keepLatestTaskRuns).toBe(100);
    expect(report.sessionCutoff).toBe(NOW - 90 * DAY);
    expect(report.auditRecords).toBe(2);
    expect(report.taskRunRecords).toBe(5); // task-A 105 - 100
    expect(report.sessions.map((s) => s.sessionId)).toEqual(["s-old1", "s-old2"]); // 旧→新
    expect(report.archived).toHaveLength(2);
    expect(report.archived.every((r) => r.eventCount === 7)).toBe(true); // 6 事件 + 归档标记

    // 审计：超窗删、窗内留（payload 原样）
    const storage = SqliteEventStorage.open({ path: dbPath });
    try {
      const rows = storage.db
        .prepare("SELECT request_id, payload FROM audit_log ORDER BY id")
        .all() as Array<{ request_id: string; payload: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.request_id).toBe("r2");
      expect(JSON.parse(rows[0]!.payload)).toEqual({ note: "audit-2" });

      // 任务运行：A 恰留最新 100（started_at 最大的 100 条 = i 0..99）、B 三条不动
      expect(
        (storage.db.prepare("SELECT COUNT(*) AS n FROM task_runs WHERE task_id = 'task-A'").get() as { n: number }).n,
      ).toBe(100);
      expect(
        (storage.db.prepare("SELECT MAX(started_at) AS m FROM task_runs WHERE task_id = 'task-A'").get() as { m: number }).m,
      ).toBe(NOW);
      expect(
        (storage.db.prepare("SELECT MIN(started_at) AS m FROM task_runs WHERE task_id = 'task-A'").get() as { m: number }).m,
      ).toBe(NOW - 99 * 1000);
      expect(
        (storage.db.prepare("SELECT COUNT(*) AS n FROM task_runs WHERE task_id = 'task-B'").get() as { n: number }).n,
      ).toBe(3);

      // 会话：旧的两个已归档（主库行/会话/索引消失），新鲜的仍在
      expect(storage.db.prepare("SELECT 1 AS hit FROM sessions WHERE id = 's-old1'").get()).toBeUndefined();
      expect(storage.db.prepare("SELECT 1 AS hit FROM sessions WHERE id = 's-old2'").get()).toBeUndefined();
      expect(storage.db.prepare("SELECT 1 AS hit FROM sessions WHERE id = 's-new'").get()).not.toBeUndefined();
      // 归档账本留痕（fail-closed 读面判据）
      expect(
        (storage.db.prepare("SELECT COUNT(*) AS n FROM archived_sessions").get() as { n: number }).n,
      ).toBe(2);
    } finally {
      storage.close();
    }

    // 归档档可读 + 归档标记在流尾（归档 ≠ 删除的兑现）
    const archived = readArchivedSession(dbPath, "s-old1");
    expect(archived.reason).toBe("retention");
    expect(archived.events[archived.events.length - 1]!.type).toBe("session/archive");
  });

  it("dry-run 零副作用：清单即预告（三类候选都列出，一行不删一档不写）", async () => {
    const dbPath = tempDbPath();
    await seedDb(dbPath);

    const report = cleanupSessions(dbPath, NOW, { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.auditRecords).toBe(2);
    expect(report.taskRunRecords).toBe(5);
    expect(report.sessions.map((s) => s.sessionId)).toEqual(["s-old1", "s-old2"]);
    expect(report.archived).toEqual([]);

    const storage = SqliteEventStorage.open({ path: dbPath });
    try {
      expect(
        (storage.db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n,
      ).toBe(3);
      expect(
        (storage.db.prepare("SELECT COUNT(*) AS n FROM task_runs").get() as { n: number }).n,
      ).toBe(108);
      expect(
        (storage.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n,
      ).toBe(3);
      // 归档目录零新档（dry-run 不写档）
      expect(storage.db.prepare("SELECT 1 AS hit FROM archived_sessions").get()).toBeUndefined();
    } finally {
      storage.close();
    }
  });

  it("幂等与联动：二次清理零命中（已归档会话不再候选）+ 阈值可显式分窗", async () => {
    const dbPath = tempDbPath();
    await seedDb(dbPath);

    const first = cleanupSessions(dbPath, NOW);
    expect(first.archived).toHaveLength(2);

    const second = cleanupSessions(dbPath, NOW);
    expect(second.auditRecords).toBe(0);
    expect(second.taskRunRecords).toBe(0);
    expect(second.sessions).toEqual([]);
    expect(second.archived).toEqual([]);

    // 显式分窗：把 s-new 的最后活跃改成 30 天前，session-days=7 → 它进候选
    const storage = SqliteEventStorage.open({ path: dbPath });
    storage.db
      .prepare("UPDATE session_index SET updated_ts = ? WHERE session_id = 's-new'")
      .run(NOW - 30 * DAY);
    storage.close();
    const third = cleanupSessions(dbPath, NOW, { sessionRetentionDays: 7 });
    expect(third.sessions.map((s) => s.sessionId)).toEqual(["s-new"]);
    expect(third.archived.map((r) => r.sessionId)).toEqual(["s-new"]);

    // 审计窗边界与覆盖：剩下那条 at = NOW−1 天——audit-days=1 恰在界上
    // 不删（at < cutoff 严格小于）；audit-days=0 时它也超窗
    const boundary = cleanupSessions(dbPath, NOW, { policy: { auditDays: 1 } });
    expect(boundary.auditRecords).toBe(0);
    const zeroWindow = cleanupSessions(dbPath, NOW, { policy: { auditDays: 0 } });
    expect(zeroWindow.auditRecords).toBe(1);
  });
});
