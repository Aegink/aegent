/**
 * L0 事件词汇表 —— `docs/l0-events.md` §3 定稿的落地（13 事件 + E4 的
 * session/revert 标记 14 个 + T-P1-06 的 model/switch 15 个 + T-P1-10 的
 * todo/update 共 16 个 + 6 结束原因 + 5 取消原因；13→14、14→15 与 15→16
 * 的裁决记录见 l0-events.md §8 落地记录）。
 *
 * 词汇表是 Q9 的单向门：定完再改的代价见
 * `oss/deepseek-harness/.agents/notes/rejected/architecture/2026-06-16-typed-event-schemas.md`。
 *
 * 三条形状纪律（l0-events.md §4，违反即 bug）：
 * 1. 封闭联合（C15/C16）：新增事件类型必须同步更新 EVENT_TYPES、SessionEvent
 *    联合与所有 switch 消费点的 assertNever——漏更新则编译失败，这是特性。
 * 2. 无运行时对象（C14）：载荷不得含 stack / signal / Error 实例 / 函数等
 *    不可 JSON 序列化的值；append 前 `assertJsonSafe` 兜底拒绝。
 * 3. 整值事件（E12）：携带状态的事件载荷是变更后的完整值，绝非裸 delta。
 *
 * 两类投影规则勿混用（B12，T-4-07 起）：tool/result 是**投影面**——工具的
 * 执行期富值经 render() 投影后才落盘（见 tools/contract.ts），富值本身
 * 绝不进事件；状态类事件（message/usage/…）是 E12 **整值面**——完整值直落。
 *
 * 生命周期是三级：turn（用户轮）→ step（一次模型调用 + 其工具执行）→ message。
 * pi 的 "turn" 在我方叫 step（l0-events.md §2.1 决定 1）。
 */

// ---------------------------------------------------------------------------
// JSON 值域（C14 的类型面；运行时面是 assertJsonSafe）
// ---------------------------------------------------------------------------

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

/**
 * C14 的执行点：断言值可安全 JSON 序列化且不含运行时对象，返回原值供 append 直接落库。
 * 拒绝：undefined / 函数 / symbol / bigint / 非有限数 / Error 实例 /
 * 任何带 `stack` 属性的对象（跨 realm Error 与手工拼的运行时对象都会命中）/
 * 非 plain 对象（Map / Set / Date / AbortSignal 等类实例）/ 循环引用。
 * 同一对象的重复出现（菱形 / 共享引用）是合法的——seen 集合 walk 完子树即
 * 回溯，只表达祖先链（见 walk 内注释）。
 */
export function assertJsonSafe(value: unknown, path = "$"): JsonValue {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, p: string): JsonValue => {
    if (v === null) return null;
    switch (typeof v) {
      case "string":
        return v;
      case "boolean":
        return v;
      case "number":
        if (!Number.isFinite(v)) throw new JsonSafeError(p, `非有限数 ${v}`);
        return v;
      case "undefined":
        throw new JsonSafeError(p, "undefined");
      case "bigint":
      case "symbol":
      case "function":
        throw new JsonSafeError(p, `不可序列化的 ${typeof v}`);
      case "object":
        break;
    }
    if (typeof (v as { stack?: unknown }).stack === "string") {
      throw new JsonSafeError(p, "含 stack 属性的运行时对象（C14：疑似 Error/signal）");
    }
    if (v instanceof Error) {
      throw new JsonSafeError(p, "Error 实例（C14：用结构化 {code, message} 替代）");
    }
    if (seen.has(v as object)) throw new JsonSafeError(p, "循环引用");
    seen.add(v as object);
    let result: JsonValue;
    if (Array.isArray(v)) {
      result = v.map((item, i) => walk(item, `${p}[${i}]`));
    } else {
      const proto = Object.getPrototypeOf(v) as object | null;
      if (proto !== Object.prototype && proto !== null) {
        throw new JsonSafeError(p, `非 plain 对象（${proto.constructor?.name ?? "unknown"} 实例）`);
      }
      const out: JsonRecord = {};
      for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(item, `${p}.${k}`);
      }
      result = out;
    }
    // 回溯（T-3-02 踩中的菱形误报本修）：seen 只表达"当前祖先链"，walk 完
    // 子树即退出集合——同一对象在树内出现两次（如 usage 同时挂 stream 记录
    // 与事件顶层字段）是合法共享引用，不是循环；真正的环在子树内未退出时
    // 再次命中，仍会拒绝。
    seen.delete(v as object);
    return result;
  };
  return walk(value, path);
}

