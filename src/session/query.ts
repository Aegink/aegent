/**
 * 会话查询（Q2，T-P2-105）——agent 可查询历史会话；**查询走 SQL 而非全量
 * 加载**。
 *
 * 行为锚：dsh·packages/session-query（包组：SQLite 检索 + 模型工具 + 导出）
 * 的检索半边——取"SQL 条件检索 + 查询作为 agent 工具暴露"两行为与其
 * 检索列设计（会话 / 时间 / 类型 / 内容）；不抄导出面（E7 transcript 已有）
 * 与其五工具全集（我方最小面：两工具，工具面见
 * kernel/tools/builtin/session-query.ts）；FTS5 全文索引不取（LIKE 即达验收
 * ——YAGNI 记档，索引随真实规模需要）。
 *
 * 纪律：
 * - **条件检索在 SQL 层**：WHERE 由结构化条件拼装（参数绑定——注入安全），
 *   LIMIT/OFFSET 分页；本模块从不 store.load / readAll 全量（"查询走 SQL
 *   而非全量加载"的验收原文）。
 * - **查询是读面**：零落流（不改 events 表一行）——L1"事件即轨迹"的
 *   读取侧；其结果与 buildChatMessages 的会话视图同源（同一 events 表）。
 * - **归档语义**（T-P2-102 依赖）：已归档会话的数据不在主库——主库检索
 *   自然命中不到；按 id 条件命中归档账本时在结果里显式标出
 *   `archivedSessions`（"查无此会话"与"已归档"是两类事实；归档档读取面
 *   走 archive.ts 的 readArchivedSession）。
 * - 内容 LIKE 是**子串匹配**（大小写敏感——SQLite LIKE 对 ASCII 大小写
 *   不敏感、对非 ASCII 敏感；`%`/`_` 转义后按字面匹配），命中摘录在
 *   JS 侧截取（前后各一段上下文）。
 */

import type Database from "better-sqlite3";

import { EVENT_TYPES, type SessionEvent, type SessionEventType } from "../core/index.js";
import { isValidSessionId } from "./session-id.js";
import { SessionArchivedError, SqliteEventStorage } from "./db.js";

/** 缺省分页大小。 */
export const DEFAULT_QUERY_LIMIT = 50;
/** 单次查询的结果上限（分页参数的上界——外部输入防呆）。 */
export const MAX_QUERY_LIMIT = 500;
/** 会话读取（getSessionEvents）的缺省与上限。 */
export const DEFAULT_SESSION_READ_LIMIT = 200;
/** 内容检索串长度上限（防呆；LIKE 模式本身无长度意义）。 */
export const MAX_CONTENT_LIKE_CHARS = 256;

const KNOWN_TYPES = new Set<string>(EVENT_TYPES);

export type SessionQueryErrorCode = "SESSION_NOT_FOUND";

export class SessionQueryError extends Error {
  constructor(
    readonly code: SessionQueryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SessionQueryError";
  }
}

export interface SessionQueryCriteria {
  /** 会话 id 前缀匹配（缺省不限——全库检索）。 */
  sessionIdPrefix?: string;
  /**
   * T5-3/EP-3 授权下推：允许读取的会话 id 白名单（宿主 authorize 产物）——
   * SQL 层 IN 子句（参数绑定，注入安全）；缺省 undefined = 不过滤
   * （宿主未装配授权面 = 既有行为零变化）。
   */
  sessionIds?: readonly string[];
  /** 事件时间下界（含界，epoch 毫秒）。 */
  fromTs?: number;
  /** 事件时间上界（含界）。 */
  toTs?: number;
  /** 事件类型过滤（EVENT_TYPES 子集——OR 语义）。 */
  types?: readonly SessionEventType[];
  /** 内容子串（对事件整值 JSON 的 LIKE 子串匹配）。 */
  contentLike?: string;
  /** 分页大小（1..MAX_QUERY_LIMIT；缺省 50）。 */
  limit?: number;
  /** 分页偏移（≥0；缺省 0）。 */
  offset?: number;
}

