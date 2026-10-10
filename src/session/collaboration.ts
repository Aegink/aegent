/**
 * 会话间协作（U27/T-P3-131）——会话 A 派任务/发消息给会话 B，completion
 * 回投源会话（pi-desktop·session-collaboration 行为同构：三型 task/
 * message/completion + 生命周期状态机 + 权限上限快照 + 完成通知）。
 *
 * 持久面定形（卡面最大定形点，词汇表立案 #30）：协作消息是**持久事实**
 * ——落流内新事件 `session/collab`（单类型 + direction 区分视角与环节：
 * dispatch 源流 / receive 目标流 / update 目标流状态机转移 / report 源流
 * completion 回投）。双方流各自落事件 = 两个视角都可独立重建（不变量 1）。
 * 不走 plugin 泛型逃生舱——这是核心产品语义不是扩展。
 *
 * 权限上限快照（U27 核心安全语义——"提交时定死"）：dispatch 时固化
 * permissionCeiling 进事件载荷；执行体拿到的就是快照值。**双向不变**：
 * 排队/在途期间后续设置变更既不能提权（防提权硬断言——上游 "a later
 * settings change cannot elevate queued work"）也不能降权（快照语义，
 * 卡面"逆方向也不降权"）。
 *
 * 环检测（复用 E9 思路）：活动派发图必须是 DAG——A 派 B 后 B 派 A、
 * 自派都类型化拒绝（创建时 fail-closed，不是读取时补救）。
 *
 * 已知边界（记档）：执行体经注入的 executor（真实执行 = 目标会话的
 * agent 循环/H6 后端链）；当前 host 单会话 spawn 模型下跨会话路由是
 * U11 偏离记档的运行时面——本卡交付服务库面 + 流投影 + UI 事实面板。
 */

import type {
  CollabEvent,
  CollabKind,
  CollabPermissionCeiling,
  CollabStatus,
  SessionEvent,
} from "../core/index.js";

export type { CollabKind, CollabPermissionCeiling, CollabStatus };

export type CollaborationErrorCode =
  | "COLLAB_TARGET_MISSING"
  | "COLLAB_CYCLE"
  | "COLLAB_SELF"
  | "COLLAB_BAD_KIND";

export class CollaborationError extends Error {
  override readonly name = "CollaborationError";
  readonly code: CollaborationErrorCode;
  constructor(code: CollaborationErrorCode, message: string) {
    super(message);
    this.name = "CollaborationError";
    this.code = code;
  }
}

/** 单条协作消息的全生命周期视图（流投影产物——往来面板的行）。 */
export interface CollaborationRecord {
  readonly collabId: string;
  readonly kind: CollabKind;
  readonly content: string;
  /** 对端会话（本流视角的单侧语义——跨流双方各自的 sessionId 不在本流内）。 */
  readonly peerSessionId: string;
  /** 本视角：dispatch 首发 = outgoing（本流是源）；receive 首发 = incoming。 */
  readonly direction: "outgoing" | "incoming";
  readonly status: CollabStatus;
  /** 派发时固化的权限快照（定死——不随后续设置变更）。 */
  readonly permissionCeiling?: CollabPermissionCeiling;
  readonly result?: string;
  readonly error?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

let collabCounter = 0;
/** 协作消息 id（进程内单调——跨流关联键；前缀 collab-）。 */
export function nextCollabId(): string {
  collabCounter += 1;
  return `collab-${collabCounter}`;
}

/** 执行体的输入（快照定死的证据面——只有快照权限，没有活设置通道）。 */
export interface CollabTask {
  readonly collabId: string;
  readonly kind: CollabKind;
  readonly content: string;
  /** 提交时固化的权限档（执行期间后续设置变更不影响——快照语义）。 */
  readonly permissionCeiling: CollabPermissionCeiling;
}

export type CollabExecutor = (
  task: CollabTask,
) => Promise<{ result?: string; error?: string; status: "completed" | "failed" }>;

export interface CollaborationDeps {
  /** 落流出口（append 事件到指定会话流——注入面：测试内存库/生产 store）。 */
  append(sessionId: string, event: CollabEvent): void;
  /** 目标会话存在性（不存在的目标类型化拒绝——未知边界不创建）。 */
  sessionExists(sessionId: string): boolean;
  /** 执行体（缺省 = 同步 echo 完结的最小面；真实执行随运行时面接线）。 */
  executor?: CollabExecutor;
  /** 完成通知（N5 分型候选——notifyOnCompletion 时回调）。 */
  notify?(payload: {
    collabId: string;
    kind: CollabKind;
    sourceSessionId: string;
    targetSessionId: string;
    status: CollabStatus;
  }): void;
}

/** 排队条目（快照 + 时间戳——非流状态，重启由流投影重建）。 */
interface QueuedEntry {
  collabId: string;
  kind: CollabKind;
  sourceSessionId: string;
  targetSessionId: string;
  content: string;
  permissionCeiling: CollabPermissionCeiling;
  notifyOnCompletion: boolean;
  createdAt: number;
}

const COLLAB_KINDS: readonly CollabKind[] = ["task", "message", "completion"];

/** 环检测：沿"目标会话的活动派发链"回溯——链上出现新目标即成环。 */
function assertNoCollabCycle(
  queue: readonly QueuedEntry[],
  sourceSessionId: string,
  targetSessionId: string,
): void {
  // 活动边集：排队中任务 (source → target)
  const edges = new Map<string, string>();
  for (const q of queue) {
    edges.set(q.sourceSessionId, q.targetSessionId);
  }
  let current: string | undefined = targetSessionId;
  const visited = new Set<string>();
  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    if (current === sourceSessionId) {
      throw new CollaborationError(
        "COLLAB_CYCLE",
        `协作派发成环：${sourceSessionId} → ${targetSessionId} 与活动派发链相交（引用图须为 DAG——E9 同款纪律）`,
      );
    }
    current = edges.get(current);
  }
}