class JsonSafeError extends Error {
  constructor(path: string, reason: string) {
    super(`事件载荷不可 JSON 序列化（C14）于 ${path}：${reason}`);
    this.name = "JsonSafeError";
  }
}

/**
 * 运行时穷尽断言（C16）：switch 消费点对 SessionEvent 的每个 type 都有分支后，
 * default 分支对收窄到 never 的值调用本函数。新增事件类型漏改 switch 时，
 * 该分支参数不再收窄为 never，编译失败。
 */
export function assertNever(x: never, context = "unreachable"): never {
  let detail: string;
  try {
    detail = JSON.stringify(x) ?? String(x);
  } catch {
    detail = String((x as { constructor?: { name?: string } })?.constructor?.name);
  }
  throw new Error(`${context}: 遇到未处理的可辨别成员 ${detail}`);
}

/** 类型级穷尽断言：T 非 never 时 `const _x: AssertNever<T> = true` 编译失败。 */
export type AssertNever<T> = [T] extends [never] ? true : false;

/** 分布式 Omit：对联合的每个成员分别 Omit，保住各成员自己的判别字段。 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// ---------------------------------------------------------------------------
// 载荷子类型（均为 JSON 安全的纯数据）
// ---------------------------------------------------------------------------

/**
 * DSH TokenUsage 同款：三计数不相交，计费输入 = input + cacheRead + cacheWrite；
 * totalTokens 不可靠或缺席时省略（`oss/deepseek-harness/packages/llm/llm/src/types.ts:176`）。
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

/**
 * 模型流的最小 chunk 词汇（P0）。阶段 2 适配层把厂商 wire 事件映射到这里；
 * 不抄 DSH 的 delta-run 打包（那是压缩优化，P0 只需无损定时序列）。
 */
export type StreamChunk =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call-delta"; id: string; name?: string; argsDelta: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done" };

/** 带原始时间戳的流记录：E14（原始分片入日志，P1）启用分片重放时的依据。 */
export interface TimedStreamChunk {
  time: number;
  chunk: StreamChunk;
}

/**
 * 结构化模型失败事实（l0-events.md §8 未展开项，P0 最小形状——原样取 DSH
 * `LlmFailure` 的前四个字段，见本文档 §8 落地记录）。
 */
export interface LlmFailure {
  /** 稳定的厂商中立机器路由码（如 "CONTEXT_WINDOW_EXCEEDED"），判据字段。 */
  code: string;
  /** 人类可读失败描述，展示字段——C14 禁的是拿自由文本当判据。 */
  message: string;
  /** HTTP 状态码（可得时）。 */
  status?: number;
  /** Retry-After 换算毫秒（T-2-03 尊重该头）。 */
  providerRetryAfterMs?: number;
}

/** turn 的结束原因（l0-events.md §3.3 定稿，6 变体）。 */
export type TurnEndReason =
  | { kind: "completed" }
  | { kind: "aborted"; cause: CancelCause }
  | { kind: "blocked" } // 策略拒绝（C10 命中危险命令等）
  | { kind: "error"; error: LlmFailure }
  | { kind: "max-tokens" }
  | { kind: "interrupted" }; // ★ 崩溃孤儿闭合，loop 永不实时发出（l0-events.md §2.4）

/**
 * 取消原因（l0-events.md §3.4 定稿，5 变体）。
 * `hook` 的判据在结构化 `reason`，自由文本只进 `message`（Q10 裁决 (d)）。
 */
export type CancelCause =
  | { kind: "user" }
  | { kind: "parent" } // 子代理被父级取消；P1 真用上，槽位现在留
  | { kind: "disposed" }
  | { kind: "hook"; reason: JsonRecord; message?: string }
  | { kind: "legacy" }; // 导入的旧日志无 cause（DSH types.ts:196 同款）

// ---------------------------------------------------------------------------
// 13 事件联合（l0-events.md §3.2 定稿）
// ---------------------------------------------------------------------------

export interface EventBase {
  /** 单调整数，权威顺序；由 store 分配，调用方不提供（pi NewEntry 纪律）。 */
  seq: number;
  /** 事件时间（epoch 毫秒）；由 store 分配。 */
  ts: number;
  /** 所属用户轮。 */
  turn: number;
  /** 仅 step 作用域事件携带（step 作用域事件在其接口里重声明为必填）。 */
  step?: number;
}

