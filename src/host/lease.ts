/**
 * surface 连接 + run 租约 + 会话级写互斥（N7+N3/T-P1-113）。
 *
 * 形状取 zcode·sessionRealtimePort.ts：每个界面是一个 host 连接（hostId +
 * deliveryKind 投递方式之分）、run 由租约保护（acquire/release）、事件 publish
 * 推送三面一体。租约的**单 holder 语义复用** session/owner-port.ts 的
 * OwnerCommandPort.acquireLease（N6 最小版——多端并发 holder 保持不做，
 * N6 注记原文兑现：zcode TaskRunLease 同为单 holder）。
 *
 * 断线即释放（connection.close() → 租约归还 + 通知）：进程内连接生命周期
 * 就是租约存活性；时间 TTL/心跳随 K8 真实网络传输层再评估（记档）。
 * "run 由租约保护"的落点 = submitWrite：写命令（prompt/steer/cancel 等
 * 改变会话流的动作）必须由持约连接发出，非持约 → NotLeaseHolderError
 * 贯穿（N6"持有者才能发命令"在 host 面的兑现）。
 *
 * N3（会话级互斥）由两层结构保证：①租约互斥（同时只一个连接可写）+
 * ②单 agent loop 的 handleRequest 同步派发（并发到达的写命令在进程内
 * 串行化，事件流 seq 由 store 单调分配——无交错）。
 */

import { LeaseBusyError, NotLeaseHolderError, type LeaseHandle } from "../session/owner-port.js";

// ---------------------------------------------------------------------------
// 投递方式（N7"有投递方式之分"）
// ---------------------------------------------------------------------------

/** 投递方式闭集：push = host 主动推送事件流；poll = 端按游标拉取。 */
export const DELIVERY_KINDS = ["push", "poll"] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

export function parseDeliveryKind(value: unknown): DeliveryKind {
  if (typeof value !== "string" || !(DELIVERY_KINDS as readonly string[]).includes(value)) {
    throw new Error(
      `投递方式只接受 ${DELIVERY_KINDS.join("|")}，收到：${String(value)}`,
    );
  }
  return value as DeliveryKind;
}

// ---------------------------------------------------------------------------
// 连接与租约
// ---------------------------------------------------------------------------

export interface SurfaceHandle {
  readonly surfaceId: string;
  readonly deliveryKind: DeliveryKind;
  /** 是否当前持有 run 租约。 */
  holdsLease(): boolean;
  /** 断线：自动释放租约（若持有）并从连接面摘除——幂等。 */
  close(): void;
}

export type LeaseListener = (heldBySurfaceId: string | undefined) => void;

/** 连接生命周期变更（N8 roster 落流面——AgentHost 转成 surface/attach|detach 事件）。 */
export interface SurfaceLifecycleChange {
  readonly op: "attach" | "detach";
  readonly surfaceId: string;
  readonly deliveryKind?: DeliveryKind;
  readonly reason?: string;
}

/**
 * 每会话一个的 surface 连接面（AgentHost 的成员——连接即租约候选，
 * "每个界面是一个 host"）。租约序号令牌语义沿用 owner-port：旧句柄在
 * 租约被释放并重新获取后即失效。
 * onLifecycle：连接建立/断开的生命周期回调（N8/T-P1-114 落流面——AgentHost
 * 把变更转成 surface/attach|detach 事件 emit，由装配方订阅 append 落流）。
 */
export class SurfaceHub {
  private leaseOwnerId: string | undefined;
  private leaseId = 0;
  private readonly connections = new Map<string, SurfaceHandleInternal>();
  private readonly leaseListeners = new Set<LeaseListener>();

  constructor(private readonly onLifecycle?: (change: SurfaceLifecycleChange) => void) {}

  /** 建立一个 surface 连接（同 surfaceId 重复连接拒绝）。 */
  connect(surfaceId: string, deliveryKind: DeliveryKind): SurfaceHandle {
    if (this.connections.has(surfaceId)) {
      throw new Error(`surface ${surfaceId} 已连接`);
    }
    const self = this;
    const handle: SurfaceHandleInternal = {
      surfaceId,
      deliveryKind,
      holdsLease: () => self.leaseOwnerId === surfaceId,
      close: () => {
        if (!this.connections.has(surfaceId)) return;
        this.connections.delete(surfaceId);
        if (this.leaseOwnerId === surfaceId) this.releaseInternal();
        this.onLifecycle?.({ op: "detach", surfaceId, reason: "disconnected" });
      },
    };
    this.connections.set(surfaceId, handle);
    this.onLifecycle?.({ op: "attach", surfaceId, deliveryKind });
    return handle;
  }

  /** 当前连接清单（roster 的进程内半边——持久半边随 N8 事件落流）。 */
  connectedSurfaceIds(): string[] {
    return [...this.connections.keys()];
  }

  isConnected(surfaceId: string): boolean {
    return this.connections.has(surfaceId);
  }

  /**
   * 获取 run 租约：单 holder（已有人持有时 LeaseBusyError）；只有**已连接**
   * 的 surface 可 acquire（未连接的幽灵候选防呆）。
   */
  acquireRunLease(surfaceId: string): LeaseHandle {
    if (!this.connections.has(surfaceId)) {
      throw new NotLeaseHolderError(surfaceId);
    }
    if (this.leaseOwnerId !== undefined && this.leaseOwnerId !== surfaceId) {
      throw new LeaseBusyError(this.leaseOwnerId);
    }
    if (this.leaseOwnerId === surfaceId) {
      // 重入 acquire：等价释放后重取（拿到新令牌——旧句柄失效）
      this.releaseInternal();
    }
    const leaseId = ++this.leaseId;
    this.leaseOwnerId = surfaceId;
    this.notifyLease();
    const self = this;
    return {
      ownerId: surfaceId,
      id: leaseId,
      release: () => {
        if (self.leaseId !== leaseId || self.leaseOwnerId !== surfaceId) return false;
        self.releaseInternal();
        return true;
      },
    };
  }

  /**
   * 写命令准入（N3 机制面）：写命令必须由**当前持约**的连接发出——句柄
   * 过期（租约被释放重获）/ 非持约 → NotLeaseHolderError。通过后执行
   * handler（进程内串行派发由单 loop 结构保证）。
   */
  submitWrite(surfaceId: string, lease: LeaseHandle, execute: () => void): void {
    if (this.leaseId !== lease.id || this.leaseOwnerId !== surfaceId) {
      throw new NotLeaseHolderError(surfaceId);
    }
    execute();
  }

  /**
   * 主动归还租约（N7 协议面 release——surfaceId 须为当前持有者；非持有者
   * → NotLeaseHolderError，未持约 → false no-op）。
   */
  releaseRunLease(surfaceId: string): boolean {
    if (this.leaseOwnerId !== surfaceId) {
      throw new NotLeaseHolderError(surfaceId);
    }
    this.releaseInternal();
    return true;
  }

  onLeaseChange(listener: LeaseListener): () => void {
    this.leaseListeners.add(listener);
    return () => this.leaseListeners.delete(listener);
  }

  currentLeaseHolder(): string | undefined {
    return this.leaseOwnerId;
  }

  private releaseInternal(): void {
    this.leaseOwnerId = undefined;
    this.notifyLease();
  }

  private notifyLease(): void {
    for (const listener of this.leaseListeners) listener(this.leaseOwnerId);
  }
}

interface SurfaceHandleInternal extends SurfaceHandle {
  close(): void;
}
