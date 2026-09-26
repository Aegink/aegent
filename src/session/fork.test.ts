import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { project } from "./project.js";
import { ForkError, InMemoryEventStorage, SessionStore } from "./store.js";
import { SqliteEventStorage } from "./db.js";

/** 两个完整 turn 的源流（每轮 8 事件，见 project.test 的 oneTurn 同构）。 */
function seedSource(store: SessionStore, sourceId: string): void {
  for (const turn of [1, 2]) {
    store.append(sourceId, [
      { type: "turn/start", turn },
      { type: "user/message", turn, message: { content: `q${turn}` }, source: "user" },
      { type: "step/start", turn, step: turn },
      {
        type: "assistant/message",
        turn,
        step: turn,
        message: { content: `a${turn}` },
        stream: [],
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      { type: "step/end", turn, step: turn },
      { type: "turn/end", turn, reason: { kind: "completed" } },
    ]);
  }
}

afterAll(() => {
  // SQLite 夹具目录由各测试自行清理；此处兜底无操作占位（保持 harness 对称）
});

describe("SessionStore.fork（E5/T-P1-40）", () => {
  it("验收①：fork 后新会话事件与父流前缀逐字节等价（seq 重编号、ts 保留）且投影一致", () => {
    const store = new SessionStore();
    seedSource(store, "s1");
    const before = store.load("s1").map((e) => ({ ...e }));

    const result = store.fork("s1", { target: "s1-fork" });
    expect(result.sessionId).toBe("s1-fork");
    expect(result.cutSeq).toBe(12);

    const forked = store.load("s1-fork");
    // 前缀逐字节等价（seq 重编号 1..16；ts 保留原值——复制历史事实）
    expect(forked.slice(0, 12).map(({ seq, ...rest }) => ({ ...rest, seq }))).toEqual(
      before.map((e, i) => ({ ...e, seq: i + 1 })),
    );
    expect(forked.map((e) => e.seq)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    // 投影一致（消息面）：fork 会话（含 lineage 标记）与源会话投影的 messages 相等
    expect(project(forked).messages).toEqual(project(before).messages);
    // lineage 标记在头部之后（第 13 条）
    const mark = forked[12]!;
    expect(mark.type).toBe("session/fork");
    if (mark.type === "session/fork") {
      expect(mark.parentSessionId).toBe("s1");
      expect(mark.cutSeq).toBe(12);
    }
  });

  it("验收②：before/after 切点语义正确（before=atSeq 前缀不含、after=含）", () => {
    const store = new SessionStore();
    seedSource(store, "s1");

    // after atSeq=6：新流复制 seq 1..6（第一个 turn 完整）+ lineage 标记
    const after = store.fork("s1", { target: "f-after", position: "after", atSeq: 6 });
    expect(after.cutSeq).toBe(6);
    const afterEvents = store.load("f-after");
    expect(afterEvents.filter((e) => e.type !== "session/fork")).toHaveLength(6);
    expect(afterEvents[5]!.type).toBe("turn/end");

    // before atSeq=6：新流复制 seq 1..5（不含 atSeq=6 那条）+ lineage 标记
    const before = store.fork("s1", { target: "f-before", position: "before", atSeq: 6 });
    expect(before.cutSeq).toBe(5);
    const beforeEvents = store.load("f-before");
    expect(beforeEvents.filter((e) => e.type !== "session/fork")).toHaveLength(5);
    expect(beforeEvents[4]!.type).toBe("step/end");

    // 缺省 = 最新（after 语义）
    const latest = store.fork("s1", { target: "f-latest" });
    expect(latest.cutSeq).toBe(12);
  });

  it("验收③：原会话零影响（事件数、seq、投影都不变）", () => {
    const store = new SessionStore();
    seedSource(store, "s1");
    const before = store.load("s1").map((e) => ({ ...e }));

    store.fork("s1", { target: "f1" });
    store.fork("s1", { target: "f2", position: "before", atSeq: 4 });

    expect(store.load("s1")).toEqual(before);
    expect(store.load("s1")).toHaveLength(12);
    expect(project(store.load("s1")).messages).toEqual(project(before).messages);
  });

  it("验收④：session/fork 落子流头部之后、重启（新 store restore）后 lineage 可查", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aegent-fork-"));
    try {
      const dbPath = join(dir, "events.db");
      const storage = SqliteEventStorage.open({ path: dbPath });
      const store = new SessionStore(storage);
      seedSource(store, "s1");
      store.fork("s1", { target: "s1-fork", position: "after", atSeq: 6 });
      await store.flush("s1-fork");
      await store.flush("s1");
      storage.close();

      // 重启等价：新 store restore 新会话——lineage 标记随流恢复可查
      const storage2 = SqliteEventStorage.open({ path: dbPath });
      const store2 = new SessionStore(storage2);
      const restored = await store2.restore("s1-fork");
      const mark = restored.find((e): e is Extract<typeof e, { type: "session/fork" }> => e.type === "session/fork");
      expect(mark).toBeDefined();
      expect(mark?.parentSessionId).toBe("s1");
      expect(mark?.position).toBe("after");
      expect(mark?.cutSeq).toBe(6);
      expect(restored[0]!.type).toBe("turn/start");
      storage2.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows WAL 句柄释放竞态（T-P1-35 坑记录）：临时目录留给系统回收
      }
    }
  });

  it("验收⑤：未闭合 turn 拒绝（FORK_SOURCE_BUSY）+ atSeq 非法类型化错误（FORK_BAD_ATSEQ）+ 目标冲突（FORK_TARGET_EXISTS/FORK_BAD_TARGET）", () => {
    const store = new SessionStore();
    seedSource(store, "s1");

    // 未闭合 turn：追加 turn/start 不闭合 → fork 拒绝
    store.append("s1", [{ type: "turn/start", turn: 3 }]);
    expect(() => store.fork("s1", { target: "f-busy" })).toThrow(ForkError);
    try {
      store.fork("s1", { target: "f-busy" });
    } catch (e) {
      expect((e as ForkError).code).toBe("FORK_SOURCE_BUSY");
    }
    // 收尾轮 3（闭环后再 fork 干净路径可用）
    store.append("s1", [{ type: "turn/end", turn: 3, reason: { kind: "completed" } }]);

    // atSeq 越界 / 非整数
    for (const bad of [0, -1, 2.5, 99]) {
      try {
        store.fork("s1", { target: `f-bad-${bad}`, atSeq: bad });
        expect.unreachable(`atSeq=${bad} 应当被拒`);
      } catch (e) {
        expect((e as ForkError).code).toBe("FORK_BAD_ATSEQ");
      }
    }

    // 目标 id 冲突 / 非法
    expect(() => store.fork("s1", { target: "s1" })).toThrow(ForkError);
    try {
      store.fork("s1", { target: "s1" });
    } catch (e) {
      expect((e as ForkError).code).toBe("FORK_BAD_TARGET");
    }
    store.fork("s1", { target: "f1" });
    expect(() => store.fork("s1", { target: "f1" })).toThrow(ForkError);
    try {
      store.fork("s1", { target: "f1" });
    } catch (e) {
      expect((e as ForkError).code).toBe("FORK_TARGET_EXISTS");
    }

    // 源会话不存在
    expect(() => store.fork("nope", { target: "f-x" })).toThrow(ForkError);
    try {
      store.fork("nope", { target: "f-x" });
    } catch (e) {
      expect((e as ForkError).code).toBe("FORK_SOURCE_MISSING");
    }
  });

  it("验收⑥：fork 出的新会话可独立继续对话（append/投影正常，与源会话互不影响）", () => {
    const store = new SessionStore();
    seedSource(store, "s1");
    store.fork("s1", { target: "f1", position: "after", atSeq: 6 });

    // 新会话继续开新轮（turn 编号接续复制历史的最后轮）
    store.append("f1", [
      { type: "turn/start", turn: 2 },
      { type: "user/message", turn: 2, message: { content: "分支续问" }, source: "user" },
      { type: "turn/end", turn: 2, reason: { kind: "completed" } },
    ]);
    const f1Messages = project(store.load("f1")).messages;
    expect(f1Messages.at(-1)?.content).toBe("分支续问");
    expect(f1Messages).toHaveLength(3); // q1,a1 + 分支续问（turn2 只 user）——q2/a2 不在（切点 6）
    // 源会话不受影响
    expect(project(store.load("s1")).messages).toHaveLength(4); // q1,a1,q2,a2
  });
});
