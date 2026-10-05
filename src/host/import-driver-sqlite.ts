/**
 * sqlite-session 驱动（T-P3-150 A1——OpenCode v1.x 等 SQLite 会话库形状；
 * ZCode 本体不导入但表结构同源验证了 spec 正确性）。better-sqlite3 以
 * `readonly: true` 打开——绝不写用户数据。表/列名全映射在 spec；有
 * sequence 列就按 `sequence, 时间, id` 排（同毫秒 part 不错位），否则按
 * `时间, id`（列探测用 PRAGMA table_info，列名来自 spec 数据而非用户输入
 * 拼接面——白名单标识符经 [] 引用防注入）。
 */

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import {
  expandHome,
  getPath,
  normalizeRole,
  toIso,
  truncateTitle,
  LIMITS,
  type ImportedMessage,
  type ImportedSessionSummary,
  type SqliteSpec,
} from "./import-spec.js";

interface TableMap {
  table: string;
  idCol: string;
  sessionIdCol: string;
  titleCol?: string;
  pathCol?: string;
  createdCol?: string;
  updatedCol?: string;
  dataCol: string;
  contentPath?: string;
  rolePath: string;
  roleMap?: Record<string, string>;
  tsPath?: string;
  sequenceCol: string | null;
  exclude: { col: string; equals: string }[];
}

function str(map: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = map?.[key];
  return typeof v === "string" && v !== "" ? v : undefined;
}

function tableMap(map: Record<string, unknown> | undefined, fallbackTable: string): TableMap {
  return {
    table: str(map, "table") ?? fallbackTable,
    idCol: str(map, "idCol") ?? "id",
    sessionIdCol: str(map, "sessionIdCol") ?? "session_id",
    titleCol: str(map, "titleCol"),
    pathCol: str(map, "pathCol"),
    createdCol: str(map, "createdCol"),
    updatedCol: str(map, "updatedCol"),
    dataCol: str(map, "dataCol") ?? "data",
    contentPath: str(map, "contentPath"),
    rolePath: str(map, "rolePath") ?? "role",
    roleMap: (map?.["roleMap"] as Record<string, string> | undefined) ?? undefined,
    tsPath: str(map, "tsPath"),
    sequenceCol: map?.["sequenceCol"] === null ? null : (str(map, "sequenceCol") ?? "sequence"),
    exclude: Array.isArray(map?.["exclude"])
      ? (map?.["exclude"] as unknown[]).filter(
          (e): e is { col: string; equals: string } =>
            e !== null && typeof e === "object" &&
            typeof (e as Record<string, unknown>)["col"] === "string" &&
            typeof (e as Record<string, unknown>)["equals"] === "string",
        )
      : [],
  };
}

function openReadonly(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true });
}

/** 多候选路径按序探测（OpenCode v1.x 三平台布局——`|` 分隔候选列表）。 */
export function resolveDbPath(spec: SqliteSpec, home: string = homedir()): string | null {
  for (const candidate of spec.db.split("|").map((p) => expandHome(p.trim(), home))) {
    if (existsSync(candidate)) return path.resolve(candidate);
  }
  return null;
}

