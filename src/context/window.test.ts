/**
 * F25/T-P1-99 验收：上下文窗口编号化——
 * ① 无压缩 → {number:0, currentId:0}；
 * ② N 次已结算压缩 → number=N、current/previous/first 三元组 = 各压缩 seq；
 * ③ started/failed 不计数（切换权威同口径——new-window.ts 同源判定）；
 * ④ session/revert 掉压缩 → 窗口身份回退（effectiveEvents 口径）；
 * ⑤ 恢复恒等：同一条流两次推导逐字段相等（流即状态，无需显式 restore）。
 * 零词汇表扩展：窗口号/身份不进事件载荷——本模块只从既有 compaction 事件
 * 的 seq/status 推导。
 */

import { describe, expect, it } from "vitest";
import type { NewSessionEvent } from "../kernel/events.js";
import {SessionEventStore, type SessionStore} from "../session/store.js";
import { currentWindow } from "./window.js";

const SESSION = "s-window";

/** 任意合法 turn 事件（窗口推导只看 compaction/revert——其余事件是填充）。 */
function filler(turn: number): NewSessionEvent[] {
  return [
    { type: "turn/start", turn },
    { type: "user/message", turn, message: { content: `u${String(turn)}` }, source: "user" },
    { type: "turn/end", turn, reason: { kind: "completed" } },
  ];
}

function compaction(status?: "started" | "completed" | "failed"): NewSessionEvent[] {
  return [
    {
      type: "compaction",
      turn: 0,
      summary: status === undefined || status === "completed" ? "摘要" : "",
      retainedTail: status === undefined || status === "completed" ? 1 : 0,
      tokensBefore: 100,
      ...(status !== undefined ? { status } : {}),
    },
  ];
}

describe("currentWindow（F25 窗口编号化）", () => {
  it("无压缩 → 初始窗 {number:0, currentId:0}（验收①）", () => {
    const store = new SessionEventStore();
    store.append(SESSION, filler(1));
    const w = currentWindow(store.load(SESSION));
    expect(w).toEqual({ number: 0, currentId: 0 });
  });

  it("N 次已结算压缩 → number=N、三元组 = 各压缩事件 seq（验收②）", () => {
    const store = new SessionEventStore();
    store.append(SESSION, filler(1));
    const seqs: number[] = [];
    for (let i = 0; i < 3; i++) {
      store.append(SESSION, filler(i + 2));
      const [first] = store.append(SESSION, compaction());
      seqs.push(first!.seq);
    }
    const w = currentWindow(store.load(SESSION));
    expect(w.number).toBe(3);
    expect(w.currentId).toBe(seqs[2]);
    expect(w.previousId).toBe(seqs[1]);
    expect(w.firstId).toBe(seqs[0]);
  });

  it("started/failed 不计数、不占三元组（验收③——切换权威同口径）", () => {
    const store = new SessionEventStore();
    store.append(SESSION, filler(1));
    const [settled] = store.append(SESSION, compaction("completed"));
    store.append(SESSION, filler(2));
    store.append(SESSION, compaction("started"));
    store.append(SESSION, compaction("failed"));
    const w = currentWindow(store.load(SESSION));
    expect(w).toEqual({ number: 1, currentId: settled!.seq, firstId: settled!.seq });
  });

  it("status 缺省 = 旧流兼容口径（completed 同权）", () => {
    const store = new SessionEventStore();
    const [legacy] = store.append(SESSION, compaction(undefined));
    const w = currentWindow(store.load(SESSION));
    expect(w).toEqual({ number: 1, currentId: legacy!.seq, firstId: legacy!.seq });
  });

  it("revert 掉压缩 → 窗口身份回退（验收④——有效视窗口径）", () => {
    const store = new SessionEventStore();
    store.append(SESSION, filler(1));
    const [c1] = store.append(SESSION, compaction());
    store.append(SESSION, filler(2));
    const [c2] = store.append(SESSION, compaction());
    const after2 = currentWindow(store.load(SESSION));
    expect(after2.number).toBe(2);
    // 回退到 c2 之前：c2 从有效视窗消失，窗口身份退回 c1
    store.append(SESSION, [{ type: "session/revert", turn: 0, targetSeq: c2!.seq - 1, phase: "revert" }]);
    const afterRevert = currentWindow(store.load(SESSION));
    expect(afterRevert).toEqual({ number: 1, currentId: c1!.seq, firstId: c1!.seq });
  });

  it("恢复恒等：同流两次推导逐字段相等（验收⑤——流即状态）", () => {
    const store = new SessionEventStore();
    store.append(SESSION, filler(1));
    store.append(SESSION, compaction("completed"));
    store.append(SESSION, compaction("started"));
    store.append(SESSION, filler(2));
    store.append(SESSION, compaction());
    const events = store.load(SESSION);
    expect(currentWindow(events)).toEqual(currentWindow(events));
    // 模拟"重启后从存储重读"：重新 load（新数组实例）推导结果不变
    expect(currentWindow(store.load(SESSION))).toEqual(currentWindow(events));
  });
});
