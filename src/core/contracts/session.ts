/**
 * 会话存储契约（T2-3 自 src/session/store.ts 下沉——pi §9 会话模型端口，
 * 依赖倒置：消费面（kernel/host/context/obs…）依赖本契约，session 域反向
 * 实现（SessionEventStore + InMemory/Sqlite storage）。
 *
 * **G1/G2 护栏载体**（flush 串行 + seq 必须前进断言、崩溃恢复三级降级）——
 * 端口如实包含现有公共面（含 registerFlushPoint/runFlushPoint/snapshot/
 * restore/fork），不做 pi/dsh 形状的"收窄"（任务卡原写"收窄为 10 方法：
 * create/open/stat/list"——我方无对应方法与会话库语义，护栏方法不可删，
 * 以事实为准记档）。
 */

import type { SessionEvent, NewSessionEvent } from "../skeleton/events.js";

/** 持久端口：事件批落库 / 全量回读（write-behind 的对端；实现=InMemory/Sqlite）。 */
export interface EventStorage {
  appendBatch(sessionId: string, events: readonly SessionEvent[]): void | Promise<void>;
  readAll(sessionId: string): SessionEvent[] | Promise<SessionEvent[]>;
}

export interface SessionSnapshot {
  sessionId: string;
  snapshotSeq: number;
  events: readonly SessionEvent[];
}

export type FlushPointPhase = "turnEnd";
export type FlushPointHook = (sessionId: string) => void | Promise<void>;

export interface ForkOptions {
  /** 新会话 id（调用方指定——会话 id 用户可见；不得与源/既有会话冲突）。 */
  target: string;
  /** "before"=切点前缀（不含 atSeq）、"after"=含 atSeq；缺省 "after"。 */
  position?: "before" | "after";
  /** 切点参照 seq（1..源流最后 seq）；缺省 = 源流最新。 */
  atSeq?: number;
}

/**
 * 会话存储端口——活动进程内事件的唯一真相 + write-behind 落库 + 崩溃恢复。
 * 实现纪律（G1/G2，护栏——改前先加断言）：flush 按 sessionId 串行链化，
 * seq 必须前进；restore 三级降级 strict/lenient/discard。
 */
export interface SessionStore {
  /** 同步追加（分配 seq/ts → JSON 安全校验 → 投影校验 → 内存序 + buffer），绝不 await I/O。 */
  append(sessionId: string, events: readonly NewSessionEvent[]): SessionEvent[];
  /** 内存序读取（同步）。 */
  load(sessionId: string): readonly SessionEvent[];
  /** 已知会话 id 清单。 */
  sessionIds(): string[];
  /** 待落库事件数（write-behind buffer）。 */
  pendingCount(sessionId: string): number;
  /** flush 串行链（G1：按会话链化，seq 必须前进断言）。 */
  flush(sessionId: string): Promise<void>;
  registerFlushPoint(phase: FlushPointPhase, hook: FlushPointHook): void;
  runFlushPoint(phase: FlushPointPhase, sessionId: string): Promise<void>;
  /** 快照（先 flush 再取内存序——外部一致性读面）。 */
  snapshot(sessionId: string): Promise<SessionSnapshot>;
  /** 崩溃恢复（G2：strict/lenient/discard 三级降级）。 */
  restore(sessionId: string, options?: { lenient?: boolean }): Promise<readonly SessionEvent[]>;
  /** fork 分支会话（E5：历史复制 + session/fork lineage 标记，fail-closed 拒绝面）。 */
  fork(
    sourceId: string,
    options: ForkOptions,
  ): { sessionId: string; cutSeq: number; eventCount: number };
}
