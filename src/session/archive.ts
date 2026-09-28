/**
 * 会话归档（Q8，T-P2-102）——归档是独立一档（`ARCHIVED_SESSIONS_SUBDIR`），
 * 不是删除。
 *
 * 行为锚：codex·rollout/src/lib.rs:87 `ARCHIVED_SESSIONS_SUBDIR = "archived_sessions"`
 * 与 compression.rs 的归档域纪律（归档与压缩/删除分型——归档域独立扫描、
 * 独立管理）。🔴 只学"归档是独立一档"的行为，不摘其压缩实现（我方压缩在
 * 上下文域，与归档正交）。
 *
 * 我方落法（卡面定形）：会话级文件移动而非行级迁移——单库多会话的
 * SQLite 形态下，"归档 = 会话全量导出到归档目录下的独立归档库文件 +
 * 主库删除 + 主库账本留去向标记"。三条纪律：
 * - **归档 ≠ 删除**：归档档是完整可读的会话快照（含归档标记事件本身），
 *   主库删除只是"移出热库"；归档档读取面自足（元数据 + 事件全在文件里）。
 * - **流内事实**：归档标记 `session/archive {reason?}` 在移出**之前**落流尾
 *   （log-only 会话级元事件，#22 立案），随数据一起进归档档——归档档自带
 *   "何时因何归档"，不依赖主库账本旁证。
 * - **fail-closed 读面**：主库读路径对已归档会话类型化拒绝
 *   （SessionArchivedError，"查无此会话"与"已归档"是两类事实）；归档档经
 *   readArchivedSession 显式读取。
 *
 * 原子性：归档档先写 tmp 再 rename 覆盖（log-archive.ts 同款 Windows 语义），
 * 全部写齐后才在主库单事务里"记账本 + 删数据"。崩溃在 rename 与删除之间 →
 * 会话仍在主库（未记账本），重试幂等（标记事件只在流尾缺席时追加）。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";

import Database from "better-sqlite3";

import type { SessionEvent } from "../kernel/events.js";
import { isValidSessionId } from "./session-id.js";
import { SqliteEventStorage } from "./db.js";
import { Projector } from "./project.js";

/** 归档目录名（主库所在目录下——库可搬家，归档目录随行）。codex 同值。 */
export const ARCHIVED_SESSIONS_SUBDIR = "archived_sessions";

export type ArchiveErrorCode =
  | "ARCHIVE_BAD_DB_PATH"
  | "ARCHIVE_BAD_SESSION_ID"
  | "ARCHIVE_SESSION_MISSING"
  | "ARCHIVE_ALREADY_ARCHIVED"
  | "ARCHIVE_NOT_FOUND"
  | "ARCHIVE_FILE_CORRUPT";

export class ArchiveError extends Error {
  constructor(
    readonly code: ArchiveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ArchiveError";
  }
}

/** 归档回执（动作成功的事实面）。 */
export interface ArchiveReceipt {
  sessionId: string;
  /** 归档档文件绝对路径（读取面入参之外的可观测面）。 */
  archivePath: string;
  /** 归档的事件总数（含归档标记事件）。 */
  eventCount: number;
  archivedAt: number;
}

/** 归档清单项（listArchivedSessions 产物——归档档元数据自足读出）。 */
export interface ArchivedSessionInfo {
  sessionId: string;
  archivedAt: number;
  eventCount: number;
  reason?: string;
  archivePath: string;
}

/** 归档档读取产物（readArchivedSession）。 */
export interface ArchivedSession {
  sessionId: string;
  archivedAt: number;
  eventCount: number;
  reason?: string;
  events: readonly SessionEvent[];
}

export interface ArchiveOptions {
  /** 归档原因（自由文本，进归档标记事件与归档档元数据）。 */
  reason?: string;
  /** 时间源（测试注入；缺省 Date.now）。 */
  now?: () => number;
}

interface ArchiveMetaRow {
  session_id: string;
  archived_at: number;
  event_count: number;
  reason: string | null;
}

function assertDbPath(dbPath: string): void {
  if (typeof dbPath !== "string" || dbPath === "" || dbPath === ":memory:") {
    throw new ArchiveError(
      "ARCHIVE_BAD_DB_PATH",
      `归档需要文件库路径（收到 ${JSON.stringify(dbPath)}——内存库无归档档落点）`,
    );
  }
}

function assertSessionId(sessionId: string): void {
  if (!isValidSessionId(sessionId)) {
    throw new ArchiveError("ARCHIVE_BAD_SESSION_ID", `会话 id 不合法：${JSON.stringify(sessionId)}`);
  }
}

