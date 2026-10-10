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

import { assertJsonSafe, type NewSessionEvent, type SessionEvent } from "../core/index.js";
import { Projector } from "./project.js";
// T2-3 依赖倒置：EventStorage/SessionSnapshot/FlushPoint*/ForkOptions/SessionStore
// 端口契约下沉 core/contracts/session.ts——本文件是 session 域实现面
//（SessionEventStore + InMemoryEventStorage），契约 re-export 保兼容消费面。
export type {
  EventStorage,
  FlushPointPhase,
  FlushPointHook,
  ForkOptions,
  SessionSnapshot,
  SessionStore,
} from "../core/index.js";
import type {
  EventStorage,
  FlushPointPhase,
  FlushPointHook,
  ForkOptions,
  SessionSnapshot,
  SessionStore,
} from "../core/index.js";

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

export class SessionEventStore implements SessionStore {
  private readonly events = new Map<string, SessionEvent[]>();
  private readonly buffer = new Map<string, SessionEvent[]>();
  private readonly lastSeq = new Map<string, number>();
  private readonly lastFlushedSeq = new Map<string, number>();
  private readonly flushChains = new Map<string, Promise<void>>();
  private readonly flushPoints = new Map<FlushPointPhase, FlushPointHook[]>();
  private nextSeqBySession = new Map<string, number>();
  /** 每会话一个投影器（E16）：append 前用它校验"已有流+新事件"。 */
  private readonly projectors = new Map<string, Projector>();

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
    // E16：写入前校验"已有流+新事件"。失败（如乱序/未知类型/开合不配对）在此抛出，
    // 内存序、buffer、投影三者都不落任何一半。
    const projector = this.projectorFor(sessionId);
    projector.append(prepared);
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

  private projectorFor(sessionId: string): Projector {
    let projector = this.projectors.get(sessionId);
    if (!projector) {
      projector = Projector.fresh();
      this.projectors.set(sessionId, projector);
    }
    return projector;
  }

  /** 内存序读取（同步）：活动进程内事件的唯一真相就在这里。 */
  load(sessionId: string): readonly SessionEvent[] {
    return this.events.get(sessionId) ?? [];
  }

