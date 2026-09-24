/**
 * 事件源存储（E1/E10/E13）——事件是唯一真相，状态是投影。
 *
 * 三层纪律（锚点见 plan-p0.md T-1-02）：
 * - append 同步入内存序，热路径绝不 await I/O（DSH "Appends are synchronous
 *   (the hot path never blocks on I/O)"，`oss/deepseek-harness/.agents/notes/
 *   implemented/architecture/2026-06-11-event-sourced-sessions.md`）。
 * - 持久化是 write-behind：未落库事件停在内部 buffer，只在显式 flush 或
 *   turn 末检查点排空（同一锚点 "drain at the awaited session/flush
 *   checkpoint fired at every turn end"）。
 * - 快照前必须 flush（E10；codex "Callers must flush the rollout after
 *   capture before persisting the snapshot"，`oss/codex/codex-rs/core/src/
 *   session/daemon_recovery.rs:2`）——写成 API 形状：snapshot() 内部先 flush。
 */

import { assertJsonSafe, type NewSessionEvent, type SessionEvent } from "../kernel/events.js";

/**
 * 持久化后端接口。T-1-03 由 SQLite 实现；P0 语义约定：
 * appendBatch 必须批量原子——进程崩溃后要么整批都在，要么整批都不在，
 * 不允许出现半批（否则"已 flush 的序"失去意义）。
 */
export interface EventStorage {
  appendBatch(sessionId: string, events: readonly SessionEvent[]): void | Promise<void>;
  /** 读回某会话已落库的全部事件（按 seq 升序返回）。 */
  readAll(sessionId: string): SessionEvent[] | Promise<SessionEvent[]>;
}

/** 内存后端：单测与"不落盘的内存会话"用；readAll/appendBatch 都是同步原子。 */
export class InMemoryEventStorage implements EventStorage {
  private readonly rows = new Map<string, SessionEvent[]>();

  appendBatch(sessionId: string, events: readonly SessionEvent[]): void {
    if (events.length === 0) return;
    let list = this.rows.get(sessionId);
    if (!list) {
      list = [];
      this.rows.set(sessionId, list);
    }
    list.push(...events);
  }

  readAll(sessionId: string): SessionEvent[] {
    return [...(this.rows.get(sessionId) ?? [])].sort((a, b) => a.seq - b.seq);
  }
}

/** 快照产物：flush 已保证 storage 覆盖到 snapshotSeq（E10 的不变量）。 */
export interface SessionSnapshot {
  sessionId: string;
  /** 快照时刻内存序的最后 seq（此后事件不属于本快照）。 */
  snapshotSeq: number;
  events: readonly SessionEvent[];
}

export type FlushPointPhase = "turnEnd";
export type FlushPointHook = (sessionId: string) => void | Promise<void>;

export class SessionStore {
  private readonly events = new Map<string, SessionEvent[]>();
  private readonly buffer = new Map<string, SessionEvent[]>();
  private readonly lastSeq = new Map<string, number>();
  private readonly lastFlushedSeq = new Map<string, number>();
  private readonly flushChains = new Map<string, Promise<void>>();
  private readonly flushPoints = new Map<FlushPointPhase, FlushPointHook[]>();
  private nextSeqBySession = new Map<string, number>();

  constructor(private readonly storage: EventStorage = new InMemoryEventStorage()) {}

  /**
   * 同步追加：分配 seq/ts → assertJsonSafe（C14）→ 入内存序与 write-behind buffer。
   * 绝不 await I/O。全部事件先校验后提交——任一非法则整批拒绝，内存序不留残迹。
   */
  append(sessionId: string, events: readonly NewSessionEvent[]): SessionEvent[] {
    const prepared: SessionEvent[] = [];
    let nextSeq = this.nextSeqBySession.get(sessionId) ?? 1;
    const ts = Date.now();
    for (const event of events) {
      assertJsonSafe(event, `append(${sessionId}) event[${prepared.length}]`);
      const committed = { ...event, seq: nextSeq++, ts } as SessionEvent;
      prepared.push(committed);
    }
    let list = this.events.get(sessionId);
    if (!list) {
      list = [];
      this.events.set(sessionId, list);
    }
    list.push(...prepared);
    let buf = this.buffer.get(sessionId);
    if (!buf) {
      buf = [];
      this.buffer.set(sessionId, buf);
    }
    buf.push(...prepared);
    this.nextSeqBySession.set(sessionId, nextSeq);
    this.lastSeq.set(sessionId, nextSeq - 1);
    return prepared;
  }

