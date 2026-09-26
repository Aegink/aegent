/**
 * token 统计测试（L3，T-8-03）——1000+ 事件喂入真 SQLite 库后，按会话与按
 * 轮的 token 分列可查；usage 缺失的消息不进聚合；L1 否定性面（只读 events
 * 表，无第二份轨迹存储）由模块纪律保证，shell 验收 `ls logs/ || echo
 * NO_LOG_DIR` 在仓库根复核。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqliteEventStorage } from "../session/db.js";
import { SessionStore } from "../session/store.js";
import {
  type UsageRow,
  ensureUsageView,
  usageBySession,
  usageByTurn,
} from "./usage.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aegent-obs-"));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 句柄释放滞后时的 EBUSY：清理失败不影响断言（T-1-03 已知坑）
  }
});

interface Fixture {
  usage: () => UsageRow[];
  byTurn: () => UsageRow[];
  close: () => void;
}

/**
 * 建库 + 喂 turns 轮事件（每轮 6 事件，assistant/message 带 usage）。
 * eventsPerTurn=6，turns=167 → 1002 事件 ≥ 1000（验收口径）。
 * 视图查的是 storage——append 只进 write-behind buffer，末尾必须 flush。
 */
async function makeFixture(
  turns: number,
  opts?: { skipUsageOnTurn?: number },
): Promise<Fixture> {
  const storage = SqliteEventStorage.open({ path: path.join(dir, "events.db") });
  const db = storage.db;
  const store = new SessionStore(storage);
  for (let turn = 1; turn <= turns; turn++) {
    const usage =
      opts?.skipUsageOnTurn === turn
        ? undefined
        : {
            inputTokens: 100 * turn,
            outputTokens: 10 * turn,
            cacheReadTokens: 5,
            cacheWriteTokens: 2,
          };
    store.append("s-fix", [
      { type: "turn/start", turn },
      { type: "user/message", turn, message: { content: `指令 ${turn}` }, source: "user" },
      { type: "step/start", turn, step: 1 },
      {
        type: "assistant/message",
        turn,
        step: 1,
        message: { content: `回答 ${turn}` },
        stream: [],
        ...(usage !== undefined ? { usage } : {}),
      },
      { type: "step/end", turn, step: 1 },
      { type: "turn/end", turn, reason: { kind: "completed" } },
    ]);
  }
  await store.flush("s-fix"); // 视图读 storage——不 flush 查不到（write-behind 纪律）
  ensureUsageView(db);
  return {
    usage: () => usageBySession(db, "s-fix"),
    byTurn: () => usageByTurn(db, "s-fix"),
    close: () => db.close(),
  };
}

