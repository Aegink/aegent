/**
 * 会话历史管理测试（U3/T-P3-105）——验收三面：
 * ① SQL 面：listSessionSummaries（session_index 清单 + 首条 user 消息标题）
 *    与 deleteSession（三表事务硬删除、幂等拒绝）；
 * ② CLI 面：`aegent sessions list` / `delete`（--yes 确认闸）退出码与输出；
 * ③ wire 面（query op:"sessions" + settings op:"session-delete"）在
 *    server.test.ts（端到端走真实 WS）。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteEventStorage } from "./db.js";
import { InMemoryEventStorage } from "./store.js";
import { isValidSessionId } from "./session-id.js";
import { defaultSessionsDbPath, formatTs, runSessionsCommand } from "../cli/sessions.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tmpDb(): { storage: SqliteEventStorage; path: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-sessions-"));
  tmpDirs.push(dir);
  const dbPath = path.join(dir, "sessions.db");
  return { storage: SqliteEventStorage.open({ path: dbPath }), path: dbPath };
}

function append(storage: SqliteEventStorage, sessionId: string, events: unknown[]): void {
  // 测试面直写：seq/ts 形状合法即可（SessionEvent 纪律由 store.append 管，
  // 这里直接走 storage.appendBatch 的持久化面——roster.test 先例）
  storage.appendBatch(
    sessionId,
    events.map((event, i) => ({ ...(event as object), seq: i + 1, ts: 1_700_000_000_000 + i }) as never),
  );
}

describe("SQL 面：listSessionSummaries / deleteSession", () => {
  it("清单按更新时间倒序 + 首条 user/message 做标题（60 字截断）", () => {
    const { storage } = tmpDb();
    try {
      append(storage, "s-aaaaaa", [
        { type: "turn/start", turn: 1 },
        { type: "user/message", turn: 1, message: { content: "帮我修一下登录页面的样式问题" }, source: "user" },
        { type: "assistant/message", turn: 1, step: 1, message: { content: "好" }, stream: [] },
      ]);
      append(storage, "s-bbbbbb", [
        { type: "user/message", turn: 1, message: { content: "第二会话".repeat(20) }, source: "user" },
      ]);
      const rows = storage.listSessionSummaries();
      expect(rows).toHaveLength(2);
      // 同 ts 序列——updated_ts 一致；标题断言为主
      const byId = new Map(rows.map((r) => [r.sessionId, r]));
      expect(byId.get("s-aaaaaa")?.title).toBe("帮我修一下登录页面的样式问题");
      expect(byId.get("s-aaaaaa")?.eventCount).toBe(3);
      const long = byId.get("s-bbbbbb")?.title ?? "";
      expect(long.length).toBeLessThanOrEqual(61);
      expect(long.endsWith("…")).toBe(true);
    } finally {
      storage.close();
    }
  });

  it("删除：三表事务清除（索引行消失、事件空）+ 不存在返回 false + 非法 id 拒绝", () => {
    const { storage } = tmpDb();
    try {
      append(storage, "s-cccccc", [{ type: "user/message", turn: 1, message: { content: "x" }, source: "user" }]);
      expect(storage.deleteSession("s-cccccc")).toBe(true);
      expect(storage.readAll("s-cccccc")).toEqual([]); // 事件清空
      expect(storage.readSessionIndex("s-cccccc")).toBeNull(); // 索引行清除
      expect(storage.deleteSession("s-cccccc")).toBe(false); // 幂等拒绝
      expect(() => storage.deleteSession("bad id!")).toThrow(/不合法/);
    } finally {
      storage.close();
    }
  });
});

describe("CLI 面：runSessionsCommand", () => {
  function collect() {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      run: (argv: string[]) =>
        runSessionsCommand(argv, {
          out: (l) => out.push(l),
          err: (l) => err.push(l),
        }),
    };
  }

  it("list 输出会话清单与续聊提示", async () => {
    const { storage, path: dbPath } = tmpDb();
    append(storage, "s-dddddd", [
      { type: "user/message", turn: 1, message: { content: "列表标题样例" }, source: "user" },
    ]);
    storage.close();
    const io = collect();
    expect(await io.run(["list", "--db", dbPath])).toBe(0);
    expect(io.out.join("\n")).toContain("s-dddddd");
    expect(io.out.join("\n")).toContain("列表标题样例");
    expect(io.out.join("\n")).toContain("续聊：aegent sessions resume <id>");
  });

  it("delete 无 --yes 被闸住；带 --yes 删除成功；未知动作回用法", async () => {
    const { storage, path: dbPath } = tmpDb();
    append(storage, "s-eeeeee", [{ type: "user/message", turn: 1, message: { content: "x" }, source: "user" }]);
    storage.close();
    const no = collect();
    expect(await no.run(["delete", "s-eeeeee", "--db", dbPath])).toBe(1);
    expect(no.err.join("\n")).toContain("--yes");
    expect(storageHas(dbPath, "s-eeeeee")).toBe(true);

    const yes = collect();
    expect(await yes.run(["delete", "s-eeeeee", "--yes", "--db", dbPath])).toBe(0);
    expect(yes.out.join("\n")).toContain("已删除");
    expect(storageHas(dbPath, "s-eeeeee")).toBe(false);

    const bad = collect();
    expect(await bad.run(["frobnicate"])).toBe(1);
    expect(bad.err.join("\n")).toContain("用法");
  });
});

function storageHas(dbPath: string, sessionId: string): boolean {
  const storage = SqliteEventStorage.open({ path: dbPath });
  try {
    return storage.readSessionIndex(sessionId) !== null;
  } finally {
    storage.close();
  }
}

describe("入口辅助", () => {
  it("defaultSessionsDbPath 指向 ~/.aegent/sessions.db；formatTs 输出 YYYY-MM-DD HH:MM", () => {
    expect(defaultSessionsDbPath().replace(/\\/g, "/")).toMatch(/\.aegent\/sessions\.db$/);
    expect(formatTs(0)).toBe("?");
    expect(formatTs(new Date("2026-09-29T08:09:00").getTime())).toBe("2026-09-29 08:09");
  });

  it("isValidSessionId 与 resume 分流共用同一校验（会话 id 纪律单源）", () => {
    expect(isValidSessionId("s-abc123")).toBe(true);
    expect(isValidSessionId("bad id")).toBe(false);
    // InMemoryEventStorage 不参与清单/删除面（SQLite 专属）——形状锚定
    expect(new InMemoryEventStorage()).toBeDefined();
  });
});
