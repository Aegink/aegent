/**
 * HostBridge（N2/T-P1-116）——端间协议与 agent 会话的编排面：把一个
 * agent 连接（AgentConnection 形状：spawnAgentProcess 产物或内存桥）、
 * 一个 AgentHost（租约/roster 面）与若干端连接（HostProtocolServer）合体。
 *
 * - **审批广播**：agent 协议消息 approval_requested/approval_settled/
 *   question_asked/prompt_returned 是"挂起"这类**非会话流事实**——经
 *   notification 信封广播给所有端连接（"任何通道可答"的前提是任何通道
 *   都看得见挂起——PendingApprovals 无端绑定的端面兑现）。
 * - **写命令租约校验**（N7/N3 贯穿）：prompt/steer/cancel/approve/
 *   question-answer 是写命令，必须来自已注册 surface 且当前持约——非持约
 *   → NotLeaseHolderError（response ok:false 贯穿）；匿名观察者（hello
 *   无 surfaceId）一律拒绝写命令。
 * - **roster 落流**（N8 贯穿）：surface 注册/断开 → surface/attach|detach
 *   经 store.append 落流（提供 store 时）+ notification 广播。
 * - 回执匹配（A9 纪律）：prompt 等 accepted（messageId 关联）；error 行
 *   拒绝最近未决 prompt（单会话 handleRequest 同步派发下的串行假设）；
 *   无专用回执的命令（approve/revert/…）发出即 resolve——事实经事件流
 *   可见，协议不锚定结果。
 */

import type { AgentMessage, AgentRequest } from "../kernel/agent-protocol.js";
import type { SessionEvent } from "../kernel/events.js";
import { NotLeaseHolderError } from "../session/owner-port.js";
import type { SessionStore } from "../session/store.js";
import { SqliteEventStorage } from "../session/db.js";
// U9/T-P3-108：op:"search" 的 Q2 消费面（已打开库上的条件检索）
import { querySessionsDb } from "../session/query.js";
// U10/T-P3-109：op:"files" 的 workspace 只读列举
import { listWorkspaceFiles } from "./files-list.js";
// U12/T-P3-111：op:"usage" 的聚合消费面（usage 视图 / 成本聚合 / 压缩统计）
import { ensureUsageView, usageBySession, usageByTurn } from "../obs/usage.js";
import { costRollup } from "../obs/cost.js";
import { compactionStats } from "../obs/compaction-stats.js";
import { AgentHost } from "./registry.js";
import {
  HostProtocolServer,
  type HostProtocolServerOptions,
  type SessionRouter,
} from "./protocol.js";
import type { DeliveryKind } from "./lease.js";
import { NotificationHub } from "./notify.js";

/** 写命令闭集（租约校验适用面——只读查询如 policy/check 不在此列）。 */
const WRITE_COMMANDS = new Set(["prompt", "steer", "cancel", "approve", "question/answer"]);

export interface AgentChannel {
  /** 发一条请求到 agent（agent-protocol 父→子行协议的发送面）。 */
  send(request: AgentRequest): void;
  /** agent → 父的消息流（runAgentChildStdio 内存桥 / spawnAgentProcess.messages）。 */
  messages: AsyncIterable<AgentMessage>;
}

export interface HostBridgeOptions {
  host: AgentHost;
  agent: AgentChannel;
  /** roster 事件的落流面（提供时 surface 注册/断开 append 进会话流）。 */
  store?: SessionStore;
  /** N5 分类通知面（提供时挂起/轮结算/端面变化按分型发布——既有
   * notification 广播零变化，分型是附加发布面）。 */
  notifyHub?: NotificationHub;
  /** U14/T-P3-103 settings 直答网关（提供时 settings 信封可用——host 面
   * 配置读写与凭据管理，不经 agent 不落流）。 */
  settingsGateway?: import("./settings-gateway.js").SettingsGateway;
  /**
   * U3/T-P3-105 会话清单库（SQLite 事件库本体——op:"sessions" 与
   * session-delete 的数据面；未提供 = 清单/删除类型化不可用。与 settings
   * 网关的 sessionDb 同一实例——生产 main 组装）。
   */
  sessionsLibrary?: SqliteEventStorage;
  /**
   * U10/T-P3-109：workspace 根（op:"files" 的扫描面）——生产 main 从
   * 最终 childArgs 的 --workspace 解析（与子进程同源）；缺省 = host 进程
   * cwd（子进程缺省语义同款）。
   */
  workspaceRoot?: string;
  /**
   * U12/T-P3-111：上下文窗口 token 数（op:"usage" 的占比分母）——生产
   * main 从最终 childArgs 的 --context-window 解析（缺省 200_000 与
   * agent-child 同源）。
   */
  contextWindow?: number;
}

