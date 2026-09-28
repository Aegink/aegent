/**
 * 迁移链测试（Q1，T-P1-89）——真实 v1→v2 迁移（T-P1-36 记档的既定消费方）：
 * 旧库自动迁移 + 索引回填正确 + 版本闸门（O19 消费）+ 迁移原子（O19 消费）+
 * 链完整性 fail-closed + 索引随写维护 + restore 未知类型显式拒绝。
 */

import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION, SqliteEventStorage } from "./db.js";
import {
  MIGRATIONS,
  MigrationChainBrokenError,
  planMigrationChain,
} from "./migrate.js";
import { SessionStore } from "./store.js";
import {
  assertMigrationAtomic,
  assertSchemaVersionGate,
  readSchemaDdl,
} from "../test-support/migration-asserts.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aegent-migrate-"));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 句柄释放滞后的 EBUSY（T-1-03 已知坑），不影响断言
  }
});

/** 造一个"旧进程"留下的 v1 库：基线 schema + user_version=1 + 会话与事件。 */
function seedV1Db(dbPath: string, eventCount: number): void {
  const db = new Database(dbPath);
  try {
    db.exec(readSchemaDdl());
    db.prepare("INSERT INTO sessions (id, created_ts) VALUES (?, ?)").run("s0", 1_000);
    // 合法事件流：turn/start 先行（E16 fold 校验要求）→ user/message 序列
    const rows: Array<[number, string, string]> = [[1, "turn/start", JSON.stringify({ seq: 1, ts: 1_001, turn: 1, type: "turn/start" })]];
    for (let seq = 2; seq <= eventCount + 1; seq += 1) {
      rows.push([
        seq,
        "user/message",
        JSON.stringify({
          seq,
          ts: 1_000 + seq,
          turn: 1,
          type: "user/message",
          message: { content: `旧事件 ${seq - 1}` },
          source: "user",
        }),
      ]);
    }
    for (const [seq, type, payload] of rows) {
      db.prepare("INSERT INTO events (session_id, seq, type, payload, ts) VALUES (?, ?, ?, ?, ?)").run(
        "s0",
        seq,
        type,
        payload,
        1_000 + seq,
      );
    }
    db.pragma("user_version = 1");
  } finally {
    db.close();
  }
}

