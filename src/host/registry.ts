/**
 * 远程 host 架构（K3/T-P1-112）——"多 host 注册 + IPC 桥（只学行为）"。
 * 形状取 pi-desktop·agent-host-bridge.ts 的行为学：host 层**包装既有装配
 * 不重写**（"wraps the existing registered IPC handlers … so the local
 * permission and persistence behavior is reused unchanged"——审批/持久化/
 * owner-port 语义零改写），本模块只补四块增量：多会话注册、事件分发、
 * M9 全局/会话两级工具类上限、权限天花板（isWidening 拒绝）。
 *
 - "IPC 桥"半边 = 端间协议 server（K8/T-P1-115），不在本模块——两域按
 *   卡序头约束分域：本模块是 host 进程内架构，wire 面随协议卡落。
 * - M9 记档消费（T-P1-49"全局/会话两级上限结构留 K3"）：全局 ToolClassLimiter
 *   聚合（跨会话泳道）叠在会话级 toolClassLimits 外层——次序 = 全局在外
 *   （host 资源面优先），工具级 B17 RwLock 仍在其内层（loop dispatch）。
 *   单进程直构面承载测试；跨进程全局聚合随批次 14 守护进程形态再评估。
 */

import { randomUUID } from "node:crypto";

import type { SessionEvent } from "../kernel/events.js";
import { ToolClassLimiter, type ToolClassLimits } from "../kernel/admission.js";
import { isWriteExecuteTool } from "../policy/protected-paths.js";
import { isValidSessionId } from "../session/session-id.js";

// ---------------------------------------------------------------------------
// 错误面
// ---------------------------------------------------------------------------

export class HostSessionExistsError extends Error {
  readonly code = "HOST_SESSION_EXISTS";
  constructor(readonly sessionId: string) {
    super(`会话 ${sessionId} 已有 host 注册——同一会话同时只允许一个 host 实例`);
    this.name = "HostSessionExistsError";
  }
}

export class HostCeilingWideningError extends Error {
  readonly code = "HOST_CEILING_WIDENING";
  constructor(readonly ceiling: boolean) {
    super(
      ceiling
        ? "请求的无人值守档未超出天花板，不应到达此错误"
        : "请求放宽到无人值守档被拒：host 会话天花板未开启（远端只能收窄不能放宽——agent-host-bridge isWidening 纪律）",
    );
    this.name = "HostCeilingWideningError";
  }
}

export class UnknownHostSessionError extends Error {
  readonly code = "UNKNOWN_HOST_SESSION";
  constructor(readonly sessionId: string) {
    super(`会话 ${sessionId} 没有 host 注册`);
    this.name = "UnknownHostSessionError";
  }
}

// ---------------------------------------------------------------------------
// 工具类上限组合（M9 两级）
// ---------------------------------------------------------------------------

type ClassAcquire = (name: string) => Promise<() => void>;

/**
 * 两级类级 acquire 组合：全局（外层）先取名额、会话（内层）再取，释放逆序
 * （内层先还、外层后还）——跨会话聚合排队落在全局泳道（验收③的时序面）。
 * 任一层缺席则跳过该层；两层都缺返回 undefined（直通零行为变化）。
 */
export function chainToolAcquire(
  globalLimiter: ToolClassLimiter | undefined,
  sessionLimiter: ToolClassLimiter | undefined,
): ClassAcquire | undefined {
  if (globalLimiter === undefined && sessionLimiter === undefined) return undefined;
  return async (name: string) => {
    const releases: Array<() => void> = [];
    try {
      if (globalLimiter !== undefined) releases.push(await globalLimiter.acquire(name));
      if (sessionLimiter !== undefined) releases.push(await sessionLimiter.acquire(name));
    } catch (error) {
      for (const release of releases.reverse()) release();
      throw error;
    }
    return () => {
      for (const release of releases.reverse()) release();
    };
  };
}

// ---------------------------------------------------------------------------
// AgentHost：单会话宿主
// ---------------------------------------------------------------------------

export interface AgentHostOptions {
  sessionId: string;
  /** host 身份（N7/T-P1-113 的 surface 连接将挂在此身份下；缺省随机 UUID）。 */
  hostId?: string;
  /** 会话级工具类上限（内层；缺省不配 = 会话内不限）。 */
  toolClassLimits?: ToolClassLimits;
  /**
   * 无人值守天花板（缺省 false）：请求面放宽到 unattended=true 被拒——
   * pi-desktop isWidening 同构（"a remote viewer … should never be able to
   * run a turn at auto"）；收窄（true → false）照常受理。
   */
  unattendedCeiling?: boolean;
}

export class AgentHost {
  readonly hostId: string;
  private disposed = false;
  private currentUnattended: boolean;
  private readonly sessionLimiter: ToolClassLimiter | undefined;

