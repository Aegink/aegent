/**
 * agent 进程协议（T9 / Q16）——跨进程接口只传可序列化值、不共享引用
 * （语言边界即进程边界的 wire 面）。
 *
 * 消息形状（stdio JSON 行协议：一行一条 JSON，`\n` 分隔）：
 *   父 → 子  AgentRequest ：prompt / cancel / revert / approve /
 *                           model/switch（J6）/ dispose
 *   子 → 父  AgentMessage ：ready / accepted / event / approval_requested /
 *                           approval_settled / reverted / idle / error
 *
 * `idle`（T-8-01）：子进程在"无在途轮且队列空"时宣告——CLI 的管道 EOF
 * 语义（"输入完毕，处理完剩余工作再退"）据此等 idle 再 dispose，避免
 * EOF 即取消在途轮；/exit 的立即退出语义不走本信号。
 *
 * A9 在协议面的落法（dsh·followup-enqueue 同款纪律）：
 * - `prompt` 的应答只有 `accepted{messageId}` **入队收执**——子进程在
 *   "收到即应答"的意义上与 DSH 的 session/prompt 一致；
 * - 没有 `session.finished`、没有 per-prompt 结果消息；轮的终态由父进程
 *   像任何消费者一样**观察 turn/end 事件**。`accepted` 证明的是 inbox
 *   admission，不锚定"这条 prompt 的结果"。
 * - `revert`（E4 对话态回退）/ `approve`（C5 审批答复转达，N6 owner 通道
 *   的 CLI 面）同样只回 admission 语义：成功无专用应答——事实经事件流
 *   （session/revert 事件 / tool-result 后续）可见；失败（越界 / 迟到 /
 *   未知 id）经 `error` 行回传类型化 code。
 *
 * 可序列化验证分两层：包络变体（ready/accepted/error/approval_* 与全部
 * AgentRequest）用类型级 `Exclude<_, JsonValue>` 型证（本文件底部断言 +
 * 测试复刻）；`event` 载荷是 SessionEvent——它是**接口**联合，TS 无隐式
 * 索引签名、无法型证 assignable to JsonValue，其 JSON 安全由词汇表 C14
 * （append 时 assertJsonSafe 兜底拒绝）在源头保证，测试里另有运行时往返证明。
 */

import {
  type AssertNever,
  type CancelCause,
  type JsonRecord,
  type JsonValue,
  type SessionEvent,
} from "./events.js";

/** 父 → 子。 */
export type AgentRequest =
  | { type: "prompt"; messageId: string; content: string }
  | { type: "cancel"; cause: CancelCause }
  | { type: "revert"; targetSeq: number }
  | {
      type: "approve";
      requestId: string;
      action: "allow" | "deny";
      reason?: string;
      /** C24：批准作用域——session 由子进程答复路径落会话批准缓存。 */
      scope?: "once" | "session";
      /** C24：审批反馈，落 L2 审计记录。 */
      feedback?: string;
    }
  | {
      /** J6 运行时换模（T-P1-04）：立即受理，生效点在新 turn。identity
       * 用内联形状（wire 可序列化型证要求；结构等同 models/identity 的
       * ModelIdentity，消费方零转换）。 */
      type: "model/switch";
      identity: { provider: string; modelId: string };
    }
  | {
      /** B8b/T-P1-21 question 答复（协议分型——不复用 approve 消息名：
       * question 的"答复"不是"批准"）。answer 为空串 = 用户跳过。 */
      type: "question/answer";
      requestId: string;
      answer: string;
    }
  | { type: "dispose" };

/** 子 → 父。 */
export type AgentMessage =
  | { type: "ready" }
  | { type: "accepted"; messageId: string }
  | { type: "event"; event: SessionEvent }
  | {
      type: "approval_requested";
      requestId: string;
      tool: string;
      args: JsonRecord;
      timeoutMs: number;
    }
  | { type: "approval_settled"; requestId: string; allowed: boolean }
  | {
      /** B8b/T-P1-21：模型提问挂起（协议分型——工具名为 question 的
       * 审批宣告转成此消息，不经 approval_requested 面）。 */
      type: "question_asked";
      requestId: string;
      question: string;
      timeoutMs: number;
    }
  | { type: "reverted"; targetSeq: number; codeRestored: boolean }
  | { type: "idle" }
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

