/**
 * 后台 job 注册表（M1/M2）——不阻塞对话的后台工作底座。
 *
 * 取 dsh·packages/jobs 的形状：注册表发 id（`<kind>-N`）、start 即返回
 * （preflight 拒绝不留残迹）、输出入有界 ring 按游标读、kill 是
 * `requested|already-finished` 二值回执、JobStatus 五值闭集含 stopping
 * 中间态。不抄其 Cordis Service 装配与 SessionId 归属面（本进程内单会话；
 * owner 归属随批次 12 多端），tool-jobs 的 bash 后台化不取（无发起方，
 * S 组闲时任务批次消费本底座）。
 *
 * job 面零事件流扩展：job 是进程内工作（重启即失——句柄面由 T-P1-87 的
 * epoch 编码拒绝过期代），生命周期经 onSettled 订阅回调承载，与批次 9
 * 审批宣告面同款"进程内事实 + 回调"先例，不进事件词汇表。
 */

import { JobEpochStaleError, encodeEpochScopedId, parseEpochScopedId } from "../session/epoch.js";

export type JobStatus = "running" | "stopping" | "completed" | "killed" | "failed";

export type JobChannel = "stdout" | "stderr" | "log";

/** ring 内单条输出（dsh JobChunk 同构：channel 三值 + 有序文本）。 */
export interface JobChunk {
  channel: JobChannel;
  text: string;
}

export interface JobView {
  id: string;
  kind: string;
  status: JobStatus;
  createdAt: number;
  settledAt?: number;
  /** 终态详情：failed 的错误消息 / killed 的取消 reason（dsh terminal detail 同位）。 */
  detail?: string;
  /** ring 累计输出条数（含已因有界丢弃的——lossy 的量度）。 */
  totalChunks: number;
}

export interface JobRead {
  view: JobView;
  /** 自上次 read 游标以来的新 chunk（消费即推进游标——dsh "consume the ring from the model cursor"）。 */
  chunks: readonly JobChunk[];
  /** 游标之前的 chunk 有因 ring 有界被丢弃的（丢了就不完整，消费方要知情）。 */
  lossy: boolean;
}

/** 执行体拿到的上下文：产出输出 + 响应取消（abort 触发后应尽快返回）。 */
export interface JobRunContext {
  emit: (channel: JobChannel, text: string) => void;
  signal: AbortSignal;
}

export interface JobSpec {
  kind: string;
  /** 执行体：resolve 为正常结算（completed）；reject 为 failed。 */
  run: (ctx: JobRunContext) => Promise<void>;
}

export class UnknownJobError extends Error {
  constructor(id: string) {
    super(`job 不存在：${id}`);
    this.name = "UnknownJobError";
  }
}

interface JobRecord {
  view: JobView;
  ring: JobChunk[];
  ringBytes: number;
  /** 已因有界丢弃的 chunk 数（read 的 lossy 判定源）。 */
  dropped: number;
  /** read 游标：已消费到第几条（全局条数序，非 ring 下标）。 */
  cursor: number;
  controller: AbortController;
  onSettled: Array<(view: JobView) => void>;
  killReason?: string;
}

export interface JobRegistryOptions {
  /** ring 容量上限（字节，UTF-8 口径）；缺省 64KB，超出丢最旧整条。 */
  maxRingBytes?: number;
  now?: () => number;
  /** M8/T-P1-87 执行代：提供时 job id 编码为 `<epoch>-<kind>-<n>`，旧代
   * 句柄查询/取消 → JOB_EPOCH_STALE；缺省（单测/无分代诉求）不编码。 */
  epoch?: string;
}

const DEFAULT_RING_BYTES = 64 * 1024;

export class JobRegistry {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly maxRingBytes: number;
  private readonly now: () => number;
  private readonly epoch?: string;
  private counter = 0;

  constructor(options: JobRegistryOptions = {}) {
    this.maxRingBytes = options.maxRingBytes ?? DEFAULT_RING_BYTES;
    this.now = options.now ?? (() => Date.now());
    this.epoch = options.epoch;
  }

  /**
   * 后台启动一个 job：同步发 id 并返回（M1"不阻塞对话"——调用方不等执行体）。
   * 执行体的异步失败被注册表接住落 failed，绝不外抛毒化调用方。
   */
  start(spec: JobSpec): string {
    const localId = `${spec.kind}-${++this.counter}`;
    const id = this.epoch ? encodeEpochScopedId(this.epoch, localId) : localId;
    const record: JobRecord = {
      view: { id, kind: spec.kind, status: "running", createdAt: this.now(), totalChunks: 0 },
      ring: [],
      ringBytes: 0,
      dropped: 0,
      cursor: 0,
      controller: new AbortController(),
      onSettled: [],
    };
    this.jobs.set(id, record);
    void this.drive(record, spec);
    return id;
  }