export interface SessionQueryRow {
  sessionId: string;
  seq: number;
  type: SessionEventType;
  ts: number;
  /** 事件整值（payload JSON.parse 回原事件）。 */
  event: SessionEvent;
  /** 内容命中摘录（contentLike 给出时存在——命中点前后各一段）。 */
  excerpt?: string;
}

export interface SessionQueryResult {
  rows: SessionQueryRow[];
  /** 同条件命中总数（分页外——hasMore 的判据）。 */
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  /** 按 id 条件命中归档账本的会话 id（数据不在主库——归档档可读，Q8）。 */
  archivedSessions: string[];
}

/** 会话事件读取产物（getSessionEvents——单会话、seq 升序）。 */
export interface SessionEventsRead {
  sessionId: string;
  /** 会话事件总数（分页外）。 */
  total: number;
  fromSeq: number;
  events: SessionQueryRow[];
  hasMore: boolean;
}

function assertDbPath(dbPath: string): void {
  if (typeof dbPath !== "string" || dbPath === "" || dbPath === ":memory:") {
    throw new TypeError(`会话查询需要文件库路径（收到 ${JSON.stringify(dbPath)}）`);
  }
}

function assertInt(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} 须为 ${min}..${max} 的整数（收到 ${JSON.stringify(value)}）`);
  }
  return value;
}

/** LIKE 模式转义（`\` 为 ESCAPE 字符——`%`/`_`/`\` 按字面匹配）。 */
function escapeLike(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * 前缀的上界（字典序严格大于一切以 prefix 开头的串的最小串）：末位码元
 * +1（末位是 U+FFFF 则回退前一位）。全 U+FFFF 前缀（真实 id 不存在）
 * 返回 undefined——调用方退化为无上界的 `>=`（仍非全表 LIKE）。
 */
function prefixUpperBound(prefix: string): string | undefined {
  for (let i = prefix.length - 1; i >= 0; i--) {
    const code = prefix.charCodeAt(i);
    if (code < 0xffff) {
      return prefix.slice(0, i) + String.fromCharCode(code + 1);
    }
  }
  return undefined;
}

/** 命中摘录（内容检索命中点前后各 ~60 字符；无命中点给出头部片段）。 */
function excerptOf(payload: string, needle: string, span = 60): string {
  const at = payload.indexOf(needle);
  if (at < 0) return payload.slice(0, span * 2);
  const start = Math.max(0, at - span);
  const end = Math.min(payload.length, at + needle.length + span);
  return `${start > 0 ? "…" : ""}${payload.slice(start, end)}${end < payload.length ? "…" : ""}`;
}

interface BuiltWhere {
  where: string;
  params: unknown[];
}

function buildWhere(criteria: SessionQueryCriteria): BuiltWhere {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (criteria.sessionIds !== undefined) {
    if (!Array.isArray(criteria.sessionIds) || criteria.sessionIds.length === 0) {
      throw new TypeError("sessionIds 须为非空字符串数组");
    }
    const placeholders = criteria.sessionIds.map((id) => {
      if (typeof id !== "string" || id === "") throw new TypeError("sessionIds 成员须为非空字符串");
      params.push(id);
      return "?";
    });
    clauses.push(`session_id IN (${placeholders.join(", ")})`);
  }
  if (criteria.sessionIdPrefix !== undefined) {
    if (typeof criteria.sessionIdPrefix !== "string" || criteria.sessionIdPrefix === "") {
      throw new TypeError("sessionIdPrefix 须为非空字符串");
    }
    // 前缀 = 范围谓词（>= prefix 且 < 上界）——字典序精确、走索引（PK 首列
    // session_id），且比 LIKE '%' 直串更安全（无通配符语义，参数绑定即可）。
    const upper = prefixUpperBound(criteria.sessionIdPrefix);
    if (upper === undefined) {
      clauses.push("e.session_id >= ?");
      params.push(criteria.sessionIdPrefix);
    } else {
      clauses.push("e.session_id >= ? AND e.session_id < ?");
      params.push(criteria.sessionIdPrefix, upper);
    }
  }
  if (criteria.fromTs !== undefined) {
    clauses.push("e.ts >= ?");
    params.push(criteria.fromTs);
  }
  if (criteria.toTs !== undefined) {
    clauses.push("e.ts <= ?");
    params.push(criteria.toTs);
  }
  if (criteria.types !== undefined) {
    if (!Array.isArray(criteria.types) || criteria.types.length === 0) {
      throw new TypeError("types 须为非空数组（或省略）");
    }
    for (const type of criteria.types) {
      if (typeof type !== "string" || !KNOWN_TYPES.has(type)) {
        throw new TypeError(`types 含未知事件类型：${JSON.stringify(type)}（词汇表闭集）`);
      }
    }
    clauses.push(`e.type IN (${criteria.types.map(() => "?").join(",")})`);
    params.push(...criteria.types);
  }
  if (criteria.contentLike !== undefined) {
    if (typeof criteria.contentLike !== "string" || criteria.contentLike === "") {
      throw new TypeError("contentLike 须为非空字符串");
    }
    if (criteria.contentLike.length > MAX_CONTENT_LIKE_CHARS) {
      throw new TypeError(`contentLike 超长（上限 ${MAX_CONTENT_LIKE_CHARS} 字符）`);
    }
    clauses.push("e.payload LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(criteria.contentLike)}%`);
  }
  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

