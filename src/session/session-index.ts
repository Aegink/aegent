/**
 * 会话索引读面（E8，T-P1-97）——导出/索引/兼容三分中的**索引面**。
 *
 * 消费 Q1/T-P1-89 的 v2 session_index 表（增量维护已由 db.appendBatch 的
 * upsertIndex 承载——flush 落库时点更新，表与数据恒不 stale）。本模块是
 * 读取原语（list/查询）+ **全量重建面**（表损坏/历史数据修正的兜底——
 * 重建与增量同一聚合 SQL，语义恒等）。
 *
 * 三分纪律：本模块不 import 导出面（export.ts）与迁移链（migrate.ts）——
 * grep 证伪在测试；索引读写不改事件流（events 表零触碰——只读聚合）。
 */

import type Database from "better-sqlite3";
import type { SqliteEventStorage } from "./db.js";

export interface SessionIndexRow {
  sessionId: string;
  firstSeq: number;
  lastSeq: number;
  eventCount: number;
  createdTs: number;
  updatedTs: number;
}

const ROW_SQL = `
  SELECT session_id, first_seq, last_seq, event_count, created_ts, updated_ts
  FROM session_index
`;

function toRow(r: {
  session_id: string;
  first_seq: number;
  last_seq: number;
  event_count: number;
  created_ts: number;
  updated_ts: number;
}): SessionIndexRow {
  return {
    sessionId: r.session_id,
    firstSeq: r.first_seq,
    lastSeq: r.last_seq,
    eventCount: r.event_count,
    createdTs: r.created_ts,
    updatedTs: r.updated_ts,
  };
}

/** 全部会话索引行（updatedTs 降序——最近活跃在前）。 */
export function listSessionIndex(storage: SqliteEventStorage): SessionIndexRow[] {
  const rows = storage.db.prepare(`${ROW_SQL} ORDER BY updated_ts DESC`).all() as Array<{
    session_id: string;
    first_seq: number;
    last_seq: number;
    event_count: number;
    created_ts: number;
    updated_ts: number;
  }>;
  return rows.map(toRow);
}

/**
 * 全量重建（DELETE 全表 + 从 events/sessions 重新聚合——与 Q1 迁移回填、
 * db.appendBatch 增量 upsert 是同一 SQL 语义，三种路径结果恒等）。单事务。
 */
export function rebuildSessionIndex(db: Database.Database): number {
  const run = db.transaction(() => {
    db.exec("DELETE FROM session_index");
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
  });
  run();
  const row = db.prepare("SELECT COUNT(*) AS n FROM session_index").get() as { n: number };
  return row.n;
}