const REQUEST_TYPES = new Set([
  "prompt",
  "cancel",
  "revert",
  "approve",
  "model/switch",
  "question/answer",
  "dispose",
]);
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
  const req = raw as {
    type: string;
    messageId?: unknown;
    content?: unknown;
    cause?: unknown;
    targetSeq?: unknown;
    requestId?: unknown;
    action?: unknown;
    reason?: unknown;
    scope?: unknown;
    feedback?: unknown;
    identity?: unknown;
    answer?: unknown;
  };
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
  if (req.type === "revert") {
    if (typeof req.targetSeq !== "number" || !Number.isInteger(req.targetSeq) || req.targetSeq < 0) {
      throw new ProtocolError("PROTOCOL_MALFORMED", "revert 需要非负整数 targetSeq");
    }
    return { type: "revert", targetSeq: req.targetSeq };
  }
  if (req.type === "approve") {
    if (typeof req.requestId !== "string" || req.requestId === "") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "approve 需要 requestId 字符串");
    }
    if (req.action !== "allow" && req.action !== "deny") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "approve 的 action 只能是 allow 或 deny");
    }
    if (req.reason !== undefined && typeof req.reason !== "string") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "approve 的 reason 必须是字符串");
    }
    if (req.scope !== undefined && req.scope !== "once" && req.scope !== "session") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "approve 的 scope 只能是 once 或 session");
    }
    if (req.feedback !== undefined && typeof req.feedback !== "string") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "approve 的 feedback 必须是字符串");
    }
    return {
      type: "approve",
      requestId: req.requestId,
      action: req.action,
      ...(typeof req.reason === "string" ? { reason: req.reason } : {}),
      ...(req.scope !== undefined ? { scope: req.scope } : {}),
      ...(typeof req.feedback === "string" ? { feedback: req.feedback } : {}),
    };
  }
  if (req.type === "model/switch") {
    // J6：identity 的 provider/modelId 必须是非空字符串（J4 的 modelIdentity
    // 同款校验——wire 面的重复校验是特性，子进程把 stdin 当不可信输入）。
    const identity = req.identity as
      | { provider?: unknown; modelId?: unknown }
      | null
      | undefined;
    if (
      typeof identity !== "object" ||
      identity === null ||
      typeof identity.provider !== "string" ||
      identity.provider === "" ||
      typeof identity.modelId !== "string" ||
      identity.modelId === ""
    ) {
      throw new ProtocolError(
        "PROTOCOL_MALFORMED",
        "model/switch 需要 identity（provider/modelId 均为非空字符串）",
      );
    }
    return {
      type: "model/switch",
      identity: { provider: identity.provider, modelId: identity.modelId },
    };
  }
  if (req.type === "question/answer") {
    // B8b：答复分型——answer 允许空串（用户跳过），requestId 必须非空
    if (typeof req.requestId !== "string" || req.requestId === "") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "question/answer 需要 requestId 字符串");
    }
    if (typeof req.answer !== "string") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "question/answer 需要 answer 字符串（可为空串）");
    }
    return { type: "question/answer", requestId: req.requestId, answer: req.answer };
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
  const msg = raw as {
    type: string;
    messageId?: unknown;
    event?: unknown;
    code?: unknown;
    message?: unknown;
    requestId?: unknown;
    tool?: unknown;
    args?: unknown;
    timeoutMs?: unknown;
    allowed?: unknown;
    targetSeq?: unknown;
    codeRestored?: unknown;
    question?: unknown;
  };
  switch (msg.type) {
    case "ready":
      return { type: "ready" };
    case "idle":
      return { type: "idle" };
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
    case "approval_requested": {
      if (typeof msg.requestId !== "string" || msg.requestId === "") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "approval_requested 需要 requestId");
      }
      if (typeof msg.tool !== "string") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "approval_requested 需要 tool");
      }
      if (
        typeof msg.args !== "object" ||
        msg.args === null ||
        Array.isArray(msg.args)
      ) {
        throw new ProtocolError("PROTOCOL_MALFORMED", "approval_requested 需要 args 对象");
      }
      if (typeof msg.timeoutMs !== "number") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "approval_requested 需要 timeoutMs");
      }
      return {
        type: "approval_requested",
        requestId: msg.requestId,
        tool: msg.tool,
        args: msg.args as JsonRecord,
        timeoutMs: msg.timeoutMs,
      };
    }
    case "approval_settled": {
      if (typeof msg.requestId !== "string" || msg.requestId === "") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "approval_settled 需要 requestId");
      }
      if (typeof msg.allowed !== "boolean") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "approval_settled 需要 allowed 布尔");
      }
      return { type: "approval_settled", requestId: msg.requestId, allowed: msg.allowed };
    }
    case "question_asked": {
      // B8b：模型提问挂起（协议分型消息面）
      if (typeof msg.requestId !== "string" || msg.requestId === "") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "question_asked 需要 requestId");
      }
      if (typeof msg.question !== "string" || msg.question === "") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "question_asked 需要 question 非空字符串");
      }
      if (typeof msg.timeoutMs !== "number") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "question_asked 需要 timeoutMs");
      }
      return {
        type: "question_asked",
        requestId: msg.requestId,
        question: msg.question,
        timeoutMs: msg.timeoutMs,
      };
    }
    case "reverted": {
      // revert 完成回执（E11：对话态 + 代码态双回退后发出；失败走 error 行）
      if (typeof msg.targetSeq !== "number" || !Number.isInteger(msg.targetSeq) || msg.targetSeq < 0) {
        throw new ProtocolError("PROTOCOL_MALFORMED", "reverted 需要非负整数 targetSeq");
      }
      if (typeof msg.codeRestored !== "boolean") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "reverted 需要 codeRestored 布尔");
      }
      return { type: "reverted", targetSeq: msg.targetSeq, codeRestored: msg.codeRestored };
    }
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
