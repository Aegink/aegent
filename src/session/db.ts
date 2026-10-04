/**
 * SQLite 落地（E2）——better-sqlite3 同步 API 与"同步 append"语义同构。
 *
 * 分层（照 cc-switch database/ 的形状，P0 只有一个域所以 DAO 就地内联，
 * 第二个域出现时再拆文件）：schema.sql（DDL）独立于本文件（连接 + 迁移 + events DAO）。
 *
 * appendBatch 用单事务实现批量原子：进程崩溃后要么整批都在，要么整批都不在
 * ——这是 SessionStore.write-behind 契约的存储端前提。
 */

import Database from "better-sqlite3";

import type { SessionEvent } from "../kernel/events.js";
import type { EventStorage } from "./store.js";
import { isValidSessionId } from "./session-id.js";
import { MIGRATIONS, planMigrationChain } from "./migrate.js";

export const CURRENT_SCHEMA_VERSION = 8;

/** 归档后从主库读该会话的 fail-closed 拒绝（Q8/T-P2-102）——归档 ≠ 删除，
 * 数据在归档档（archive.ts 的 readArchivedSession 可查），主库读路径必须
 * 显式拒绝而不是返回空流（"查无此会话"与"已归档"是两类事实）。 */
export class SessionArchivedError extends Error {
  readonly code = "SESSION_ARCHIVED";
  constructor(readonly sessionId: string) {
    super(`会话 ${sessionId} 已归档（Q8）：数据在归档档（ARCHIVED_SESSIONS_SUBDIR），主库不再持有`);
    this.name = "SessionArchivedError";
  }
}

export interface OpenDbOptions {
  /** 文件路径；":memory:" 时全内存。 */
  path: string;
}

export class SqliteEventStorage implements EventStorage {
  private readonly insertEvent: Database.Statement;
  private readonly ensureSession: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectArchived: Database.Statement;

  private constructor(public readonly db: Database.Database) {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    this.migrate();

    this.ensureSession = db.prepare("INSERT OR IGNORE INTO sessions (id, created_ts) VALUES (?, ?)");
    this.insertEvent = db.prepare(
      "INSERT INTO events (session_id, seq, type, payload, ts) VALUES (?, ?, ?, ?, ?)",
    );
    this.selectAll = db.prepare(
      "SELECT payload FROM events WHERE session_id = ? ORDER BY seq ASC",
    );
    // Q8/T-P2-102：归档账本查询（readAll 的 fail-closed 判据源）
    this.selectArchived = db.prepare(
      "SELECT 1 AS hit FROM archived_sessions WHERE session_id = ?",
    );
  }

  static open(options: OpenDbOptions): SqliteEventStorage {
    const db = new Database(options.path);
    try {
      return new SqliteEventStorage(db);
    } catch (err) {
      // 初始化失败（如 schema 版本拒绝）也要关掉底层连接，否则 Windows 上句柄泄漏锁文件
      db.close();
      throw err;
    }
  }

