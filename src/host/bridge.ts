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
import { tryInstructionSettingsOp } from "./settings-instruction-ops.js";
import { tryPanelSettingsOp } from "./settings-panel-ops.js";
import { tryTransferSettingsOp } from "./settings-transfer-ops.js";
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
const WRITE_COMMANDS = new Set(["prompt", "steer", "cancel", "approve", "question/answer", "polish", "revert", "thinking/set"]);


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
  /** T-P3-170：懒派生的非主会话通道池（主会话通道在 options.agent——进程生命周期与 host 同步）。 */
  private readonly channels = new Map<string, AgentChannel>();
  /** U10 ready 捕获清单（工具/技能/prompts——/ 补全来源）。 */
  private agentCapabilities: import("./query-gateway.js").AgentCapabilities | undefined;
  private readonly unconsumed: Promise<void>;

  constructor(private readonly options: HostBridgeOptions) {
    // agent 消息泵：event → 会话事件广播；审批/提问 → notification 广播。
    // 主会话通道在此起泵；T-P3-170 池化通道的泵在 channelFor 懒派生时起。
    this.unconsumed = this.pumpSession(this.options.host.sessionId, options.agent)
      .catch(() => {})
      .finally(() => {
        // T-P3-147（走查实录）：主 agent 通道死亡后未决 prompt/polish 不类型化
        // 拒绝将永久挂起——child 死 = 后续请求必死，全部立即回执类型化失败。
        this.rejectPendingOf(this.options.host.sessionId);
        for (const resolve of this.pendingPolishes.values()) {
          resolve({ type: "polish_result", requestId: "", ok: false, error: "agent 进程已退出" });
        }
        this.pendingPolishes.clear();
      });
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

  /** 会话通道取用面：主会话走 options.agent（生命周期同步）；其余会话经
   *  agentFactory 懒派生并入池（child 崩溃即从池摘除——下次请求重派生，
   *  新 child 靠 --db 持久恢复历史）。 */
  private channelFor(sessionId: string): AgentChannel {
    if (sessionId === this.options.host.sessionId || this.options.agentFactory === undefined) {
      return this.options.agent;
    }
    let channel = this.channels.get(sessionId);
    if (channel === undefined) {
      channel = this.options.agentFactory(sessionId);
      this.channels.set(sessionId, channel);
      void this.pumpSession(sessionId, channel).catch(() => {}).finally(() => {
        this.rejectPendingOf(sessionId);
        this.channels.delete(sessionId);
      });
    }
    return channel;
  }

  /** T-P3-170：stop 收束面——杀掉全部池化 child（主 agent 由 server.stop 直杀）。 */
  async killAllChannels(): Promise<void> {
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
      // N7 run 租约协议面：acquire/release 直答（不经 agent；code 透传）。
      onLease: async (lease) => {
        if (lease.op === "acquire") {
          const acquired = this.options.host.surfaces.acquireRunLease(lease.surfaceId);
          return { held: true, surfaceId: acquired.ownerId };
        }
        const released = this.options.host.surfaces.releaseRunLease(lease.surfaceId);
        return { released };
      },
      // K5 恢复视图 + U3/U9/U10/U12 查询——实现拆分至 query-gateway.ts，
      // 本处只做依赖注入（capabilities 是活查询——ready 捕获在泵内）。
      onQuery: (query) =>
        handleHostQuery(
          {
            hostSessionId: () => this.options.host.sessionId,
            ...(this.options.store !== undefined ? { store: this.options.store } : {}),
            ...(this.options.sessionsLibrary !== undefined
              ? { sessionsLibrary: this.options.sessionsLibrary }
              : {}),
            ...(this.options.settingsGateway !== undefined
              ? { settingsGateway: this.options.settingsGateway }
              : {}),
            ...(this.options.workspaceRoot !== undefined
              ? { workspaceRoot: this.options.workspaceRoot }
              : {}),
            ...(this.options.contextWindow !== undefined
              ? { contextWindow: this.options.contextWindow }
              : {}),
            capabilities: () => this.agentCapabilities,
          },
          query,
        ),
      // U14/T-P3-103 settings 直答（host 面配置——不经 agent 不落流）。
      onSettings: async (call) => {
        const gateway = this.options.settingsGateway;
        if (gateway === undefined) {
          const error = new Error("host 未配置 settings 面");
          (error as unknown as { code: string }).code = "SETTINGS_UNSUPPORTED";
          throw error;
        }
        if (call.op === "policy-audit") {
          // 审批历史（八轮 E——store 在 bridge 手里故此拦截）
          const sessionId = this.options.host.sessionId;
          const store = this.options.store;
          const all = store === undefined ? [] : store.load(sessionId);
          return { entries: buildPolicyAuditEntries(all) };
        }
        // T-P3-140 自检 / T-P3-141 插件主题 CSS / T-P3-143 外部 MCP 扫描（只读）
        if (call.op === "sandbox-doctor") return gateway.sandboxDoctor();
        if (call.op === "plugin-theme-css") return gateway.pluginThemeCss(call.name!);
        if (call.op === "mcp-import-scan") return gateway.mcpImportScan();
        if (call.op === "get") return { settings: await gateway.get() };
        if (call.op === "credentials-set") {
          return { masked: (await gateway.credentialsSet(call.provider!, call.key!)).masked };
        }
        if (call.op === "credentials-delete") {
          return { deleted: (await gateway.credentialsDelete(call.provider!)).deleted };
        }
        if (call.op === "probe") return { health: await gateway.probeProvider(call.provider!) };
        // U17：MCP 连接校验（向导"测连接"——launch 一次握手+列工具）
        if (call.op === "mcp-check") {
          return {
            check: await gateway.mcpCheck({
              name: call.name!,
              command: call.command!,
              ...(Array.isArray(call.args) ? { args: call.args } : {}),
              ...(call.env !== undefined ? { env: call.env } : {}),
              ...(call.timeoutMs !== undefined ? { timeoutMs: call.timeoutMs } : {}),
            }),
          };
        }
        const transferOp = tryTransferSettingsOp(gateway, call, { store: this.options.store, sessionId: this.options.host.sessionId, ...(this.options.sessionsLibrary !== undefined ? { sessionsLibrary: this.options.sessionsLibrary } : {}) }); if (transferOp !== undefined) return transferOp; // T-P3-153/154：数据中心族+日志中心族一行收敛（logging fallback 在域文件内） // T-P3-153 数据中心族一行收敛（配置包/备份/会话导出/体检/会话删除——settings-transfer-ops；session-export 拦截在域文件——store 在 bridge 手里）
        if (call.op === "skills-list") return gateway.skillsList();
        if (call.op === "skill-save") return gateway.skillSave(call.skill!);
        // T-P3-144：技能导入扫描/执行 + 删除/Reveal（护栏与复制在域文件）
        if (call.op === "skill-import-scan") return gateway.skillImportScan();
        if (call.op === "skill-import-apply") return gateway.skillImportApply(call.items!);
        if (call.op === "skill-delete") return gateway.skillDelete(call.path!);
        if (call.op === "skill-reveal") return gateway.skillReveal(call.path!);
              if (call.op === "prompts-list") return gateway.promptsList();
        if (call.op === "prompt-save") return gateway.promptSave(call.prompt!);
        if (call.op === "prompt-delete") return gateway.promptDelete(call.path!);
        if (call.op === "prompt-reveal") return gateway.promptReveal(call.path!);
        if (call.op === "prompt-import-scan") return gateway.promptImportScan();
        if (call.op === "prompt-import-apply") return gateway.promptImportApply(call.items!);
        if (call.op === "enhancement-test") return gateway.enhancementTest(call.task as import("./settings-provider-ops.js").EnhancementTestTask);
        if (call.op === "subagents-list") return gateway.subagentsList();
        const instrOp = tryInstructionSettingsOp(gateway, call); // 指令域四 op 收敛（T-P3-151）
        if (instrOp !== undefined) return instrOp;
        if (call.op === "stt-transcribe") return gateway.sttTranscribe({ base64: call.content!, mediaType: call.mediaType! });
        if (call.op === "tts-synthesize") return gateway.ttsSynthesize({ text: call.text! });
        // T-P3-150 项目域八 op 一行收敛（分发面在 settings-project-ops）
        const projectOp = tryProjectSettingsOp(gateway, call);
        if (projectOp !== undefined) return projectOp;
        // T-P3-156 面板域（R/P/T：git 族/终端族/辅助对话历史）
        const panelOp = tryPanelSettingsOp(gateway, call);
        if (panelOp !== undefined) return panelOp;
        if (call.op === "plugins-list") return gateway.pluginsList();
        // T-P3-148：插件/市场族 op 一行收敛（分发在 settings-plugin-ops）
        const pluginOp = tryPluginSettingsOp(gateway, call, this.reloadNotifier());
        if (pluginOp !== undefined) return pluginOp;
        if (call.op === "provider-models" || call.op === "provider-test") {
          const payload = {
            provider: call.provider!,
            baseUrl: call.baseUrl!,
            adapter: call.adapter as "openai" | "openai-responses" | "anthropic" | "google",
            ...(call.headers !== undefined ? { headers: call.headers } : {}),
            ...(call.apiKey !== undefined ? { apiKey: call.apiKey } : {}),
          };
          if (call.op === "provider-models") return gateway.providerModels(payload);
          return gateway.providerTest({ ...payload, modelId: call.modelId! });
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

  // T-P3-148 热加载通知器（host 落盘插件后主动发；通道关闭静默——新会话兜底）。
  // T-P3-170：广播全部通道（主 + 池化——每个 child 的工具清单都要刷新）。
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
    this.options.notifyHub?.publish("surface_changed", { sessionId: this.options.host.sessionId, type, surfaceId, ...(rest as Record<string, unknown>) });
  }
}
