/**
 * `aegent sessions` 子命令（U3/T-P3-105）——历史会话列表/删除（resume 是
 * 入口分流：`aegent sessions resume <id>` = 以 --session <id> 正常启动
 * REPL，在 index.ts 处理——续聊即"同一会话 id 再开进程"，机制全部复用）。
 *
 * 数据面 = session 域既有事实（Q2 session_index 索引 + 硬删除事务），本
 * 命令是入口面不是新机制。缺省库路径 <home>/.aegent/sessions.db（--db
 * 覆盖——与 AEGENT_DB/--db 的装配面同一路径约定）。
 */

import os from "node:os";
import path from "node:path";

import { SqliteEventStorage } from "../session/db.js";
import { isValidSessionId } from "../session/session-id.js";

export const SESSIONS_COMMAND_USAGE =
  "用法：aegent sessions list [--db <path>] | aegent sessions resume <id> | aegent sessions delete <id> [--yes] [--db <path>]";

/** 缺省事件库路径（sessions 命令面自己的缺省——<home>/.aegent/sessions.db）。 */
export function defaultSessionsDbPath(): string {
  return path.join(os.homedir(), ".aegent", "sessions.db");
}

export function formatTs(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "?";
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface SessionsCommandIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

function pickDbPath(argv: readonly string[]): string | undefined {
  const i = argv.indexOf("--db");
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/** sessions 子命令入口（argv = "sessions" 之后的参数）；返回进程退出码。 */
export async function runSessionsCommand(
  argv: readonly string[],
  io: SessionsCommandIo,
): Promise<number> {
  const [action, id] = argv;
  const dbPath = pickDbPath(argv) ?? defaultSessionsDbPath();
  try {
    if (action === "list") {
      const storage = SqliteEventStorage.open({ path: dbPath });
      try {
        const rows = storage.listSessionSummaries();
        if (rows.length === 0) {
          io.out(`（库 ${dbPath} 无会话——跑一次会话并带 --db 即落库）`);
          return 0;
        }
        io.out(`会话清单（${dbPath}，最近 ${rows.length} 条）：`);
        for (const row of rows) {
          io.out(
            `${row.sessionId}  ${row.eventCount} 事件  更新 ${formatTs(row.updatedTs)}` +
              (row.title !== undefined ? `  ${row.title}` : ""),
          );
        }
        io.out("续聊：aegent sessions resume <id>");
        return 0;
      } finally {
        storage.close();
      }
    }
    if (action === "delete" && id !== undefined) {
      if (!isValidSessionId(id)) {
        io.err(`会话 id 不合法：${id}`);
        return 1;
      }
      if (!argv.includes("--yes")) {
        io.err(`删除是硬删除（事件不可恢复）：确认请加 --yes（aegent sessions delete ${id} --yes）`);
        return 1;
      }
      const storage = SqliteEventStorage.open({ path: dbPath });
      try {
        const deleted = storage.deleteSession(id);
        io.out(deleted ? `已删除会话 ${id}` : `会话 ${id} 不存在（库 ${dbPath}）`);
        return 0;
      } finally {
        storage.close();
      }
    }
    io.err(SESSIONS_COMMAND_USAGE);
    return 1;
  } catch (e) {
    io.err(`sessions 命令失败：${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