  /** 内存序读取（同步）：活动进程内事件的唯一真相就在这里。 */
  load(sessionId: string): readonly SessionEvent[] {
    return this.events.get(sessionId) ?? [];
  }

  /** 内部 buffer 里尚未落库的事件数（测试与可观测用）。 */
  pendingCount(sessionId: string): number {
    return this.buffer.get(sessionId)?.length ?? 0;
  }

  /**
   * write-behind 排空：把该会话 buffer 整批交给 storage。
   * 同一会话的 flush 串行化（promise 链），保证后端看到的批次顺序与内存序一致。
   */
  async flush(sessionId: string): Promise<void> {
    const tail = this.flushChains.get(sessionId) ?? Promise.resolve();
    const run = tail.then(async () => {
      const batch = this.buffer.get(sessionId);
      if (!batch || batch.length === 0) return;
      await this.storage.appendBatch(sessionId, batch);
      const maxSeq = batch[batch.length - 1]!.seq;
      const prev = this.lastFlushedSeq.get(sessionId) ?? 0;
      if (maxSeq <= prev) throw new Error(`flush 语义错误：seq 未前进（${maxSeq} <= ${prev}）`);
      this.lastFlushedSeq.set(sessionId, maxSeq);
      this.buffer.set(sessionId, []);
    });
    // 失败也要清链，否则后续 flush 永远拿到 rejected tail；错误仍由本次调用方收到。
    this.flushChains.set(
      sessionId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  /**
   * turn 末 flush 检查点（E13）。loop 在每个 turn 结束时 await 本方法；
   * flush 本体内置在前，注册的 hook 在其后（拿到的是"已持久化"的时点）。
   */
  registerFlushPoint(phase: FlushPointPhase, hook: FlushPointHook): void {
    const hooks = this.flushPoints.get(phase) ?? [];
    hooks.push(hook);
    this.flushPoints.set(phase, hooks);
  }

  async runFlushPoint(phase: FlushPointPhase, sessionId: string): Promise<void> {
    await this.flush(sessionId);
    for (const hook of this.flushPoints.get(phase) ?? []) {
      await hook(sessionId);
    }
  }

  /**
   * 快照（E10）：先 flush 再取内存序——storage 必然覆盖到 snapshotSeq，
   * 结构上排除"快照说做了 / 事件说没做"。
   */
  async snapshot(sessionId: string): Promise<SessionSnapshot> {
    await this.flush(sessionId);
    const events = this.load(sessionId);
    return {
      sessionId,
      snapshotSeq: events.length === 0 ? 0 : events[events.length - 1]!.seq,
      events,
    };
  }

  /**
   * 崩溃恢复：从 storage 重放已落库事件到内存（杀进程重启路径）。
   * seq 不连续视为存储损坏，直接抛错——绝不带病重建内存序。
   */
  async restore(sessionId: string): Promise<readonly SessionEvent[]> {
    const rows = await this.storage.readAll(sessionId);
    for (let i = 0; i < rows.length; i++) {
      if (rows[i]!.seq !== i + 1) {
        throw new Error(`存储损坏：seq 不连续（位置 ${i} 期望 ${i + 1}，实际 ${rows[i]!.seq}）`);
      }
    }
    this.events.set(sessionId, [...rows]);
    const maxSeq = rows.length;
    this.lastSeq.set(sessionId, maxSeq);
    this.lastFlushedSeq.set(sessionId, maxSeq);
    this.nextSeqBySession.set(sessionId, maxSeq + 1);
    this.buffer.set(sessionId, []);
    return rows;
  }
}
