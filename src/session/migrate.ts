/**
 * 会话格式迁移链（Q1，T-P1-89）——单调整数版本、相邻迁移注册表。
 *
 * 取 dsh·session-format/src/chain.ts 的纪律：currentVersion + **相邻迁移**
 * 声明（vN→vN+1，绝不跨级）——缺失相邻迁移即抛 MigrationChainBrokenError
 * （code=MIGRATION_CHAIN_BROKEN，fail-closed：宁可打不开库，也不静默跳级
 * 打开半迁移的库）；单调整数（不搞 major/minor——"写入方决定 bump，拿不准
 * 就 bump"）。
 *
 * 报错方向敏感（Q1 验收原文）：库比代码新 → 拒绝打开（assertSchemaVersionGate，
 * O19 基建；未知新版本的数据不猜）；代码比库新 → 逐级迁移到当前版本。
 * 未知事件类型显式拒绝（非透传）由 E16 校验面承载（project.ts KNOWN_TYPES，
 * append 与 restore 同闸）。
 *
 * 真实迁移 v1→v2（本卡落地，兑现 T-P1-36"真实 v0→vN 迁移链批次 10 落地"
 * 的消费记档）：建会话索引表 session_index（E8 索引面的地基；v2 的正当
 * bump 理由）并从既有事件回填——旧库打开即自动迁移，数据不重排（payload
 * 列整事件 JSON 存取，schema 演进只加表不加列）。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

export class MigrationChainBrokenError extends Error {
  readonly code = "MIGRATION_CHAIN_BROKEN";
  constructor(readonly missingFrom: number) {
    super(`迁移链缺失 v${missingFrom}→v${missingFrom + 1} 的相邻迁移（fail-closed，拒绝跳级）`);
    this.name = "MigrationChainBrokenError";
  }
}

export interface SchemaMigration {
  readonly from: number;
  readonly to: number;
  /** 在调用方的事务内执行（整链单事务——T-1-02 批量原子语义）。 */
  readonly apply: (db: Database.Database) => void;
}

/** v0→v1 基线 schema（schema.sql 读取面从 db.migrate 归位到链上）。 */
function applyBaseSchema(db: Database.Database): void {
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
  db.exec(readFileSync(schemaPath, "utf-8"));
}

/** v1→v2：会话索引表（E8 地基）+ 既有数据回填。 */
export const SCHEMA_V2_INDEX_DDL = `
CREATE TABLE IF NOT EXISTS session_index (
    session_id  TEXT    PRIMARY KEY,
    first_seq   INTEGER NOT NULL,
    last_seq    INTEGER NOT NULL,
    event_count INTEGER NOT NULL,
    created_ts  INTEGER NOT NULL,
    updated_ts  INTEGER NOT NULL
);
`;

/**
 * v2→v3：归档账本表（Q8/T-P2-102 地基）——记录"哪些会话已归档到
 * ARCHIVED_SESSIONS_SUBDIR 的独立归档档"（归档 ≠ 删除：账本是**去向标记**，
 * 不是数据副本。主库读面凭它 fail-closed 拒绝，归档档读取面凭各归档文件的
 * 元数据自足可查——账本丢失不丢归档）。archive_file 存相对文件名（目录随
 * 主库位置解析——库可搬家）。
 */
export const SCHEMA_V3_ARCHIVE_LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS archived_sessions (
    session_id   TEXT    PRIMARY KEY,
    archived_at  INTEGER NOT NULL,
    event_count  INTEGER NOT NULL,
    reason       TEXT,
    archive_file TEXT    NOT NULL
);
`;

/**
 * v3→v4：运维账本两表（Q4/T-P2-103 地基）——`audit_log`（L2 审批审计记录
 * 的落库面）与 `task_runs`（任务运行记录）。两表都是**运维账本**而非会话
 * 轨迹（L1 纪律不破：会话事实仍在 events 表；审计/运行记录本就无事件词汇
 * 承载——L2 审计按设计走宣告通道）。清理判据列（at / task_id+started_at）
 * 建索引（保留策略清理按这两列删扫）。
 */
export const SCHEMA_V4_MAINTENANCE_DDL = `
CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT    NOT NULL,
    phase      TEXT    NOT NULL,
    request_id TEXT    NOT NULL,
    tool       TEXT    NOT NULL,
    surface    TEXT    NOT NULL,
    approver   TEXT    NOT NULL,
    at         INTEGER NOT NULL,
    payload    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log (at);

CREATE TABLE IF NOT EXISTS task_runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    TEXT    NOT NULL,
    status     TEXT    NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at   INTEGER,
    detail     TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs (task_id, started_at DESC);
`;

export const MIGRATIONS: readonly SchemaMigration[] = [
  { from: 0, to: 1, apply: applyBaseSchema },
  {
    from: 1,
    to: 2,
    apply: (db) => {
      db.exec(SCHEMA_V2_INDEX_DDL);
      // 回填：从既有 sessions/events 聚合（旧库打开即自动建索引，数据不重排）
      db.exec(`
        INSERT INTO session_index (session_id, first_seq, last_seq, event_count, created_ts, updated_ts)
        SELECT s.id,
               COALESCE(MIN(e.seq), 0),
               COALESCE(MAX(e.seq), 0),
               COUNT(e.seq),
               s.created_ts,
               COALESCE(MAX(e.ts), s.created_ts)
        FROM sessions s LEFT JOIN events e ON e.session_id = s.id
        GROUP BY s.id
      `);
    },
  },
  {
    from: 2,
    to: 3,
    // 只加表不加列（payload 整事件 JSON 存取，schema 演进零数据重排）
    apply: (db) => {
      db.exec(SCHEMA_V3_ARCHIVE_LEDGER_DDL);
    },
  },
  {
    from: 3,
    to: 4,
    apply: (db) => {
      db.exec(SCHEMA_V4_MAINTENANCE_DDL);
    },
  },
];

/**
 * 规划 from→to 的逐级迁移序列。缺失相邻迁移（注册表不完整）→
 * MigrationChainBrokenError fail-closed——绝不静默跳级。
 */
export function planMigrationChain(
  from: number,
  to: number,
  migrations: readonly SchemaMigration[] = MIGRATIONS,
): SchemaMigration[] {
  if (from > to) throw new MigrationChainBrokenError(from); // 倒退不是迁移
  const plan: SchemaMigration[] = [];
  for (let version = from; version < to; version += 1) {
    const step = migrations.find((m) => m.from === version && m.to === version + 1);
    if (!step) throw new MigrationChainBrokenError(version);
    plan.push(step);
  }
  return plan;
}
