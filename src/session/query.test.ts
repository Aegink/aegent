import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { NewSessionEvent } from "../kernel/events.js";
import { archiveSession } from "./archive.js";
import { SessionArchivedError, SqliteEventStorage } from "./db.js";
import {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  SessionQueryError,
  buildSessionQuery,
  getSessionEvents,
  querySessions,
} from "./query.js";
import { SessionStore } from "./store.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-query-"));
  dirs.push(dir);
  return join(dir, "events.sqlite");
}

function turnEvents(turn: number, text: string): NewSessionEvent[] {
  return [
    { type: "turn/start", turn },
    { type: "step/start", turn, step: turn },
    { type: "user/message", turn, message: { content: text }, source: "user" },
    { type: "assistant/message", turn, step: turn, message: { content: `${text}-reply` }, stream: [] },
    { type: "step/end", turn, step: turn },
    { type: "turn/end", turn, reason: { kind: "completed" } },
  ];
}

/** 两会话（s-alpha 一轮"hello world"、s-beta 两轮）+ 手工 ts 定序。 */
async function seedDb(dbPath: string): Promise<{ tsBase: number }> {
  const storage = SqliteEventStorage.open({ path: dbPath });
  try {
    const store = new SessionStore(storage);
    store.append("s-alpha", turnEvents(1, "hello world"));
    store.append("s-beta", [...turnEvents(1, "first beta question"), ...turnEvents(2, "second beta question")]);
    await store.flush("s-alpha");
    await store.flush("s-beta");
    // 手工时间：s-alpha 事件 ts = 1000..1005，s-beta = 2000..2011（确定性区间检索）
    const tsBase = 1000;
    const alpha = storage.db
      .prepare("SELECT seq FROM events WHERE session_id = 's-alpha' ORDER BY seq")
      .all() as Array<{ seq: number }>;
    alpha.forEach((row, i) => {
      storage.db
        .prepare("UPDATE events SET ts = ? WHERE session_id = 's-alpha' AND seq = ?")
        .run(tsBase + i, row.seq);
    });
    const beta = storage.db
      .prepare("SELECT seq FROM events WHERE session_id = 's-beta' ORDER BY seq")
      .all() as Array<{ seq: number }>;
    beta.forEach((row, i) => {
      storage.db
        .prepare("UPDATE events SET ts = ? WHERE session_id = 's-beta' AND seq = ?")
        .run(2000 + i, row.seq);
    });
    return { tsBase };
  } finally {
    storage.close();
  }
}

