/**
 * HostBridge（N2/T-P1-116）——协议编排面：agent 连接 + AgentHost + 端连接
 * 合体。审批等非流事实 notification 广播（N2）；写命令租约校验（N7/N3）；
 * roster 落流（N8）；回执匹配（A9——prompt accepted 关联，error 行归属最近
 * 未决，无回执命令即 resolve）；polish（T-P3-146 I）requestId 关联旁路面。
 */

import type { AgentMessage, AgentRequest } from "../kernel/agent-protocol.js";
import type { SessionEvent } from "../kernel/events.js";
import { NotLeaseHolderError } from "../session/owner-port.js";
import type { SessionStore } from "../session/store.js";
import { SqliteEventStorage } from "../session/db.js";
// U9/U10/U12 查询面的 op 分流实现拆分至 query-gateway.ts（行数纪律拆分）
import { handleHostQuery } from "./query-gateway.js";
import { buildPolicyAuditEntries } from "./policy-audit-op.js";
import { tryPluginSettingsOp } from "./settings-plugin-ops.js";
import { tryProjectSettingsOp } from "./settings-project-ops.js";
import { buildSurfaceServerOptions } from "./bridge-surface-options.js";
import { tryPanelSettingsOp } from "./settings-panel-ops.js";
import { tryTransferSettingsOp } from "./settings-transfer-ops.js";
import { trySchedulerSettingsOp } from "./scheduler-ops.js";
import { localSttStatus } from "./local-stt.js";
import { sttDownloadAll } from "./local-stt-download.js";
import { AgentHost } from "./registry.js";
import {
  HostProtocolServer,
  type HostProtocolServerOptions,
  type SessionRouter,
} from "./protocol.js";
// AgentChannel 实体搬 protocol.ts（行数纪律）——此处 re-export 兼容既有消费面
export type { AgentChannel } from "./protocol.js";
import type { AgentChannel } from "./protocol.js";
import type { DeliveryKind } from "./lease.js";
import { NotificationHub } from "./notify.js";
/** 写命令闭集（租约校验适用面——只读查询如 policy/check 不在此列）。 */
const WRITE_COMMANDS = new Set(["prompt", "steer", "cancel", "approve", "question/answer", "polish", "revert", "thinking/set", "queue/remove", "queue/edit"]);


export interface HostBridgeOptions {
  host: AgentHost;
  agent: AgentChannel;
  /**
   * T-P3-170 多会话并发（pi-desktop 单 sidecar Map<sessionId,Runtime> 的
   * 进程形态对应）：按会话派生 agent 通道的工厂（生产 = spawnAgentProcess
   * 每 sessionId 一个 child——同 host 进程内多会话并发，事件按 sessionId
   * 归属广播）。缺席 = 单会话模型（options.agent 恒用——既有测试零变化）。
   */
  agentFactory?: (sessionId: string) => AgentChannel;
  /** roster 事件的落流面（提供时 surface 注册/断开 append 进会话流）。 */
  store?: SessionStore;
  /** N5 分类通知面（分型是附加发布面——既有 notification 广播零变化）。 */
  notifyHub?: NotificationHub;
  /** U14 settings 直答网关（host 面配置读写与凭据管理，不经 agent 不落流）。 */
  settingsGateway?: import("./settings-gateway.js").SettingsGateway;
  sessionsLibrary?: SqliteEventStorage;
  workspaceRoot?: string;
  contextWindow?: number;
  /** T-P3-147 E：会话标题服务（turn/end 结算后异步生成——host 旁路面）。 */
  titleService?: import("./title-service.js").TitleService;
}

interface SurfaceRegistration {
  surfaceId: string;
  server: HostProtocolServer;
  closeSurface: () => void;
}

