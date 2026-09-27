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
  | {
      /** E5/T-P1-40 fork 分支会话：源 = 本子进程当前会话（不传——wire 面
       * 无需回显），target 是新会话 id。position/atSeq 语义见
       * SessionStore.fork（缺省 after + 最新）。 */
      type: "session/fork";
      targetId: string;
      position?: "before" | "after";
      atSeq?: number;
    }
  | {
      /** A10/T-P1-47 steer（重定向在途轮，pi-desktop·active-turn-steering
       * 的 additive agent/steer 同构）：expectedTurn 必填——目标不是当前
       * 活动轮时类型化拒绝（TURN_NOT_ACTIVE，AGENT_BUSY 同构），不武装
       * 队列。steer 与 follow-up（prompt）分通道：prompt idle 时开新轮、
       * busy 时排队；steer 只对在途轮，受理后入同一 PromptQueue、由
       * step 边界消费（A11：下一次模型请求才见它）。受理无专用回执
       * （revert/approve 同款——事实经 user/message 落流可见，A9 纪律）。
       */
      type: "steer";
      expectedTurn: number;
      content: string;
    }
  | {
      /** B21/T-P1-63 会话配置热刷新：patch 只允许白名单键（REFRESHABLE_
       * CONFIG_KEYS）——静态设置出现在载荷 → 子进程侧类型化拒绝（整包
       * 不应用）；白名单键逐键应用并回执 applied。 */
      type: "config/refresh";
      patch: JsonRecord;
    }
  | {
      /** C19/T-P1-75 策略 dry-run：跑完整判定链而不执行工具——裁决经
       * policy_verdict 回执返回（**不落事件流**：dry-run 不是状态变更，
       * 落流会在历史里留下从未发生过的裁决）。args 为剥提案前的原始
       * 参数（C48 剥除是求值管道的一部分）。 */
      type: "policy/check";
      tool: string;
      args: JsonRecord;
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
  | { type: "reverted"; targetSeq: number; codeRestored: boolean }
  | {
      /** A8/T-P1-52：取消后未消费输入退回（"退回输入框"）——轮以 aborted
       * 终止且队列非空时，队列中尚未进入模型历史的 prompt 全量退给父进程
       * 回显（pi-desktop·Stop "retains accepted input as history without
       * independently replaying it" 同构；不丢也不自动执行）。 */
      type: "prompt_returned";
      contents: string[];
    }
  | {
      /** E5/T-P1-40：fork 成功回执——新会话 id 与切点（lineage 标记已落
       * 子流头部）。新会话的后续对话由新进程/新装配打开，本连接不动。 */
      type: "forked";
      sessionId: string;
      cutSeq: number;
      eventCount: number;
    }
  | {
      /** B21/T-P1-63：热刷新回执——applied = 本次应用的白名单键。 */
      type: "config_refreshed";
      applied: string[];
    }
  | {
      /** C19/T-P1-75：dry-run 裁决回执——action/reason/rule 是整链终裁
       * 证据（C18 同源）；ask/abstain 一律回 "ask"（dry-run 不进 broker，
       * 询问即"需审批"判定）。 */
      type: "policy_verdict";
      tool: string;
      args: JsonRecord;
      action: "allow" | "ask" | "deny";
      reason: string;
      rule?: string;
    }
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
  "session/fork",
  "steer",
  "config/refresh",
  "policy/check",
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
    patch?: unknown;
    targetId?: unknown;
    position?: unknown;
    atSeq?: unknown;
    expectedTurn?: unknown;
    tool?: unknown;
    args?: unknown;
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
  if (req.type === "session/fork") {
    // E5/T-P1-40：targetId 非空必填；position 闭集；atSeq 正整数可缺省
    // （越界等语义错误在 store.fork 里类型化拒绝——wire 面只做形状校验）。
    if (typeof req.targetId !== "string" || req.targetId === "") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "session/fork 需要 targetId 非空字符串");
    }
    if (req.position !== undefined && req.position !== "before" && req.position !== "after") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "session/fork 的 position 只接受 before|after");
    }
    if (req.atSeq !== undefined && (typeof req.atSeq !== "number" || !Number.isInteger(req.atSeq) || req.atSeq < 1)) {
      throw new ProtocolError("PROTOCOL_MALFORMED", "session/fork 的 atSeq 必须是正整数");
    }
    const atSeq: number | undefined = typeof req.atSeq === "number" ? req.atSeq : undefined;
    return {
      type: "session/fork",
      targetId: req.targetId,
      ...(req.position !== undefined ? { position: req.position } : {}),
      ...(atSeq !== undefined ? { atSeq } : {}),
    };
  }
  if (req.type === "config/refresh") {
    // B21/T-P1-63：patch 必须是 JSON 对象（键值校验在 SessionConfigStore
    // ——白名单外键类型化拒绝、fail-closed 整包不应用）。
    const patch = req.patch;
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      throw new ProtocolError("PROTOCOL_MALFORMED", "config/refresh 需要 patch 对象");
    }
    return { type: "config/refresh", patch: patch as JsonRecord };
  }
  if (req.type === "policy/check") {
    // C19/T-P1-75：tool 非空 + args 必须是 JSON 对象（dry-run 输入形状；
    // 语义判定全在子进程求值管道）。
    if (typeof req.tool !== "string" || req.tool === "") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "policy/check 需要 tool 非空字符串");
    }
    if (typeof req.args !== "object" || req.args === null || Array.isArray(req.args)) {
      throw new ProtocolError("PROTOCOL_MALFORMED", "policy/check 需要 args 对象");
    }
    return { type: "policy/check", tool: req.tool, args: req.args as JsonRecord };
  }
  if (req.type === "steer") {
    // A10/T-P1-47：expectedTurn 正整数必填（轮号从 1 起）、content 非空；
    // 目标校验在 agent-process（对 loop.activeTurn 权威面）——wire 面只做形状。
    if (
      typeof req.expectedTurn !== "number" ||
      !Number.isInteger(req.expectedTurn) ||
      req.expectedTurn < 1
    ) {
      throw new ProtocolError("PROTOCOL_MALFORMED", "steer 需要 expectedTurn 正整数（目标轮号）");
    }
    if (typeof req.content !== "string" || req.content === "") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "steer 需要 content 非空字符串");
    }
    return { type: "steer", expectedTurn: req.expectedTurn, content: req.content };
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
    sessionId?: unknown;
    cutSeq?: unknown;
    eventCount?: unknown;
    applied?: unknown;
    contents?: unknown;
    action?: unknown;
    reason?: unknown;
    rule?: unknown;
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
    case "forked": {
      // fork 完成回执（E5/T-P1-40：新会话 id + 切点事实）
      if (typeof msg.sessionId !== "string" || msg.sessionId === "") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "forked 需要非空 sessionId");
      }
      if (typeof msg.cutSeq !== "number" || !Number.isInteger(msg.cutSeq) || msg.cutSeq < 0) {
        throw new ProtocolError("PROTOCOL_MALFORMED", "forked 需要非负整数 cutSeq");
      }
      if (typeof msg.eventCount !== "number" || !Number.isInteger(msg.eventCount) || msg.eventCount < 1) {
        throw new ProtocolError("PROTOCOL_MALFORMED", "forked 需要正整数 eventCount（lineage 标记至少 1 条）");
      }
      return { type: "forked", sessionId: msg.sessionId, cutSeq: msg.cutSeq, eventCount: msg.eventCount };
    }
    case "config_refreshed":
      if (!Array.isArray(msg.applied) || msg.applied.some((k) => typeof k !== "string")) {
        throw new ProtocolError("PROTOCOL_MALFORMED", "config_refreshed 需要 applied 字符串数组");
      }
      return { type: "config_refreshed", applied: msg.applied as string[] };
    case "policy_verdict": {
      // C19/T-P1-75：dry-run 裁决回执（tool 非空 + args 对象 + action 三值
      // 闭集 + reason 非空；rule 缺席 = 非规则来源的裁决，C18 同源语义）
      if (typeof msg.tool !== "string" || msg.tool === "") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "policy_verdict 需要 tool 非空字符串");
      }
      if (typeof msg.args !== "object" || msg.args === null || Array.isArray(msg.args)) {
        throw new ProtocolError("PROTOCOL_MALFORMED", "policy_verdict 需要 args 对象");
      }
      if (
        msg.action !== "allow" &&
        msg.action !== "ask" &&
        msg.action !== "deny"
      ) {
        throw new ProtocolError("PROTOCOL_MALFORMED", "policy_verdict 需要 allow/ask/deny 之一");
      }
      if (typeof msg.reason !== "string" || msg.reason === "") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "policy_verdict 需要 reason 非空字符串");
      }
      if (msg.rule !== undefined && typeof msg.rule !== "string") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "policy_verdict 的 rule 须为字符串");
      }
      return {
        type: "policy_verdict",
        tool: msg.tool,
        args: msg.args as JsonRecord,
        action: msg.action,
        reason: msg.reason,
        ...(typeof msg.rule === "string" ? { rule: msg.rule } : {}),
      };
    }
    case "prompt_returned": {
      // A8/T-P1-52：取消后未消费输入退回（可为空数组？不——发送方仅在
      // 队列非空时发；wire 面仍校验数组形状）
      if (!Array.isArray(msg.contents) || msg.contents.some((c) => typeof c !== "string")) {
        throw new ProtocolError("PROTOCOL_MALFORMED", "prompt_returned 需要字符串数组 contents");
      }
      return { type: "prompt_returned", contents: msg.contents as string[] };
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