export class CollaborationService {
  private readonly queue: QueuedEntry[] = [];
  private running = new Set<string>();

  constructor(private readonly deps: CollaborationDeps) {}

  /**
   * 派发：源流落 dispatch、目标流落 receive（queued）。权限快照在此固化。
   * message 型即时性更高（走同一状态机——最小面不分叉）。
   */
  dispatch(request: {
    sourceSessionId: string;
    targetSessionId: string;
    kind: CollabKind;
    content: string;
    /** 提交时的权限档（调用方从当前设置读取——进事件载荷后即定死）。 */
    permissionCeiling: CollabPermissionCeiling;
    notifyOnCompletion?: boolean;
    ts?: number;
  }): string {
    if (!COLLAB_KINDS.includes(request.kind)) {
      throw new CollaborationError("COLLAB_BAD_KIND", `协作消息 kind 非法：${String(request.kind)}`);
    }
    if (request.sourceSessionId === request.targetSessionId) {
      throw new CollaborationError("COLLAB_SELF", "不能给自己派协作任务（自派拒绝）");
    }
    if (!this.deps.sessionExists(request.targetSessionId)) {
      throw new CollaborationError(
        "COLLAB_TARGET_MISSING",
        `目标会话不存在：${request.targetSessionId}（未知边界不创建——E6 同款纪律）`,
      );
    }
    assertNoCollabCycle(this.queue, request.sourceSessionId, request.targetSessionId);
    const collabId = nextCollabId();
    const ts = request.ts ?? Date.now();
    const entry: QueuedEntry = {
      collabId,
      kind: request.kind,
      sourceSessionId: request.sourceSessionId,
      targetSessionId: request.targetSessionId,
      content: request.content,
      permissionCeiling: request.permissionCeiling,
      notifyOnCompletion: request.notifyOnCompletion ?? true,
      createdAt: ts,
    };
    this.queue.push(entry);
    // 源流：派发事实（含快照——定死的起点）
    this.deps.append(request.sourceSessionId, {
      type: "session/collab",
      seq: 0,
      ts,
      turn: 0,
      collabId,
      direction: "dispatch",
      kind: request.kind,
      peerSessionId: request.targetSessionId,
      content: request.content,
      permissionCeiling: request.permissionCeiling,
      notifyOnCompletion: entry.notifyOnCompletion,
    });
    // 目标流：入队事实（同快照）
    this.deps.append(request.targetSessionId, {
      type: "session/collab",
      seq: 0,
      ts,
      turn: 0,
      collabId,
      direction: "receive",
      kind: request.kind,
      peerSessionId: request.sourceSessionId,
      content: request.content,
      status: "queued",
      permissionCeiling: request.permissionCeiling,
    });
    return collabId;
  }

  /** 排队中的任务数（指定目标会话）。 */
  queuedCount(targetSessionId: string): number {
    return this.queue.filter((q) => q.targetSessionId === targetSessionId).length;
  }

  /** 取消排队任务（状态机转移 cancelled——目标流 update + 源流 report）。 */
  cancel(collabId: string, ts: number = Date.now()): boolean {
    const idx = this.queue.findIndex((q) => q.collabId === collabId);
    if (idx === -1) return false;
    const entry = this.queue.splice(idx, 1)[0]!;
    this.deps.append(entry.targetSessionId, {
      type: "session/collab",
      seq: 0,
      ts,
      turn: 0,
      collabId,
      direction: "update",
      kind: entry.kind,
      peerSessionId: entry.sourceSessionId,
      status: "cancelled",
    });
    this.deps.append(entry.sourceSessionId, {
      type: "session/collab",
      seq: 0,
      ts,
      turn: 0,
      collabId,
      direction: "report",
      kind: "completion",
      peerSessionId: entry.targetSessionId,
      status: "cancelled",
    });
    if (entry.notifyOnCompletion) this.deps.notify?.({ ...entry, status: "cancelled" });
    return true;
  }