export class HostBridge implements SessionRouter {
  private readonly listeners = new Set<(sessionId: string, event: SessionEvent) => void>();
  private readonly registrations = new Map<string, SurfaceRegistration>();
  /** T-P3-170：per-session 在途 prompt 收执（键 = sessionId——多 child 各自的消息 id 空间互不串线）。 */
  private readonly pendingPrompts = new Map<string, Map<string, (value: unknown) => void>>();
  private readonly lastPendingPromptIds = new Map<string, string | undefined>();
  private readonly pendingPolishes = new Map<string, (value: unknown) => void>();
  /** T-P3-170：per-session 通道池——**主会话也入池**（结构性设置热加载
   * 需要 kill→重派生主 child；池化死亡自动重派生语义统一）。 */
  private readonly channels = new Map<string, AgentChannel>();
  /** T-P3-173（并发差距补全 B4）：池内通道最后活跃时刻（空闲回收判据）。 */
  private readonly channelLastActive = new Map<string, number>();
  /** 热加载 busy 判据：进行中的用户轮（turn/start 入、turn/end 出——
   * recycle 跳过 busy 会话，绝不杀正在执行的 child）。 */
  private readonly activeTurns = new Set<string>();
  /** T-P3-173：空闲回收定时器（idleReaper——30min 无消息且无在途 prompt）。 */
  private readonly idleReaper: ReturnType<typeof setInterval>;
  /** U10 ready 捕获清单（工具/技能/prompts——/ 补全来源）。 */
  private agentCapabilities: import("./query-gateway.js").AgentCapabilities | undefined;
  private readonly unconsumed: Promise<void>;

  constructor(private readonly options: HostBridgeOptions) {
    // agent 消息泵：event → 会话事件广播；审批/提问 → notification 广播。
    // 主会话通道入池后起泵（死亡 finally 摘池——channelFor 经 agentFactory
    // 重派生，结构性设置热加载依赖该路径）；T-P3-170 池化通道的泵同款。
    this.channels.set(this.options.host.sessionId, options.agent);
    this.unconsumed = this.pumpSession(this.options.host.sessionId, options.agent)
      .catch(() => {})
      .finally(() => {
        // T-P3-147（走查实录）：主 agent 通道死亡后未决 prompt/polish 不类型化
        // 拒绝将永久挂起——child 死 = 后续请求必死，全部立即回执类型化失败。
        this.rejectPendingOf(this.options.host.sessionId);
        this.activeTurns.delete(this.options.host.sessionId);
        this.channels.delete(this.options.host.sessionId); // 入池后死亡摘池——channelFor 重派生
        for (const resolve of this.pendingPolishes.values()) {
          resolve({ type: "polish_result", requestId: "", ok: false, error: "agent 进程已退出" });
        }
        this.pendingPolishes.clear();
      });
    // T-P3-173（B4）：池内 child 空闲回收——30min 无消息且无在途 prompt 的
    // 会话进程自动退出（kill 摘池；下次请求 channelFor 天然重派生，--db
    // 持久恢复历史）。主会话通道豁免（生命周期与 host 同步）。
    this.idleReaper = setInterval(() => {
      const idleMs = 30 * 60_000;
      const now = Date.now();
      for (const [sid, channel] of [...this.channels.entries()]) {
        if (sid === this.options.host.sessionId) continue; // 主会话豁免空闲回收
        const last = this.channelLastActive.get(sid) ?? now;
        const hasPending = (this.pendingPrompts.get(sid)?.size ?? 0) > 0;
        if (!hasPending && now - last > idleMs) {
          this.channels.delete(sid);
          this.channelLastActive.delete(sid);
          const killable = channel as Partial<{ kill: () => Promise<void> | void }>;
          if (typeof killable.kill === "function") void killable.kill();
        }
      }
    }, 5 * 60_000);
    this.idleReaper.unref?.();
  }

  /** 一个会话通道的消息泵（T-P3-170：每通道一个——消息按会话归属分发）。 */
  private async pumpSession(sessionId: string, channel: AgentChannel): Promise<void> {
    for await (const message of channel.messages) {
      this.handleAgentMessage(sessionId, message);
    }
  }

  /** 该会话通道死亡时未决 prompt 的类型化收尾（挂起防呆）。 */
  private rejectPendingOf(sessionId: string): void {
    for (const resolve of this.pendingPrompts.get(sessionId)?.values() ?? []) {
      resolve({
        __bridgeError: { code: "AGENT_CHANNEL_DEAD", message: "agent 进程已退出——本请求不会被处理（查看 host 日志的装配错误）" },
      });
    }
    this.pendingPrompts.delete(sessionId);
    this.lastPendingPromptIds.delete(sessionId);
  }

  /** 会话通道取用面：全部会话走池（主会话构造时入池——死亡重派生语义
   * 统一，结构性设置热加载依赖）；无 agentFactory 的测试装配兜底直返
   * options.agent。 */
  private channelFor(sessionId: string): AgentChannel {
    if (this.options.agentFactory === undefined) {
      return this.options.agent;
    }
    let channel = this.channels.get(sessionId);
    if (channel === undefined) {
      channel = this.options.agentFactory(sessionId);
      this.channels.set(sessionId, channel);
      void this.pumpSession(sessionId, channel).catch(() => {}).finally(() => {
        this.rejectPendingOf(sessionId);
        this.activeTurns.delete(sessionId);
        this.channels.delete(sessionId);
      });
    }
    return channel;
  }

