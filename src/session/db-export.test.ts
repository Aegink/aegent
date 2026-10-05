// T-P3-174 批次 4：会话库整库导出（.sqlite 在线备份 / .sql 自写 dump 可重放）。
import { mkdtempSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  exportSessionDb,
  sessionDbExportFileName,
} from "./db-export.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-dbexport-"));
  dirs.push(dir);
  return dir;
}

describe("db-export", () => {
  it("文件名：时间戳形状 aegent-sessions-<stamp>.<ext>", () => {
    const now = new Date(2026, 9, 5, 14, 30, 9).getTime();
    expect(sessionDbExportFileName("sqlite", now)).toBe("aegent-sessions-20261005-143009.sqlite");
    expect(sessionDbExportFileName("sql", now)).toBe("aegent-sessions-20261005-143009.sql");
  });
  it("导出目录不存在 = 自动逐级创建（写面动作语义）", async () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (a TEXT)");
    db.prepare("INSERT INTO t VALUES (?)").run("x");
    const target = path.join(tempDir(), "nested", "deeper");
    const out = await exportSessionDb(db, target, "sqlite");
    expect(existsSync(out.path)).toBe(true);
    const copy = new Database(out.path);
    expect(copy.prepare("SELECT COUNT(*) AS n FROM t").get()).toEqual({ n: 1 });
    copy.close();
    db.close();
  });
  it(".sqlite 导出：文件落盘且可独立打开查询（在线备份 API）", async () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE events (session_id TEXT, seq INTEGER, payload TEXT)");
    db.prepare("INSERT INTO events VALUES (?, ?, ?)").run("s1", 1, "{}");
    const out = await exportSessionDb(db, tempDir(), "sqlite");
    expect(existsSync(out.path)).toBe(true);
    expect(out.bytes).toBe(statSync(out.path).size);
    const copy = new Database(out.path);
    expect(copy.prepare("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 1 });
    copy.close();
    db.close();
  });
  it(".sql 导出：schema+INSERT+user_version 三段齐全，重放进新库数据一致", async () => {
    const db = new Database(":memory:");
    db.pragma("user_version = 8");
    db.exec("CREATE TABLE events (session_id TEXT, seq INTEGER, payload TEXT)");
    db.prepare("INSERT INTO events VALUES (?, ?, ?)").run("s1", 1, "它's 含引号");
    const out = await exportSessionDb(db, tempDir(), "sql");
    const text = readFileSync(out.path, "utf8");
    expect(text.startsWith("BEGIN TRANSACTION;")).toBe(true);
    expect(text.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(text).toContain("PRAGMA user_version = 8;");
    expect(text).toContain("CREATE TABLE events");
    expect(text).toContain("INSERT INTO \"events\"");
    // 重放：新库执行 dump 全文 → 数据与 user_version 一致
    const replay = new Database(":memory:");
    replay.exec(text);
    expect(replay.prepare("SELECT payload FROM events").get()).toEqual({ payload: "它's 含引号" });
    expect(replay.pragma("user_version", { simple: true })).toBe(8);
    replay.close();
    db.close();
  });
});
