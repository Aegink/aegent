/**
 * 热点复杂度增长曲线断言（T7/T-P2-503）。
 *
 * 纪律（kimi·tree-sitter-bash README 同款——断言的是复杂度不是耗时）：
 * 断言 n 与 2n 的耗时**比值形状**（线性 fold 理论比值 ≈2，上界取 4 = 2× 余量），
 * 绝对耗时只 console.info 作基线记录、不打闸；每档 min-of-3 降噪（JIT 预热
 * 与 GC 抖动的常用手段——比值断言的机器方差纪律，卡面定形）。
 * 独立文件原因：project.test.ts 已 386 行（400 行上限）——supersession.test
 * 拆出先例。
 */

import { performance } from "node:perf_hooks";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { NewSessionEvent, SessionEvent } from "../kernel/events.js";
import { project } from "./project.js";
import { buildChatMessages } from "./messages.js";
import { SqliteEventStorage } from "./db.js";
import { SessionStore } from "./store.js";
import { querySessions } from "./query.js";

const LINEAR_RATIO_CEILING = 4; // 线性理论比值 2 的 2× 余量——超出即复杂度退化嫌疑

/** 一轮 turn 的 6 事件（形状同 project.test.ts oneTurn 的校验过形状，精简 tool 对）。 */
function oneTurn(turn: number, seq0: number): SessionEvent[] {
  const ts = 1_700_000_000_000 + turn;
  const mk = (event: NewSessionEvent, i: number): SessionEvent =>
    ({ ...event, seq: seq0 + i, ts } as SessionEvent);
  const events: NewSessionEvent[] = [
    { type: "turn/start", turn },
    { type: "user/message", turn, message: { content: `q${turn}` }, source: "user" },
    { type: "step/start", turn, step: turn },
    { type: "assistant/message", turn, step: turn, message: { content: `a${turn}` }, stream: [] },
    { type: "step/end", turn, step: turn },
    { type: "turn/end", turn, reason: { kind: "completed" } },
  ];
  return events.map((e, i) => mk(e, i));
}

function streamOf(turnCount: number): SessionEvent[] {
  const events: SessionEvent[] = [];
  let seq = 1;
  for (let turn = 1; turn <= turnCount; turn++) {
    events.push(...oneTurn(turn, seq));
    seq += 6;
  }
  return events;
}

/** min-of-3：同一操作跑 3 遍取最小——预热线程后再计时，GC 噪声取下界。 */
function minOf3(fn: () => void): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function seedQueryDb(turnCount: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "aegent-complexity-"));
  dirs.push(dir);
  const dbPath = join(dir, "events.sqlite");
  const storage = SqliteEventStorage.open({ path: dbPath });
  const store = new SessionStore(storage);
  for (let turn = 1; turn <= turnCount; turn++) {
    store.append("s-perf", oneTurn(turn, (turn - 1) * 6 + 1).map((e) => ({ ...e, ts: 1_700_000_000_000 + turn })));
  }
  // flush 返回 Promise（write-behind 排空异步落库）——必须 await 后再
  // close，否则收尾回调撞上已关连接（unhandled rejection；T-P3-111
  // cost.test 同款竞态的收尾面）。
  await store.flush("s-perf");
  storage.close();
  return dbPath;
}

describe("热点复杂度增长曲线（T7——断言形状不断言绝对耗时）", () => {
  it("project fold 全量：2n/n 耗时比 < 4（线性形状）", () => {
    const half = streamOf(1_250); // 7 500 事件
    const full = streamOf(2_500); // 15 000 事件
    const tHalf = minOf3(() => project(half));
    const tFull = minOf3(() => project(full));
    const ratio = tFull / tHalf;
    console.info(
      `[复杂度基线] project fold: n=${half.length} → ${tHalf.toFixed(1)}ms, 2n → ${tFull.toFixed(1)}ms, 比值 ${ratio.toFixed(2)}（上界 ${LINEAR_RATIO_CEILING}）`,
    );
    expect(ratio).toBeLessThan(LINEAR_RATIO_CEILING);
  });

  it("buildChatMessages：2n/n 耗时比 < 4（线性或视窗常数）", () => {
    const half = streamOf(1_250);
    const full = streamOf(2_500);
    const tHalf = minOf3(() => buildChatMessages(half));
    const tFull = minOf3(() => buildChatMessages(full));
    const ratio = tFull / tHalf;
    console.info(
      `[复杂度基线] buildChatMessages: n=${half.length} → ${tHalf.toFixed(1)}ms, 2n → ${tFull.toFixed(1)}ms, 比值 ${ratio.toFixed(2)}（上界 ${LINEAR_RATIO_CEILING}）`,
    );
    expect(ratio).toBeLessThan(LINEAR_RATIO_CEILING);
  });

  it("querySessions 检索：2n/n 耗时比 < 4（索引面不随库容超线性）", async () => {
    const smallDb = await seedQueryDb(500); // 3 000 行
    const largeDb = await seedQueryDb(1_000); // 6 000 行
    const tSmall = minOf3(() => querySessions(smallDb, { types: ["user/message"] }));
    const tLarge = minOf3(() => querySessions(largeDb, { types: ["user/message"] }));
    const ratio = tLarge / tSmall;
    console.info(
      `[复杂度基线] querySessions(types): 3k 行 → ${tSmall.toFixed(1)}ms, 6k 行 → ${tLarge.toFixed(1)}ms, 比值 ${ratio.toFixed(2)}（上界 ${LINEAR_RATIO_CEILING}）`,
    );
    expect(ratio).toBeLessThan(LINEAR_RATIO_CEILING);
  });
});