  /**
   * 结构性设置热加载（用户裁决"可变动项实时热加载"）：回收**空闲** child
   * （busy = 有进行中轮或在途 prompt 的会话绝不杀）——下次请求 channelFor
   * 重派生新 child，启动时烘焙的配置（工具注册/后端/computerUse/mcp/
   * plugins/预设/供应商清单）全部按最新 settings 生效。返回回收数。
   */
  recycleIdleChannels(): number {
    let recycled = 0;
    for (const [sid, channel] of [...this.channels.entries()]) {
      const busy = this.activeTurns.has(sid) || (this.pendingPrompts.get(sid)?.size ?? 0) > 0;
      if (busy) continue;
      this.channels.delete(sid);
      this.channelLastActive.delete(sid);
      this.activeTurns.delete(sid);
      this.rejectPendingOf(sid);
      const killable = channel as Partial<{ kill: () => Promise<void> | void }>;
      if (typeof killable.kill === "function") {
        try {
          void killable.kill();
        } catch {
          /* 幂等——杀失败留自然退出 */
        }
      }
      recycled += 1;
    }
    return recycled;
  }

  /** T-P3-170：stop 收束面——杀掉全部池化 child（主 agent 由 server.stop 直杀）。 */
  async killAllChannels(): Promise<void> {
    clearInterval(this.idleReaper);
    this.channelLastActive.clear();
    const pool = [...this.channels.entries()];
    this.channels.clear();
    for (const [sessionId, channel] of pool) {
      this.rejectPendingOf(sessionId);
      const killable = channel as Partial<{ kill: () => Promise<void> | void }>;
      if (typeof killable.kill === "function") {
        try {
          await killable.kill();
        } catch {
          // 收束幂等——单 child 杀失败不阻断其余
        }
      }
    }
  }

  private handleAgentMessage(sessionId: string, message: AgentMessage): void {
    if (sessionId !== this.options.host.sessionId) this.channelLastActive.set(sessionId, Date.now());
    // U10/T-P3-109：ready 携带的注册表清单（工具名 + 技能名单）——
    // / 补全的清单来源，经 query op:"meta" 曝光给端。
    if (message.type === "ready") {
      this.agentCapabilities = {
        tools: message.tools ?? [],
        skills: message.skills ?? [],
        ...(message.prompts !== undefined ? { prompts: message.prompts } : {}),
      };
      return;
    }
    // T-P3-146 I：润色回执（requestId 关联——旁路调用面不经事件流）
    if (message.type === "polish_result") {
      const resolve = this.pendingPolishes.get(message.requestId);
      if (resolve !== undefined) {
        this.pendingPolishes.delete(message.requestId);
        resolve(message);
      }
      return;
    }
    if (message.type === "event") {
      // 热加载 busy 判据：进行中轮跟踪（turn/start 入、turn/end 出）
      if (message.event.type === "turn/start") this.activeTurns.add(sessionId);
      if (message.event.type === "turn/end") this.activeTurns.delete(sessionId);
      for (const listener of this.listeners) listener(sessionId, message.event);
      if (message.event.type === "turn/end") {
        this.options.notifyHub?.publish("turn_settled", {
          sessionId,
          turn: message.event.turn,
          reason: message.event.reason,
        });
        // T-P3-147 E：标题生成（首轮结算后异步——fire-and-forget 全守卫）
        void this.options.titleService?.onTurnSettled(sessionId);
      }
      return;
    }
    if (message.type === "accepted") {
      const resolve = this.pendingPrompts.get(sessionId)?.get(message.messageId);
      if (resolve !== undefined) {
        this.pendingPrompts.get(sessionId)?.delete(message.messageId);
        if (this.lastPendingPromptIds.get(sessionId) === message.messageId) {
          this.lastPendingPromptIds.set(sessionId, undefined);
        }
        resolve({ accepted: message.messageId });
      }
      return;
    }
    if (message.type === "error") {
      // error 行无关联 id（agent-protocol 连接级错误）——归属该会话最近在途 prompt
      const lastId = this.lastPendingPromptIds.get(sessionId);
      if (lastId !== undefined) {
        const resolve = this.pendingPrompts.get(sessionId)?.get(lastId);
        if (resolve !== undefined) {
          this.pendingPrompts.get(sessionId)?.delete(lastId);
          this.lastPendingPromptIds.set(sessionId, undefined);
          // 类型化拒绝（N6 错误面）经同一通道回给端
          resolve({
            __bridgeError: { code: message.code, message: message.message },
          });
        }
      }
      return;
    }
    // 审批/提问/退回/空闲：非会话流事实 → notification 广播（会话归属随事件带出——T-P3-170）
    const { type: name, ...payload } = message as { type: string } & Record<string, unknown>;
    this.notifySession(sessionId, name, payload);
    // N5 分型：挂起类事实的分类发布（approval_requested/question_asked）
    if (name === "approval_requested" || name === "question_asked") {
      this.options.notifyHub?.publish("approval_pending", { sessionId, name, payload });
    }
  }