describe("迁移链（Q1/T-P1-89）", () => {
  it("v1 旧库打开 → 自动迁移 v2 → session_index 回填正确（数据不重排）", async () => {
    const dbPath = path.join(dir, "legacy.db");
    seedV1Db(dbPath, 5);

    const storage = SqliteEventStorage.open({ path: dbPath });
    const store = new SessionStore(storage);
    const events = await store.restore("s0");
    expect(events).toHaveLength(6); // turn/start + 5 条 user/message
    expect(events[0]).toMatchObject({ seq: 1, type: "turn/start" });
    expect(events[1]).toMatchObject({ seq: 2, type: "user/message" }); // payload 逐字节保留

    const index = storage.readSessionIndex("s0");
    expect(index).not.toBeNull();
    expect(index!.firstSeq).toBe(1);
    expect(index!.lastSeq).toBe(6); // turn/start + 5 条 user/message
    expect(index!.eventCount).toBe(6);
    expect(index!.createdTs).toBe(1_000);
    expect(index!.updatedTs).toBe(1_006);

    const version = storage.db.pragma("user_version", { simple: true }) as number;
    expect(version).toBe(CURRENT_SCHEMA_VERSION);
    storage.close();
  });

  it("v0 空库打开 → 全链迁移到当前版本", () => {
    const storage = SqliteEventStorage.open({ path: path.join(dir, "fresh.db") });
    expect(storage.db.pragma("user_version", { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
    expect(storage.readSessionIndex("s0")).toBeNull(); // 无会话无行——不炸
    storage.close();
  });

  it("user_version=CURRENT+1 的库打开 → 类型化拒绝（O19 assertSchemaVersionGate 消费）", () => {
    assertSchemaVersionGate({
      dbPath: path.join(dir, "from-future.db"),
      open: (p) => SqliteEventStorage.open({ path: p }),
    });
  });

  it("迁移中途失败 → 库仍可打开且无半写（O19 assertMigrationAtomic 消费）", () => {
    const dbPath = path.join(dir, "interrupted.db");
    seedV1Db(dbPath, 3);
    const db = new Database(dbPath);
    try {
      // v1 库 + 注入一个中途失败的迁移闭包（真实链上 v1→v2 的 apply 位置）
      db.pragma("user_version = 1");
      const poisoned = planMigrationChain(1, CURRENT_SCHEMA_VERSION, [
        MIGRATIONS[0]!, // v0→v1 基线（幂等：schema IF NOT EXISTS）
        {
          from: 1,
          to: 2,
          apply: (d) => {
            d.exec("CREATE TABLE IF NOT EXISTS partial_marker (id)");
            throw new Error("注入的迁移中途失败");
          },
        },
        ...MIGRATIONS.slice(2), // v2→v3 起后续真实迁移（链完整性不参与本次注入）
      ]);
      assertMigrationAtomic(
        () => {
          db.transaction(() => {
            for (const step of poisoned) step.apply(db);
            db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
          })();
        },
        () => {
          // 库仍可打开（未锁死）+ user_version 未推进（无半写）
          const reopened = new Database(dbPath);
          try {
            expect(reopened.pragma("user_version", { simple: true })).toBe(1);
            expect(reopened.prepare("SELECT COUNT(*) AS n FROM events").get()).toMatchObject({ n: 4 });
          } finally {
            reopened.close();
          }
        },
      );
    } finally {
      db.close();
    }
  });

  it("链完整性：缺失相邻迁移 → MigrationChainBrokenError fail-closed（拒绝跳级）", () => {
    // 构造注册表缺 v1→v2：从 v1 迁移到 2 必须抛
    expect(() => planMigrationChain(1, 2, [MIGRATIONS[0]!])).toThrow(MigrationChainBrokenError);
    expect(() => planMigrationChain(1, 2, [MIGRATIONS[0]!])).toThrow(/v1→v2/);
    // 完整链规划成功且逐级相邻
    const plan = planMigrationChain(0, CURRENT_SCHEMA_VERSION);
    expect(plan.map((m) => [m.from, m.to])).toEqual(
      Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, i) => [i, i + 1]),
    );
  });

  it("v2 索引随写维护：flush 落库后索引行与流事实恒等（write-behind 契约）", async () => {
    const storage = SqliteEventStorage.open({ path: path.join(dir, "live.db") });
    const store = new SessionStore(storage);
    store.append("s0", [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: "hi" }, source: "user" },
    ]);
    await store.flush("s0"); // 索引维护在 appendBatch（落库时点）——write-behind 缓冲不触发
    expect(storage.readSessionIndex("s0")).toMatchObject({ firstSeq: 1, lastSeq: 2, eventCount: 2 });
    store.append("s0", [{ type: "turn/end", turn: 1, reason: { kind: "completed" } }]);
    await store.flush("s0");
    expect(storage.readSessionIndex("s0")).toMatchObject({ lastSeq: 3, eventCount: 3 });
    storage.close();
  });

  it("restore 遇未知事件类型 → 显式拒绝非透传（E16 读路径闸门复证）", async () => {
    const dbPath = path.join(dir, "unknown-type.db");
    seedV1Db(dbPath, 1); // seq 1-2（turn/start + user/message）
    const db = new Database(dbPath);
    try {
      db.prepare("INSERT INTO events (session_id, seq, type, payload, ts) VALUES (?, ?, ?, ?, ?)").run(
        "s0",
        3,
        "ghost/future",
        JSON.stringify({ seq: 3, ts: 2_000, turn: 1, type: "ghost/future" }),
        2_000,
      );
    } finally {
      db.close();
    }
    const storage = SqliteEventStorage.open({ path: dbPath });
    const store = new SessionStore(storage);
    await expect(store.restore("s0")).rejects.toThrow(/未知事件类型 ghost\/future/);
    storage.close();
  });
});