/**
 * 由条件装配查询 SQL（检索面唯一组装点——机内化：测试对同一 SQL 跑
 * EXPLAIN QUERY PLAN 断言索引/扫描形态；不是第二套查询实现）。
 */
export interface BuiltSessionQuery {
  where: string;
  params: unknown[];
  countSql: string;
  rowsSql: string;
}

export function buildSessionQuery(criteria: SessionQueryCriteria = {}): BuiltSessionQuery {
  const { where, params } = buildWhere(criteria);
  return {
    where,
    params,
    countSql: `SELECT COUNT(*) AS n FROM events e ${where}`,
    rowsSql:
      `SELECT e.session_id, e.seq, e.type, e.ts, e.payload FROM events e ${where}` +
      " ORDER BY e.ts DESC, e.session_id ASC, e.seq DESC LIMIT ? OFFSET ?",
  };
}

function rowOf(r: { session_id: string; seq: number; type: string; ts: number; payload: string }, contentLike?: string): SessionQueryRow {
  return {
    sessionId: r.session_id,
    seq: r.seq,
    type: r.type as SessionEventType,
    ts: r.ts,
    event: JSON.parse(r.payload) as SessionEvent,
    ...(contentLike !== undefined ? { excerpt: excerptOf(r.payload, contentLike) } : {}),
  };
}

/** 归档账本命中的会话 id（按 id 前缀——归档会话的主库读面 fail-closed 的补集）。 */
function archivedMatches(db: Database.Database, sessionIdPrefix: string | undefined): string[] {
  if (sessionIdPrefix === undefined) {
    return (
      db.prepare("SELECT session_id FROM archived_sessions ORDER BY archived_at DESC").all() as Array<{
        session_id: string;
      }>
    ).map((r) => r.session_id);
  }
  const upper = prefixUpperBound(sessionIdPrefix);
  const rows = (
    upper === undefined
      ? db
          .prepare(
            "SELECT session_id FROM archived_sessions WHERE session_id >= ? ORDER BY archived_at DESC",
          )
          .all(sessionIdPrefix)
      : db
          .prepare(
            "SELECT session_id FROM archived_sessions WHERE session_id >= ? AND session_id < ? ORDER BY archived_at DESC",
          )
          .all(sessionIdPrefix, upper)
  ) as Array<{ session_id: string }>;
  return rows.map((r) => r.session_id);
}

/**
 * 条件检索会话事件（跨会话）。按时间新→旧排序（检索面语义）；命中总数与
 * 分页独立（hasMore 判据）。已归档会话不在主库——按 id 条件命中账本时
 * 在 `archivedSessions` 显式列出（读取走 readArchivedSession）。
 */