  /** 全端广播一条 notification 信封（主会话归属——terminal 等宿主级事实）。 */
  notifyAll(name: string, payload: unknown): void {
    this.notifySession(this.options.host.sessionId, name, payload);
  }

  /** T-P3-170：会话归属的通知广播（agent 消息按来源会话带出）。 */
  notifySession(sessionId: string, name: string, payload: unknown): void {
    for (const registration of this.registrations.values()) {
      registration.server.notify(sessionId, name, payload);
    }
  }

  // -- SessionRouter -------------------------------------------------------

  async send(
    sessionId: string,
    request: AgentRequest,
    from?: { surfaceId?: string },
  ): Promise<unknown> {
    if (WRITE_COMMANDS.has(request.type)) {
      // N7/N3 贯穿：写命令必须持约——发送端身份（from.surfaceId）就是
      // 当前租约持有者；匿名观察者 / 未持约 surface 一律拒绝。
      // T-P3-170：租约保持连接面语义（host 级运行授权）——多会话下持约端
      // 可驱动任一会话（单 UI 部署形态的写方唯一性不变；跨端竞写弱化记档）。
      const holder = this.options.host.surfaces.currentLeaseHolder();
      const surfaceId = from?.surfaceId;
      if (holder === undefined || surfaceId === undefined || holder !== surfaceId) {
        throw new NotLeaseHolderError(surfaceId ?? "(匿名连接)");
      }
    }
    const channel = this.channelFor(sessionId);
    if (request.type === "prompt") {
      return new Promise((resolve) => {
        const pending = this.pendingPrompts.get(sessionId) ?? new Map<string, (value: unknown) => void>();
        pending.set(request.messageId, resolve);
        this.pendingPrompts.set(sessionId, pending);
        this.lastPendingPromptIds.set(sessionId, request.messageId);
        channel.send(request);
      });
    }
    // T-P3-146 I：polish 旁路请求（写命令租约已过——回执经 polish_result）
    if (request.type === "polish") {
      return new Promise((resolve) => {
        this.pendingPolishes.set(request.requestId, resolve);
        channel.send(request);
      });
    }
    channel.send(request);
    // A9 纪律：无专用回执的命令发出即受理——事实经事件流可见。
    return { sent: true };
  }

