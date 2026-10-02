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
  type SessionRef,
} from "./events.js";
import type { IncomingAttachment } from "../attachments/types.js";
import { validateSessionRefs } from "../session/reference.js";

/** 父 → 子。 */
export type AgentRequest =
  | {
      /** P2/T-P1-125：卸载最老图片出现的触发命令（批次 14 UI 消费；A9——无回执，事实经 image/offload 事件可见）。 */
      type: "offload";
      count: number;
    }
  | {
      type: "prompt";
      messageId: string;
      content: string;
      /**
       * 随消息附上的附件（P1/T-P1-124——wire 形状扩展，批次 9 先例：
       * wire 形状非事件词汇表）。base64 字节随 wire 传子进程，编排面
       * 校验限额并落 store 后以 ref 落流。可选——无附件零变化。
       */
      attachments?: IncomingAttachment[];
      /**
       * 本条消息引用的其他会话（E9/T-P2-107——wire 形状扩展，附件先例：
       * wire 形状非事件词汇表）。编排面校验形状/限额/引用环后随
       * user/message 落流（**流存引用不存内容**）。可选——无引用零变化。
       */
      sessionRefs?: SessionRef[];
    }
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
      /** C52/T-P1-79：修改后的执行参数（仅 allow 携带；子进程 gate 侧重跑
       * 出口族硬拦）。deny 携带 → 子进程类型化拒绝。 */
      modifiedInput?: JsonRecord;
      /** C6/T-P1-82：答复端标识（跨端回转审计面——多端 host N7 的 wire
       * 就绪位；P0 CLI 缺省不带）。 */
      source?: string;
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
      /** T-P3-148 热加载：host 在 settings plugins 段落盘（安装/启停/卸载/
       * 市场装卸）后主动通知子进程 diff 重装载插件——工具注销/重注册、
       * 贡献盒回填、MCP 连接重连，完成后重发 ready（工具/技能/命令清单
       * 一次刷新）。无载荷 fire-and-forget；失败走 error 行。 */
      type: "plugins/reload";
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
  | {
      /** M3/T-P1-86 崩溃续跑（显式动作）：对账（幂等）→ 定位最新 interrupted
       * 轮 → 以原输入开新轮。busy / 无可续跑轮 → 类型化 error 行。 */
      type: "session/resume";
    }
  | {
      /** L7/T-P1-95 命令生命周期记录（log-only 落流，无回执——fire-and-forget
       * 记录面）：name/args 由 CLI 命令解析器自报。 */
      type: "command/run";
      commandId: string;
      name: string;
      args?: string;
    }
  | {
      type: "command/done";
      commandId: string;
      kind: "success" | "error";
      text?: string;
    }
  | {
      /** S5/T-P2-404 用户反馈（log-only 落流——feedback/note，turn=0）：
       * kind 闭集 + targetSeq/commandId 二选一；seq 存在性在子进程侧校验
       * （流是唯一真相）。 */
      type: "feedback";
      kind: "up" | "down";
      targetSeq?: number;
      commandId?: string;
      comment?: string;
      doctorSummary?: string;
    }
  | {
      /**
       * T-P3-146 I 一键润色（C19 policy/check → policy_verdict 回执对同构
       * 的旁路调用面）：一次 LLM 调用把草稿润色为更优表达——不经会话流
       * 不开轮；结果经 polish_result 回执（requestId 关联）。draft 非空串。
       */
      type: "polish";
      requestId: string;
      draft: string;
    }
  | { type: "dispose" };

/**
 * 副调用 usage 投影（T-P3-147 F——TokenUsage 的 wire 形状；type 别名而非
 * interface：TS 无隐式索引签名，wire 层可序列化型证要求，SessionRef 先例）。
 */
export type PolishUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
};

