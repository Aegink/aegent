/**
 * agent 进程协议（T9 / Q16）——跨进程接口只传可序列化值、不共享引用
 * （语言边界即进程边界的 wire 面）。
 *
 * 消息形状（stdio JSON 行协议：一行一条 JSON，`\n` 分隔）：
 *   父 → 子  AgentRequest ：prompt / cancel / dispose
 *   子 → 父  AgentMessage ：ready / accepted / event / error
 *
 * A9 在协议面的落法（dsh·followup-enqueue 同款纪律）：
 * - `prompt` 的应答只有 `accepted{messageId}` **入队收执**——子进程在
 *   "收到即应答"的意义上与 DSH 的 session/prompt 一致；
 * - 没有 `session.finished`、没有 per-prompt 结果消息；轮的终态由父进程
 *   像任何消费者一样**观察 turn/end 事件**。`accepted` 证明的是 inbox
 *   admission，不锚定"这条 prompt 的结果"。
 *
 * 可序列化验证分两层：包络变体（ready/accepted/error 与全部 AgentRequest）
 * 用类型级 `Exclude<_, JsonValue>` 型证（本文件底部断言 + 测试复刻）；
 * `event` 载荷是 SessionEvent——它是**接口**联合，TS 无隐式索引签名、无法
 * 型证 assignable to JsonValue，其 JSON 安全由词汇表 C14（append 时
 * assertJsonSafe 兜底拒绝）在源头保证，测试里另有运行时往返证明。
 */

import {
  type AssertNever,
  type CancelCause,
  type JsonValue,
  type SessionEvent,
} from "./events.js";

/** 父 → 子。 */
export type AgentRequest =
  | { type: "prompt"; messageId: string; content: string }
  | { type: "cancel"; cause: CancelCause }
  | { type: "dispose" };

/** 子 → 父。 */
export type AgentMessage =
  | { type: "ready" }
  | { type: "accepted"; messageId: string }
  | { type: "event"; event: SessionEvent }
  | { type: "error"; code: string; message: string };

export class ProtocolError extends Error {
  constructor(
    readonly code: "PROTOCOL_MALFORMED" | "PROTOCOL_UNKNOWN_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

const REQUEST_TYPES = new Set(["prompt", "cancel", "dispose"]);
const CANCEL_KINDS = new Set(["user", "parent", "disposed", "hook", "legacy"]);

/** 单行 JSON 行数上限（防呆，不设复杂流控；超长即协议错误）。 */
export const MAX_LINE_BYTES = 4 * 1024 * 1024;

/**
 * 解析父进程发来的一行请求。外部输入一律校验（AGENTS.md §6）：类型、
 * 字段形状、取消原因的 kind 白名单——子进程把 stdin 当不可信输入。
 */
export function decodeRequest(line: string): AgentRequest {
  if (line.length > MAX_LINE_BYTES) {
    throw new ProtocolError("PROTOCOL_MALFORMED", `请求行超长（>${MAX_LINE_BYTES} 字节）`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new ProtocolError("PROTOCOL_MALFORMED", "不是合法 JSON");
  }
  if (typeof raw !== "object" || raw === null || typeof (raw as { type?: unknown }).type !== "string") {
    throw new ProtocolError("PROTOCOL_MALFORMED", "缺少 type 字段");
  }
  const req = raw as { type: string; messageId?: unknown; content?: unknown; cause?: unknown };
  if (!REQUEST_TYPES.has(req.type)) {
    throw new ProtocolError("PROTOCOL_UNKNOWN_REQUEST", `未知请求类型 ${req.type}`);
  }
  if (req.type === "prompt") {
    if (typeof req.messageId !== "string" || req.messageId === "") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "prompt 需要 messageId 字符串");
    }
    if (typeof req.content !== "string" || req.content === "") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "prompt 需要 content 非空字符串");
    }
    return { type: "prompt", messageId: req.messageId, content: req.content };
  }
  if (req.type === "cancel") {
    const cause = req.cause as { kind?: unknown; reason?: unknown; message?: unknown } | null;
    if (
      typeof cause !== "object" ||
      cause === null ||
      typeof cause.kind !== "string" ||
      !CANCEL_KINDS.has(cause.kind)
    ) {
      throw new ProtocolError("PROTOCOL_MALFORMED", "cancel 需要 CancelCause（kind 白名单）");
    }
    if (cause.kind === "hook" && (typeof cause.reason !== "object" || cause.reason === null)) {
      throw new ProtocolError("PROTOCOL_MALFORMED", "hook 取消需要结构化 reason");
    }
    return { type: "cancel", cause: cause as unknown as CancelCause };
  }
  return { type: "dispose" };
}

/** 子 → 父方向的行解析（父进程同样把子进程输出当不可信输入）。 */
export function decodeMessage(line: string): AgentMessage {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new ProtocolError("PROTOCOL_MALFORMED", "不是合法 JSON");
  }
  if (typeof raw !== "object" || raw === null || typeof (raw as { type?: unknown }).type !== "string") {
    throw new ProtocolError("PROTOCOL_MALFORMED", "缺少 type 字段");
  }
  const msg = raw as { type: string; messageId?: unknown; event?: unknown; code?: unknown; message?: unknown };
  switch (msg.type) {
    case "ready":
      return { type: "ready" };
    case "accepted":
      if (typeof msg.messageId !== "string") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "accepted 需要 messageId");
      }
      return { type: "accepted", messageId: msg.messageId };
    case "event":
      if (typeof msg.event !== "object" || msg.event === null || typeof (msg.event as { type?: unknown }).type !== "string") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "event 需要 SessionEvent 形状载荷");
      }
      return { type: "event", event: msg.event as SessionEvent };
    case "error":
      if (typeof msg.code !== "string" || typeof msg.message !== "string") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "error 需要 code 与 message");
      }
      return { type: "error", code: msg.code, message: msg.message };
    default:
      throw new ProtocolError("PROTOCOL_UNKNOWN_REQUEST", `未知消息类型 ${msg.type}`);
  }
}

// ---------------------------------------------------------------------------
// 类型级可序列化断言（验收②的型证面；event 载荷见文件头注释的分层说明）
// ---------------------------------------------------------------------------

/** AgentRequest 整体 ⊆ JsonValue。 */
const _REQUEST_IS_JSON: AssertNever<Exclude<AgentRequest, JsonValue>> = true;
/** AgentMessage 的包络变体（event 载荷除外，见头注释）⊆ JsonValue。 */
const _MESSAGE_ENVELOPE_IS_JSON: AssertNever<
  Exclude<Exclude<AgentMessage, { type: "event" }>, JsonValue>
> = true;
void _REQUEST_IS_JSON;
void _MESSAGE_ENVELOPE_IS_JSON;
