import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertForwardCompatibleStream,
  assertMigrationAtomic,
  assertSchemaVersionGate,
  legacyShapeStream,
} from "./migration-asserts.js";
import { SqliteEventStorage } from "../session/db.js";
import { SessionStore, type EventStorage } from "../session/store.js";
import { project } from "../session/project.js";
import { goalFromEvents } from "../kernel/goal.js";
import type { SessionEvent } from "../kernel/events.js";

/** 预置旧事件的桩存储（restore 走 storage 路径——旧流形状就是写入时的合法形状）。 */
function preloadedStorage(events: readonly SessionEvent[]): EventStorage {
  return {
    appendBatch: async () => undefined,
    readAll: async () => [...events],
  };
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "aegent-migration-"));
}

describe("前向兼容（O19「旧字段不再被读」的对应面）", () => {
  it("旧形状流（全部可选字段缺席）restore 后消息/投影语义完整（验收①）", async () => {
    const result = await assertForwardCompatibleStream(async (events) => {
      const store = new SessionStore(preloadedStorage(events));
      await store.restore("s-legacy");
      return { events: store.load("s-legacy"), projection: project(events) };
    });
    expect(result.events).toHaveLength(legacyShapeStream().length);
    // 投影语义完整：goal 历史、消息面、无一因缺字段而失真
    expect(result.projection.goals.map((g) => g.status)).toEqual(["active", "achieved"]);
    expect(result.projection.messages.some((m) => m.role === "user")).toBe(true);
  });

  it("投影/goal 重建消费旧流不依赖新增可选字段（deadline/title 缺席可读）", async () => {
    await assertForwardCompatibleStream(
      (events) => goalFromEvents(events),
      (goal, events) => {
        expect(goal?.text).toBe("旧会话的目标");
        expect(goal?.status).toBe("achieved");
        expect(goal?.deadline).toBeUndefined(); // 旧流无 deadline——重建不炸不造默认值
        // 事件里所有 compaction 均无 title——投影器照常消费
        const compactions = events.filter((e) => e.type === "compaction");
        expect(compactions.length).toBeGreaterThan(0);
        for (const c of compactions) {
          expect("title" in c).toBe(false);
        }
      },
    );
  });
});

describe("版本闸门（O19「旧入口已退役」的对应面）", () => {
  it("user_version = CURRENT+1 的库打开被类型化拒绝（fail-closed，验收②）", () => {
    const root = tempRoot();
    try {
      assertSchemaVersionGate({
        dbPath: join(root, "future.db"),
        open: (path) => SqliteEventStorage.open({ path }),
      });
      // 正常库不受影响（对照）
      const storage = SqliteEventStorage.open({ path: join(root, "current.db") });
      expect(storage).toBeInstanceOf(SqliteEventStorage);
      storage.close();
    } finally {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // Windows 句柄释放竞态——临时目录由系统回收
      }
    }
  });
});

describe("原子性（O19「迁移后可恢复」的对应面）", () => {
  it("批次中途失败 → 整批回滚无半写（T-1-02 单事务消费用例，验收③）", () => {
    const root = tempRoot();
    try {
      const dbPath = join(root, "atomic.db");
      const storage = SqliteEventStorage.open({ path: dbPath });
      storage.appendBatch("s1", [
        { seq: 1, ts: 0, type: "turn/start", turn: 1 },
        { seq: 2, ts: 0, type: "turn/end", turn: 1, reason: { kind: "completed" } },
      ]);

      // 注入中途失败的"迁移"：第二批含重复主键 (session_id, seq) → 事务回滚
      assertMigrationAtomic(
        () =>
          storage.appendBatch("s1", [
            { seq: 3, ts: 0, type: "turn/start", turn: 2 },
            { seq: 2, ts: 0, type: "turn/end", turn: 2, reason: { kind: "completed" } }, // PK 冲突
          ]),
        () => {
          // 库仍可打开、首批数据未半写
          const reopened = SqliteEventStorage.open({ path: dbPath });
          const rows = reopened.readAll("s1");
          expect(rows.map((r) => r.seq)).toEqual([1, 2]); // 第二批整批缺席
          reopened.close();
        },
      );
      storage.close();
    } finally {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // Windows 句柄释放竞态——临时目录由系统回收
      }
    }
  });

  it("migrate 不抛错即模板误用（要求注入中途失败的迁移）", () => {
    expect(() => assertMigrationAtomic(() => undefined, () => undefined)).toThrow(
      /未抛错/,
    );
  });
});
