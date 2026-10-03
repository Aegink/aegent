/**
 * 端间协议层（K8/T-P1-115）——"内核协议自有 + ACP 适配"的自有协议半边
 * （ACP 映射是 K4/T-P1-117 的独立面）。形状取 pi·packages/protocol 的四件：
 * hello 版本握手（不匹配 → hello_error）、request/response 的 requestId
 * 关联、严格校验（未知属性拒绝 + 错误消息有界）、连接生命周期在协议之外
 * （"Server and worker lifecycle is intentionally outside this public
 * protocol"——本协议不管连接怎么建立）。
 *
 * **词汇复用 AgentRequest/AgentMessage**（内核协议自有——信封化而非第三套
 * 词汇，词汇单一来源是卡序头约束 2）；**JSON 行帧**（agent-protocol 同款
 * MAX_LINE_BYTES 防呆——不取 pi 的 CBOR/长度前缀帧：二进制传输优化无真实
 * 消费方，行协议 debug 可读，记档）；**sessionId 一级路由**（不取 pi 的
 * serverId/attachmentId 三级——单 host 进程内一级即达，YAGNI）。
 *
 * 协议语义（端视角）：
 * - 连接后先发 `{type:"hello", version}`，版本不符收 hello_error（唯一
 *   的服务端主动错误信封）；hello 前发 request → HELLO_REQUIRED 错误。
 * - `{type:"request", requestId, sessionId, call: AgentRequest}` → 按
 *   sessionId 路由；结果经 `{type:"response", requestId, ok, result|error}`
 *   返回（requestId 关联——并发请求不串线）。
 * - `{type:"event", sessionId, event}` 是 host → 端的推送通道（会话事件
 *   流的订阅面——所有连接可见，N2 审批广播消费）。
 * - 坏行（非 JSON/未知类型/未知属性/载荷形状错）→ error response **不崩
 *   连接**（pi ProtocolValidationError 语义的我方适配：信封级错误可回复，
 *   只有传输级故障才断连——断连在协议之外）。
 */

import {
  type AgentRequest,
  type AgentMessage,
} from "../kernel/agent-protocol.js";
import type { SessionEvent } from "../kernel/events.js";
import {
  bounded,
  parseClientEnvelope,
  salvageRequestId,
  type ClientEnvelope,
  type ProtocolErrorShape,
} from "./protocol-parse.js";
import type { SettingsCall } from "./protocol-settings.js";

export const PROTOCOL_VERSION = 1;


// ---------------------------------------------------------------------------
// host → 端信封
// ---------------------------------------------------------------------------

export type ServerEnvelope =
  | {
      type: "hello";
      version: typeof PROTOCOL_VERSION;
      /** K5/T-P1-128：本 host 的会话 id 回执（UI 连接后即可发起 query/请求
       * ——host 单会话模型的路由引导；批次 12 hello 身份字段先例的 server
       * 侧对称面）。缺省不发（协议层不感知 sessionId 时）。 */
      sessionId?: string;
    }
  | { type: "hello_error"; error: ProtocolErrorShape }
  | { type: "response"; requestId: string; ok: true; result?: unknown }
  | { type: "response"; requestId: string; ok: false; error: ProtocolErrorShape }
  | { type: "event"; sessionId: string; event: SessionEvent }
  /**
   * N2/T-P1-116 广播通道：审批挂起/结算、提问、退回输入等**非会话流事实**
   * （协议消息形状，非事件词汇表——批次 9 先例"协议面载荷扩展属协议消息
   * 形状"）。name = agent 协议消息 type；payload = 其消息体。
   */
  | { type: "notification"; sessionId: string; name: string; payload?: unknown };

// ---------------------------------------------------------------------------
// 会话路由（host 侧实现——K8 server 与 agent-child 编排的解耦面）
// ---------------------------------------------------------------------------

export interface SessionRouter {
  /**
   * 将 AgentRequest 路由到目标会话。resolve 值 = 回执载荷（如 accepted 的
   * messageId）；reject（Error 带 code 属性时用其 code）→ ok:false response。
   * from.surfaceId = 发送端身份（N2 写命令租约校验的归属面——匿名/未注册
   * 为 undefined）。
   */
  send(sessionId: string, request: AgentRequest, from?: { surfaceId?: string }): Promise<unknown>;
  /** 会话事件推送订阅（host → 全部连接的 event 通道）。 */
  onEvent(listener: (sessionId: string, event: SessionEvent) => void): () => void;
}

// ---------------------------------------------------------------------------
// 协议服务端（单连接一个实例——握手状态按连接隔离）
// ---------------------------------------------------------------------------

