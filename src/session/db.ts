/**
 * SQLite 落地（E2）——better-sqlite3 同步 API 与"同步 append"语义同构。
 *
 * 分层（照 cc-switch database/ 的形状，P0 只有一个域所以 DAO 就地内联，
 * 第二个域出现时再拆文件）：schema.sql（DDL）独立于本文件（连接 + 迁移 + events DAO）。
 *
 * appendBatch 用单事务实现批量原子：进程崩溃后要么整批都在，要么整批都不在
 * ——这是 SessionStore.write-behind 契约的存储端前提。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import type { SessionEvent } from "../kernel/events.js";
import type { EventStorage } from "./store.js";

export const CURRENT_SCHEMA_VERSION = 1;

export interface OpenDbOptions {
  /** 文件路径；":memory:" 时全内存。 */
  path: string;
}

export class SqliteEventStorage implements EventStorage {
  private readonly insertEvent: Database.Statement;
  private readonly ensureSession: Database.Statement;
  private readonly selectAll: Database.Statement;

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

  /** user_version 单调推进：v0 应用 schema.sql 后置 1；更高版本号留给未来的迁移步骤。 */
  private migrate(): void {
    const version = (this.db.pragma("user_version", { simple: true }) as number) ?? 0;
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `数据库 schema 版本（${version}）比当前代码（${CURRENT_SCHEMA_VERSION}）更新——拒绝用旧代码打开新库`,
      );
    }
    if (version === CURRENT_SCHEMA_VERSION) return;
    const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
    const ddl = readFileSync(schemaPath, "utf-8");
    this.db.transaction(() => {
      this.db.exec(ddl);
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
    });
    run();
  }

  readAll(sessionId: string): SessionEvent[] {
    const rows = this.selectAll.all(sessionId) as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as SessionEvent);
  }

  close(): void {
    this.db.close();
  }
}