  private async drive(record: JobRecord, spec: JobSpec): Promise<void> {
    try {
      await spec.run({
        emit: (channel, text) => this.pushChunk(record, { channel, text }),
        signal: record.controller.signal,
      });
      // 正常 resolve 但 kill 已在途（stopping）：取消是权威结局，不落 completed。
      if (record.controller.signal.aborted) {
        this.settle(record, "killed", record.killReason);
      } else {
        this.settle(record, "completed");
      }
    } catch (error) {
      // 执行体响应 abort 退出（reject/throw）= killed（dsh："A producer throw
      // propagates without changing job state"——终态归 kill 语义非 failure）。
      if (record.controller.signal.aborted) {
        this.settle(record, "killed", record.killReason);
      } else {
        this.settle(record, "failed", error instanceof Error ? error.message : String(error));
      }
    }
  }

  list(): JobView[] {
    return [...this.jobs.values()].map((r) => ({ ...r.view }));
  }

  get(id: string): JobView {
    return { ...this.mustGet(id).view };
  }

  /** 消费自上次游标以来的增量输出并推进游标（ring 有界时丢段以 lossy 标记）。 */
  read(id: string): JobRead {
    const record = this.mustGet(id);
    // 游标之前的 ring 条目若已被有界丢弃，消费方拿到的是不完整前缀。
    const lossy = record.dropped > record.cursor;
    const fromIndex = Math.max(0, record.cursor - record.dropped);
    const chunks = record.ring.slice(fromIndex).map((c) => ({ ...c }));
    record.cursor = record.view.totalChunks;
    return { view: { ...record.view }, chunks, lossy };
  }

  /**
   * 请求取消：running → stopping（向执行体发 abort），执行体退出后落 killed
   * （reason 进 detail）；已终态 → already-finished（二值回执，不抛）。
   * stopping 是可观测中间态——持续到执行体真正退出，kill 本身不等。
   */
  kill(id: string, reason?: string): "requested" | "already-finished" {
    const record = this.mustGet(id);
    if (record.view.status !== "running") {
      return "already-finished";
    }
    record.view.status = "stopping";
    record.killReason = reason;
    record.controller.abort();
    return "requested";
  }

  /** 等结算或超时（不取消 job——dsh wait 语义：等待只观察，不干预）。 */
  wait(id: string, timeoutMs: number): Promise<JobView> {
    const record = this.mustGet(id);
    if (isTerminal(record.view.status)) {
      return Promise.resolve({ ...record.view });
    }
    return new Promise<JobView>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = record.onSettled.indexOf(onSettled);
        if (index >= 0) record.onSettled.splice(index, 1);
        reject(new Error(`wait 超时（${timeoutMs}ms）：job ${id} 仍为 ${record.view.status}`));
      }, timeoutMs);
      const onSettled = (view: JobView): void => {
        clearTimeout(timer);
        resolve({ ...view });
      };
      record.onSettled.push(onSettled);
    });
  }

  onSettled(id: string, callback: (view: JobView) => void): void {
    const record = this.mustGet(id);
    if (isTerminal(record.view.status)) {
      callback({ ...record.view });
      return;
    }
    record.onSettled.push(callback);
  }

  private pushChunk(record: JobRecord, chunk: JobChunk): void {
    const bytes = Buffer.byteLength(chunk.text, "utf8");
    record.ring.push(chunk);
    record.ringBytes += bytes;
    record.view.totalChunks += 1;
    while (record.ringBytes > this.maxRingBytes && record.ring.length > 1) {
      const oldest = record.ring.shift()!;
      record.ringBytes -= Buffer.byteLength(oldest.text, "utf8");
      record.dropped += 1;
    }
  }

  private settle(
    record: JobRecord,
    status: Exclude<JobStatus, "running" | "stopping">,
    detail?: string,
  ): void {
    if (isTerminal(record.view.status)) return;
    record.view.status = status;
    record.view.settledAt = this.now();
    if (detail !== undefined) record.view.detail = detail;
    for (const callback of record.onSettled.splice(0)) {
      callback({ ...record.view });
    }
  }

  private mustGet(id: string): JobRecord {
    // M8 过期代句柄拒绝：解析出 epoch 段且 ≠ 本代 → 类型化拒绝（不静默
    // 误命中"不存在"——调用方要能区分"查无此 job"与"这是旧进程的句柄"）。
    const parsed = parseEpochScopedId(id);
    if (this.epoch && parsed && parsed.epoch !== this.epoch) {
      throw new JobEpochStaleError(id, parsed.epoch, this.epoch);
    }
    const record = this.jobs.get(id);
    if (!record) throw new UnknownJobError(id);
    return record;
  }
}

export function isTerminal(status: JobStatus): boolean {
  return status === "completed" || status === "killed" || status === "failed";
}
