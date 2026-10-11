/**
 * W15b/T9-7 验收：commit 原子批（崩溃点 = 整批不可见）+ ignorable 信封
 * （白名单式跳过/拒读）+ G1/G2 不破（flush 串行与恢复纪律）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { envelopeVisibleEvents, EventEnvelopeError, type EventStorage, type SessionEvent } from "../core/index.js";
import { SqliteEventStorage, CURRENT_SCHEMA_VERSION } from "./db.js";
import { InMemoryEventStorage, SessionEventStore } from "./store.js";
import { collaborationProjection } from "./collab-projection.js";

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

function makeDb(): { path: string } {
  const dir = mkdtempSync(join(tmpdir(), "aegent-commit-"));
  roots.push(dir);
  return { path: join(dir, "sessions.db") };
}

const ev = (seq: number, type: string, extra: Record<string, unknown> = {}): SessionEvent =>
  ({ type, seq, ts: 1_700_000_000_000 + seq, turn: 1, ...extra }) as SessionEvent;

describe("commit 原子批（W15b/T9-7——§10）", () => {
  it("四类写同一事务：事件+标题+血统+插件文档同批可见", () => {
    const { path } = makeDb();
    const storage = SqliteEventStorage.open({ path });
    storage.commit([
      { kind: "events", sessionId: "s1", events: [ev(1, "turn/start"), ev(2, "user/message", { message: { content: "hi" } })] },
      { kind: "title", sessionId: "s1", title: "测试会话", source: "generated" },
      { kind: "origin", sessionId: "s1", originSessionId: "s-parent" },
      { kind: "doc", collection: "plug/acme/notes", docId: "n1", body: { text: "插件文档" } },
    ]);
    expect(storage.readAll("s1")).toHaveLength(2);
    expect(storage.getTitle("s1")?.title).toBe("测试会话");
    expect(storage.getSessionOrigin("s1")).toBe("s-parent");
    expect(storage.readPluginDocuments("plug/acme/notes")).toHaveLength(1);
    storage.close();
  });

  it("崩溃点：批内事务中止 = 整批不可见（事件/标题/文档零残留）", () => {
    const { path } = makeDb();
    const storage = SqliteEventStorage.open({ path });
    // 先落一条 seq=1——批内重复 seq 触发 PK 冲突（事务中止点）
    storage.commit([{ kind: "events", sessionId: "s1", events: [ev(1, "turn/start")] }]);
    expect(() =>
      storage.commit([
        { kind: "events", sessionId: "s1", events: [ev(2, "user/message", { message: { content: "x" } })] },
        { kind: "title", sessionId: "s1", title: "不该出现的标题", source: "generated" },
        { kind: "doc", collection: "plug/acme/notes", docId: "n-bad", body: { text: "不该出现" } },
        { kind: "events", sessionId: "s1", events: [ev(1, "turn/start")], }, // PK 冲突——崩溃点
      ]),
    ).toThrow();
    // 整批不可见：seq=2 事件、标题、文档全部回滚
    expect(storage.readAll("s1")).toHaveLength(1);
    expect(storage.getTitle("s1")).toBeUndefined();
    expect(storage.readPluginDocuments("plug/acme/notes")).toHaveLength(0);
    storage.close();
  });

  it("schema v10：库版本单调推进（plugin_documents 表在位）", () => {
    const { path } = makeDb();
    const storage = SqliteEventStorage.open({ path });
    expect(CURRENT_SCHEMA_VERSION).toBe(10);
    // v10 表存在（插入即证）
    expect(() =>
      storage.commit([{ kind: "doc", collection: "c", docId: "d", body: { ok: true } }]),
    ).not.toThrow();
    storage.close();
  });

  it("SessionStore.commit：事件走校验路径 + 非事件写经 flush 链同批落库（热路径不 await I/O）", async () => {
    const storage = new InMemoryEventStorage();
    const store = new SessionEventStore(storage);
    const { seq } = await store.commit([
      {
        kind: "events",
        sessionId: "s1",
        events: [
          { type: "turn/start", turn: 1 },
          { type: "user/message", turn: 1, message: { content: "hi" } },
          { type: "turn/end", turn: 1, reason: { kind: "completed" } },
        ] as never,
      },
      { kind: "doc", collection: "plug/acme/notes", docId: "n1", body: { text: "同批" } },
    ]);
    expect(seq).toBe(3);
    await store.flush("s1");
    expect(storage.readAll("s1")).toHaveLength(3);
    expect(storage.readDocument("plug/acme/notes", "n1")).toEqual({ text: "同批" });
  });

  it("G1 不破：flush 串行 + seq 必须前进断言（commit 后照常）", async () => {
    const store = new SessionEventStore(new InMemoryEventStorage());
    await store.commit([
      {
        kind: "events",
        sessionId: "s1",
        events: [
          { type: "turn/start", turn: 1 },
          { type: "user/message", turn: 1, source: "user", message: { content: "a" } },
          { type: "turn/end", turn: 1, reason: { kind: "completed" } },
        ] as never,
      },
    ]);
    await store.flush("s1");
    await store.flush("s1"); // 二次 flush 空批 no-op
    store.append("s1", [
      { type: "turn/start", turn: 2 },
      { type: "user/message", turn: 2, source: "user", message: { content: "b" } },
      { type: "turn/end", turn: 2, reason: { kind: "completed" } },
    ]);
    await store.flush("s1");
    const events = store.load("s1");
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]); // seq 前进纪律
  });

  it("G2 不破：restore 三级降级语义保持（strict 断续抛错 / lenient 容忍）", async () => {
    const storage = new InMemoryEventStorage();
    // 直接写乱序库面（绕过 store 校验——模拟崩溃残留）
    storage.appendBatch("s1", [ev(1, "turn/start"), ev(3, "user/message", { message: { content: "x" } })]);
    const strict = new SessionEventStore(storage);
    await expect(strict.restore("s1")).rejects.toThrow("seq 不连续");
    const lenient = new SessionEventStore(storage);
    await expect(lenient.restore("s1", { lenient: true })).resolves.toHaveLength(0); // fold 失败降 discard
  });
});

describe("ignorable 信封（W15b/T9-7——§4 白名单式）", () => {
  it("readAll raw 语义：skip 行原样返回（槽位完整性）；可见流由 envelopeVisibleEvents 过滤；reject 恒拒读", () => {
    const { path } = makeDb();
    const storage = SqliteEventStorage.open({ path });
    storage.appendBatch("s1", [
      ev(1, "turn/start"),
      ev(2, "future/event", { ignorable: true, data: "新版事件" } as never),
      ev(3, "user/message", { message: { content: "ok" } }),
    ]);
    // raw：ignorable 行不丢槽位（restore strict 预检/maxSeq 依赖完整 seq 空间——P0-1 修复语义）
    expect(storage.readAll("s1").map((e) => e.seq)).toEqual([1, 2, 3]);
    // 可见流读面：skip 过滤（查询/导出/转移/回放）
    expect(envelopeVisibleEvents(storage.readAll("s1")).map((e) => e.seq)).toEqual([1, 3]);
    storage.close();

    const { path: path2 } = makeDb();
    const storage2 = SqliteEventStorage.open({ path: path2 });
    storage2.appendBatch("s2", [ev(1, "future/event", { data: "未标注" } as never)]);
    expect(() => storage2.readAll("s2")).toThrow(EventEnvelopeError);
    storage2.close();
  });

  it("P0-1 回归：尾跳痕（最大 seq 为 ignorable）restore 后续写不撞主键、不丢事件", async () => {
    const { path } = makeDb();
    const storage = SqliteEventStorage.open({ path });
    storage.appendBatch("s1", [
      ev(1, "turn/start"),
      ev(2, "user/message", { message: { content: "a" } }),
      ev(3, "turn/end", { reason: { kind: "completed" } }),
      ev(4, "future/event", { ignorable: true } as never),
      ev(5, "future/event", { ignorable: true } as never),
    ]);
    const store = new SessionEventStore(storage);
    await store.restore("s1"); // strict 通过（raw seq 空间完整）
    // 续写：nextSeq 必须从真最大 seq+1 = 6 起（修复前低估为 4 → 撞 PK 断写链）
    store.append("s1", [{ type: "turn/start", turn: 2 }]);
    await store.flush("s1");
    const reread = new SessionEventStore(SqliteEventStorage.open({ path }));
    const events = await reread.restore("s1");
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 6]); // 可见流：跳痕 + 新事件
    expect(events.at(-1)!.type).toBe("turn/start");
  });

  it("P1-3 回归：flush 挂起窗口内 append 不丢（换桶语义——新事件归下一批）", async () => {
    const pending: Array<() => void> = []; // 每批一个放行闸（flush 串行链——每轮都会到挂起点）
    const inner = new InMemoryEventStorage();
    const slow = {
      appendBatch(sessionId: string, events: readonly SessionEvent[]): Promise<void> {
        inner.appendBatch(sessionId, events);
        return new Promise<void>((resolve) => {
          pending.push(resolve);
        });
      },
      readAll(sessionId: string): SessionEvent[] {
        return inner.readAll(sessionId);
      },
    } satisfies EventStorage;
    const store = new SessionEventStore(slow);
    store.append("s1", [{ type: "turn/start", turn: 1 }]);
    const flushing = store.flush("s1"); // 第一批挂起在闸上
    await new Promise((r) => setTimeout(r, 0)); // 让 flush 的 run 进入挂起点（微任务时序）
    // 挂起窗口内同会话新 append（修复前：push 进同引用批 → 越过持久化调用点
    // 即被清出 buffer 且被标已落库 → 重启即丢）
    store.append("s1", [
      { type: "user/message", turn: 1, source: "user", message: { content: "during" } },
    ]);
    expect(pending).toHaveLength(1);
    pending.shift()!(); // 放行第一批
    await flushing;
    expect(store.pendingCount("s1")).toBe(1); // 新事件仍待落库（未被误标）
    const second = store.flush("s1"); // 第二批（挂起窗口内 append 的）
    await new Promise((r) => setTimeout(r, 0));
    pending.shift()!();
    await second;
    expect(inner.readAll("s1").map((e) => e.type)).toEqual(["turn/start", "user/message"]);
  });

  it("P1-3 回归：flush 失败回塞保序（持久化抛错 → 事件滞留 buffer 下轮重试）", async () => {
    let failNext = true;
    const inner = new InMemoryEventStorage();
    const flaky = {
      appendBatch(sessionId: string, events: readonly SessionEvent[]): Promise<void> {
        if (failNext) return Promise.reject(new Error("存储瞬断"));
        inner.appendBatch(sessionId, events);
        return Promise.resolve();
      },
      readAll(sessionId: string): SessionEvent[] {
        return inner.readAll(sessionId);
      },
    } satisfies EventStorage;
    const store = new SessionEventStore(flaky);
    store.append("s1", [{ type: "turn/start", turn: 1 }]);
    await expect(store.flush("s1")).rejects.toThrow("存储瞬断");
    expect(store.pendingCount("s1")).toBe(1); // 回塞——不丢
    failNext = false;
    await store.flush("s1"); // 重试成功
    expect(inner.readAll("s1")).toHaveLength(1);
    expect(store.pendingCount("s1")).toBe(0);
  });

  it("restore：strict 对 ignorable 未知容忍（seq 槽位纪律保持）+ 对 reject 抛错", async () => {
    const storage = new InMemoryEventStorage();
    storage.appendBatch("s1", [
      ev(1, "turn/start"),
      ev(2, "future/event", { ignorable: true } as never),
      ev(3, "user/message", { message: { content: "x" } }),
    ]);
    const strict = new SessionEventStore(storage);
    const restored = await strict.restore("s1"); // 不抛——ignorable 槽位合法消费
    expect(restored.map((e) => e.seq)).toEqual([1, 3]);
    expect(strict.sessionIds()).toContain("s1");

    const { path } = makeDb();
    const poisoned = SqliteEventStorage.open({ path });
    poisoned.appendBatch("s2", [ev(1, "future/event", { data: 1 } as never)]);
    poisoned.close();
    const storage2 = SqliteEventStorage.open({ path });
    const strictPoisoned = new SessionEventStore(storage2);
    await expect(strictPoisoned.restore("s2")).rejects.toThrow(EventEnvelopeError);
    // lenient 同拒（fail-closed 不设例外——未知语义数据的可用性降级会静默丢事实）
    const lenientPoisoned = new SessionEventStore(storage2);
    await expect(lenientPoisoned.restore("s2", { lenient: true })).rejects.toThrow(EventEnvelopeError);
    storage2.close();
  });
});

describe("编排投影（W15b/T9-7——pi-desktop SessionCollaborationSummary 对位）", () => {
  it("createdBySession/createdSessions/currentTask/result 四字段聚合", async () => {
    const store = new SessionEventStore(new InMemoryEventStorage());
    // 源视角：A 派 B（在途）+ A 派 C（已结算）
    store.append("s-a", [
      { type: "session/collab", turn: 1, collabId: "collab-1", direction: "dispatch", kind: "task", peerSessionId: "s-b", content: "任务A", permissionCeiling: "ask" } as never,
      { type: "session/collab", turn: 1, collabId: "collab-2", direction: "dispatch", kind: "task", peerSessionId: "s-c", content: "任务B", permissionCeiling: "ask" } as never,
      { type: "session/collab", turn: 1, collabId: "collab-2", direction: "report", kind: "completion", peerSessionId: "s-c", status: "completed", result: "产出文本" } as never,
    ]);
    const projection = collaborationProjection({
      sessionId: "s-a",
      store,
      originOf: (id) => (id === "s-b" ? "s-a" : undefined),
      childrenOf: (id) => (id === "s-a" ? ["s-b", "s-c"] : []),
    });
    expect(projection.createdSessions).toEqual(["s-b", "s-c"]);
    expect(projection.currentTask?.collabId).toBe("collab-1");
    expect(projection.currentTask?.status).toBe("queued");
    expect(projection.result?.collabId).toBe("collab-2");
    expect(projection.result?.result).toBe("产出文本");
    // 被派生视角：createdBySession
    const child = collaborationProjection({ sessionId: "s-b", store, originOf: () => "s-a", childrenOf: () => [] });
    expect(child.createdBySession).toBe("s-a");
    expect(child.createdSessions).toEqual([]);
  });
});
