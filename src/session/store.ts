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

export { InMemoryEventStorage } from "./store-memory.js";
import { InMemoryEventStorage } from "./store-memory.js";
import {
  assertJsonSafe,
  EventEnvelopeError,
  type NewSessionEvent,
  type SessionEvent,
} from "../core/index.js";
import { partitionByEnvelope } from "./store-envelope.js";
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
  StorageWrite,
} from "../core/index.js";

export class SessionEventStore implements SessionStore {
  private readonly events = new Map<string, SessionEvent[]>();
  private readonly buffer = new Map<string, SessionEvent[]>();
  private readonly lastSeq = new Map<string, number>();
  private readonly lastFlushedSeq = new Map<string, number>();
  private readonly flushChains = new Map<string, Promise<void>>();
  /** W15b/T9-7：commit 非事件写排队（flush 同事务窗口）。 */
  private readonly pendingExtraWrites = new Map<string, StorageWrite[]>();
  private readonly flushPoints = new Map<FlushPointPhase, FlushPointHook[]>();
  private nextSeqBySession = new Map<string, number>();
  /** 每会话一个投影器（E16）：append 前用它校验"已有流+新事件"。 */
  private readonly projectors = new Map<string, Projector>();

  constructor(private readonly storage: EventStorage = new InMemoryEventStorage()) {}

  /** 同步追加：seq/ts 分配 → C14 JSON 安全 → E16 投影校验 → 内存序 +
   * buffer。绝不 await I/O；任一非法整批拒绝（内存序不留残迹）。 */
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

  /** 内存后端的 extras 即置（doc 面——title/origin 由事件流承载，记档）。 */
  private applyInMemoryExtras(extras: readonly StorageWrite[]): void {
    for (const write of extras) {
      if (write.kind === "doc") {
        (this.storage as InMemoryEventStorage).putDocument(write.collection, write.docId, write.body);
      }
    }
  }


