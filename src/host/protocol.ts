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
  MAX_LINE_BYTES,
  type AgentRequest,
  type AgentMessage,
} from "../kernel/agent-protocol.js";
import type { SessionEvent } from "../kernel/events.js";

export const PROTOCOL_VERSION = 1;

/** 错误消息有界（pi boundedErrorMessage 同款 500 字符截断）。 */
function bounded(message: string): string {
  return message.length <= 500 ? message : `${message.slice(0, 497)}...`;
}

export interface ProtocolErrorShape {
  readonly code: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// 端 → host 信封（严格校验：未知属性拒绝）
// ---------------------------------------------------------------------------

export type ClientEnvelope =
  | { type: "hello"; version: number }
  | { type: "request"; requestId: string; sessionId: string; call: AgentRequest };

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return `未知属性 "${key}"`;
  }
  return null;
}

/** 解析并严格校验一条端 → host 信封（坏信封抛 Error——调用方转 error 行）。 */
export function parseClientEnvelope(line: string): ClientEnvelope {
  if (line.length > MAX_LINE_BYTES) {
    throw new Error(`行超长（上限 ${MAX_LINE_BYTES} 字符）`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(`非 JSON 行：${bounded(error instanceof Error ? error.message : String(error))}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("信封必须是 JSON 对象");
  }
  const record = parsed as Record<string, unknown>;
  const type = record["type"];
  if (type === "hello") {
    const unknownKey = rejectUnknownKeys(record, ["type", "version"]);
    if (unknownKey) throw new Error(`hello 信封${unknownKey}`);
    if (typeof record["version"] !== "number" || !Number.isInteger(record["version"])) {
      throw new Error("hello 需要 version 整数");
    }
    return { type: "hello", version: record["version"] };
  }
  if (type === "request") {
    const unknownKey = rejectUnknownKeys(record, ["type", "requestId", "sessionId", "call"]);
    if (unknownKey) throw new Error(`request 信封${unknownKey}`);
    if (typeof record["requestId"] !== "string" || record["requestId"] === "") {
      throw new Error("request 需要 requestId 非空字符串");
    }
    if (typeof record["sessionId"] !== "string" || record["sessionId"] === "") {
      throw new Error("request 需要 sessionId 非空字符串");
    }
    if (record["call"] === null || typeof record["call"] !== "object" || Array.isArray(record["call"])) {
      throw new Error("request 需要 call 对象（AgentRequest）");
    }
    const call = record["call"] as Record<string, unknown>;
    if (typeof call["type"] !== "string" || call["type"] === "") {
      throw new Error("request.call 需要 type 字段");
    }
    return {
      type: "request",
      requestId: record["requestId"],
      sessionId: record["sessionId"],
      call: call as unknown as AgentRequest,
    };
  }
  throw new Error(`未知信封类型：${String(type)}`);
}

// ---------------------------------------------------------------------------
// host → 端信封
// ---------------------------------------------------------------------------

export type ServerEnvelope =
  | { type: "hello"; version: typeof PROTOCOL_VERSION }
  | { type: "hello_error"; error: ProtocolErrorShape }
  | { type: "response"; requestId: string; ok: true; result?: unknown }
  | { type: "response"; requestId: string; ok: false; error: ProtocolErrorShape }
  | { type: "event"; sessionId: string; event: SessionEvent };

// ---------------------------------------------------------------------------
// 会话路由（host 侧实现——K8 server 与 agent-child 编排的解耦面）
// ---------------------------------------------------------------------------

export interface SessionRouter {
  /**
   * 将 AgentRequest 路由到目标会话。resolve 值 = 回执载荷（如 accepted 的
   * messageId）；reject（Error 带 code 属性时用其 code）→ ok:false response。
   */
  send(sessionId: string, request: AgentRequest): Promise<unknown>;
  /** 会话事件推送订阅（host → 全部连接的 event 通道）。 */
  onEvent(listener: (sessionId: string, event: SessionEvent) => void): () => void;
}

// ---------------------------------------------------------------------------
// 协议服务端（单连接一个实例——握手状态按连接隔离）
// ---------------------------------------------------------------------------

export interface HostProtocolServerOptions {
  /** 输出通道（host → 端的行写入口——传输层注入，协议不管字节怎么走）。 */
  write: (line: string) => void;
  /** 协议错误留痕（坏行/校验拒绝——可观测面；缺省静默）。 */
  onProtocolError?: (error: Error) => void;
}

export class HostProtocolServer {
  private helloed = false;
  private closed = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly router: SessionRouter,
    private readonly options: HostProtocolServerOptions,
  ) {
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
        requestId: "(unparsed)",
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
      this.write({ type: "hello", version: PROTOCOL_VERSION });
      return;
    }
    // request：握手前置（hello 才能发 request）
    if (!this.helloed) {
      this.write({
        type: "response",
        requestId: envelope.requestId,
        ok: false,
        error: { code: "HELLO_REQUIRED", message: bounded("先发 hello 握手再发 request") },
      });
      return;
    }
    const { requestId, sessionId, call } = envelope;
    void this.router
      .send(sessionId, call)
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

  /** 主动推送一条 host → 端消息（event 通道之外的扩展位——缺省不用）。 */
  pushEvent(sessionId: string, event: SessionEvent): void {
    this.write({ type: "event", sessionId, event });
  }

  /** 连接关闭：停止事件订阅（连接生命周期在协议之外——close 是传输面动作）。 */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
  }

  private write(envelope: ServerEnvelope): void {
    if (this.closed) return;
    this.options.write(JSON.stringify(envelope));
  }
}

/** 协议行长度上限复用（agent-protocol 同款——帧纪律单一来源）。 */
export type { AgentMessage };
