import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { NewSessionEvent, SessionEvent } from "../kernel/events.js";
import {
  ARCHIVED_SESSIONS_SUBDIR,
  ArchiveError,
  archiveSession,
  listArchivedSessions,
  readArchivedSession,
} from "./archive.js";
import { SessionArchivedError, SqliteEventStorage } from "./db.js";
import { SessionStore } from "./store.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-archive-"));
  dirs.push(dir);
  return join(dir, "events.sqlite");
}

function sampleTurn(turn: number): NewSessionEvent[] {
  return [
    { type: "turn/start", turn },
    { type: "step/start", turn, step: turn },
    { type: "user/message", turn, message: { content: `q${turn}` }, source: "user" },
    { type: "assistant/message", turn, step: turn, message: { content: `a${turn}` }, stream: [] },
    { type: "step/end", turn, step: turn },
    { type: "turn/end", turn, reason: { kind: "completed" } },
  ];
}

/** 建库 + 写两个会话（"s-live" 一个 turn、"s-arch" 两个 turn），flush 落库。 */
async function seedDb(path: string): Promise<void> {
  const storage = SqliteEventStorage.open({ path });
  try {
    const store = new SessionStore(storage);
    store.append("s-live", sampleTurn(1));
    store.append("s-arch", [...sampleTurn(1), ...sampleTurn(2)]);
    await store.flush("s-live");
    await store.flush("s-arch");
  } finally {
    storage.close();
  }
}

function readMainEvents(path: string, sessionId: string): SessionEvent[] {
  const storage = SqliteEventStorage.open({ path });
  try {
    return storage.readAll(sessionId);
  } finally {
    storage.close();
  }
}

function archiveErrorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ArchiveError) return error.code;
    throw error;
  }
  throw new Error("预期抛 ArchiveError，实际未抛");
}