  /**
   * 执行队头任务（一次一个——目标会话的串行消费面）：落 running → 执行
   * （**快照定死**：executor 收 dispatch 时固化的权限档）→ 落 completed/
   * failed（目标流 update + 源流 completion 回投）→ 通知。队空 = no-op。
   */
  async runNext(targetSessionId: string): Promise<string | null> {
    const entry = this.queue.find((q) => q.targetSessionId === targetSessionId);
    if (entry === undefined || this.running.has(targetSessionId)) return null;
    this.running.add(targetSessionId);
    const ts = Date.now();
    this.deps.append(targetSessionId, {
      type: "session/collab",
      seq: 0,
      ts,
      turn: 0,
      collabId: entry.collabId,
      direction: "update",
      kind: entry.kind,
      peerSessionId: entry.sourceSessionId,
      status: "running",
    });
    let outcome: { result?: string; error?: string; status: "completed" | "failed" };
    try {
      // 快照定死的执行点：executor 只见 CollabTask（快照），不见活设置
      outcome = await (this.deps.executor?.({
        collabId: entry.collabId,
        kind: entry.kind,
        content: entry.content,
        permissionCeiling: entry.permissionCeiling,
      }) ?? Promise.resolve({ result: entry.content, status: "completed" as const }));
    } catch (e) {
      outcome = { status: "failed", error: e instanceof Error ? e.message : String(e) };
    }
    this.queue.splice(this.queue.findIndex((q) => q.collabId === entry.collabId), 1);
    this.running.delete(targetSessionId);
    const settleTs = Date.now();
    this.deps.append(targetSessionId, {
      type: "session/collab",
      seq: 0,
      ts: settleTs,
      turn: 0,
      collabId: entry.collabId,
      direction: "update",
      kind: entry.kind,
      peerSessionId: entry.sourceSessionId,
      status: outcome.status,
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    });
    // completion 回投：结果落源会话流（协作闭环——源会话可见结果事实）
    this.deps.append(entry.sourceSessionId, {
      type: "session/collab",
      seq: 0,
      ts: settleTs,
      turn: 0,
      collabId: entry.collabId,
      direction: "report",
      kind: "completion",
      peerSessionId: entry.targetSessionId,
      status: outcome.status,
      ...(outcome.result !== undefined ? { result: outcome.result } : {}),
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    });
    if (entry.notifyOnCompletion) {
      this.deps.notify?.({
        collabId: entry.collabId,
        kind: entry.kind,
        sourceSessionId: entry.sourceSessionId,
        targetSessionId: entry.targetSessionId,
        status: outcome.status,
      });
    }
    return entry.collabId;
  }
}

/**
 * 流投影：从单条事件流重建协作消息视图（往来面板数据面——事件是唯一
 * 真相，重启后状态可完全重建）。聚合键 = collabId；视角方向 = 首见事件
 * 是 dispatch（本流为源）还是 receive（本流为目标）。
 */
export function collaborationsFromEvents(
  events: readonly SessionEvent[],
): CollaborationRecord[] {
  const byId = new Map<string, { record: CollaborationRecord }>();
  for (const e of events) {
    if (e.type !== "session/collab") continue;
    let entry = byId.get(e.collabId);
    if (entry === undefined) {
      const isSource = e.direction === "dispatch";
      entry = {
        record: {
          collabId: e.collabId,
          kind: e.kind,
          content: e.content ?? "",
          peerSessionId: e.peerSessionId,
          direction: isSource ? "outgoing" : "incoming",
          status: e.status ?? "queued",
          ...(e.permissionCeiling !== undefined ? { permissionCeiling: e.permissionCeiling } : {}),
          ...(e.result !== undefined ? { result: e.result } : {}),
          ...(e.error !== undefined ? { error: e.error } : {}),
          createdAt: e.ts,
          updatedAt: e.ts,
        },
      };
      byId.set(e.collabId, entry);
    }
    const r = { ...entry.record };
    if (e.status !== undefined) {
      r.status = e.status;
      r.updatedAt = e.ts;
    }
    if (e.direction === "report") {
      if (e.result !== undefined) r.result = e.result;
      if (e.error !== undefined) r.error = e.error;
      r.updatedAt = e.ts;
    }
    entry.record = r;
  }
  return [...byId.values()].map((v) => v.record);
}