interface SurfaceRegistration {
  surfaceId: string;
  server: HostProtocolServer;
  closeSurface: () => void;
}

export class HostBridge implements SessionRouter {
  private readonly listeners = new Set<(sessionId: string, event: SessionEvent) => void>();
  private readonly registrations = new Map<string, SurfaceRegistration>();
  /** 在途 prompt 的回执等待（messageId → resolve）。 */
  private readonly pendingPrompts = new Map<string, (value: unknown) => void>();
  /** 最近的在途 prompt（error 行的归属——单会话串行假设，卡内定形）。 */
  private lastPendingPromptId: string | undefined;
  /** U10/T-P3-109：ready 消息捕获的注册表清单（工具/技能——/ 补全来源）。 */
  private agentCapabilities: { tools: string[]; skills: { name: string; description: string }[] } | undefined;
  private readonly unconsumed: Promise<void>;

  constructor(private readonly options: HostBridgeOptions) {
    // agent 消息泵：event → 会话事件广播；审批/提问 → notification 广播。
    this.unconsumed = (async () => {
      for await (const message of options.agent.messages) {
        this.handleAgentMessage(message);
      }
    })();
    void this.unconsumed.catch(() => {}); // 泵异常不炸 host（agent 退出即静默结束）
  }

  private handleAgentMessage(message: AgentMessage): void {
    const sessionId = this.options.host.sessionId;
    // U10/T-P3-109：ready 携带的注册表清单（工具名 + 技能名单）——
    // / 补全的清单来源，经 query op:"meta" 曝光给端。
    if (message.type === "ready") {
      this.agentCapabilities = {
        tools: message.tools ?? [],
        skills: message.skills ?? [],
      };
      return;
    }
    if (message.type === "event") {
      for (const listener of this.listeners) listener(sessionId, message.event);
      // N5 分型：轮结算事实的分类发布（turn/end 是结算时点）
      if (message.event.type === "turn/end") {
        this.options.notifyHub?.publish("turn_settled", {
          sessionId,
          turn: message.event.turn,
          reason: message.event.reason,
        });
      }
      return;
    }
    if (message.type === "accepted") {
      const resolve = this.pendingPrompts.get(message.messageId);
      if (resolve !== undefined) {
        this.pendingPrompts.delete(message.messageId);
        if (this.lastPendingPromptId === message.messageId) this.lastPendingPromptId = undefined;
        resolve({ accepted: message.messageId });
      }
      return;
    }
    if (message.type === "error") {
      // error 行无关联 id（agent-protocol 连接级错误）——归属最近在途 prompt
      if (this.lastPendingPromptId !== undefined) {
        const id = this.lastPendingPromptId;
        const resolve = this.pendingPrompts.get(id);
        if (resolve !== undefined) {
          this.pendingPrompts.delete(id);
          this.lastPendingPromptId = undefined;
          // 类型化拒绝（N6 错误面）经同一通道回给端
          resolve({
            __bridgeError: { code: message.code, message: message.message },
          });
        }
      }
      return;
    }
    // 审批/提问/退回/空闲：非会话流事实 → notification 广播
    const { type: name, ...payload } = message as { type: string } & Record<string, unknown>;
    this.notifyAll(name, payload);
    // N5 分型：挂起类事实的分类发布（approval_requested/question_asked）
    if (name === "approval_requested" || name === "question_asked") {
      this.options.notifyHub?.publish("approval_pending", { sessionId, name, payload });
    }
  }

  /** 全端广播一条 notification 信封（agent 消息与 N5 hub 转发共用面）。 */
  notifyAll(name: string, payload: unknown): void {
    const sessionId = this.options.host.sessionId;
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
    if (sessionId !== this.options.host.sessionId) {
      const error = new Error(`会话 ${sessionId} 没有 host 注册`);
      (error as unknown as { code: string }).code = "UNKNOWN_HOST_SESSION";
      throw error;
    }
    if (WRITE_COMMANDS.has(request.type)) {
      // N7/N3 贯穿：写命令必须持约——发送端身份（from.surfaceId）就是
      // 当前租约持有者；匿名观察者 / 未持约 surface 一律拒绝。
      const holder = this.options.host.surfaces.currentLeaseHolder();
      const surfaceId = from?.surfaceId;
      if (holder === undefined || surfaceId === undefined || holder !== surfaceId) {
        throw new NotLeaseHolderError(surfaceId ?? "(匿名连接)");
      }
    }
    if (request.type === "prompt") {
      return new Promise((resolve) => {
        this.pendingPrompts.set(request.messageId, resolve);
        this.lastPendingPromptId = request.messageId;
        this.options.agent.send(request);
      });
    }
    this.options.agent.send(request);
    // A9 纪律：无专用回执的命令发出即受理——事实经事件流可见。
    return { sent: true };
  }