describe("会话归档（Q8/T-P2-102）", () => {
  it("归档往返：主库消失 + 归档账本在 + 归档档在 + 流尾归档标记 + 归档档完整可读", async () => {
    const dbPath = tempDbPath();
    await seedDb(dbPath);
    const before = readMainEvents(dbPath, "s-arch");
    expect(before).toHaveLength(12);

    const receipt = archiveSession(dbPath, "s-arch", {
      reason: "retention",
      now: () => 1_800_000_000_000,
    });
    expect(receipt.sessionId).toBe("s-arch");
    expect(receipt.eventCount).toBe(13); // 12 条原事件 + 1 条归档标记
    expect(receipt.archivedAt).toBe(1_800_000_000_000);
    expect(receipt.archivePath).toBe(
      join(dirname(dbPath), ARCHIVED_SESSIONS_SUBDIR, "s-arch.sqlite"),
    );
    expect(existsSync(receipt.archivePath)).toBe(true);

    // 主库侧：数据行删除 + 账本留痕 + 索引行清掉 + 其它会话零影响
    const storage = SqliteEventStorage.open({ path: dbPath });
    try {
      expect(
        (storage.db.prepare("SELECT COUNT(*) AS n FROM events WHERE session_id = ?").get("s-arch") as { n: number }).n,
      ).toBe(0);
      expect(storage.db.prepare("SELECT 1 AS hit FROM sessions WHERE id = ?").get("s-arch")).toBeUndefined();
      expect(
        storage.db.prepare("SELECT 1 AS hit FROM session_index WHERE session_id = ?").get("s-arch"),
      ).toBeUndefined();
      expect(
        storage.db
          .prepare(
            "SELECT archived_at, event_count, reason, archive_file FROM archived_sessions WHERE session_id = ?",
          )
          .get("s-arch"),
      ).toEqual({
        archived_at: 1_800_000_000_000,
        event_count: 13,
        reason: "retention",
        archive_file: "s-arch.sqlite",
      });
      expect(storage.readAll("s-live")).toHaveLength(6);
    } finally {
      storage.close();
    }

    // 归档档侧：完整可读 + 前 12 条与原流逐条等值（归档是搬运不是改写）+ 流尾标记
    const archived = readArchivedSession(dbPath, "s-arch");
    expect(archived.sessionId).toBe("s-arch");
    expect(archived.eventCount).toBe(13);
    expect(archived.reason).toBe("retention");
    expect(archived.archivedAt).toBe(1_800_000_000_000);
    expect(archived.events.slice(0, before.length)).toEqual(before);
    const tail = archived.events[archived.events.length - 1]!;
    expect(tail.type).toBe("session/archive");
    expect(tail.seq).toBe(13);
    expect(tail.type === "session/archive" ? tail.reason : undefined).toBe("retention");
  });

  it("归档后主库读路径 fail-closed：readAll → SessionArchivedError（查无 ≠ 已归档）", async () => {
    const dbPath = tempDbPath();
    await seedDb(dbPath);
    archiveSession(dbPath, "s-arch");

    const storage = SqliteEventStorage.open({ path: dbPath });
    try {
      expect(() => storage.readAll("s-arch")).toThrow(SessionArchivedError);
      let code: string | undefined;
      try {
        storage.readAll("s-arch");
      } catch (error) {
        code = (error as SessionArchivedError).code;
      }
      expect(code).toBe("SESSION_ARCHIVED");
      // 未归档会话不受影响
      expect(storage.readAll("s-live")).toHaveLength(6);
    } finally {
      storage.close();
    }
  });

  it("listArchivedSessions 可查：归档档元数据自足（删掉主库账本也照样列出）", async () => {
    const dbPath = tempDbPath();
    await seedDb(dbPath);
    archiveSession(dbPath, "s-arch", { reason: "manual", now: () => 200 });
    archiveSession(dbPath, "s-live", { now: () => 100 });

    const infos = listArchivedSessions(dbPath);
    expect(infos.map((i) => i.sessionId)).toEqual(["s-arch", "s-live"]); // archivedAt 降序
    expect(infos[0]).toMatchObject({ reason: "manual", archivedAt: 200, eventCount: 13 });
    expect(infos[1]).toMatchObject({ eventCount: 7 }); // 6 + 1
    expect("reason" in infos[1]!).toBe(false);

    // 账本删除（归档档元数据自足——账本丢失不丢归档的复核）
    const storage = SqliteEventStorage.open({ path: dbPath });
    storage.db.exec("DELETE FROM archived_sessions");
    storage.close();
    expect(listArchivedSessions(dbPath).map((i) => i.sessionId)).toEqual(["s-arch", "s-live"]);
  });

  it("归档标记幂等：流尾已有 session/archive 时不再追加第二枚（崩溃重试路径）", async () => {
    const dbPath = tempDbPath();
    await seedDb(dbPath);
    // 模拟"标记已落但归档未完成"的中间态（崩溃重试前的残留）
    const storage = SqliteEventStorage.open({ path: dbPath });
    try {
      const store = new SessionStore(storage);
      await store.restore("s-arch");
      store.append("s-arch", [{ type: "session/archive", turn: 2, reason: "retention" }]);
      await store.flush("s-arch");
    } finally {
      storage.close();
    }

    const receipt = archiveSession(dbPath, "s-arch", { reason: "retention" });
    expect(receipt.eventCount).toBe(13); // 不因第二枚标记变 14
    const archived = readArchivedSession(dbPath, "s-arch");
    expect(archived.events.filter((e) => e.type === "session/archive")).toHaveLength(1);
  });

  it("失败面类型化：坏路径/坏 id/不存在/重复归档/无归档档 各自拒绝码", async () => {
    const dbPath = tempDbPath();
    await seedDb(dbPath);

    expect(archiveErrorCode(() => archiveSession(":memory:", "s-arch"))).toBe("ARCHIVE_BAD_DB_PATH");
    expect(archiveErrorCode(() => archiveSession(dbPath, "../evil"))).toBe("ARCHIVE_BAD_SESSION_ID");
    expect(archiveErrorCode(() => archiveSession(dbPath, "s-none"))).toBe("ARCHIVE_SESSION_MISSING");
    archiveSession(dbPath, "s-arch");
    expect(archiveErrorCode(() => archiveSession(dbPath, "s-arch"))).toBe("ARCHIVE_ALREADY_ARCHIVED");
    expect(archiveErrorCode(() => readArchivedSession(dbPath, "s-live"))).toBe("ARCHIVE_NOT_FOUND");
    expect(() => archiveSession(dbPath, "s-arch")).toThrow(ArchiveError);
  });
});