  onEvent(listener: (sessionId: string, event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * host 侧自产事件的广播点（C10 协作——事件经 store.append 分配 seq 后
   * 经此扇出所有端连接；emitRoster 同款循环形态的公开面）。事件落流由
   * 调用方负责（本方法只广播）。
   */
  broadcastEvent(sessionId: string, events: readonly SessionEvent[]): void {
    for (const event of events) {
      for (const listener of this.listeners) listener(sessionId, event);
    }
  }

  /**
   * host 内部调度通道（C1——cron/webhook 的 prompt 投递面）：与用户 prompt
   * 走完全相同的执行链，但**不经租约**。授权语义：定时任务是用户在定义时
   * 预先授权的 host-owned 自动化；租约（N7）管"多个实时端之间谁在驱动"，
   * host 自身调度不在其上（pi-desktop ADR 0041 同构）。
   */
  /** prompt 收执记账（send 与 sendSystemPrompt 共用——同一条 pendingPrompts 表）。 */
  private enqueuePendingPrompt(sessionId: string, messageId: string, resolve: (value: unknown) => void): void {
    const pending = this.pendingPrompts.get(sessionId) ?? new Map<string, (value: unknown) => void>();
    pending.set(messageId, resolve);
    this.pendingPrompts.set(sessionId, pending);
    this.lastPendingPromptIds.set(sessionId, messageId);
  }

  sendSystemPrompt(sessionId: string, request: { type: "prompt"; messageId: string; content: string }): Promise<unknown> {
    const channel = this.channelFor(sessionId);
    return new Promise((resolve) => {
      this.enqueuePendingPrompt(sessionId, request.messageId, resolve);
      channel.send(request);
    });
  }

  // -- 端连接面 ------------------------------------------------------------

  /** 注册一个端连接：surface 注册 + 协议 server；close 组合两者收束（N7）。 */
  connectSurface(surfaceOptions: {
    surfaceId?: string;
    deliveryKind?: DeliveryKind;
    write: HostProtocolServerOptions["write"];
  }): { server: HostProtocolServer; close(): void } {
    const surfaceId =
      surfaceOptions.surfaceId ?? `anon-${this.registrations.size + 1}-${Date.now().toString(36)}`;
    if (this.registrations.has(surfaceId)) {
      const error = new Error(`surface ${surfaceId} 已连接`);
      (error as unknown as { code: string }).code = "SURFACE_ALREADY_CONNECTED";
      throw error;
    }
    const deliveryKind = surfaceOptions.deliveryKind ?? "push";
    const handle = this.options.host.surfaces.connect(surfaceId, deliveryKind);
    this.emitRoster({ type: "surface/attach", surfaceId, deliveryKind });
    // 四钩子（hello/lease/query/settings）的组装下沉 bridge-surface-options.ts
    //（行数纪律拆分）——本处只做 bridge 私有面的显式投影。
    const serverOptions: HostProtocolServerOptions = buildSurfaceServerOptions(
      {
        host: this.options.host,
        ...(this.options.store !== undefined ? { store: this.options.store } : {}),
        ...(this.options.sessionsLibrary !== undefined ? { sessionsLibrary: this.options.sessionsLibrary } : {}),
        ...(this.options.settingsGateway !== undefined ? { settingsGateway: this.options.settingsGateway } : {}),
        ...(this.options.workspaceRoot !== undefined ? { workspaceRoot: this.options.workspaceRoot } : {}),
        ...(this.options.contextWindow !== undefined ? { contextWindow: this.options.contextWindow } : {}),
        reloadNotify: this.reloadNotifier(),
        agentCapabilities: () => this.agentCapabilities,
      },
      surfaceId,
      surfaceOptions.write,
    );
    const server = new HostProtocolServer(this, serverOptions);
    const registration: SurfaceRegistration = {
      surfaceId,
      server,
      closeSurface: () => handle.close(),
    };
    this.registrations.set(surfaceId, registration);
    return {
      server,
      close: () => {
        if (!this.registrations.has(surfaceId)) return;
        this.registrations.delete(surfaceId);
        server.close();
        handle.close(); // 断线自动释放租约（SurfaceHub）
        this.emitRoster({ type: "surface/detach", surfaceId, reason: "disconnected" });
      },
    };
  }

  // T-P3-148/T-P3-170 热加载通知器：host 落盘插件后广播全部通道（主+池化）。
  private reloadNotifier = (): (() => void) => {
    const fire = (): void => {
      const reload = { type: "plugins/reload" } as unknown as AgentRequest;
      this.options.agent.send(reload);
      for (const channel of this.channels.values()) channel.send(reload);
    };
    return fire;
  };
  /** surface 数量（通知广播面）。 */
  get surfaceCount(): number {
    return this.registrations.size;
  }

  private emitRoster(event: { type: string; surfaceId: string; deliveryKind?: string; reason?: string }): void {
    // roster 落流（N8）：seq/ts 由 store 分配；广播给所有端连接（event 通道）；
    // turn 落 0（会话级元事件纪律——l0-events §3.2）；N5 分型发布端面进退。
    const store = this.options.store;
    if (store === undefined) return;
    const { type, surfaceId, ...rest } = event;
    const committed = store.append(this.options.host.sessionId, [
      (type === "surface/attach"
        ? { type, turn: 0, surfaceId, ...(rest as { deliveryKind?: string }) }
        : { type, turn: 0, surfaceId, ...(rest as { reason?: string }) }) as never,
    ]);
    for (const event2 of committed) {
      for (const listener of this.listeners) listener(this.options.host.sessionId, event2);
    }
    // N5 分型：端面进退的分类发布
    this.options.notifyHub?.publish("surface_changed", { sessionId: this.options.host.sessionId, type, surfaceId, ...(rest as Record<string, unknown>) });
  }
}