describe("会话查询（Q2/T-P2-105）", () => {
  it("四类条件检索：会话前缀 / 时间区间 / 事件类型 / 内容子串（AND 组合）", async () => {
    const dbPath = tempDbPath();
    await seedDb(dbPath);

    // ① 会话 id 前缀
    const byPrefix = querySessions(dbPath, { sessionIdPrefix: "s-alpha" });
    expect(byPrefix.total).toBe(6);
    expect(byPrefix.rows.every((r) => r.sessionId === "s-alpha")).toBe(true);
    const crossPrefix = querySessions(dbPath, { sessionIdPrefix: "s-" });
    expect(crossPrefix.total).toBe(18);
    expect(new Set(crossPrefix.rows.map((r) => r.sessionId))).toEqual(new Set(["s-alpha", "s-beta"]));

    // ② 时间区间（含界）
    const byTime = querySessions(dbPath, { fromTs: 2000, toTs: 2005 });
    expect(byTime.total).toBe(6);
    expect(byTime.rows.map((r) => r.ts).sort((a, b) => a - b)).toEqual([2000, 2001, 2002, 2003, 2004, 2005]);

    // ③ 事件类型
    const byType = querySessions(dbPath, { types: ["user/message"] });
    expect(byType.total).toBe(3);
    expect(byType.rows.every((r) => r.type === "user/message")).toBe(true);

    // ④ 内容子串（命中摘录 + 与 AND 组合）——"first beta" 同时命中用户句
    // 与其 assistant 回复（回复文本 = 用户句 + "-reply"，子串匹配同命中）
    const byContent = querySessions(dbPath, { contentLike: "first beta" });
    expect(byContent.total).toBe(2);
    expect(new Set(byContent.rows.map((r) => r.type))).toEqual(
      new Set(["user/message", "assistant/message"]),
    );
    expect(byContent.rows.every((r) => r.sessionId === "s-beta")).toBe(true);
    expect(byContent.rows[0]!.excerpt).toContain("first beta question");
    const combined = querySessions(dbPath, {
      sessionIdPrefix: "s-alpha",
      types: ["user/message"],
      contentLike: "hello",
    });
    expect(combined.total).toBe(1);
    expect(combined.rows[0]!.event.type).toBe("user/message");

    // 无命中
    expect(querySessions(dbPath, { contentLike: "不存在的串" }).total).toBe(0);
  });

  it("分页：LIMIT/OFFSET 在 SQL 层（行数受 limit 约束而 total 统计全量）+ hasMore", async () => {
    const dbPath = tempDbPath();
    await seedDb(dbPath);

    const page1 = querySessions(dbPath, { sessionIdPrefix: "s-", limit: 5 });
    expect(page1.total).toBe(18);
    expect(page1.rows).toHaveLength(5);
    expect(page1.hasMore).toBe(true);
    expect(page1.limit).toBe(5);
    expect(page1.offset).toBe(0);

    const page2 = querySessions(dbPath, { sessionIdPrefix: "s-", limit: 5, offset: 5 });
    expect(page2.rows).toHaveLength(5);
    expect(page2.hasMore).toBe(true);
    // 两页无重叠（时间倒序稳定序）
    const key = (r: { sessionId: string; seq: number }) => `${r.sessionId}:${r.seq}`;
    expect(new Set([...page1.rows, ...page2.rows].map(key)).size).toBe(10);

    const lastPage = querySessions(dbPath, { sessionIdPrefix: "s-", limit: 5, offset: 15 });
    expect(lastPage.rows).toHaveLength(3);
    expect(lastPage.hasMore).toBe(false);

    expect(DEFAULT_QUERY_LIMIT).toBe(50);
  });

  it("SQL 断言：前缀走索引（EXPLAIN 无全表扫描）+ 行查询带 LIMIT；坏条件 fail-closed", async () => {
    const dbPath = tempDbPath();
    await seedDb(dbPath);

    const storage = SqliteEventStorage.open({ path: dbPath });
    try {
      // 前缀条件：EXPLAIN QUERY PLAN 命中 events 主键索引（session_id 范围）
      const prefixSql = buildSessionQuery({ sessionIdPrefix: "s-alpha" });
      const plan = storage.db
        .prepare(`EXPLAIN QUERY PLAN ${prefixSql.rowsSql}`)
        .all(...prefixSql.params, 50, 0) as Array<{ detail: string }>;
      const details = plan.map((r) => r.detail).join(" | ");
      expect(details).toContain("USING INDEX");
      expect(details).toContain("session_id>?");
      expect(details).not.toContain("SCAN e");

      // 行查询本体带 LIMIT ? OFFSET ?（分页在 SQL 层——不全量加载）
      expect(prefixSql.rowsSql).toContain("LIMIT ? OFFSET ?");
      expect(prefixSql.where).toContain("e.session_id >= ?");
      expect(prefixSql.where).toContain("e.session_id < ?");
    } finally {
      storage.close();
    }

    // 坏条件类型化拒绝（外部输入校验）
    expect(() => querySessions(dbPath, { limit: 0 })).toThrow(TypeError);
    expect(() => querySessions(dbPath, { limit: MAX_QUERY_LIMIT + 1 })).toThrow(TypeError);
    expect(() => querySessions(dbPath, { offset: -1 })).toThrow(TypeError);
    expect(() => querySessions(dbPath, { types: [] })).toThrow(TypeError);
    expect(() => querySessions(dbPath, { types: ["ghost/type" as never] })).toThrow(TypeError);
    expect(() => querySessions(dbPath, { contentLike: "" })).toThrow(TypeError);
    expect(() => querySessions(dbPath, { contentLike: "x".repeat(300) })).toThrow(TypeError);
    expect(() => querySessions(dbPath, { sessionIdPrefix: "" })).toThrow(TypeError);
  });

  it("归档语义：已归档会话主库检不到但在 archivedSessions 显式列出（Q8 补集）；读取类型化拒绝", async () => {
    const dbPath = tempDbPath();
    await seedDb(dbPath);
    archiveSession(dbPath, "s-alpha", { reason: "retention" });

    const hit = querySessions(dbPath, { sessionIdPrefix: "s-alpha" });
    expect(hit.total).toBe(0); // 主库无行
    expect(hit.archivedSessions).toEqual(["s-alpha"]); // 但账本显式标出
    const cross = querySessions(dbPath, { sessionIdPrefix: "s-" });
    expect(cross.total).toBe(12); // s-beta 12 条
    expect(cross.archivedSessions).toEqual(["s-alpha"]);

    // getSessionEvents 对归档会话 fail-closed（归档档走 readArchivedSession）
    expect(() => getSessionEvents(dbPath, "s-alpha")).toThrow(SessionArchivedError);
    // 不存在的会话 → SESSION_NOT_FOUND
    try {
      getSessionEvents(dbPath, "s-none");
    } catch (error) {
      expect((error as SessionQueryError).code).toBe("SESSION_NOT_FOUND");
    }
  });

  it("getSessionEvents：单会话 seq 升序 + fromSeq/limit 分页 + total/hasMore", async () => {
    const dbPath = tempDbPath();
    await seedDb(dbPath);

    const all = getSessionEvents(dbPath, "s-beta");
    expect(all.total).toBe(12);
    expect(all.events.map((r) => r.seq)).toEqual([...Array(12).keys()].map((i) => i + 1));
    expect(all.hasMore).toBe(false);
    expect(all.events[0]!.event.type).toBe("turn/start");

    const page = getSessionEvents(dbPath, "s-beta", { fromSeq: 7, limit: 3 });
    expect(page.events.map((r) => r.seq)).toEqual([7, 8, 9]);
    expect(page.hasMore).toBe(true);
    const tail = getSessionEvents(dbPath, "s-beta", { fromSeq: 10, limit: 3 });
    expect(tail.events.map((r) => r.seq)).toEqual([10, 11, 12]);
    expect(tail.hasMore).toBe(false);

    expect(() => getSessionEvents(dbPath, "s-beta", { fromSeq: 0 })).toThrow(TypeError);
    expect(() => getSessionEvents(dbPath, "../evil")).toThrow(TypeError);
  });
});