  /** W15b/T9-7 commit 原子批（§10）：events 走 append 校验路径；
   * title/origin/doc 排队进受影响会话 flush 链同事务落库（sqlite 单事务
   * 即"marker 未落 = 整批不可见"——sidecar 记档 §10 条款）。 */
  async commit(writes: readonly StorageWrite[]): Promise<{ seq: number }> {
    let maxSeq = 0;
    const affected = new Set<string>();
    const extra = new Map<string, StorageWrite[]>();
    for (const write of writes) {
      if (write.kind === "events") {
        const committed = this.append(write.sessionId, write.events);
        if (committed.length > 0) {
          maxSeq = Math.max(maxSeq, committed[committed.length - 1]!.seq);
          affected.add(write.sessionId);
        }
        continue;
      }
      // 非事件写：doc 无会话身份——跟随第一个受影响会话；无受影响会话则直落
      const sessionId =
        write.kind === "doc" ? (affected.values().next().value ?? "") : write.sessionId;
      const bucket = extra.get(sessionId) ?? [];
      bucket.push(write);
      extra.set(sessionId, bucket);
      if (write.kind !== "doc") affected.add(write.sessionId);
    }
    // 排队进各会话的 flush 链（同事务窗口）
    for (const [sessionId, writesForSession] of extra) {
      if (sessionId === "") continue;
      const pending = this.pendingExtraWrites.get(sessionId) ?? [];
      pending.push(...writesForSession);
      this.pendingExtraWrites.set(sessionId, pending);
    }
    // 直落面：无受影响会话的纯 doc 批（独立事务；内存后端即置）
    const orphans = extra.get("") ?? [];
    if (orphans.length > 0) {
      if (typeof this.storage.commit === "function") await this.storage.commit(orphans);
      else this.applyInMemoryExtras(orphans);
      extra.delete("");
    }
    for (const sessionId of affected) await this.flush(sessionId);
    return { seq: maxSeq };
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

  /** 已知会话 id（内存序键集——落库但本进程未安装的不在列，走 Q2 库查）。 */
  sessionIds(): string[] {
    return [...this.events.keys()];
  }

  /** 内部 buffer 里尚未落库的事件数（测试与可观测用）。 */
  pendingCount(sessionId: string): number {
    return this.buffer.get(sessionId)?.length ?? 0;
  }

  /** write-behind 排空：buffer 整批交 storage（同会话 promise 链串行化——
   * 后端批次顺序与内存序一致，G1）。 */
  async flush(sessionId: string): Promise<void> {
    const tail = this.flushChains.get(sessionId) ?? Promise.resolve();
    const run = tail.then(async () => {
      const batch = this.buffer.get(sessionId);
      const extras = this.pendingExtraWrites.get(sessionId);
      if ((!batch || batch.length === 0) && (!extras || extras.length === 0)) return;
      // 换桶（W16 排查 P1-3）：持久化前先把 buffer/extras 指向新容器，旧容器
      // 归本次持久化批——await 挂起窗口内新 append/commit 落进新桶，不会被
      // 误标"已落库"后清空（旧实现 batch/extras 与 buffer 共享数组引用，
      // 挂起期间 push 进批引用的事件越过持久化调用点即丢）。失败回塞保序。
      if (batch !== undefined && batch.length > 0) this.buffer.set(sessionId, []);
      if (extras !== undefined && extras.length > 0) this.pendingExtraWrites.delete(sessionId);
      try {
        // W15b/T9-7：commit 的非事件写与 buffer 事件同一事务（storage.commit
        // 在位时）——"事件+标题+账本+插件文档同批落"；无 extras 走既有
        // appendBatch 快路径（零行为变化）。
        if (extras !== undefined && extras.length > 0) {
          if (typeof this.storage.commit === "function") {
            const writes: StorageWrite[] = [];
            if (batch !== undefined && batch.length > 0) {
              writes.push({ kind: "events", sessionId, events: batch });
            }
            writes.push(...extras);
            await this.storage.commit(writes);
          } else {
            if (batch !== undefined && batch.length > 0) await this.storage.appendBatch(sessionId, batch);
            this.applyInMemoryExtras(extras);
          }
        } else if (batch !== undefined && batch.length > 0) {
          await this.storage.appendBatch(sessionId, batch);
        } else {
          // 仅 extras（无事件批）：commit 在位走同事务；内存后端即置 doc 面
          if (typeof this.storage.commit === "function") {
            await this.storage.commit(extras ?? []);
          } else {
            this.applyInMemoryExtras(extras ?? []);
          }
        }
      } catch (e) {
        // 回塞：持久化失败的事件不丢——按 seq 序塞回新桶头部，write-behind
        // 下轮 flush 重试（与 append 的 seq 单调一致：旧批 seq 全部小于新桶）。
        const buf = this.buffer.get(sessionId) ?? [];
        if (batch !== undefined && batch.length > 0) this.buffer.set(sessionId, [...batch, ...buf]);
        const pend = this.pendingExtraWrites.get(sessionId) ?? [];
        if (extras !== undefined && extras.length > 0) {
          this.pendingExtraWrites.set(sessionId, [...extras, ...pend]);
        }
        throw e;
      }
      if (batch !== undefined && batch.length > 0) {
        const maxSeq = batch[batch.length - 1]!.seq;
        const prev = this.lastFlushedSeq.get(sessionId) ?? 0;
        if (maxSeq <= prev) throw new Error(`flush 语义错误：seq 未前进（${maxSeq} <= ${prev}）`);
        this.lastFlushedSeq.set(sessionId, maxSeq);
      }
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

  /** turn 末 flush 检查点（E13）——hook 拿到"已持久化"时点。 */
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

  /** 快照（E10）：先 flush 再取内存序——storage 必然覆盖到 snapshotSeq。 */
  async snapshot(sessionId: string): Promise<SessionSnapshot> {
    await this.flush(sessionId);
    const events = this.load(sessionId);
    return {
      sessionId,
      snapshotSeq: events.length === 0 ? 0 : events[events.length - 1]!.seq,
      events,
    };
  }

  /** 崩溃恢复（G2/T-P3-172 三级降级）：strict 断续/语义坏抛错；lenient
   * 断续容忍（fold 仍失败降 discard）；discard 旧流不进内存（投影弃用、
   * 新事件从 maxSeq+1 续写）。可用性优先——历史内容永不删除。 */
  async restore(sessionId: string, options: { lenient?: boolean } = {}): Promise<readonly SessionEvent[]> {
    const raw = await this.storage.readAll(sessionId);
    // §4/T9-7 信封校验（分区/槽位纪律在 store-envelope.ts——行数纪律拆分位）
    const { rows, skippedIdx } = partitionByEnvelope(raw);
    if (options.lenient !== true) {
      for (let i = 0; i < raw.length; i++) {
        if (skippedIdx.has(i)) continue; // ignorable 未知——seq 槽位合法消费
        if (raw[i]!.seq !== i + 1) {
          throw new Error(`存储损坏：seq 不连续（位置 ${i} 期望 ${i + 1}，实际 ${raw[i]!.seq}）`);
        }
      }
    }
    const maxSeq = raw.length > 0 ? raw[raw.length - 1]!.seq : 0;
    let folded = false;
    try {
      if (skippedIdx.size > 0) {
        // ignorable 跳痕容忍折叠：seq 断档处 skipTo 桥接（strict 预检已保证
        // 每个断档都对应被跳过的槽位——E16 纪律不破；无跳过时走原 fold——
        // G2 lenient 语义零变化）
        const bridged = Projector.fresh();
        for (const row of rows) {
          if (row.seq !== bridged.projection.lastSeq + 1) {
            bridged.skipTo(row.seq - 1);
          }
          bridged.append([row]);
        }
        // 尾部跳痕桥接（W16 排查 P0-1 深层）：maxSeq 在被跳区间内时投影
        // lastSeq 停在最后一个可见行——与 nextSeqBySession（maxSeq+1）失配，
        // 后续 append 必抛"seq 不连续"。补尾桥对齐两者（W16 回归断言钉住）。
        if (maxSeq > bridged.projection.lastSeq) bridged.skipTo(maxSeq);
        this.projectors.set(sessionId, bridged);
      } else {
        this.projectors.set(sessionId, Projector.fold(rows));
      }
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

  /** fork 分支（E5/T-P1-40）：历史复制到新 id（seq 重编号）+ lineage 标记。
   * fail-closed：目标非法/已存在、源缺失/忙（未闭合 turn）、atSeq 非法。 */
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
