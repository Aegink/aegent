import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { exportSession, parseSessionExport } from "./export.js";
import { listSessionIndex, rebuildSessionIndex } from "./session-index.js";
import { CURRENT_SCHEMA_VERSION, SqliteEventStorage } from "./db.js";
import { SessionStore } from "./store.js";
import { renderTranscript } from "./transcript.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aegent-e8-"));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 句柄释放滞后的 EBUSY（T-1-03 已知坑）
  }
});

/** 建一个含 2 会话各 1 完整轮的 v2 库（Q1 迁移已自动执行）。 */
function seedTwoSessions(dbPath: string): SessionStore {
  const storage = SqliteEventStorage.open({ path: dbPath });
  const store = new SessionStore(storage);
  for (const sessionId of ["sA", "sB"]) {
    store.append(sessionId, [
      { type: "turn/start", turn: 1 },
      { type: "user/message", turn: 1, message: { content: `${sessionId} 的问题` }, source: "user" },
      { type: "turn/end", turn: 1, reason: { kind: "completed" } },
    ]);
  }
  return store;
}

describe("exportSession（E8 导出面）", () => {
  it("导出物自包含：全事件 + 元数据；脱离库可读（纯 JSON → renderTranscript 消费）", async () => {
    const dbPath = path.join(dir, "export.db");
    const store = seedTwoSessions(dbPath);
    await store.flush("sA");
    await store.flush("sB");
    const snapshot = exportSession(store, "sA", { now: () => 1_700_000_000_000 });

    // 落文件再读回（导出物的真实消费路径）
    const file = path.join(dir, "sA-export.json");
    writeFileSync(file, JSON.stringify(snapshot), "utf8");
    const parsed = parseSessionExport(readFileSync(file, "utf8"));
    expect(parsed.kind).toBe("aegent-session-export");
    expect(parsed.formatVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(parsed.sessionId).toBe("sA");
    expect(parsed.eventCount).toBe(3);
    expect(parsed.events.map((e) => e.type)).toEqual(["turn/start", "user/message", "turn/end"]);
    // 脱离库：transcript 可直接消费导出物（E7 联动）
    const t = renderTranscript(parsed.events);
    expect(t.some((e) => e.kind === "message" && e.content === "sA 的问题")).toBe(true);
  });

  it("导出面只读：导出不改事件流；非导出物 parse 拒绝", async () => {
    const dbPath = path.join(dir, "readonly.db");
    const store = seedTwoSessions(dbPath);
    await store.flush("sA");
    const before = store.load("sA");
    exportSession(store, "sA");
    expect(store.load("sA")).toEqual(before);
    expect(() => parseSessionExport({ hello: 1 })).toThrow(/缺少 kind 声明/);
  });
});

describe("session-index（E8 索引面）", () => {
  it("list 读面：多会话行齐全，updatedTs 降序（最近活跃在前）", async () => {
    const dbPath = path.join(dir, "list.db");
    const storage = SqliteEventStorage.open({ path: dbPath });
    const store = seedTwoSessions(dbPath);
    await store.flush("sA");
    await store.flush("sB");
    // sB 的事件 ts 更晚（seed 同 ts）——追加一条让 sB 的 updatedTs 前进
    store.append("sB", [{ type: "turn/start", turn: 2 }]);
    await store.flush("sB");
    const rows = listSessionIndex(storage);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.sessionId).toBe("sB"); // 最近活跃在前
    expect(rows[0]!.lastSeq).toBe(4);
    expect(rows[1]!.sessionId).toBe("sA");
    storage.close();
  });

  it("增量与全量重建恒等；重建不改事件流（E8 '不互相污染'）", async () => {
    const dbPath = path.join(dir, "rebuild.db");
    const storage = SqliteEventStorage.open({ path: dbPath });
    const store = seedTwoSessions(dbPath);
    await store.flush("sA");
    await store.flush("sB");
    const incremental = listSessionIndex(storage);

    // 事件流快照（重建前后对照）
    const eventsBefore = storage.db.prepare("SELECT * FROM events ORDER BY session_id, seq").all();

    const rebuilt = rebuildSessionIndex(storage.db);
    expect(rebuilt).toBe(2);
    expect(listSessionIndex(storage)).toEqual(incremental); // 增量 ≡ 全量重建
    const eventsAfter = storage.db.prepare("SELECT * FROM events ORDER BY session_id, seq").all();
    expect(eventsAfter).toEqual(eventsBefore); // 事件流逐字节不变
    storage.close();
  });
});

describe("E8 三分互不调用（grep 证伪）", () => {
  it("export 不 import 索引/迁移；session-index 不 import 导出/迁移", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const exportSrc = readFileSync(path.join(here, "export.ts"), "utf8");
    const indexSrc = readFileSync(path.join(here, "session-index.ts"), "utf8");
    // 查 import 面（非全文——注释提及模块名合法）
    expect(exportSrc.match(/^import .*session-index.*$/m) ?? []).toHaveLength(0);
    expect(exportSrc.match(/^import .*migrate.*$/m) ?? []).toHaveLength(0);
    expect(indexSrc.match(/^import .*export\.js.*$/m) ?? []).toHaveLength(0);
    expect(indexSrc.match(/^import .*migrate.*$/m) ?? []).toHaveLength(0);
    // 兼容面（migrate.ts 迁移链）独立——由 T-P1-89 既有测试承载，此处证伪互引
    const migrateSrc = readFileSync(path.join(here, "migrate.ts"), "utf8");
    expect(migrateSrc.match(/^import .*session-index.*$/m) ?? []).toHaveLength(0);
    expect(migrateSrc.match(/^import .*export\.js.*$/m) ?? []).toHaveLength(0);
  });
});