export function scanSqlite(spec: SqliteSpec, home: string = homedir()): ImportedSessionSummary[] {
  const dbPath = resolveDbPath(spec, home);
  if (dbPath === null) return [];
  let db: Database.Database;
  try {
    db = openReadonly(dbPath);
  } catch {
    return [];
  }
  try {
    const sMap = tableMap(spec.session, "session");
    if (!tableExists(db, sMap.table)) return [];
    const exclude = sMap.exclude;
    // exclude = 等值排除（命名即语义——T-P3-174 批次 7 修正：原实现写反成
    // include 等值匹配且无消费者从未暴露）
    const whereSql = exclude.map((e, i) => `s.[${ident(e.col)}] != @ex${String(i)}`).join(" AND ");
    const params: Record<string, string> = {};
    exclude.forEach((e, i) => {
      params[`ex${String(i)}`] = e.equals;
    });
    const mMap = tableMap(spec.message, "message");
    const rows = db
      .prepare(
        `SELECT s.[${ident(sMap.idCol)}] AS id
              ${sMap.titleCol !== undefined ? `, s.[${ident(sMap.titleCol)}] AS title` : ", NULL AS title"}
              ${sMap.pathCol !== undefined ? `, s.[${ident(sMap.pathCol)}] AS directory` : ", NULL AS directory"}
              ${sMap.createdCol !== undefined ? `, s.[${ident(sMap.createdCol)}] AS created` : ", NULL AS created"}
              ${sMap.updatedCol !== undefined ? `, s.[${ident(sMap.updatedCol)}] AS updated` : ", NULL AS updated"}
              , (SELECT COUNT(*) FROM [${ident(mMap.table)}] m WHERE m.[${ident(mMap.sessionIdCol)}] = s.[${ident(sMap.idCol)}]) AS message_count
         FROM [${ident(sMap.table)}] s
         ${whereSql !== "" ? `WHERE ${whereSql}` : ""}`,
      )
      .all(params) as Array<{ id: string | null; title: string | null; directory: string | null; created: string | null; updated: string | null; message_count: number }>;
    const summaries: ImportedSessionSummary[] = [];
    for (const row of rows.slice(0, LIMITS.maxFiles)) {
      if (row.id === null || row.id === undefined) continue;
      summaries.push({
        source: spec.id,
        externalId: String(row.id),
        title: truncateTitle(row.title ?? "") || `会话 ${String(row.id).slice(0, 8)}`,
        projectPath: row.directory ?? null,
        createdAt: toIso(row.created),
        updatedAt: toIso(row.updated) ?? toIso(safeMtime(dbPath)) ?? "",
        messageCount: Number(row.message_count ?? 0), // sqlite COUNT 准确——不降级
        dbPath,
      });
    }
    return summaries;
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** 单会话消息还原（B1 预览/A6 导入）。message 行 data 列 JSON 解析后按
 * rolePath/tsPath 取值；part 表在位时按 message 分组（textTypes 拼正文、
 * toolType 出工具消息——OpenCode v1.x 三层形状）；无 part 时正文在 message
 * 行（两层库——contentPath 或裸文本 data）。 */
export function convertSqlite(spec: SqliteSpec, dbPath: string, externalId: string, home: string = homedir()): ImportedMessage[] | null {
  const resolved = resolveDbPath(spec, home);
  if (resolved === null || path.resolve(dbPath) !== resolved) return null;
  let db: Database.Database;
  try {
    db = openReadonly(resolved);
  } catch {
    return null;
  }
  try {
    const mMap = tableMap(spec.message, "message");
    if (!tableExists(db, mMap.table)) return null;
    const messageRows = db
      .prepare(
        `SELECT m.[${ident(mMap.idCol)}] AS id
              ${mMap.createdCol !== undefined ? `, m.[${ident(mMap.createdCol)}] AS created` : ", NULL AS created"}
              , m.[${ident(mMap.dataCol)}] AS data
         FROM [${ident(mMap.table)}] m
         WHERE m.[${ident(mMap.sessionIdCol)}] = ?
         ORDER BY ${orderBy(db, mMap, "m")}`,
      )
      .all(externalId) as Array<{ id: string | null; created: string | null; data: string | null }>;

    const hasPart = spec.part !== undefined;
    const pMap = hasPart ? tableMap(spec.part, "message-part") : undefined;
    const partByMessage = new Map<string, Array<Record<string, unknown>>>();
    if (hasPart && pMap !== undefined && tableExists(db, pMap.table)) {
      const partRows = db
        .prepare(
          `SELECT p.[${ident(pMap.sessionIdCol)}] AS sid, p.[${ident(pMap.dataCol)}] AS data
           FROM [${ident(pMap.table)}] p
           ORDER BY ${orderBy(db, pMap, "p")}`,
        )
        .all() as Array<{ sid: string | null; data: string | null }>;
      for (const row of partRows) {
        if (row.sid === null || row.data === null) continue;
        const parsed = parseJsonColumn(row.data);
        if (parsed === null) continue;
        const list = partByMessage.get(row.sid) ?? [];
        list.push(parsed);
        partByMessage.set(row.sid, list);
      }
    }

    const messages: ImportedMessage[] = [];
    for (const row of messageRows) {
      if (row.id === null) continue;
      const data = parseJsonColumn(row.data);
      const role = normalizeRole(getPath(data, mMap.rolePath), mMap.roleMap);
      if (role === null || role === "tool") continue;
      const created = toIso(row.created ?? (mMap.tsPath !== undefined ? getPath(data, mMap.tsPath) : undefined));

      if (hasPart && pMap !== undefined) {
        const parts = partByMessage.get(row.id) ?? [];
        const toolType = str(spec.part, "toolType") ?? "tool";
        const textTypes = (() => {
          const raw = spec.part?.["textTypes"];
          return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : ["text"];
        })();
        let textBuffer = "";
        const flushText = () => {
          if (textBuffer.trim() !== "") {
            messages.push({ role, text: textBuffer.trim(), createdAt: created });
            textBuffer = "";
          }
        };
        for (const partData of parts) {
          const partType = String(getPath(partData, "type") ?? "");
          if (partType === toolType) {
            flushText();
            messages.push({
              role: "tool",
              toolName: String(getPath(partData, str(spec.part, "toolNamePath") ?? "tool") ?? ""),
              toolArgs: getPath(partData, str(spec.part, "argsPath") ?? "state.input"),
              toolResult: stringifyResult(getPath(partData, str(spec.part, "resultPath") ?? "state.output")),
              toolError: String(getPath(partData, str(spec.part, "statusPath") ?? "state.status") ?? "") === "error",
              createdAt: created,
            });
            continue;
          }
          if (textTypes.includes(partType)) {
            const text = getPath(partData, "text");
            if (typeof text === "string") textBuffer += (textBuffer === "" ? "" : "\n") + text;
          }
        }
        flushText();
        continue;
      }

      // 两层库：正文在 message 行
      const text =
        mMap.contentPath !== undefined
          ? String(getPath(data, mMap.contentPath) ?? "")
          : typeof row.data === "string" && !row.data.trim().startsWith("{")
            ? row.data
            : String(getPath(data, "content") ?? "");
      messages.push({ role, text, createdAt: created });
    }
    return messages;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function orderBy(db: Database.Database, map: TableMap, alias: string): string {
  const seqCol = map.sequenceCol;
  const hasSequence = seqCol !== null && seqCol !== undefined && columnExists(db, map.table, seqCol);
  const ts = map.createdCol !== undefined ? `${alias}.[${ident(map.createdCol)}]` : "''";
  const id = `${alias}.[${ident(map.idCol)}]`;
  return hasSequence && seqCol !== undefined ? `${alias}.[${ident(seqCol)}], ${ts}, ${id}` : `${ts}, ${id}`;
}

/** 标识符白名单校验（列/表名进 SQL 前查——spec 数据不变成注入面）。 */
function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`非法标识符：${name}`);
  }
  return name;
}

function tableExists(db: Database.Database, table: string): boolean {
  try {
    ident(table);
    const row = db.prepare("SELECT 1 AS hit FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    return row !== undefined;
  } catch {
    return false;
  }
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  try {
    ident(column);
    const cols = db.prepare(`PRAGMA table_info([${ident(table)}])`).all() as Array<{ name: string }>;
    return cols.some((c) => c.name === column);
  } catch {
    return false;
  }
}

function parseJsonColumn(raw: string | null): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringifyResult(raw: unknown): string {
  if (typeof raw === "string") return raw;
  return JSON.stringify(raw ?? "");
}

function safeMtime(file: string): number | null {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}
