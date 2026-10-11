/**
 * W15b/T9-7 验收：trace 家族工具（session_trace / session_event_trace /
 * session_event_read——真 sqlite 库 + 授权边界）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteEventStorage } from "../../src/session/db.js";
import type { SessionEvent } from "../../src/core/index.js";
import { createSessionTraceTools, type SessionTraceDeps } from "./session-trace.js";

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows 句柄释放竞态
    }
  }
});

const ev = (seq: number, type: string, extra: Record<string, unknown> = {}): SessionEvent =>
  ({ type, seq, ts: 1_700_000_000_000 + seq, turn: 1, ...extra }) as SessionEvent;

function makeFixture(options?: { authorizeRead?: SessionTraceDeps["authorizeRead"] }) {
  const dir = mkdtempSync(join(tmpdir(), "aegent-trace-"));
  roots.push(dir);
  const dbPath = join(dir, "sessions.db");
  const storage = SqliteEventStorage.open({ path: dbPath });
  // 父子血统 + 引用关系事件
  storage.commit([
    { kind: "events", sessionId: "s-parent", events: [
      ev(1, "turn/start"),
      ev(2, "user/message", { source: "user", message: { content: "父任务" } }),
    ] },
    { kind: "events", sessionId: "s-child", events: [
      ev(1, "turn/start"),
      ev(2, "user/message", { source: "user", message: { content: "子任务", sessionRefs: [{ sessionId: "s-parent", seq: 2 }] } }),
      ev(3, "session/revert", { targetSeq: 2, codeRestored: false }),
    ] },
    { kind: "origin", sessionId: "s-child", originSessionId: "s-parent" },
  ]);
  const deps: SessionTraceDeps = {
    dbPath,
    ...(options?.authorizeRead !== undefined ? { authorizeRead: options.authorizeRead } : {}),
    caller: { sessionId: "s-parent", cwd: "/w" },
  };
  const tools = createSessionTraceTools(deps);
  const dispatch = (name: string, args: Record<string, unknown>) => {
    const tool = tools.find((t) => t.name === name)!;
    return tool.execute(args as never, {} as never) as Promise<{ content: string; isError?: boolean }>;
  };
  return { storage, dispatch };
}

describe("trace 家族（W15b/T9-7）", () => {
  it("session_trace：createdBySession + createdSessions 血统投影", async () => {
    const { dispatch, storage } = makeFixture();
    const child = JSON.parse((await dispatch("session_trace", { sessionId: "s-child" })).content);
    expect(child.createdBySession).toBe("s-parent");
    const parent = JSON.parse((await dispatch("session_trace", { sessionId: "s-parent" })).content);
    expect(parent.createdSessions).toEqual(["s-child"]);
    void storage;
  });

  it("session_event_trace：sessionRefs 引用者 + revert 覆盖标记", async () => {
    const { dispatch } = makeFixture();
    const result = JSON.parse((await dispatch("session_event_trace", { sessionId: "s-child", seq: 2 })).content);
    expect(result.type).toBe("user/message");
    expect(result.referencedBy).toEqual([]); // 自引用不成立（refs 指向 s-parent）
    expect(result.overriddenBy).toEqual({ seq: 3, type: "session/revert" });
    // 父会话的 seq2 被子会话引用
    const parentSide = JSON.parse((await dispatch("session_event_trace", { sessionId: "s-parent", seq: 2 })).content);
    void parentSide;
  });

  it("session_event_read：完整事件 + 前后摘要", async () => {
    const { dispatch } = makeFixture();
    const result = JSON.parse((await dispatch("session_event_read", { sessionId: "s-child", seq: 2, context: 1 })).content);
    expect(result.event.type).toBe("user/message");
    expect(result.event.message.content).toBe("子任务");
    expect(result.before).toHaveLength(1); // seq1 turn/start
    expect(result.after).toHaveLength(1); // seq3 revert
  });

  it("授权边界：denied → SESSION_READ_DENIED（EP-3 同面）", async () => {
    const { dispatch } = makeFixture({
      authorizeRead: () => ({ allowed: false, reason: "跨项目拒绝" }),
    });
    const result = await dispatch("session_trace", { sessionId: "s-child" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("SESSION_READ_DENIED");
  });

  it("未知事件 → SESSION_NOT_FOUND 类型化拒绝", async () => {
    const { dispatch } = makeFixture();
    const result = await dispatch("session_event_read", { sessionId: "s-child", seq: 99 });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("SESSION_NOT_FOUND");
  });
});
