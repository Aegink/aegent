/**
 * 会话库整库导出（T-P3-174 批次 4——数据中心域扩展）：
 *  - `.sqlite`：better-sqlite3 在线备份 API（`db.backup`）——备份期间源库
 *    可继续读写（SQLite Online Backup，页级复制；WAL 源库安全）；
 *  - `.sql`：`db.iterdump()` 逐语句 dump 拼写（人可读、可跨 SQLite 版本
 *    重建；大库慢于页级备份——按需选择）。
 * 导出落点 = UI 侧 pick_folder 选定的目录（host 不自选——桌面壳文件夹选择
 * 面既有）；文件名带时间戳防覆盖。导出是读面动作，绝不触碰源库内容。
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";

export type SessionDbExportFormat = "sqlite" | "sql";

export function isSessionDbExportFormat(v: unknown): v is SessionDbExportFormat {
  return v === "sqlite" || v === "sql";
}

/** 导出文件名（时间戳到秒——同目录重复导出不覆盖）。 */
export function sessionDbExportFileName(format: SessionDbExportFormat, now: number = Date.now()): string {
  const d = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `aegent-sessions-${stamp}.${format}`;
}

export interface SessionDbExportResult {
  path: string;
  format: SessionDbExportFormat;
  bytes: number;
}

/** .sqlite 整库导出（在线备份 API——异步）。 */
export function exportSessionDbSqlite(db: Database.Database, outPath: string): Promise<Database.BackupMetadata> {
  return db.backup(outPath);
}

/**
 * .sql 语句导出（self-dump——Node 绑定无 iterdump（CLI .dump 专属），自写
 * schema+数据+user_version 三段：可重放脚本经 BEGIN/COMMIT 包裹）。
 * user_version 必须随导出（迁移链状态——重放进新库时 migrate() 依赖它）。
 */
export function exportSessionDbSql(db: Database.Database, outPath: string): void {
  const lines: string[] = ["BEGIN TRANSACTION;"];
  const objects = db
    .prepare<[], { type: string; name: string; sql: string }>(
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
    )
    .all();
  for (const obj of objects) lines.push(`${obj.sql.replace(/;$/, "")};`);
  const userVersion = db.pragma("user_version", { simple: true }) as number;
  lines.push(`PRAGMA user_version = ${userVersion};`);
  const tables = objects.filter((o) => o.type === "table");
  const quote = (v: unknown): string => {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
    if (typeof v === "bigint") return String(v);
    if (Buffer.isBuffer(v)) return `X'${v.toString("hex")}'`;
    return `'${String(v).replace(/'/g, "''")}'`;
  };
  // SQL 标识符引用（双引号包裹 + 内部双引号翻倍——JSON.stringify 的 \" 转义
  // 不是 SQL 语义，自写 sqlIdent 防标识符注入）
  const sqlIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;
  for (const table of tables) {
    const colNames = (db.prepare(`PRAGMA table_info(${sqlIdent(table.name)})`).all() as { name: string }[]).map((c) => c.name);
    const rows = db.prepare(`SELECT * FROM ${sqlIdent(table.name)}`).iterate() as IterableIterator<Record<string, unknown>>;
    for (const row of rows) {
      const values = colNames.map((c) => quote(row[c]));
      lines.push(`INSERT INTO ${sqlIdent(table.name)} (${colNames.map(sqlIdent).join(", ")}) VALUES (${values.join(", ")});`);
    }
  }
  lines.push("COMMIT;");
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
}

/**
 * 导出入口（域 op 消费面）：dir 不存在时逐级创建（导出是写面动作——UI 侧
 * pick_folder 恒选已存在目录，手输新路径的预期是自动建目录）。返回落盘
 * 绝对路径与字节数。
 */
export async function exportSessionDb(
  db: Database.Database,
  dir: string,
  format: SessionDbExportFormat,
  now: number = Date.now(),
): Promise<SessionDbExportResult> {
  const stat = existsSync(dir) ? statSync(dir) : undefined;
  if (stat !== undefined && !stat.isDirectory()) {
    throw new Error(`导出落点不是目录：${dir}`);
  }
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, sessionDbExportFileName(format, now));
  if (format === "sqlite") {
    await exportSessionDbSqlite(db, outPath);
  } else {
    exportSessionDbSql(db, outPath);
  }
  return { path: outPath, format, bytes: statSync(outPath).size };
}