export function querySessions(dbPath: string, criteria: SessionQueryCriteria = {}): SessionQueryResult {
  assertDbPath(dbPath);
  const storage = SqliteEventStorage.open({ path: dbPath });
  try {
    return querySessionsDb(storage.db, criteria);
  } finally {
    storage.close();
  }
}

/**
 * 已打开库上的条件检索（U9/T-P3-108：host bridge 的 op:"search" 消费面——
 * 复用 sessionsLibrary 的既有连接，不再逐查开关库）。语义与 querySessions
 * 全同（单测共用同一用例面）；db 参数不作校验（调用方持有连接的所有权）。
 */
export function querySessionsDb(
  db: Database.Database,
  criteria: SessionQueryCriteria = {},
): SessionQueryResult {
  const limit = assertInt(criteria.limit ?? DEFAULT_QUERY_LIMIT, "limit", 1, MAX_QUERY_LIMIT);
  const offset = assertInt(criteria.offset ?? 0, "offset", 0, Number.MAX_SAFE_INTEGER);
  const built = buildSessionQuery(criteria);
  const total = (db.prepare(built.countSql).get(...built.params) as { n: number }).n;
  const rows = db
    .prepare(built.rowsSql)
    .all(...built.params, limit, offset) as Array<{
    session_id: string;
    seq: number;
    type: string;
    ts: number;
    payload: string;
  }>;
  return {
    rows: rows.map((r) => rowOf(r, criteria.contentLike)),
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
    archivedSessions: archivedMatches(db, criteria.sessionIdPrefix),
  };
}

/**
 * 读一个会话的事件（seq 升序——会话视图的自然序）；分页面同 querySessions。
 * 已归档会话 → SessionArchivedError（fail-closed：归档档走 archive.ts）；
 * 会话不存在 → SessionQueryError SESSION_NOT_FOUND。
 */
export function getSessionEvents(
  dbPath: string,
  sessionId: string,
  options: { fromSeq?: number; limit?: number } = {},
): SessionEventsRead {
  assertDbPath(dbPath);
  if (!isValidSessionId(sessionId)) {
    throw new TypeError(`会话 id 不合法：${JSON.stringify(sessionId)}`);
  }
  const fromSeq = assertInt(options.fromSeq ?? 1, "fromSeq", 1, Number.MAX_SAFE_INTEGER);
  const limit = assertInt(
    options.limit ?? DEFAULT_SESSION_READ_LIMIT,
    "limit",
    1,
    MAX_QUERY_LIMIT,
  );

  const storage = SqliteEventStorage.open({ path: dbPath });
  try {
    const db = storage.db;
    // 归档 fail-closed（与 SqliteEventStorage.readAll 同判据——这里不走
    // storage.readAll 以免把全量流读进内存）。
    if (db.prepare("SELECT 1 AS hit FROM archived_sessions WHERE session_id = ?").get(sessionId) !== undefined) {
      throw new SessionArchivedError(sessionId);
    }
    const exists = db.prepare("SELECT 1 AS hit FROM sessions WHERE id = ?").get(sessionId);
    if (exists === undefined) {
      throw new SessionQueryError("SESSION_NOT_FOUND", `会话 ${sessionId} 不存在`);
    }
    const total = (
      db.prepare("SELECT COUNT(*) AS n FROM events WHERE session_id = ?").get(sessionId) as {
        n: number;
      }
    ).n;
    const rows = db
      .prepare(
        `SELECT session_id, seq, type, ts, payload FROM events
         WHERE session_id = ? AND seq >= ?
         ORDER BY seq ASC LIMIT ?`,
      )
      .all(sessionId, fromSeq, limit) as Array<{
      session_id: string;
      seq: number;
      type: string;
      ts: number;
      payload: string;
    }>;
    const lastSeq = rows.length > 0 ? rows[rows.length - 1]!.seq : fromSeq - 1;
    return {
      sessionId,
      total,
      fromSeq,
      events: rows.map((r) => rowOf(r)),
      hasMore: lastSeq < total,
    };
  } finally {
    storage.close();
  }
}