/** 会话 id → 归档文件名（encodeURIComponent——wire 校验允含 "/" 等字符，文件名必须编码）。 */
function archiveFileName(sessionId: string): string {
  return `${encodeURIComponent(sessionId)}.sqlite`;
}

function archiveDirOf(dbPath: string): string {
  return join(dirname(dbPath), ARCHIVED_SESSIONS_SUBDIR);
}

function archivePathOf(dbPath: string, sessionId: string): string {
  return join(archiveDirOf(dbPath), archiveFileName(sessionId));
}

const ARCHIVE_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS archived_meta (
    session_id  TEXT    PRIMARY KEY,
    archived_at INTEGER NOT NULL,
    event_count INTEGER NOT NULL,
    reason      TEXT
);

CREATE TABLE IF NOT EXISTS archived_events (
    seq     INTEGER PRIMARY KEY,
    payload TEXT    NOT NULL
);
`;

let tmpCounter = 0;

/** 写归档档（tmp 路径——调用方 rename 覆盖目标；归档档是冷文件无 WAL 旁文件）。 */
function writeArchiveFile(
  path: string,
  meta: { sessionId: string; archivedAt: number; eventCount: number; reason?: string },
  events: readonly SessionEvent[],
): void {
  const db = new Database(path);
  try {
    db.exec(ARCHIVE_SCHEMA_DDL);
    db.prepare(
      "INSERT INTO archived_meta (session_id, archived_at, event_count, reason) VALUES (?, ?, ?, ?)",
    ).run(meta.sessionId, meta.archivedAt, meta.eventCount, meta.reason ?? null);
    const insertEvent = db.prepare("INSERT INTO archived_events (seq, payload) VALUES (?, ?)");
    for (const event of events) {
      insertEvent.run(event.seq, JSON.stringify(event));
    }
  } finally {
    db.close();
  }
}

function readArchiveMeta(path: string): ArchiveMetaRow {
  let db: Database.Database;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new ArchiveError(
      "ARCHIVE_FILE_CORRUPT",
      `归档档打不开：${path}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }
  try {
    const row = db
      .prepare("SELECT session_id, archived_at, event_count, reason FROM archived_meta")
      .get() as ArchiveMetaRow | undefined;
    if (!row) {
      throw new ArchiveError("ARCHIVE_FILE_CORRUPT", `归档档缺少元数据行：${path}`);
    }
    return row;
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError(
      "ARCHIVE_FILE_CORRUPT",
      `归档档读取失败：${path}（${error instanceof Error ? error.message : String(error)}）`,
    );
  } finally {
    db.close();
  }
}

function toInfo(path: string, row: ArchiveMetaRow): ArchivedSessionInfo {
  return {
    sessionId: row.session_id,
    archivedAt: row.archived_at,
    eventCount: row.event_count,
    ...(row.reason !== null ? { reason: row.reason } : {}),
    archivePath: path,
  };
}

/**
 * 归档一个会话：流尾落归档标记（幂等）→ 全量写入归档档（tmp + rename）→
 * 主库单事务"记账本 + 从 events/sessions/session_index 删除"。
 * 失败面全部类型化（ArchiveError）；归档是显式动作（调用方给 now——无后台魔法）。
 */