  constructor(
    readonly registry: HostRegistry,
    readonly options: AgentHostOptions,
  ) {
    if (!isValidSessionId(options.sessionId)) {
      throw new Error(`会话 id 不合法：${options.sessionId}`);
    }
    this.hostId = options.hostId ?? randomUUID();
    this.currentUnattended = options.unattendedCeiling === true;
    this.sessionLimiter =
      options.toolClassLimits !== undefined
        ? new ToolClassLimiter(options.toolClassLimits, (name) =>
            isWriteExecuteTool(name) ? "write" : "read",
          )
        : undefined;
  }

  get sessionId(): string {
    return this.options.sessionId;
  }

  /** 会话内是否处于无人值守档（host 写命令面的活查询源——N7 卡消费）。 */
  get unattended(): boolean {
    return this.currentUnattended;
  }

  /**
   * 请求切换无人值守档：天花板（unattendedCeiling=false）下请求 true 是
   * 放宽 → HOST_CEILING_WIDENING；收窄照常。返回生效后的档位。
   */
  requestUnattended(requested: boolean): boolean {
    if (requested && this.options.unattendedCeiling !== true) {
      throw new HostCeilingWideningError(this.options.unattendedCeiling ?? false);
    }
    this.currentUnattended = requested;
    return this.currentUnattended;
  }

  /**
   * 事件出口：本会话 agent 事件经此进入 registry 分发（装配方/直构测试
   * 在事件落盘后调用——pi-desktop ingest(envelope) 的我方同构；归属校验
   * 防串话：别的会话事件喂进来是编程错误）。
   */
  emit(event: SessionEvent): void {
    if (this.disposed) return; // dispose 后出口静默（不再分发）
    this.registry.route(this.options.sessionId, event);
  }

  /** 该会话 executeTool 的类级 acquire（全局外层 + 会话内层组合）。 */
  toolAcquire(): ClassAcquire | undefined {
    return chainToolAcquire(this.registry.globalToolLimiter, this.sessionLimiter);
  }

  /** 会话内泳道快照（可观测面；未配会话限额返回 undefined）。 */
  sessionLimiterSnapshot():
    | { writeRunning: number; readRunning: number; writeWaiting: number; readWaiting: number }
    | undefined {
    return this.sessionLimiter?.snapshot();
  }

  /** 从 registry 摘除本 host 并停止分发（幂等）。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.registry.remove(this.options.sessionId, this);
  }
}

// ---------------------------------------------------------------------------
// HostRegistry：多 host 注册 + 事件分发
// ---------------------------------------------------------------------------

export type HostEventListener = (sessionId: string, event: SessionEvent) => void;

export interface HostRegistryOptions {
  /** M9 全局工具类上限（外层泳道——跨会话聚合）。缺省不配 = 不限。 */
  globalToolClassLimits?: ToolClassLimits;
}

export class HostRegistry {
  private readonly hosts = new Map<string, AgentHost>();
  private readonly listeners = new Set<HostEventListener>();
  readonly globalToolLimiter: ToolClassLimiter | undefined;

  constructor(options: HostRegistryOptions = {}) {
    this.globalToolLimiter =
      options.globalToolClassLimits !== undefined
        ? new ToolClassLimiter(options.globalToolClassLimits, (name) =>
            isWriteExecuteTool(name) ? "write" : "read",
          )
        : undefined;
  }

  /** 注册一个会话的 host；同 sessionId 重复注册类型化拒绝。 */
  register(options: AgentHostOptions): AgentHost {
    if (this.hosts.has(options.sessionId)) {
      throw new HostSessionExistsError(options.sessionId);
    }
    const host = new AgentHost(this, options);
    this.hosts.set(options.sessionId, host);
    return host;
  }

  get(sessionId: string): AgentHost | undefined {
    return this.hosts.get(sessionId);
  }

  /** 必须存在（协议路由面消费——K8 卡）；不存在类型化拒绝。 */
  mustGet(sessionId: string): AgentHost {
    const host = this.hosts.get(sessionId);
    if (host === undefined) throw new UnknownHostSessionError(sessionId);
    return host;
  }

  list(): AgentHost[] {
    return [...this.hosts.values()];
  }

  has(sessionId: string): boolean {
    return this.hosts.has(sessionId);
  }

  /** 订阅全部会话事件（按 sessionId 归属路由给监听方）；返回退订函数。 */
  subscribe(listener: HostEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 全局限器快照（M9"容量可观测"——ADR 0041 同款）。 */
  globalLimiterSnapshot():
    | { writeRunning: number; readRunning: number; writeWaiting: number; readWaiting: number }
    | undefined {
    return this.globalToolLimiter?.snapshot();
  }

  /** dispose 全部 host（registry 生命周期结束面）。 */
  dispose(): void {
    for (const host of [...this.hosts.values()]) host.dispose();
    this.listeners.clear();
  }

  /** 事件路由（AgentHost.emit 的内部通道——dispose 后的 host 不会到达）。 */
  route(sessionId: string, event: SessionEvent): void {
    for (const listener of this.listeners) listener(sessionId, event);
  }

  /** 摘除 host（AgentHost.dispose 的内部通道；幂等——非当前注册者不动）。 */
  remove(sessionId: string, host: AgentHost): void {
    if (this.hosts.get(sessionId) === host) this.hosts.delete(sessionId);
  }
}
