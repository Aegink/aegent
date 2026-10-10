/**
 * 旧数据清理（Q4，T-P2-103）——消费保留策略（Q6）与归档动作（Q8）的
 * **显式**清理动作。
 *
 * 行为锚：pi-desktop·db/migrations.rs 的 boot_maintenance（`DELETE FROM
 * audit_log WHERE ts < now - AUDIT_RETENTION_MS` + task_runs 按 task 分区
 * 留最新 N 条）——取"按保留策略清理 + 清理是显式动作"的行为；🔴 不摘其
 * SQL 与 Rust 迁移框架。
 *
 * 三类清理（卡面）：
 * 1. **审计记录**：`audit_log.at < now - auditDays 天` 删（Q6 常量消费）；
 * 2. **任务运行记录**：每 task_id 只留最新 keepLatestTaskRuns 条；
 * 3. **超保留会话**：最后活跃早于阈值的会话走 Q8 **归档**（不是删除——
 *    "归档是独立一档"）。
 *
 * 纪律：
 * - **显式动作非后台魔法**：无定时器、无隐式 Date.now——调用方给 now、
 *   给 dbPath（CLI 入口 `src/cli/maintenance.ts`；后台调度面随 15d S1）。
 * - **dry-run 是人工确认半边**：`dryRun: true` 只算不执行——清单先给人看。
 * - **分域**：本模块只清"旧数据"（审计/运行记录/超保留会话），不碰 M4 的
 *   内存回收（运行时域：hot 会话的内存态）与 Q3 的截断临时文件（spill 域，
 *   各自清理策略独立）。
 * - 与事件流的关系：会话归档是**搬运**（archive.ts 落归档标记 + 归档档），
 *   事件流本身永不删行（不变量 1）；audit_log/task_runs 是运维账本
 *   （非会话轨迹），其行可删——两张表由本模块的写入面登记（recordAudit /
 *   recordTaskRun），保留策略的判据列建了索引。
 */

import type Database from "better-sqlite3";

import type { JsonValue } from "../core/index.js";
import { archiveSession, type ArchiveReceipt } from "./archive.js";
import { SqliteEventStorage } from "./db.js";
import { MS_PER_DAY, resolveRetentionPolicy, retentionCutoff, type RetentionCutoff, type RetentionPolicy } from "./retention.js";

// ---------------------------------------------------------------------------
// 写入面（运维账本的登记原语——生产者：L2 审计落库 / 任务运行登记）
// ---------------------------------------------------------------------------

/**
 * 审计记录登记行（结构上兼容 policy 域 ApprovalAuditRecord——session 域
 * 不反向依赖 policy 域，故此处取结构面：kind/phase/requestId/tool/surface/
 * approver/at 为检索与清理列，其余扩展字段整体落 payload）。
 */
export interface AuditLogRecord {
  /** 记录族（当前唯一 "approval"——L2 审批审计）。 */
  kind: string;
  /** 阶段（asked / settled / timed-out）。 */
  phase: string;
  requestId: string;
  tool: string;
  surface: string;
  approver: string;
  at: number;
  /** 整条记录 JSON（feedback/replySource 等扩展面——列只做检索与清理）。 */
  payload?: JsonValue;
}