export interface HostProtocolServerOptions {
  /** 输出通道（host → 端的行写入口——传输层注入，协议不管字节怎么走）。 */
  write: (line: string) => void;
  /**
   * 连接身份（构造期给定——组合层注册 surface 时确定；hello 的 surfaceId
   * 字段只是校验回执，身份真源在此）。
   */
  surfaceId?: string;
  /** 协议错误留痕（坏行/校验拒绝——可观测面；缺省静默）。 */
  onProtocolError?: (error: Error) => void;
  /** hello 回执携带的本 host 会话 id（K5 路由引导——bridge 侧注入）。 */
  sessionId?: string;
  /**
   * hello 回调（N2 surface 注册面）：端身份（surfaceId/deliveryKind）由
   * 组合层（HostBridge）消费——协议层只解析与校验形状。
   */
  onHello?: (hello: { surfaceId?: string; deliveryKind?: "push" | "poll" }) => void;
  /**
   * lease 信封回调（N7 run 租约协议面——bridge 直答，不经 agent）。
   * reject → ok:false（LeaseBusy/NotLeaseHolder 等类型化 code）。
   */
  onLease?: (lease: { op: "acquire" | "release"; surfaceId: string }) => Promise<unknown>;
  /**
   * query 信封回调（K5/T-P1-128 恢复视图——bridge 直答只读，不经 agent）。
   * U3 起 op:"sessions" = 会话历史清单；op:"events" 放宽为任意会话只读；
   * U9/T-P3-108 起 op:"search" = 跨会话检索。reject（Error 带 code）→ ok:false。
   */
  onQuery?: (query: {
    sessionId: string;
    op: "events" | "sessions" | "search" | "files" | "meta" | "usage" | "review" | "file";
    afterSeq?: number;
    criteria?: { contentLike: string; limit?: number; offset?: number };
    path?: string;
  }) => Promise<unknown>;
  /**
   * settings 信封回调（U14/T-P3-103 host 面配置——bridge 直答，不经 agent、
   * 不落流；op 闭集与载荷形状在 protocol-settings.ts——U22/T-P3-125 拆分）。
   */
  onSettings?: (call: SettingsCall) => Promise<unknown>;
}

