import { describe, expect, it } from "vitest";

import type { NewSessionEvent, SessionEvent } from "../kernel/events.js";
import { InMemoryEventStorage, SessionStore, type EventStorage } from "./store.js";

function userMsg(content: string, turn = 1): NewSessionEvent {
  return { type: "user/message", turn, message: { content }, source: "user" };
}

function turnStart(turn: number): NewSessionEvent {
  return { type: "turn/start", turn };
}

describe("SessionStore.append（E1/E13）", () => {
  it("验收①：append 返回后 load() 立即可见，seq/ts 由 store 分配且单调", () => {
    const store = new SessionStore();
    const a = store.append("s1", [turnStart(1), userMsg("hi")]);
    // 同步返回——此刻事件已在内存序，无需任何 await
    expect(store.load("s1")).toHaveLength(2);
    expect(a.map((e) => e.seq)).toEqual([1, 2]);
    expect(a.every((e) => typeof e.ts === "number" && e.ts > 0)).toBe(true);
    const b = store.append("s1", [userMsg("again")]);
    expect(b[0]!.seq).toBe(3);
    // 会话间 seq 独立
    expect(store.append("s2", [turnStart(1)])[0]!.seq).toBe(1);
  });

  it("调用方给不出权威 seq：多给也会被 store 分配的值覆盖（纪律 4）", () => {
    const store = new SessionStore();
    const bad = { ...userMsg("x"), seq: 99 } as unknown as NewSessionEvent;
    const [committed] = store.append("s1", [bad]);
    expect(committed!.seq).toBe(1);
  });

  it("任一事件非法（C14）则整批拒绝，内存序无残迹", () => {
    const store = new SessionStore();
    const bad = {
      type: "user/message",
      turn: 1,
      message: { content: "x" },
      source: "user",
      evil: new Error("no"),
    } as unknown as NewSessionEvent;
    expect(() => store.append("s1", [userMsg("ok"), bad])).toThrow(/C14/);
    expect(store.load("s1")).toHaveLength(0);
    expect(store.append("s1", [userMsg("fresh")])[0]!.seq).toBe(1);
  });
});

describe("write-behind 与崩溃恢复（E13）", () => {
  it("验收②：未 flush 的事件死在 buffer，已 flush 的序完整存活且连续", async () => {
    const storage = new InMemoryEventStorage();
    const store = new SessionStore(storage);
    store.append("s1", [turnStart(1), userMsg("a")]);
    await store.flush("s1");
    store.append("s1", [userMsg("b"), userMsg("c")]); // 只进 buffer，不 flush
    expect(store.pendingCount("s1")).toBe(2);

    // 崩溃模拟：换一个 store 读同一 storage（等价杀进程重启），旧 buffer 随进程消失
    const after = new SessionStore(storage);
    await after.restore("s1");
    const rows = after.load("s1");
    expect(rows.map((e) => e.seq)).toEqual([1, 2]); // 已 flush 的序，连续
    expect((rows[1] as Extract<SessionEvent, { type: "user/message" }>).message.content).toBe("a");
  });

  it("restore 后新 append 接着已落库的 seq 继续，不重号", async () => {
    const storage = new InMemoryEventStorage();
    const first = new SessionStore(storage);
    first.append("s1", [turnStart(1), userMsg("a")]);
    await first.flush("s1");

    const second = new SessionStore(storage);
    await second.restore("s1");
    const fresh = second.append("s1", [userMsg("after-crash")]);
    expect(fresh[0]!.seq).toBe(3);
  });

  it("seq 断层的存储在 restore 时拒绝重建（带病重建是事故放大器）", async () => {
    const storage = new InMemoryEventStorage();
    const store = new SessionStore(storage);
    store.append("s1", [turnStart(1), userMsg("x")]);
    await store.flush("s1");
    // 手工凿掉一条，制造断层
    const raw = (storage as unknown as { rows: Map<string, SessionEvent[]> }).rows.get("s1")!;
    raw.splice(0, 1);
    await expect(new SessionStore(storage).restore("s1")).rejects.toThrow(/seq 不连续/);
  });
});

describe("turn 末 flush 检查点（E13）", () => {
  it("runFlushPoint('turnEnd') 先排空 buffer，再执行注册的 hook", async () => {
    const storage = new InMemoryEventStorage();
    const store = new SessionStore(storage);
    const order: string[] = [];
    const original = InMemoryEventStorage.prototype.appendBatch;
    storage.appendBatch = (sid, events) => {
      order.push("storage");
      original.call(storage, sid, events);
    };
    store.registerFlushPoint("turnEnd", () => {
      order.push("hook");
    });

    store.append("s1", [userMsg("q")]);
    expect(store.pendingCount("s1")).toBe(1);
    await store.runFlushPoint("turnEnd", "s1");
    expect(order).toEqual(["storage", "hook"]); // flush 在前，hook 在后
    expect(store.pendingCount("s1")).toBe(0);
    expect(storage.readAll("s1")).toHaveLength(1);
  });
});

describe("快照前必须 flush（E10）", () => {
  it("验收③：snapshot() 内部先 flush——storage 必然覆盖到 snapshotSeq（防回归）", async () => {
    const storage = new InMemoryEventStorage();
    const store = new SessionStore(storage);
    store.append("s1", [turnStart(1), userMsg("a")]);
    // 关键：**没有**手动 flush，直接快照
    const snap = await store.snapshot("s1");
    expect(snap.snapshotSeq).toBe(2);
    const persisted = storage.readAll("s1");
    // 若 snapshot 忘了 flush，这里会是 0 条——"快照说做了/事件说没做"当场现形
    expect(persisted).toHaveLength(2);
    expect(persisted[persisted.length - 1]!.seq).toBe(snap.snapshotSeq);
    expect(store.pendingCount("s1")).toBe(0);
  });

  it("空会话快照 seq 为 0", async () => {
    const store = new SessionStore();
    const snap = await store.snapshot("empty");
    expect(snap.snapshotSeq).toBe(0);
    expect(snap.events).toHaveLength(0);
  });
});

describe("flush 串行化与失败语义", () => {
  it("落库失败不清空 buffer（可重试），重试成功后批次与内存序一致", async () => {
    const batches: number[][] = [];
    const persisted: SessionEvent[] = [];
    let failFirst = true;
    const storage: EventStorage = {
      appendBatch: async (_sid, events) => {
        if (failFirst) {
          failFirst = false;
          throw new Error("disk on fire");
        }
        batches.push(events.map((e) => e.seq));
        persisted.push(...events);
      },
      readAll: () => persisted,
    };

    const store = new SessionStore(storage);
    store.append("s1", [userMsg("a")]);
    store.append("s1", [userMsg("b")]);
    await expect(store.flush("s1")).rejects.toThrow("disk on fire");
    expect(store.pendingCount("s1")).toBe(2); // 失败不丢
    await store.flush("s1");
    expect(batches).toEqual([[1, 2]]); // 剩余 buffer 一批补上，顺序不乱
    expect(persisted).toHaveLength(2);
  });

  it("并发 flush 排队执行，同一批事件不重复落库", async () => {
    const storage = new InMemoryEventStorage();
    const original = InMemoryEventStorage.prototype.appendBatch;
    const batchCount = { n: 0 };
    storage.appendBatch = (sid, events) => {
      batchCount.n += 1;
      original.call(storage, sid, events);
    };
    const store = new SessionStore(storage);
    store.append("s1", [userMsg("a")]);
    await Promise.all([store.flush("s1"), store.flush("s1")]);
    expect(batchCount.n).toBe(1);
    expect(storage.readAll("s1")).toHaveLength(1);
  });
});