/** 子 → 父。 */
export type AgentMessage =
  | {
      type: "ready";
      /** U10/T-P3-109：注册表工具名清单（/ 补全的清单来源——registry 所有者是子进程）。 */
      tools?: string[];
      /** U10/T-P3-109：I2 技能清单（name/description——补全面提示用）。 */
      skills?: { name: string; description: string }[];
      /**
       * T-P3-146：提示词模板目录（/ 补全与设置页只读区共用数据面）——
       * name/description/argumentHint + source 闭集（project|user|extra|
       * builtin|mcp）。文件模板在此是启动快照（展开面另行新鲜扫描）；
       * mcp 条目来自 live 连接。
       */
      prompts?: {
        name: string;
        description?: string;
        argumentHint?: string;
        source: "project" | "user" | "extra" | "builtin" | "mcp";
      }[];
    }
  | { type: "accepted"; messageId: string }
  | { type: "event"; event: SessionEvent }
  | {
      type: "approval_requested";
      requestId: string;
      tool: string;
      args: JsonRecord;
      timeoutMs: number;
      /** C54/T-P1-78：审批来源分类（tool/question/task/elicitation/
       * hook-review 闭集）——UI 按类呈现、配置按类开关。 */
      category: string;
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
  | {
      /** M3/T-P1-86：续跑受理回执——fromTurn 是被续跑的崩溃轮号；新轮
       * 以原输入重开（事实经 user/message/turn/start 落流可见）。 */
      type: "resumed";
      fromTurn: number;
    }
  | {
      /** T-P3-146 I：润色回执（polish 请求的关联应答——text 为润色后草稿；
       * 失败 = ok:false + error 消息，UI 侧 toast 不落流）。usage/ms 为
       * T-P3-147 F 观测面（usage 页按任务分账的回执透传位）。
       */
      type: "polish_result";
      requestId: string;
      ok: boolean;
      text?: string;
      error?: string;
      usage?: PolishUsage;
      ms?: number;
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
  "session/resume",
  "command/run",
  "command/done",
  "feedback",
  "steer",
  "config/refresh",
  "plugins/reload",
  "policy/check",
  "polish",
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
    count?: unknown;
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
    commandId?: unknown;
    name?: unknown;
    kind?: unknown;
    text?: unknown;
    comment?: unknown;
    doctorSummary?: unknown;
    tool?: unknown;
    args?: unknown;
    modifiedInput?: unknown;
    source?: unknown;
    draft?: unknown;
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
    // P1/T-P1-124：附件可选字段校验（wire 面 T6——畸形形状类型化拒绝）
    const rawAttachments = (req as { attachments?: unknown }).attachments;
    if (rawAttachments !== undefined) {
      if (!Array.isArray(rawAttachments)) {
        throw new ProtocolError("PROTOCOL_MALFORMED", "prompt.attachments 必须是数组");
      }
      for (const att of rawAttachments as Record<string, unknown>[]) {
        if (att === null || typeof att !== "object") {
          throw new ProtocolError("PROTOCOL_MALFORMED", "prompt.attachments 成员必须是对象");
        }
        if (typeof att["mediaType"] !== "string" || att["mediaType"] === "") {
          throw new ProtocolError("PROTOCOL_MALFORMED", "prompt.attachments 成员需要 mediaType 非空字符串");
        }
        if (typeof att["data"] !== "string" || att["data"] === "") {
          throw new ProtocolError("PROTOCOL_MALFORMED", "prompt.attachments 成员需要 data 非空字符串（base64）");
        }
        if (att["name"] !== undefined && typeof att["name"] !== "string") {
          throw new ProtocolError("PROTOCOL_MALFORMED", "prompt.attachments 成员的 name 需要字符串");
        }
      }
    }
    const parsedAttachments = (rawAttachments as Record<string, unknown>[] | undefined)?.map(
      (att) => ({
        mediaType: att["mediaType"] as string,
        data: att["data"] as string,
        ...(att["name"] !== undefined ? { name: att["name"] as string } : {}),
      }),
    );
    // E9/T-P2-107：会话引用可选字段校验（wire 面 T6——形状/上限 fail-closed；
    // 环检测在编排面做（需要会话流——wire 层无 store））
    const rawRefs = (req as { sessionRefs?: unknown }).sessionRefs;
    let parsedRefs: SessionRef[] | undefined;
    if (rawRefs !== undefined) {
      try {
        parsedRefs = validateSessionRefs(rawRefs);
      } catch (error) {
        throw new ProtocolError(
          "PROTOCOL_MALFORMED",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    return {
      type: "prompt",
      messageId: req.messageId,
      content: req.content,
      // 空数组剥掉键（无附件语义与缺省一致——queue/wire 零差异）
      ...(parsedAttachments !== undefined && parsedAttachments.length > 0
        ? { attachments: parsedAttachments }
        : {}),
      ...(parsedRefs !== undefined && parsedRefs.length > 0 ? { sessionRefs: parsedRefs } : {}),
    };
  }
  if (req.type === "offload") {
    if (typeof req.count !== "number" || !Number.isInteger(req.count) || req.count < 1) {
      throw new ProtocolError("PROTOCOL_MALFORMED", "offload.count 需要正整数");
    }
    return { type: "offload", count: req.count };
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
    // C52：modifiedInput 可选，出现时必须是 JSON 对象（deny 携带的语义
    // 校验在子进程 pending.reply——类型化 APPROVAL_REPLY_MALFORMED）
    if (
      req.modifiedInput !== undefined &&
      (typeof req.modifiedInput !== "object" || req.modifiedInput === null || Array.isArray(req.modifiedInput))
    ) {
      throw new ProtocolError("PROTOCOL_MALFORMED", "approve 的 modifiedInput 必须是对象");
    }
    return {
      type: "approve",
      requestId: req.requestId,
      action: req.action,
      ...(typeof req.reason === "string" ? { reason: req.reason } : {}),
      ...(req.scope !== undefined ? { scope: req.scope } : {}),
      ...(typeof req.feedback === "string" ? { feedback: req.feedback } : {}),
      ...(req.modifiedInput !== undefined
        ? { modifiedInput: req.modifiedInput as JsonRecord }
        : {}),
      ...(typeof req.source === "string" ? { source: req.source } : {}),
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
  if (req.type === "command/run") {
    // L7/T-P1-95：命令调用记录（wire 面形状校验，语义在 CLI 命令域）
    if (typeof req.commandId !== "string" || req.commandId === "") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "command/run 需要 commandId 非空字符串");
    }
    if (typeof req.name !== "string" || req.name === "") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "command/run 需要 name 非空字符串");
    }
    if (req.args !== undefined && typeof req.args !== "string") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "command/run 的 args 须为字符串");
    }
    return {
      type: "command/run",
      commandId: req.commandId,
      name: req.name,
      ...(req.args !== undefined ? { args: req.args } : {}),
    };
  }
  if (req.type === "command/done") {
    if (typeof req.commandId !== "string" || req.commandId === "") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "command/done 需要 commandId 非空字符串");
    }
    if (req.kind !== "success" && req.kind !== "error") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "command/done 的 kind 只接受 success|error");
    }
    if (req.text !== undefined && typeof req.text !== "string") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "command/done 的 text 须为字符串");
    }
    return {
      type: "command/done",
      commandId: req.commandId,
      kind: req.kind,
      ...(req.text !== undefined ? { text: req.text } : {}),
    };
  }
  if (req.type === "session/resume") {
    // M3/T-P1-86：无载荷——目标轮由子进程按流定位（最新 interrupted 轮）。
    return { type: "session/resume" };
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
  if (req.type === "plugins/reload") {
    return { type: "plugins/reload" };
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
  if (req.type === "feedback") {
    // S5/T-P2-404：形状校验（kind 闭集 + 二选一 + 可选文本）；targetSeq
    // 存在性在 agent-process 落流前校验（流内事实以流为准）。
    const kind = req.kind;
    if (kind !== "up" && kind !== "down") {
      throw new ProtocolError("PROTOCOL_MALFORMED", `feedback 的 kind 须为 up|down，收到 ${String(kind)}`);
    }
    const hasSeq = req.targetSeq !== undefined && req.targetSeq !== null;
    const hasCommand = req.commandId !== undefined && req.commandId !== null;
    if (hasSeq === hasCommand) {
      throw new ProtocolError("PROTOCOL_MALFORMED", "feedback 需要 targetSeq 与 commandId 二选一");
    }
    if (hasSeq && (typeof req.targetSeq !== "number" || !Number.isInteger(req.targetSeq) || req.targetSeq < 0)) {
      throw new ProtocolError("PROTOCOL_MALFORMED", "feedback 的 targetSeq 须为非负整数");
    }
    if (hasCommand && (typeof req.commandId !== "string" || req.commandId === "")) {
      throw new ProtocolError("PROTOCOL_MALFORMED", "feedback 的 commandId 须为非空字符串");
    }
    for (const field of ["comment", "doctorSummary"] as const) {
      const value = req[field];
      if (value !== undefined && value !== null && typeof value !== "string") {
        throw new ProtocolError("PROTOCOL_MALFORMED", `feedback 的 ${field} 须为字符串`);
      }
    }
    return {
      type: "feedback",
      kind,
      ...(hasSeq ? { targetSeq: req.targetSeq as number } : {}),
      ...(hasCommand ? { commandId: req.commandId as string } : {}),
      ...(typeof req.comment === "string" ? { comment: req.comment } : {}),
      ...(typeof req.doctorSummary === "string" ? { doctorSummary: req.doctorSummary } : {}),
    };
  }
  if (req.type === "polish") {
    // T-P3-146 I：润色请求形状（requestId 非空 + draft 非空字符串——空草稿
    // 无可润色，UI 侧已拦；wire 层防御性重复校验）
    if (typeof req.requestId !== "string" || req.requestId === "") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "polish 需要 requestId 非空字符串");
    }
    if (typeof req.draft !== "string" || req.draft.trim() === "") {
      throw new ProtocolError("PROTOCOL_MALFORMED", "polish 需要 draft 非空字符串");
    }
    return { type: "polish", requestId: req.requestId, draft: req.draft };
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
    category?: unknown;
    allowed?: unknown;
    targetSeq?: unknown;
    codeRestored?: unknown;
    question?: unknown;
    sessionId?: unknown;
    cutSeq?: unknown;
    eventCount?: unknown;
    fromTurn?: unknown;
    applied?: unknown;
    contents?: unknown;
    action?: unknown;
    reason?: unknown;
    rule?: unknown;
    tools?: unknown;
    skills?: unknown;
    prompts?: unknown;
    ok?: unknown;
    text?: unknown;
    error?: unknown;
    usage?: unknown;
    ms?: unknown;
    draft?: unknown;
  };
  switch (msg.type) {
    case "ready": {
      // U10/T-P3-109：清单载荷可选（旧子进程/测试注入零变化）；形状坏拒绝。
      const out: {
        type: "ready";
        tools?: string[];
        skills?: { name: string; description: string }[];
        prompts?: {
          name: string;
          description?: string;
          argumentHint?: string;
          source: "project" | "user" | "extra" | "builtin" | "mcp";
        }[];
      } = { type: "ready" };
      if (msg.tools !== undefined) {
        if (!Array.isArray(msg.tools) || msg.tools.some((t) => typeof t !== "string")) {
          throw new ProtocolError("PROTOCOL_MALFORMED", "ready.tools 须为字符串数组");
        }
        out.tools = msg.tools as string[];
      }
      if (msg.skills !== undefined) {
        if (
          !Array.isArray(msg.skills) ||
          msg.skills.some(
            (s) =>
              s === null ||
              typeof s !== "object" ||
              typeof (s as { name?: unknown }).name !== "string" ||
              typeof (s as { description?: unknown }).description !== "string",
          )
        ) {
          throw new ProtocolError("PROTOCOL_MALFORMED", "ready.skills 须为 {name,description} 数组");
        }
        out.skills = msg.skills as { name: string; description: string }[];
      }
      // T-P3-146：prompts 目录（形状校验同 skills——source 闭集额外把关）
      if (msg.prompts !== undefined) {
        if (
          !Array.isArray(msg.prompts) ||
          msg.prompts.some(
            (p) =>
              p === null ||
              typeof p !== "object" ||
              typeof (p as { name?: unknown }).name !== "string" ||
              typeof (p as { source?: unknown }).source !== "string" ||
              !["project", "user", "extra", "builtin", "mcp"].includes(
                String((p as { source?: unknown }).source),
              ),
          )
        ) {
          throw new ProtocolError("PROTOCOL_MALFORMED", "ready.prompts 形状非法（name/source 必填，source 闭集）");
        }
        out.prompts = msg.prompts as {
          name: string;
          description?: string;
          argumentHint?: string;
          source: "project" | "user" | "extra" | "builtin" | "mcp";
        }[];
      }
      return out;
    }
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
      // C54：category 必须在闭集内（tool/question/task/elicitation/hook-review）
      if (
        typeof msg.category !== "string" ||
        !["tool", "question", "task", "elicitation", "hook-review"].includes(msg.category)
      ) {
        throw new ProtocolError(
          "PROTOCOL_MALFORMED",
          "approval_requested 需要 category ∈ tool/question/task/elicitation/hook-review",
        );
      }
      return {
        type: "approval_requested",
        requestId: msg.requestId,
        tool: msg.tool,
        args: msg.args as JsonRecord,
        timeoutMs: msg.timeoutMs,
        category: msg.category,
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
    case "resumed": {
      // M3/T-P1-86：续跑受理回执（fromTurn = 被续跑的崩溃轮号）
      if (typeof msg.fromTurn !== "number" || !Number.isInteger(msg.fromTurn) || msg.fromTurn < 1) {
        throw new ProtocolError("PROTOCOL_MALFORMED", "resumed 需要正整数 fromTurn");
      }
      return { type: "resumed", fromTurn: msg.fromTurn };
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
    case "polish_result": {
      // T-P3-146 I：润色回执（ok 闭集 + text/error 按语义缺省）
      if (typeof msg.requestId !== "string" || msg.requestId === "") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "polish_result 需要 requestId");
      }
      if (msg.ok !== true && msg.ok !== false) {
        throw new ProtocolError("PROTOCOL_MALFORMED", "polish_result 需要 ok 布尔");
      }
      if (msg.text !== undefined && typeof msg.text !== "string") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "polish_result 的 text 须为字符串");
      }
      if (msg.error !== undefined && typeof msg.error !== "string") {
        throw new ProtocolError("PROTOCOL_MALFORMED", "polish_result 的 error 须为字符串");
      }
      // T-P3-147 F：usage（对象）/ms（非负数）可选形状
      if (
        msg.usage !== undefined &&
        (typeof msg.usage !== "object" || msg.usage === null || Array.isArray(msg.usage))
      ) {
        throw new ProtocolError("PROTOCOL_MALFORMED", "polish_result 的 usage 须为对象");
      }
      if (msg.ms !== undefined && (typeof msg.ms !== "number" || !Number.isFinite(msg.ms) || msg.ms < 0)) {
        throw new ProtocolError("PROTOCOL_MALFORMED", "polish_result 的 ms 须为非负数");
      }
      return {
        type: "polish_result",
        requestId: msg.requestId,
        ok: msg.ok,
        ...(typeof msg.text === "string" ? { text: msg.text } : {}),
        ...(typeof msg.error === "string" ? { error: msg.error } : {}),
        ...(msg.usage !== undefined ? { usage: msg.usage as PolishUsage } : {}),
        ...(typeof msg.ms === "number" ? { ms: msg.ms } : {}),
      };
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