export function archiveSession(
  dbPath: string,
  sessionId: string,
  options: ArchiveOptions = {},
): ArchiveReceipt {
  assertDbPath(dbPath);
  assertSessionId(sessionId);
  const archivedAt = (options.now ?? Date.now)();
  const storage = SqliteEventStorage.open({ path: dbPath });
  try {
    const ledgerHit = storage.db
      .prepare("SELECT 1 AS hit FROM archived_sessions WHERE session_id = ?")
      .get(sessionId);
    if (ledgerHit !== undefined) {
      throw new ArchiveError(
        "ARCHIVE_ALREADY_ARCHIVED",
        `会话 ${sessionId} 已在归档账本（归档只发生一次——重归档请从归档档读）`,
      );
    }
    const rows = storage.db
      .prepare("SELECT payload FROM events WHERE session_id = ? ORDER BY seq ASC")
      .all(sessionId) as Array<{ payload: string }>;
    if (rows.length === 0) {
      throw new ArchiveError(
        "ARCHIVE_SESSION_MISSING",
        `会话 ${sessionId} 在主库不存在（无事件行——先 flush/restore，或已归档）`,
      );
    }

    // 归档标记落流尾（log-only 会话级元事件，#22）：只在流尾缺席时追加
    // （崩溃重试幂等——不重复追加第二枚标记）。
    let stream: SessionEvent[] = rows.map((r) => JSON.parse(r.payload) as SessionEvent);
    const last = stream[stream.length - 1]!;
    if (last.type !== "session/archive") {
      const marker = {
        type: "session/archive",
        turn: last.turn,
        seq: last.seq + 1,
        ts: archivedAt,
        ...(options.reason !== undefined ? { reason: options.reason } : {}),
      } as SessionEvent;
      storage.db
        .prepare("INSERT INTO events (session_id, seq, type, payload, ts) VALUES (?, ?, ?, ?, ?)")
        .run(sessionId, marker.seq, marker.type, JSON.stringify(marker), marker.ts);
      stream = [...stream, marker];
    }

    // 归档前流完整性校验（E16 读路径闸门）：损坏流拒绝归档——绝不把坏数据
    // 搬进归档档再删主库。
    Projector.fold(stream);

    const archivePath = archivePathOf(dbPath, sessionId);
    const archiveDir = archiveDirOf(dbPath);
    mkdirSync(archiveDir, { recursive: true });
    const tmpPath = join(archiveDir, `.tmp-${process.pid}-${++tmpCounter}-${archiveFileName(sessionId)}`);
    try {
      writeArchiveFile(
        tmpPath,
        {
          sessionId,
          archivedAt,
          eventCount: stream.length,
          ...(options.reason !== undefined ? { reason: options.reason } : {}),
        },
        stream,
      );
      // tmp → 目标原子替换（Windows 实测 MoveFileEx REPLACE_EXISTING 语义，
      // 覆盖已存在的崩溃残留/旧档——main 库删除还没发生，重试即修复）
      renameSync(tmpPath, archivePath);
    } catch (error) {
      rmSync(tmpPath, { force: true });
      throw error;
    }

    const ledger = storage.db.transaction(() => {
      storage.db
        .prepare(
          "INSERT INTO archived_sessions (session_id, archived_at, event_count, reason, archive_file) VALUES (?, ?, ?, ?, ?)",
        )
        .run(sessionId, archivedAt, stream.length, options.reason ?? null, archiveFileName(sessionId));
      storage.db.prepare("DELETE FROM events WHERE session_id = ?").run(sessionId);
      storage.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
      storage.db.prepare("DELETE FROM session_index WHERE session_id = ?").run(sessionId);
    });
    ledger();

    return { sessionId, archivePath, eventCount: stream.length, archivedAt };
  } finally {
    storage.close();
  }
}

/**
 * 归档清单：扫描归档目录的归档档并读其元数据（**不依赖主库账本**——
 * 账本丢失不丢归档，归档档元数据自足）。按归档时间降序。
 */
export function listArchivedSessions(dbPath: string): ArchivedSessionInfo[] {
  assertDbPath(dbPath);
  const archiveDir = archiveDirOf(dbPath);
  if (!existsSync(archiveDir)) return [];
  const files = readdirSync(archiveDir).filter(
    (f) => f.endsWith(".sqlite") && !f.startsWith(".tmp-"),
  );
  const infos = files.map((f) => {
    const path = join(archiveDir, f);
    return toInfo(path, readArchiveMeta(path));
  });
  return infos.sort((a, b) => b.archivedAt - a.archivedAt);
}

/** 归档档读取面（归档 ≠ 删除的兑现：归档会话数据完整可查）。 */
export function readArchivedSession(dbPath: string, sessionId: string): ArchivedSession {
  assertDbPath(dbPath);
  assertSessionId(sessionId);
  const path = archivePathOf(dbPath, sessionId);
  if (!existsSync(path)) {
    throw new ArchiveError("ARCHIVE_NOT_FOUND", `会话 ${sessionId} 没有归档档：${path}`);
  }
  const meta = readArchiveMeta(path);
  let db: Database.Database;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new ArchiveError(
      "ARCHIVE_FILE_CORRUPT",
      `归档档打不开：${path}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }
  try {
    const rows = db
      .prepare("SELECT payload FROM archived_events ORDER BY seq ASC")
      .all() as Array<{ payload: string }>;
    return {
      sessionId: meta.session_id,
      archivedAt: meta.archived_at,
      eventCount: meta.event_count,
      ...(meta.reason !== null ? { reason: meta.reason } : {}),
      events: rows.map((r) => JSON.parse(r.payload) as SessionEvent),
    };
  } finally {
    db.close();
  }
}