  /**
   * user_version 单调推进（Q1/T-P1-89 迁移链化）：库比代码新 → 拒绝打开
   * （fail-closed，报错方向敏感）；代码比库新 → 相邻迁移注册表逐级迁移
   * （缺失相邻迁移 fail-closed），整链单事务（T-1-02 批量原子语义——中途
   * 失败无半写，重启重跑幂等）。
   */
  private migrate(): void {
    const version = (this.db.pragma("user_version", { simple: true }) as number) ?? 0;
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `数据库 schema 版本（${version}）比当前代码（${CURRENT_SCHEMA_VERSION}）更新——拒绝用旧代码打开新库`,
      );
    }
    if (version === CURRENT_SCHEMA_VERSION) return;
    const plan = planMigrationChain(version, CURRENT_SCHEMA_VERSION, MIGRATIONS);
    this.db.transaction(() => {
      for (const step of plan) {
        step.apply(this.db);
      }
      this.db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
    })();
  }

  appendBatch(sessionId: string, events: readonly SessionEvent[]): void {
    if (events.length === 0) return;
    const run = this.db.transaction(() => {
      this.ensureSession.run(sessionId, events[0]!.ts);
      for (const event of events) {
        this.insertEvent.run(sessionId, event.seq, event.type, JSON.stringify(event), event.ts);
      }
      // Q1 v2：会话索引随写维护（E8 读面的地基——表与数据恒不 stale）
      this.upsertIndex(sessionId);
    });
    run();
  }

  /** 会话索引 upsert：从本会话事件聚合（幂等——重建与增量同一 SQL）。 */
  private upsertIndex(sessionId: string): void {
    this.db
      .prepare(
        `INSERT INTO session_index (session_id, first_seq, last_seq, event_count, created_ts, updated_ts)
         SELECT s.id,
                COALESCE(MIN(e.seq), 0),
                COALESCE(MAX(e.seq), 0),
                COUNT(e.seq),
                s.created_ts,
                COALESCE(MAX(e.ts), s.created_ts)
         FROM sessions s LEFT JOIN events e ON e.session_id = s.id
         WHERE s.id = ?
         GROUP BY s.id
         ON CONFLICT(session_id) DO UPDATE SET
           first_seq = excluded.first_seq,
           last_seq = excluded.last_seq,
           event_count = excluded.event_count,
           updated_ts = excluded.updated_ts`,
      )
      .run(sessionId);
  }

  /** E8 消费面：会话索引行（Q1 v2 表的读取原语）。 */
  readSessionIndex(sessionId: string): { firstSeq: number; lastSeq: number; eventCount: number; createdTs: number; updatedTs: number } | null {
    const row = this.db
      .prepare(
        "SELECT first_seq, last_seq, event_count, created_ts, updated_ts FROM session_index WHERE session_id = ?",
      )
      .get(sessionId) as
      | { first_seq: number; last_seq: number; event_count: number; created_ts: number; updated_ts: number }
      | undefined;
    if (!row) return null;
    return {
      firstSeq: row.first_seq,
      lastSeq: row.last_seq,
      eventCount: row.event_count,
      createdTs: row.created_ts,
      updatedTs: row.updated_ts,
    };
  }

  readAll(sessionId: string): SessionEvent[] {
    // Q8/T-P2-102：已归档会话在主库读面 fail-closed——归档 ≠ 删除，但主库
    // 不再持有其数据；静默返回空流会把"已归档"误报成"查无此会话"。
    if (this.selectArchived.get(sessionId) !== undefined) {
      throw new SessionArchivedError(sessionId);
    }
    const rows = this.selectAll.all(sessionId) as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as SessionEvent);
  }

  /**
   * U3/T-P3-105 会话历史清单（session_index 全表 + 标题）：标题 = 每会话
   * 首条 user/message 的内容前 60 字（pi-desktop 会话列表的信息架构——
   * 时间/标题/规模）。SQLite bare-column 语义：min(seq) 行的 payload。
   */
  listSessionSummaries(limit = 100): {
    sessionId: string;
    eventCount: number;
    createdTs: number;
    updatedTs: number;
    title?: string;
  }[] {
    const rows = this.db
      .prepare(
        "SELECT session_id, event_count, created_ts, updated_ts FROM session_index ORDER BY updated_ts DESC LIMIT ?",
      )
      .all(limit) as Array<{ session_id: string; event_count: number; created_ts: number; updated_ts: number }>;
    // T-P3-147 E：生成标题优先（session_titles 表），回退首条 user 消息截断
    const generatedTitles = new Map(
      (
        this.db
          .prepare("SELECT session_id, title, source FROM session_titles")
          .all() as Array<{ session_id: string; title: string; source: string }>
      ).map((r) => [r.session_id, r.title]),
    );
    const titles = this.db
      .prepare(
        "SELECT session_id, payload FROM events WHERE type = 'user/message' AND session_id IN (SELECT session_id FROM session_index) GROUP BY session_id HAVING seq = MIN(seq)",
      )
      .all() as Array<{ session_id: string; payload: string }>;
    const titleOf = new Map(
      titles.map((t) => {
        try {
          const event = JSON.parse(t.payload) as { message?: { content?: unknown } };
          const raw = event.message?.content;
          const text = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
          return [t.session_id, text !== "" ? (text.length > 60 ? `${text.slice(0, 60)}…` : text) : undefined];
        } catch {
          return [t.session_id, undefined];
        }
      }),
    );
    return rows.map((row) => ({
      sessionId: row.session_id,
      eventCount: row.event_count,
      createdTs: row.created_ts,
      updatedTs: row.updated_ts,
      ...((generatedTitles.get(row.session_id) ?? titleOf.get(row.session_id)) !== undefined
        ? { title: generatedTitles.get(row.session_id) ?? titleOf.get(row.session_id) }
        : {}),
    }));
  }

  /**
   * T-P3-147 E：会话标题的持久位（session_titles 表——v6）。生成面写入
   * source="generated"；custom 权威级（用户改名）保留字段不被生成覆盖。
   */
  getTitle(sessionId: string): { title: string; source: string } | undefined {
    const row = this.db
      .prepare("SELECT title, source FROM session_titles WHERE session_id = ?")
      .get(sessionId) as { title: string; source: string } | undefined;
    return row;
  }

  setTitle(sessionId: string, title: string, source: "generated" | "custom"): void {
    // generated 不覆盖 custom（权威级——zcode custom_title 短路同语义）
    const existing = this.getTitle(sessionId);
    if (existing?.source === "custom") return;
    this.db
      .prepare(
        `INSERT INTO session_titles (session_id, title, source, generated_ts) VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET title = excluded.title, source = excluded.source, generated_ts = excluded.generated_ts
         WHERE excluded.source = 'custom' OR session_titles.source != 'custom'`,
      )
      .run(sessionId, title, source, Date.now());
  }


  /**
   * U3/T-P3-105 单会话删除（CLI/UI 的删除入口——硬删除三表事务）。
   * 存在才删（返回 true）；已归档会话同删（归档账本行一并清除——删除即
   * 全域移除，与"归档保留账本"语义相反面，卡内定形）。
   */
  deleteSession(sessionId: string): boolean {
    if (typeof sessionId !== "string" || !isValidSessionId(sessionId)) {
      throw new Error(`会话 id 不合法：${String(sessionId)}`);
    }
    const exists = this.db.prepare("SELECT 1 AS hit FROM sessions WHERE id = ?").get(sessionId);
    if (exists === undefined) return false;
    const remove = this.db.transaction((sid: string) => {
      this.db.prepare("DELETE FROM events WHERE session_id = ?").run(sid);
      this.db.prepare("DELETE FROM session_titles WHERE session_id = ?").run(sid);
      this.db.prepare("DELETE FROM session_projects WHERE session_id = ?").run(sid);
      this.db.prepare("DELETE FROM import_registry WHERE session_id = ?").run(sid);
      this.db.prepare("DELETE FROM session_index WHERE session_id = ?").run(sid);
      this.db.prepare("DELETE FROM archived_sessions WHERE session_id = ?").run(sid);
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
    });
    remove(sessionId);
    return true;
  }

  /**
   * 会话↔项目归属（T-P3-150 B1——任务=项目内会话）。写入点 = host 侧首条
   * user/message 镜像落库时按当时 activeProject 自动归属；首次归属后不
   * 改写（归属稳定——手动移动走 setSessionProject 显式覆盖）。
   */
  getSessionProject(sessionId: string): string | undefined {
    const row = this.db
      .prepare("SELECT project_id FROM session_projects WHERE session_id = ?")
      .get(sessionId) as { project_id: string } | undefined;
    return row?.project_id;
  }

  setSessionProject(sessionId: string, projectId: string, options: { overwrite?: boolean } = {}): void {
    if (options.overwrite === true) {
      // 显式覆盖（手动移动归属）
      this.db
        .prepare(
          `INSERT INTO session_projects (session_id, project_id, attached_ts) VALUES (?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET project_id = excluded.project_id, attached_ts = excluded.attached_ts`,
        )
        .run(sessionId, projectId, Date.now());
      return;
    }
    // 首次归属不改写（自动归属幂等）
    this.db
      .prepare(
        "INSERT OR IGNORE INTO session_projects (session_id, project_id, attached_ts) VALUES (?, ?, ?)",
      )
      .run(sessionId, projectId, Date.now());
  }

  listSessionProjects(): { sessionId: string; projectId: string }[] {
    // 显式映射（SQLite bare-column 返回蛇形键——直接 as 驼峰是断言不是
    // 转换，r.sessionId 恒 undefined → project-tasks 归属匹配恒空，
    // 任务清单从未出过任务（T-P3-164 走查实录根因）。
    return (
      this.db
        .prepare("SELECT session_id, project_id FROM session_projects")
        .all()
        .map((r) => {
          const row = r as Record<string, unknown>;
          return { sessionId: String(row["session_id"]), projectId: String(row["project_id"]) };
        })
    );
  }

  /**
   * 导入会话幂等账（T-P3-150 A6）：externalKey = `<source>:<externalId>`——
   * 已存在返回其 sessionId（重复导入跳过），否则登记新映射。
   */
  lookupImportedSession(externalKey: string): string | undefined {
    const row = this.db
      .prepare("SELECT session_id FROM import_registry WHERE external_key = ?")
      .get(externalKey) as { session_id: string } | undefined;
    return row?.session_id;
  }

  registerImportedSession(externalKey: string, sessionId: string): { sessionId: string; alreadyImported: boolean } {
    const existing = this.db
      .prepare("SELECT session_id FROM import_registry WHERE external_key = ?")
      .get(externalKey) as { session_id: string } | undefined;
    if (existing !== undefined) return { sessionId: existing.session_id, alreadyImported: true };
    this.db
      .prepare("INSERT OR IGNORE INTO import_registry (external_key, session_id, imported_ts) VALUES (?, ?, ?)")
      .run(externalKey, sessionId, Date.now());
    return { sessionId, alreadyImported: false };
  }

  close(): void {
    this.db.close();
  }
}