export interface TurnStartEvent extends EventBase {
  type: "turn/start";
}

export interface TurnEndEvent extends EventBase {
  type: "turn/end";
  reason: TurnEndReason;
}

export interface StepStartEvent extends EventBase {
  type: "step/start";
  step: number;
}

export interface StepEndEvent extends EventBase {
  type: "step/end";
  step: number;
}

/**
 * `source` 三值（l0-events.md §3.2）：人类 prompt、注入上下文、目标续跑
 * 三者都逐字投影 content，靠 source 区分——没有它就再也分不开（DSH types.ts:309）。
 */
export type UserMessageSource = "user" | "injected" | "resume";

export interface UserMessageEvent extends EventBase {
  type: "user/message";
  message: { content: string };
  source: UserMessageSource;
}

export interface SystemMessageEvent extends EventBase {
  type: "system/message";
  step: number;
  message: { content: string };
}

export interface AssistantMessageEvent extends EventBase {
  type: "assistant/message";
  step: number;
  message: { content: string };
  /** 无损定时流记录（含 reasoning 前缀；E14 P1 起用于分片重放）。 */
  stream: TimedStreamChunk[];
  /** 适配器报告了 token 计量才携带（与模型输出同事件，无独立 usage 记录）。 */
  usage?: TokenUsage;
  /** 中断是写入时记录的事实，不是读取时从 turn 边界的推导（l0-events.md §2.3）。 */
  interrupted?: true;
}

/** 一次未产出可见消息的模型尝试（失败/重试/取消/流错误）——不为记录失败而伪造模型消息。 */
export interface AssistantAttemptEvent extends EventBase {
  type: "assistant/attempt";
  step: number;
  stream: TimedStreamChunk[];
}

export interface ToolCallEvent extends EventBase {
  type: "tool/call";
  step: number;
  callId: string;
  name: string;
  /** 模型产出的原始 arguments JSON 串，unparsed——解析失败、键序、字节精度都不丢。 */
  arguments: string;
}

export interface ToolResultEvent extends EventBase {
  type: "tool/result";
  step: number;
  callId: string;
  message: { content: string; isError?: boolean };
  /** 仅 message.isError 为 true 时允许（DSH 同款约束）；结构化事实，模型不可见 reason 另放。 */
  error?: { name: string; code: string; reason?: string };
  /** 工具私有展示载荷，对内核不透明；assertJsonSafe 在 append 拒绝非 JSON 值。 */
  meta?: JsonValue;
}

export interface CompactionEvent extends EventBase {
  type: "compaction";
  /** 压缩摘要文本（P0 由假 provider 剧本生成；摘要质量属 F5 P1）。 */
  summary: string;
  /** 保留尾部的 seq 边界：新窗口从该 seq 之后的事件重建。 */
  retainedTail: number;
  /** 压缩前完整 token 计数（E12：整值，不是 delta）。 */
  tokensBefore: number;
  usage?: TokenUsage;
  /**
   * 压缩触发原因的机器可读标记（F24/T-7-06；codex·compact_model_fallback.rs:27-30
   * 的 CompactionReason 序列化词表）："context_limit"（溢出触发——本地判定或
   * provider 拒绝两源共用，codex 的 ContextLimit）| "model_downshift"（换更小
   * 上下文模型先压缩，F24）。user_requested / comp_hash_changed 是 P1/P2 槽位。
   * 可选字段向后兼容：早期流缺省读作 context_limit。
   */
  reason?: string;
}

export interface CheckpointEvent extends EventBase {
  type: "checkpoint";
  /** 代码状态快照的提供方（E11：代码检查点）。 */
  provider: string;
  /** 指回快照的引用（如 git commit / 快照 id），JSON 安全。 */
  ref: JsonValue;
}

/** 本次请求为何发出（DSH `RequestHeaderReason` 同款四值）。 */
export type RequestHeaderReason = "initial" | "resume" | "change" | "series";

/**
 * 下一次请求的完整头。它是 header 不是消息：参与"重建请求"，不参与"派生历史"
 * （l0-events.md §4 纪律 7，Q12 裁决进 L0）。
 */
export interface RequestHeaderEvent extends EventBase {
  type: "request/header";
  /** 请求设置，必含模型身份二元组 `{provider, modelId}`（J4；T-2-01 定形）。 */
  config: JsonRecord;
  tools?: JsonValue;
  reason: RequestHeaderReason;
}