export class HostProtocolServer {
  private helloed = false;
  private closed = false;
  /** 本连接的 surface 身份（构造期给定；request 的 from 归属面）。 */
  private surfaceId: string | undefined;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly router: SessionRouter,
    private readonly options: HostProtocolServerOptions,
  ) {
    this.surfaceId = options.surfaceId;
    // 事件推送：会话事件 → 全部连接广播（N2 审批广播的面——"任何通道可答"
    // 的前提是任何通道都看得见挂起）。
    this.unsubscribe = router.onEvent((sessionId, event) => {
      this.write({
        type: "event",
        sessionId,
        event,
      });
    });
  }

  /** 喂入一行端 → host 消息（坏行 → error response，连接存活）。 */
  handleLine(line: string): void {
    if (this.closed) return;
    if (line.trim() === "") return;
    let envelope: ClientEnvelope;
    try {
      envelope = parseClientEnvelope(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.onProtocolError?.(error instanceof Error ? error : new Error(message));
      this.write({
        type: "response",
        requestId: salvageRequestId(line),
        ok: false,
        error: { code: "PROTOCOL_MALFORMED", message: bounded(message) },
      });
      return;
    }
    if (envelope.type === "hello") {
      if (envelope.version !== PROTOCOL_VERSION) {
        this.write({
          type: "hello_error",
          error: {
            code: "PROTOCOL_VERSION_MISMATCH",
            message: bounded(
              `协议版本不支持：端 ${envelope.version}，host ${PROTOCOL_VERSION}`,
            ),
          },
        });
        return;
      }
      this.helloed = true;
      this.write({
        type: "hello",
        version: PROTOCOL_VERSION,
        ...(this.options.sessionId !== undefined ? { sessionId: this.options.sessionId } : {}),
      });
      if (envelope.surfaceId !== undefined || envelope.deliveryKind !== undefined) {
        if (envelope.surfaceId !== undefined) this.surfaceId = envelope.surfaceId;
        this.options.onHello?.({
          ...(envelope.surfaceId !== undefined ? { surfaceId: envelope.surfaceId } : {}),
          ...(envelope.deliveryKind !== undefined
            ? { deliveryKind: envelope.deliveryKind as "push" | "poll" }
            : {}),
        });
      }
      return;
    }
    // request：握手前置（hello 才能发 request/lease）
    if (!this.helloed) {
      this.write({
        type: "response",
        requestId: envelope.type === "request" ? envelope.requestId : "(lease)",
        ok: false,
        error: { code: "HELLO_REQUIRED", message: bounded("先发 hello 握手再发 request") },
      });
      return;
    }
    if (envelope.type === "lease") {
      if (!this.helloed) {
        this.write({
          type: "response",
          requestId: "(lease)",
          ok: false,
          error: { code: "HELLO_REQUIRED", message: bounded("先发 hello 握手再发 lease") },
        });
        return;
      }
      if (!this.options.onLease) {
        this.write({
          type: "response",
          requestId: "(lease)",
          ok: false,
          error: { code: "LEASE_UNSUPPORTED", message: bounded("本连接未配置租约面") },
        });
        return;
      }
      void this.options
        .onLease(envelope)
        .then((result) => {
          this.write({
            type: "response",
            requestId: "(lease)",
            ok: true,
            ...(result !== undefined ? { result } : {}),
          });
        })
        .catch((error: unknown) => {
          const code =
            error instanceof Error &&
            typeof (error as unknown as { code?: unknown }).code === "string"
              ? (error as unknown as { code: string }).code
              : "LEASE_ERROR";
          const message = bounded(error instanceof Error ? error.message : String(error));
          this.write({
            type: "response",
            requestId: "(lease)",
            ok: false,
            error: { code, message },
          });
        });
      return;
    }
    if (envelope.type === "query") {
      if (!this.options.onQuery) {
        this.write({
          type: "response",
          requestId: envelope.requestId,
          ok: false,
          error: { code: "QUERY_UNSUPPORTED", message: bounded("本连接未配置查询面") },
        });
        return;
      }
      void this.options
        .onQuery(envelope)
        .then((result) => {
          this.write({
            type: "response",
            requestId: envelope.requestId,
            ok: true,
            ...(result !== undefined ? { result } : {}),
          });
        })
        .catch((error: unknown) => {
          const code =
            error instanceof Error &&
            typeof (error as unknown as { code?: unknown }).code === "string"
              ? (error as unknown as { code: string }).code
              : "QUERY_ERROR";
          const message = bounded(error instanceof Error ? error.message : String(error));
          this.write({
            type: "response",
            requestId: envelope.requestId,
            ok: false,
            error: { code, message },
          });
        });
      return;
    }
    if (envelope.type === "settings") {
      if (!this.options.onSettings) {
        this.write({
          type: "response",
          requestId: envelope.requestId,
          ok: false,
          error: { code: "SETTINGS_UNSUPPORTED", message: bounded("本连接未配置 settings 面") },
        });
        return;
      }
      void this.options
        .onSettings(envelope)
        .then((result) => {
          this.write({
            type: "response",
            requestId: envelope.requestId,
            ok: true,
            ...(result !== undefined ? { result } : {}),
          });
        })
        .catch((error: unknown) => {
          const code =
            error instanceof Error &&
            typeof (error as unknown as { code?: unknown }).code === "string"
              ? (error as unknown as { code: string }).code
              : "SETTINGS_ERROR";
          const message = bounded(error instanceof Error ? error.message : String(error));
          this.write({
            type: "response",
            requestId: envelope.requestId,
            ok: false,
            error: { code, message },
          });
        });
      return;
    }
    const { requestId, sessionId, call } = envelope;
    void this.router
      .send(sessionId, call, { ...(this.surfaceId !== undefined ? { surfaceId: this.surfaceId } : {}) })
      .then((result) => {
        this.write({
          type: "response",
          requestId,
          ok: true,
          ...(result !== undefined ? { result } : {}),
        });
      })
      .catch((error: unknown) => {
        const code =
          error instanceof Error &&
          typeof (error as unknown as { code?: unknown }).code === "string"
            ? (error as unknown as { code: string }).code
            : "ROUTER_ERROR";
        const message = bounded(error instanceof Error ? error.message : String(error));
        this.write({ type: "response", requestId, ok: false, error: { code, message } });
      });
  }

  /** 主动推送一条 host → 端事件（router 广播之外的显式入口）。 */
  pushEvent(sessionId: string, event: SessionEvent): void {
    this.write({ type: "event", sessionId, event });
  }

  /** N2 广播：审批/提问等非流内事实（name = agent 协议消息 type）。 */
  notify(sessionId: string, name: string, payload?: unknown): void {
    this.write({
      type: "notification",
      sessionId,
      name,
      ...(payload !== undefined ? { payload } : {}),
    });
  }

  /** 连接关闭：停止事件订阅（连接生命周期在协议之外——close 是传输面动作）。 */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
  }

  private write(envelope: ServerEnvelope): void {
    if (this.closed) return;
    const line = JSON.stringify(envelope);
    this.options.write(line);
  }
}

/** 协议行长度上限复用（agent-protocol 同款——帧纪律单一来源）。 */
export type { AgentMessage };
export { parseClientEnvelope, type ClientEnvelope } from "./protocol-parse.js";


/** AgentChannel（自 bridge.ts 搬入——行数纪律位）：agent 请求发送面与
 * 消息流（runAgentChildStdio 内存桥 / spawnAgentProcess.messages 消费端）。 */
export interface AgentChannel {
  /** 发一条请求到 agent（agent-protocol 父→子行协议的发送面）。 */
  send(request: import("../kernel/agent-protocol.js").AgentRequest): void;
  /** agent → 父的消息流（runAgentChildStdio 内存桥 / spawnAgentProcess.messages）。 */
  messages: AsyncIterable<import("../kernel/agent-protocol.js").AgentMessage>;
}
