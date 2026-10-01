/**
 * HostBridge（N2/T-P1-116）——端间协议与 agent 会话的编排面：agent 连接 +
 * AgentHost（租约/roster）+ 端连接（HostProtocolServer）合体。
 * 审批/提问等非会话流事实经 notification 广播；写命令租约校验（N7/N3）；
 * roster 落流（N8）；回执匹配（A9——prompt accepted 关联，error 行归属最近
 * 未决 prompt，无回执命令发出即 resolve）。polish（T-P3-146 I）为带 requestId
 * 回执的旁路命令，pendingPolishes 关联。
 */

import type { AgentMessage, AgentRequest } from "../kernel/agent-protocol.js";
import type { SessionEvent } from "../kernel/events.js";
import { NotLeaseHolderError } from "../session/owner-port.js";
import type { SessionStore } from "../session/store.js";
import { SqliteEventStorage } from "../session/db.js";
// U9/U10/U12 查询面的 op 分流实现拆分至 query-gateway.ts（行数纪律拆分）
import { handleHostQuery } from "./query-gateway.js";
import { buildPolicyAuditEntries } from "./policy-audit-op.js";
import type { InstructionTarget } from "./protocol-settings.js";
import { AgentHost } from "./registry.js";
import {
  HostProtocolServer,
  type HostProtocolServerOptions,
  type SessionRouter,
} from "./protocol.js";
import type { DeliveryKind } from "./lease.js";
import { NotificationHub } from "./notify.js";

/** 写命令闭集（租约校验适用面——只读查询如 policy/check 不在此列）。 */
const WRITE_COMMANDS = new Set(["prompt", "steer", "cancel", "approve", "question/answer", "polish"]);

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
  /** N5 分类通知面（分型是附加发布面——既有 notification 广播零变化）。 */
  notifyHub?: NotificationHub;
  /** U14 settings 直答网关（host 面配置读写与凭据管理，不经 agent 不落流）。 */
  settingsGateway?: import("./settings-gateway.js").SettingsGateway;
  /** U3 会话清单库（op:"sessions" 与 session-delete 数据面；生产 main 组装）。 */
  sessionsLibrary?: SqliteEventStorage;
  /** U10：workspace 根（op:"files" 扫描面——与子进程 --workspace 同源）。 */
  workspaceRoot?: string;
  /** U12：上下文窗口 token 数（op:"usage" 占比分母，与子进程同源）。 */
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
  /** 在途 polish 的回执等待（requestId → resolve——T-P3-146 I 旁路调用面）。 */
  private readonly pendingPolishes = new Map<string, (value: unknown) => void>();
  /** U10/T-P3-109：ready 消息捕获的注册表清单（工具/技能——/ 补全来源）。 */
  private agentCapabilities: {
    tools: string[];
    skills: { name: string; description: string }[];
    prompts?: {
      name: string;
      description?: string;
      argumentHint?: string;
      source: "project" | "user" | "extra" | "builtin" | "mcp";
    }[];
  } | undefined;
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
    // T-P3-146 I：polish 旁路请求（写命令租约已过——回执经 polish_result）
    if (request.type === "polish") {
      return new Promise((resolve) => {
        this.pendingPolishes.set(request.requestId, resolve);
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
        if (call.op === "update") return { settings: await gateway.update(call.patch ?? {}) };
        if (call.op === "credentials-set") {
          return { masked: (await gateway.credentialsSet(call.provider!, call.key!)).masked };
        }
        if (call.op === "credentials-delete") {
          return { deleted: (await gateway.credentialsDelete(call.provider!)).deleted };
        }
        if (call.op === "probe") return { health: await gateway.probeProvider(call.provider!) };
        if (call.op === "session-delete") return gateway.sessionDelete(call.sessionId!);
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
        // U20/T-P3-122：配置包导入（UI 已确认——备份滚动 + 合并落盘）
        if (call.op === "import") return gateway.importSettings(call.settings!);
        if (call.op === "skills-list") return gateway.skillsList();
        if (call.op === "skill-save") return gateway.skillSave(call.skill!);
        // T-P3-144：技能导入扫描/执行 + 删除/Reveal（护栏与复制在域文件）
        if (call.op === "skill-import-scan") return gateway.skillImportScan();
        if (call.op === "skill-import-apply") return gateway.skillImportApply(call.items!);
        if (call.op === "skill-delete") return gateway.skillDelete(call.path!);
        if (call.op === "skill-reveal") return gateway.skillReveal(call.path!);
        // T-P3-146：提示词模板管理面（文件域 + 旧库迁移 + 外部导入）
        if (call.op === "prompts-list") return gateway.promptsList();
        if (call.op === "prompt-save") return gateway.promptSave(call.prompt!);
        if (call.op === "prompt-delete") return gateway.promptDelete(call.path!);
        if (call.op === "prompt-reveal") return gateway.promptReveal(call.path!);
        if (call.op === "prompt-import-scan") return gateway.promptImportScan();
        if (call.op === "prompt-import-apply") return gateway.promptImportApply(call.items!);
        // U23 子代理清单 / U24 指令中心（三文件位 + 白名单写回）
        if (call.op === "subagents-list") return gateway.subagentsList();
        if (call.op === "instructions-list") return gateway.instructionsList();
        if (call.op === "instruction-save") return gateway.instructionSave(call.target as InstructionTarget, call.content!);
        // U26：语音转写代理（UI 录音 → P4 STT → 文本回端）
        if (call.op === "stt-transcribe") return gateway.sttTranscribe({ base64: call.content!, mediaType: call.mediaType! });
        // T-P3-133 插件清单 / T-P3-137 供应商模型拉取与真实测试（host 代理）
        if (call.op === "plugins-list") return gateway.pluginsList();
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