  /**
   * 已知会话 id 清单（内存序的键集快照——只读消费方用，如 fork-tree 的
   * 谱系重建 fromStore）。**不是**"全部落库会话"（落库但本进程未安装的
   * 会话不在列——那要走库面查询 Q2）。
   */
  sessionIds(): string[] {
    return [...this.events.keys()];
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
   * 三级降级（T-P3-172——child 启动恢复的可用性阶梯）：
   *   strict（缺省）：seq 断续/语义坏 → 抛错（快照/对账面语义不变）；
   *   lenient：seq 断续容忍（按库实际 seq 灌内存、nextSeq=maxSeq+1 接续），
   *     fold 仍失败 → 自动降 discard；
   *   discard：旧流不进内存（恢复视图经库读面仍然完整可见），投影弃用——
   *     后续 append 自动 fresh 新投影，新事件从 maxSeq+1 干净续写。
   * 旧版本缺陷可能留下带洞/缺 turn 边界的流——**可用性优先**，历史内容
   * 永不删除（库行原样保留）。
   */
  async restore(sessionId: string, options: { lenient?: boolean } = {}): Promise<readonly SessionEvent[]> {
    const rows = await this.storage.readAll(sessionId);
    if (options.lenient !== true) {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i]!.seq !== i + 1) {
          throw new Error(`存储损坏：seq 不连续（位置 ${i} 期望 ${i + 1}，实际 ${rows[i]!.seq}）`);
        }
      }
    }
    const maxSeq = rows.length > 0 ? rows[rows.length - 1]!.seq : 0;
    let folded = false;
    try {
      this.projectors.set(sessionId, Projector.fold(rows));
      folded = true;
    } catch (e) {
      // strict：原样上抛（E16 读路径闸门——未知类型/开合不配对的具体原因
      // 必须可见）；lenient 且 fold 失败 → discard（见头注释）
      if (options.lenient !== true) throw e;
    }
    if (folded) {
      this.events.set(sessionId, [...rows]);
    } else {
      // discard：旧流不进内存，但投影的 lastSeq 预置 maxSeq（后续 append
      // 的 seq 接续校验从 maxSeq+1 通过——投影流校验与库 seq 空间一致）
      const projector = this.projectors.get(sessionId) ?? Projector.fresh();
      projector.skipTo(maxSeq);
      this.projectors.set(sessionId, projector);
      this.events.delete(sessionId);
    }
    this.lastSeq.set(sessionId, maxSeq);
    this.lastFlushedSeq.set(sessionId, maxSeq);
    this.nextSeqBySession.set(sessionId, maxSeq + 1);
    this.buffer.set(sessionId, []);
    return folded ? rows : [];
  }

  // -------------------------------------------------------------------------
  // fork 分支会话（E5，T-P1-40）
  // -------------------------------------------------------------------------

  /**
   * fork 分支会话（E5/T-P1-40）：把源会话已完结历史复制到新 sessionId
   * （seq 从 1 重编号；ts 保留原值——复制的是历史事实，不是新事件），
   * 紧随落一条 `session/fork` lineage 标记（子流头部，log-only 不进模型
   * 历史）。切点语义（pi·fork-policy selectBranchFork 同构）：
   * position "after"（缺省）= 新流含 atSeq 处的事件，"before" = 不含
   * （cutSeq = atSeq - 1）；cutSeq = 0 即空分支。
   *
   * fail-closed 拒绝面：目标 id 非法/已存在、源会话不存在、源会话有
   * 未闭合 turn（只从 idle 会话分叉——Q5 对账口径）、atSeq 非法。
   * 新流的 write-behind buffer 立即待 flush（fork 是持久操作）。
   */
  fork(
    sourceId: string,
    options: ForkOptions,
  ): { sessionId: string; cutSeq: number; eventCount: number } {
    const { target, position = "after", atSeq } = options;
    if (typeof target !== "string" || target === "" || target === sourceId) {
      throw new ForkError("FORK_BAD_TARGET", `fork 目标会话 id 非法：${String(target)}`);
    }
    if (this.events.has(target)) {
      throw new ForkError("FORK_TARGET_EXISTS", `fork 目标会话 ${target} 已存在——拒绝覆盖`);
    }
    const source = this.events.get(sourceId);
    if (!source || source.length === 0) {
      throw new ForkError("FORK_SOURCE_MISSING", `源会话 ${sourceId} 不存在或为空流（先 restore/load）`);
    }
    // 只从 idle 会话分叉：存在未闭合 turn 即拒绝（未闭合 turn 的"已完结历史"
    // 边界不清——运行态事件复制出去就是半态）。
    const openTurns = new Set<number>();
    for (const e of source) {
      if (e.type === "turn/start") openTurns.add(e.turn);
      else if (e.type === "turn/end") openTurns.delete(e.turn);
    }
    if (openTurns.size > 0) {
      throw new ForkError(
        "FORK_SOURCE_BUSY",
        `源会话 ${sourceId} 存在未闭合 turn（${[...openTurns].sort((a, b) => a - b).join(",")}）——只从 idle 会话分叉`,
      );
    }
    const lastSeq = source[source.length - 1]!.seq;
    let cutSeq: number;
    if (atSeq === undefined) {
      cutSeq = lastSeq;
    } else {
      if (!Number.isInteger(atSeq) || atSeq < 1 || atSeq > lastSeq) {
        throw new ForkError("FORK_BAD_ATSEQ", `atSeq=${String(atSeq)} 越界（合法范围 1..${lastSeq}）`);
      }
      cutSeq = position === "before" ? atSeq - 1 : atSeq;
    }
    const copied = source
      .filter((e) => e.seq <= cutSeq)
      .map((e, i) => ({ ...e, seq: i + 1 }) as SessionEvent);
    const lastTurn = cutSeq === 0 ? 0 : copied[cutSeq - 1]!.turn;
    const newEvents: SessionEvent[] = [
      ...copied,
      {
        type: "session/fork",
        parentSessionId: sourceId,
        position,
        cutSeq,
        seq: cutSeq + 1,
        ts: Date.now(),
        turn: lastTurn,
      },
    ];
    // 整体先过投影校验（E16：损坏/非法在这里被拒），然后一次落齐内存序 +
    // buffer + 投影——fork 要么完整出现，要么不出现（appendBatch 原子纪律同构）。
    const projector = Projector.fold(newEvents);
    this.events.set(target, newEvents);
    this.buffer.set(target, [...newEvents]);
    this.projectors.set(target, projector);
    this.nextSeqBySession.set(target, newEvents.length + 1);
    this.lastSeq.set(target, newEvents.length);
    this.lastFlushedSeq.set(target, 0);
    this.flushChains.set(target, Promise.resolve());
    return { sessionId: target, cutSeq, eventCount: newEvents.length };
  }
}

/** fork 失败的类型化错误码（fail-closed 面：每类拒绝原因一个码）。 */
export type ForkErrorCode =
  | "FORK_BAD_TARGET"
  | "FORK_TARGET_EXISTS"
  | "FORK_SOURCE_MISSING"
  | "FORK_SOURCE_BUSY"
  | "FORK_BAD_ATSEQ";

export class ForkError extends Error {
  constructor(
    readonly code: ForkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ForkError";
  }
}

/** fork 的调用方选项（切点语义见 SessionStore.fork 注释）。 */
// ForkOptions 已下沉 core/contracts/session.ts（文件头部 re-export）。