describe("usage_rollup（T-8-03 · L3）", () => {
  it("1000+ 事件喂入后按会话与按轮的 token 分列可查且数值正确", async () => {
    const turns = 167; // 6 × 167 = 1002 事件
    const fixture = await makeFixture(turns);
    try {
      const sessions = fixture.usage();
      expect(sessions.length).toBe(1);
      const s = sessions[0]!;
      expect(s.sessionId).toBe("s-fix");
      expect(s.requests).toBe(turns);
      // Σ inputTokens = 100 × Σ1..167 = 100 × 167×168/2 = 1_402_800
      expect(s.inputTokens).toBe(1_402_800);
      // Σ outputTokens = 10 × 167×168/2 = 140_280
      expect(s.outputTokens).toBe(140_280);
      expect(s.cacheReadTokens).toBe(5 * turns);
      expect(s.cacheCreationTokens).toBe(2 * turns);
      // totalTokens 缺省按 input+output 折算
      expect(s.totalTokens).toBe(1_402_800 + 140_280);

      const rows = fixture.byTurn();
      expect(rows.length).toBe(turns);
      expect(rows.map((r) => r.turn)).toEqual(
        Array.from({ length: turns }, (_, i) => i + 1),
      );
      const t7 = rows[6]!;
      expect(t7.inputTokens).toBe(700);
      expect(t7.outputTokens).toBe(70);
      expect(t7.cacheCreationTokens).toBe(2);
      expect(t7.totalTokens).toBe(770);
    } finally {
      fixture.close();
    }
  });

  it("usage 缺失的消息不进聚合（无计量不算 0），totalTokens 按 input+output 折算", async () => {
    const fixture = await makeFixture(3, { skipUsageOnTurn: 2 });
    try {
      const s = fixture.usage()[0]!;
      expect(s.requests).toBe(2); // turn 2 无 usage，缺席（不算 0）
      const rows = fixture.byTurn();
      expect(rows.map((r) => r.turn)).toEqual([1, 3]);
      // turn 3：input 300 + output 30 = 330（fixture 未给 total，走折算分支）
      expect(rows[1]!.totalTokens).toBe(330);
    } finally {
      fixture.close();
    }
  });

  it("totalTokens 显式值优先于折算；多会话各自聚合互不串扰", async () => {
    const storage = SqliteEventStorage.open({ path: path.join(dir, "multi.db") });
    try {
      const db = storage.db;
      const store = new SessionStore(storage);
      for (const sessionId of ["s-a", "s-b"]) {
        store.append(sessionId, [
          { type: "turn/start", turn: 1 },
          { type: "user/message", turn: 1, message: { content: "hi" }, source: "user" },
          { type: "step/start", turn: 1, step: 1 },
          {
            type: "assistant/message",
            turn: 1,
            step: 1,
            message: { content: "yo" },
            stream: [],
            usage: {
              inputTokens: sessionId === "s-a" ? 11 : 22,
              outputTokens: 3,
              ...(sessionId === "s-b" ? { totalTokens: 999 } : {}),
            },
          },
          { type: "step/end", turn: 1, step: 1 },
          { type: "turn/end", turn: 1, reason: { kind: "completed" } },
        ]);
      }
      await store.flush("s-a");
      await store.flush("s-b");
      ensureUsageView(db);
      const a = usageBySession(db, "s-a")[0]!;
      const b = usageBySession(db, "s-b")[0]!;
      expect(a.inputTokens).toBe(11);
      expect(a.totalTokens).toBe(14); // 无 total → 折算
      expect(b.inputTokens).toBe(22);
      expect(b.totalTokens).toBe(999); // 显式 total 优先
      expect(usageBySession(db).length).toBe(2);
    } finally {
      storage.db.close();
    }
  });

  it("缓存命中率按会话可查（F6/T-P1-19）：cacheRead/input（OpenAI cached ⊆ prompt 语义），input=0 缺席", async () => {
    const fixture = await makeFixture(2);
    try {
      const s = fixture.usage()[0]!;
      // 会话级：ΣcacheRead=10，Σinput=300 → 10/300（从聚合和现算，非均值）
      expect(s.cacheHitRate).toBeCloseTo(10 / 300, 10);
      const rows = fixture.byTurn();
      expect(rows[0]!.cacheHitRate).toBeCloseTo(5 / 100, 10);
      expect(rows[1]!.cacheHitRate).toBeCloseTo(5 / 200, 10);
    } finally {
      fixture.close();
    }

    // input=0（无计量不算 0 的同款纪律）：命中率缺席
    const storage = SqliteEventStorage.open({ path: path.join(dir, "zero.db") });
    try {
      const db = storage.db;
      const store = new SessionStore(storage);
      store.append("s-zero", [
        { type: "turn/start", turn: 1 },
        { type: "user/message", turn: 1, message: { content: "hi" }, source: "user" },
        { type: "step/start", turn: 1, step: 1 },
        {
          type: "assistant/message",
          turn: 1,
          step: 1,
          message: { content: "yo" },
          stream: [],
          usage: { inputTokens: 0, outputTokens: 3, cacheReadTokens: 2 },
        },
        { type: "step/end", turn: 1, step: 1 },
        { type: "turn/end", turn: 1, reason: { kind: "completed" } },
      ]);
      await store.flush("s-zero");
      ensureUsageView(db);
      expect(usageBySession(db, "s-zero")[0]!.cacheHitRate).toBeUndefined();
    } finally {
      storage.db.close();
    }
  });
});