/** 登记一条审计记录（返回行 id；表由迁移 v4 建好）。 */
export function recordAudit(db: Database.Database, record: AuditLogRecord): number {
  const info = db
    .prepare(
      `INSERT INTO audit_log (kind, phase, request_id, tool, surface, approver, at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.kind,
      record.phase,
      record.requestId,
      record.tool,
      record.surface,
      record.approver,
      record.at,
      JSON.stringify(record.payload ?? {}),
    );
  return Number(info.lastInsertRowid);
}

/** 任务运行记录行（status 闭集 = 运行生命周期的四事实；ended_at 终态才有）。 */
export type TaskRunStatus = "running" | "completed" | "failed" | "aborted";

export interface TaskRunRecord {
  /** 任务标识（同一任务的多条运行记录按它分区做保留）。 */
  taskId: string;
  status: TaskRunStatus;
  startedAt: number;
  endedAt?: number;
  detail?: string;
}

/** 登记一条任务运行记录（返回行 id；settle 由生产者同 id 更新或终态直记）。 */
export function recordTaskRun(db: Database.Database, run: TaskRunRecord): number {
  const info = db
    .prepare(
      `INSERT INTO task_runs (task_id, status, started_at, ended_at, detail)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(run.taskId, run.status, run.startedAt, run.endedAt ?? null, run.detail ?? null);
  return Number(info.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// 清理面
// ---------------------------------------------------------------------------

export interface CleanupOptions {
  /** 保留策略覆盖（缺省 RETENTION_POLICY——Q6 单一来源）。 */
  policy?: Partial<RetentionPolicy>;
  /**
   * 会话归档阈值（天）：最后活跃早于 now - N 天的会话归档；缺省 = 策略
   * 的 auditDays（旧数据同一保留窗——策略里没有第二条会话字段，YAGNI）。
   * 显式给值即可与审计窗分开。
   */
  sessionRetentionDays?: number;
  /** dry-run：只产出清单不执行（人工确认半边——零副作用）。 */
  dryRun?: boolean;
}

/** 待归档会话项（清单面）。 */
export interface CleanupSessionCandidate {
  sessionId: string;
  /** 会话最后活跃时间（session_index.updated_ts——flush 落库时点）。 */
  lastActiveTs: number;
}

/** 清理报告：dry-run 与执行共用同一形状（dry-run 的 archived 恒空）。 */
export interface CleanupReport {
  dryRun: boolean;
  now: number;
  /** 审计记录的保留下界（epoch 毫秒；ts < auditBefore 的记录清理）。 */
  auditBefore: number;
  /** 每任务保留的最新运行记录条数。 */
  keepLatestTaskRuns: number;
  /** 会话归档阈值（epoch 毫秒；最后活跃早于此的会话归档）。 */
  sessionCutoff: number;
  /** 命中清理的审计记录数。 */
  auditRecords: number;
  /** 命中清理的任务运行记录数。 */
  taskRunRecords: number;
  /** 命中归档的会话清单（dry-run 与执行同列——清单即预告）。 */
  sessions: CleanupSessionCandidate[];
  /** 实际完成的归档回执（dry-run 恒空）。 */
  archived: ArchiveReceipt[];
}

function assertDbPath(dbPath: string): void {
  if (typeof dbPath !== "string" || dbPath === "" || dbPath === ":memory:") {
    throw new TypeError(`清理需要文件库路径（收到 ${JSON.stringify(dbPath)}）`);
  }
}

/** 每 task 保留最新 N 条的行选择（窗口函数；清理 SQL 与计数 SQL 同一语义）。 */
const TASK_RUNS_BEYOND_SQL = `
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY task_id ORDER BY started_at DESC, id DESC
    ) AS rn FROM task_runs
  ) WHERE rn > ?
`;

/**
 * 执行一次旧数据清理：审计记录按保留窗删 + 任务运行记录按条数删 +
 * 超保留会话归档。dry-run 只算不执行。
 *
 * 次序：先算全部清单（audit/task/session 三类候选）→ dry-run 直接返回 →
 * 否则在同一连接上删审计/任务行（单事务）→ 关闭连接 → 逐会话走
 * archiveSession（Q8 归档自带自己的事务与原子替换）。
 */
export function cleanupSessions(
  dbPath: string,
  now: number,
  options: CleanupOptions = {},
): CleanupReport {
  assertDbPath(dbPath);
  if (!Number.isFinite(now)) {
    throw new TypeError(`清理需要显式时刻 now（收到 ${String(now)}）——不在库内藏隐式 Date.now`);
  }
  const policy = resolveRetentionPolicy(options.policy);
  const cutoff: RetentionCutoff = retentionCutoff(now, policy);
  const sessionDays = options.sessionRetentionDays ?? policy.auditDays;
  if (!Number.isInteger(sessionDays) || sessionDays < 0) {
    throw new TypeError(`会话归档阈值须为非负整数天（收到 ${String(sessionDays)}）`);
  }
  const sessionCutoff = now - sessionDays * MS_PER_DAY;
  const dryRun = options.dryRun === true;

  let auditRecords = 0;
  let taskRunRecords = 0;
  let sessions: CleanupSessionCandidate[] = [];

  const storage = SqliteEventStorage.open({ path: dbPath });
  try {
    const db = storage.db;
    auditRecords = (
      db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE at < ?").get(cutoff.auditBefore) as {
        n: number;
      }
    ).n;
    taskRunRecords = (
      db.prepare(`SELECT COUNT(*) AS n FROM (${TASK_RUNS_BEYOND_SQL})`).get(
        cutoff.keepLatestTaskRuns,
      ) as { n: number }
    ).n;
    sessions = (
      db
        .prepare(
          `SELECT s.session_id AS session_id, s.updated_ts AS updated_ts
           FROM session_index s
           LEFT JOIN archived_sessions a ON a.session_id = s.session_id
           WHERE s.updated_ts < ? AND a.session_id IS NULL
           ORDER BY s.updated_ts ASC`,
        )
        .all(sessionCutoff) as Array<{ session_id: string; updated_ts: number }>
    ).map((r) => ({ sessionId: r.session_id, lastActiveTs: r.updated_ts }));

    if (dryRun) {
      return {
        dryRun: true,
        now,
        auditBefore: cutoff.auditBefore,
        keepLatestTaskRuns: cutoff.keepLatestTaskRuns,
        sessionCutoff,
        auditRecords,
        taskRunRecords,
        sessions,
        archived: [],
      };
    }

    const prune = db.transaction(() => {
      db.prepare("DELETE FROM audit_log WHERE at < ?").run(cutoff.auditBefore);
      db.prepare(`DELETE FROM task_runs WHERE id IN (${TASK_RUNS_BEYOND_SQL})`).run(
        cutoff.keepLatestTaskRuns,
      );
    });
    prune();
  } finally {
    storage.close();
  }

  // 会话归档走 Q8（搬运非删除——逐会话独立事务；归档后主库读面 fail-closed）。
  const archived: ArchiveReceipt[] = [];
  for (const candidate of sessions) {
    archived.push(
      archiveSession(dbPath, candidate.sessionId, { reason: "retention", now: () => now }),
    );
  }

  return {
    dryRun: false,
    now,
    auditBefore: cutoff.auditBefore,
    keepLatestTaskRuns: cutoff.keepLatestTaskRuns,
    sessionCutoff,
    auditRecords,
    taskRunRecords,
    sessions,
    archived,
  };
}