  onEvent(listener: (sessionId: string, event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // -- 端连接面 ------------------------------------------------------------

  /**
   * 注册一个端连接：surface 注册（租约候选 + roster attach 落流）+ 协议
   * server（hello 握手由 server 面、surface 由本层）。返回的 close 组合
   * server 关闭与 surface 断开（断线自动释放租约——N7）。
   */
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
    const serverOptions: HostProtocolServerOptions = {
      write: surfaceOptions.write,
      surfaceId,
      sessionId: this.options.host.sessionId,
      onHello: (hello) => {
        // hello 携带的身份与注册不符 = 编程错误（connectSurface 已注册）
        if (hello.surfaceId !== undefined && hello.surfaceId !== surfaceId) {
          throw new Error(`hello 身份 ${hello.surfaceId} 与注册面 ${surfaceId} 不符`);
        }
      },
      // N7 run 租约协议面：acquire/release 直答（不经 agent）；单 holder
      // 语义在 SurfaceHub（LeaseBusyError/NotLeaseHolderError 的 code 透传）。
      onLease: async (lease) => {
        if (lease.op === "acquire") {
          const acquired = this.options.host.surfaces.acquireRunLease(lease.surfaceId);
          return { held: true, surfaceId: acquired.ownerId };
        }
        const released = this.options.host.surfaces.releaseRunLease(lease.surfaceId);
        return { released };
      },
      // K5/T-P1-128 恢复视图（只读直答——不落流、不经 agent、不需要租约）。
      // U3/T-P3-105：op:"sessions" = 会话历史清单（SQLite 库在位才有数据）；
      // op:"events" 放宽为任意会话只读（历史查看入口——写命令仍限本会话）。
      onQuery: async (query) => {
        const store = this.options.store;
        if (store === undefined) {
          const error = new Error("host 未配置事件存储，查询面不可用");
          (error as unknown as { code: string }).code = "STORE_UNAVAILABLE";
          throw error;
        }
        if (query.op === "sessions") {
          const library = this.options.sessionsLibrary;
          if (library === undefined) {
            const error = new Error("host 未配置 SQLite 事件库，会话清单不可用");
            (error as unknown as { code: string }).code = "SESSIONS_UNAVAILABLE";
            throw error;
          }
          return { sessions: library.listSessionSummaries() };
        }
        // U9/T-P3-108：跨会话检索（Q2 消费面）——只回命中摘要行（sessionId/
        // seq/type/ts/excerpt），不回事件整值（payload 全量不出检索面）。
        if (query.op === "search") {
          const library = this.options.sessionsLibrary;
          if (library === undefined) {
            const error = new Error("host 未配置 SQLite 事件库，跨会话检索不可用");
            (error as unknown as { code: string }).code = "SESSIONS_UNAVAILABLE";
            throw error;
          }
          const criteria = query.criteria!;
          const result = querySessionsDb(library.db, {
            contentLike: criteria.contentLike,
            ...(criteria.limit !== undefined ? { limit: criteria.limit } : {}),
            ...(criteria.offset !== undefined ? { offset: criteria.offset } : {}),
          });
          return {
            rows: result.rows.map((r) => ({
              sessionId: r.sessionId,
              seq: r.seq,
              type: r.type,
              ts: r.ts,
              excerpt: r.excerpt ?? "",
            })),
            total: result.total,
            hasMore: result.hasMore,
          };
        }
        // U10/T-P3-109：workspace 只读文件列举（@ 补全数据面）+ 注册表
        // 清单（ready 捕获——/ 补全来源）。都是只读直答，不经 agent 不落流。
        if (query.op === "files") {
          const root = this.options.workspaceRoot ?? process.cwd();
          return listWorkspaceFiles(root);
        }
        if (query.op === "meta") {
          return {
            tools: this.agentCapabilities?.tools ?? [],
            skills: this.agentCapabilities?.skills ?? [],
          };
        }
        // U12/T-P3-111：用量与上下文可视化（聚合面消费端）——数据源单源：
        // token 全部来自事件库 usage_rollup（assistant/message 的 usage 落流
        // 投影）；成本 = costRollup × settings 计价（未配置 = 如实缺席）；
        // 压缩统计 = 会话流内 compaction 事件（store 投影）。
        if (query.op === "usage") {
          const library = this.options.sessionsLibrary;
          if (library === undefined) {
            const error = new Error("host 未配置 SQLite 事件库，用量面不可用");
            (error as unknown as { code: string }).code = "SESSIONS_UNAVAILABLE";
            throw error;
          }
          // 幂等建视图（本 host 是 usage_rollup 的首个生产消费方——IF NOT
          // EXISTS 语义见 obs/usage.ts，无迁移问题）
          ensureUsageView(library.db);
          const sessionId = this.options.host.sessionId;
          const turns = usageByTurn(library.db, sessionId);
          const lastUsage = turns.length > 0 ? turns[turns.length - 1] : undefined;
          const pricing =
            this.options.settingsGateway !== undefined
              ? ((await this.options.settingsGateway.get()).pricing ?? [])
              : [];
          const stream = this.options.store?.load(sessionId) ?? [];
          return {
            contextWindow: this.options.contextWindow,
            currentSession: {
              turns,
              contextTokens: lastUsage?.totalTokens,
              compaction: compactionStats(stream),
            },
            sessions: usageBySession(library.db),
            costs: costRollup(library.db, pricing),
          };
        }
        // 本会话：内存序读取（同步）：镜像 append 的直接产物——最新、无
        // write-behind 缓冲滞后（restore/readAll 只见已 flush 部分——E1
        // 纪律的读面选择）。U3：跨会话（历史查看入口）直接回源 SQLite 库
        // ——历史会话不在内存镜像；库未配置 = 空流（无历史可看）。
        if (query.sessionId !== this.options.host.sessionId) {
          if (this.options.sessionsLibrary === undefined) return { events: [] };
          const archived = this.options.sessionsLibrary.readAll(query.sessionId);
          const events =
            query.afterSeq !== undefined
              ? archived.filter((e) => e.seq > query.afterSeq!)
              : [...archived];
          return { events };
        }
        const all = store.load(query.sessionId);
        const events =
          query.afterSeq !== undefined ? all.filter((e) => e.seq > query.afterSeq!) : [...all];
        return { events };
      },
      // U14/T-P3-103 settings 直答（host 面配置——不经 agent 不落流）。
      onSettings: async (call) => {
        const gateway = this.options.settingsGateway;
        if (gateway === undefined) {
          const error = new Error("host 未配置 settings 面");
          (error as unknown as { code: string }).code = "SETTINGS_UNSUPPORTED";
          throw error;
        }
        if (call.op === "get") return { settings: await gateway.get() };
        if (call.op === "update") return { settings: await gateway.update(call.patch ?? {}) };
        if (call.op === "credentials-set") {
          return { masked: (await gateway.credentialsSet(call.provider!, call.key!)).masked };
        }
        if (call.op === "credentials-delete") {
          return { deleted: (await gateway.credentialsDelete(call.provider!)).deleted };
        }
        if (call.op === "probe") {
          return { health: await gateway.probeProvider(call.provider!) };
        }
        if (call.op === "session-delete") {
          return gateway.sessionDelete(call.sessionId!);
        }
        return { credentials: await gateway.credentialsList() };
      },
    };
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

  /** surface 数量（通知广播面）。 */
  get surfaceCount(): number {
    return this.registrations.size;
  }

  private emitRoster(event: { type: string; surfaceId: string; deliveryKind?: string; reason?: string }): void {
    // roster 落流（N8）：store 提供时 append（seq/ts 由 store 分配），
    // 并把已提交事件广播给所有端连接（event 通道）。
    const store = this.options.store;
    if (store === undefined) return;
    const { type, surfaceId, ...rest } = event;
    // 会话级元事件纪律：turn 落 0（l0-events §3.2——不要求轮上下文）。
    const committed = store.append(this.options.host.sessionId, [
      (type === "surface/attach"
        ? { type, turn: 0, surfaceId, ...(rest as { deliveryKind?: string }) }
        : { type, turn: 0, surfaceId, ...(rest as { reason?: string }) }) as never,
    ]);
    for (const event2 of committed) {
      for (const listener of this.listeners) listener(this.options.host.sessionId, event2);
    }
    // N5 分型：端面进退的分类发布
    this.options.notifyHub?.publish("surface_changed", {
      sessionId: this.options.host.sessionId,
      type,
      surfaceId,
      ...(rest as Record<string, unknown>),
    });
  }
}