/**
 * revert 标记（E4，T-1-05）：最新标记生效。append-only 流不可截断，
 * 回退 = 追加标记让有效投影隐藏 targetSeq 之后的效果（phase "revert"）；
 * phase "undo"（unrevert）恢复全部，约定 targetSeq=0。
 * 会话级元事件：不要求 turn/step 开合上下文。词汇表 13→14 的裁决记录见
 * l0-events.md §8 落地记录与 plan-p0-progress.md 待澄清表。
 */
export interface SessionRevertEvent extends EventBase {
  type: "session/revert";
  targetSeq: number;
  phase: "revert" | "undo";
}

/**
 * 换模事件（J9/J10/J14，T-P1-06）：换模/回滚以持久事件承载，绝不静默改
 * 状态（pi·agent-harness SpecialEventPayload 纪律）。会话级元事件：不要求
 * turn/step 开合上下文（session/revert 同款）。reason 值域："user"（owner
 * 经协议/端口换模受理——含 deferred 受理，受理即用户选择的事实落流）|
 * "rollback"（J11 不兼容回滚，from=被回滚的目标、to=恢复的 prev）。
 * 会话级选择的事实源 = 流内最新本事件的 to（J14 回放保护：restore/回放
 * 按流重建，不以全局默认覆盖——grok user_model_preference 的 replay 纪律）。
 * 词汇表 14→15 的裁决记录见 l0-events.md §8 落地记录 3 与待澄清表（供追认）。
 */
export interface ModelSwitchEvent extends EventBase {
  type: "model/switch";
  /** 受理/回滚前的模型身份（内联形状，events.ts 不依赖 models 层）。 */
  from: { provider: string; modelId: string };
  /** 受理/回滚后的模型身份——流内最新本事件的 to 即会话级选择事实源。 */
  to: { provider: string; modelId: string };
  reason: "user" | "rollback";
}

/** todo 项的状态三值（G2 最小面；opencode 的 cancelled 不引入——YAGNI）。 */
export type TodoStatus = "pending" | "in_progress" | "completed";

/**
 * todo 清单更新（G2，T-P1-10）：todo 变更 = 事件，状态 = 投影（不变量 1
 * 同构，opencode·session/todo 的 Event.Updated 纪律）。会话级元事件：
 * 不要求 turn/step 开合上下文（session/revert / model/switch 同款，落流时
 * turn 挂流内最后轮空流兜 0）。items 是变更后的**完整清单**——E12 整值
 * 事件，绝非 delta；最新一条本事件即 todo 当前状态的事实源。
 * 词汇表 15→16 的裁决记录见 l0-events.md §8 落地记录 4 与待澄清表（供追认）。
 */
export interface TodoUpdateEvent extends EventBase {
  type: "todo/update";
  items: Array<{ content: string; status: TodoStatus }>;
}

export type SessionEvent =
  | TurnStartEvent
  | TurnEndEvent
  | StepStartEvent
  | StepEndEvent
  | UserMessageEvent
  | SystemMessageEvent
  | AssistantMessageEvent
  | AssistantAttemptEvent
  | ToolCallEvent
  | ToolResultEvent
  | CompactionEvent
  | CheckpointEvent
  | RequestHeaderEvent
  | SessionRevertEvent
  | ModelSwitchEvent
  | TodoUpdateEvent;

/** 16 事件类型清单（封闭联合的运行时面；C16 要求与 SessionEvent 严格一致）。 */
export const EVENT_TYPES = [
  "turn/start",
  "turn/end",
  "step/start",
  "step/end",
  "user/message",
  "system/message",
  "assistant/message",
  "assistant/attempt",
  "tool/call",
  "tool/result",
  "compaction",
  "checkpoint",
  "request/header",
  "session/revert",
  "model/switch",
  "todo/update",
] as const;

export type SessionEventType = (typeof EVENT_TYPES)[number];

// C16 编译期闸门：EVENT_TYPES 与 SessionEvent 的 type 集合互差必须为 never。
// 任一侧多出/缺失一个成员，下一行的赋值即编译失败。
const _EVENT_TYPES_EXACT: AssertNever<
  Exclude<SessionEventType, SessionEvent["type"]> | Exclude<SessionEvent["type"], SessionEventType>
> = true;
void _EVENT_TYPES_EXACT;

/** append 的入参形状：seq / ts 由 store 分配，调用方不给（pi NewEntry 纪律，l0-events.md §3.1）。 */
export type NewSessionEvent = DistributiveOmit<SessionEvent, "seq" | "ts">;
