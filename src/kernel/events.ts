/**
 * L0 事件词汇表 —— `docs/l0-events.md` §3 定稿的落地（13 事件 + E4 的
 * session/revert 标记 14 个 + T-P1-06 的 model/switch 15 个 + T-P1-10 的
 * todo/update 16 个 + T-P1-12 的 goal/set 共 17 个 + 6 结束原因 + 5 取消
 * 原因；各次扩展的裁决记录见 l0-events.md §8 落地记录）。
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
  | {
      type: "done";
      /**
       * B20/T-P1-62：厂商 stop/finish reason（OpenAI wire 的 choices[0]
       * .finish_reason，此前被丢弃）。可选——旧流/部分适配器缺省。
       * loop 据此判定"输出 token 触顶可续跑"（OUTPUT_TOKEN_LIMIT_FINISH_
       * REASONS 闭集）；走待澄清 #10 载荷扩展立案（C14 JSON 安全）。
       */
      finishReason?: string;
    };

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
  /**
   * E18/T-P1-94：本回合产出的 assistant/message 事件 seq 按序列表——
   * loop（机器）在收轮时点自报（kimi·engine.ts turnSettled {outcome,
   * produced} 同构），消费者免事后反推"哪些消息属于本回合"；abort 轮
   * 照报已产出部分（不丢不虚构）。可选缺省：旧流兼容 + 无 assistant
   * 产出的轮（produced 为空数组时不落——空集与缺席同义）。
   * 词汇表立案 #14（事件计数 21 不变——载荷扩展）。
   */
  produced?: number[];
}

export interface StepStartEvent extends EventBase {
  type: "step/start";
  step: number;
}

export interface StepEndEvent extends EventBase {
  type: "step/end";
  step: number;
  /**
   * B19/T-P1-61 step 可观测性（kimi stepCompleted 的 timing/traceId 同构，
   * ModelRequestTiming 最小面）：有模型请求的 step 才携带（纯工具收尾 step
   * 不带）；firstTokenLatencyMs = 流开始到首个 chunk、streamDurationMs = 流
   * 开始到结束。走待澄清 #9 载荷扩展立案（旧流缺省，前向兼容）。
   */
  timing?: { firstTokenLatencyMs: number; streamDurationMs: number };
  /**
   * B19/T-P1-61 模型请求关联 id（`r<序数>` 会话内单调，promptId 同族分配
   * 纪律——每次模型请求一枚，request/header 的同一 step 面可关联）。与
   * timing 同规则：有模型请求的 step 才带。前向兼容同上。
   */
  traceId?: string;
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
  /**
   * A12/T-P1-53 关联 id（claude-official prompt_id 行为同构——🔴 专有仓
   * 只学语义零代码摘取）：用户输入的关联键，其效力区间 = 本条 user/message
   * 之后、**下一条 user/message 之前**的全部事件（按流顺序归属——事件流
   * 的顺序即关联结构，区间内事件不逐个带 id，投影/消费面按 seq 切片推导）。
   * loop 在落 user/message 时统一分配（runTurn 首条与 steer 注入每条各
   * 一枚，格式 `p<序数>` 会话内单调、恢复路径从流重建保证不重号）。
   * 与 A9 纪律一致：promptId 是关联键**不是完成句柄**——没有 finished()
   * 配对、没有 per-prompt 完成语义；与 queue 的 messageId（q<序数>，
   * inbox admission 收执，仅队列通道）分工明确。旧流缺省该字段（前向兼容，
   * 走待澄清 #8 载荷扩展立案——事件计数 19 不变）。
   */
  promptId?: string;
  /**
   * 随消息附上的附件引用（P1/T-P1-124——词汇表立案 #20：载荷扩展，事件计数
   * 不变）。**流存引用不存字节**：本字段只携带 AttachmentRef（id/mediaType/
   * name/size），字节在 AttachmentStore（流轻量纪律）；重建路径 = ref →
   * store.read（恢复/回放时注入 resolver）。字段缺省——旧流前向兼容
   * （缺值读作"无附件"，投影零变化）。
   */
  attachments?: AttachmentRef[];
  /**
   * 本条消息引用的其他会话（E9/T-P2-107——载荷扩展，事件计数不变）：
   * **流存引用不存内容**（附件同款纪律——只落 {sessionId, upToSeq?}，
   * 被引会话的内容字节绝不进本会话的流）。注入发生在投影面
   * （buildChatMessages 经 resolveSessionRef 注入有界快照文本——头部 N 条
   * + 字符预算 + 不可信背景警示）；upToSeq 是引用视窗（缺省 = 引用方可见
   * 的最新）。引用图必须 DAG（创建时环检测 fail-closed——见
   * session/reference.ts）。字段缺省——旧流前向兼容（投影零变化）。
   */
  sessionRefs?: SessionRef[];
}

/**
 * 会话引用（E9——引用是流内事实：只带指针不带内容；`upToSeq` 是视窗上界）。
 * 声明为 type 别名而非 interface：TS 的 interface 无隐式索引签名，无法满足
 * wire 层 `Exclude<AgentRequest, JsonValue>` 的可序列化型证（AttachmentRef
 * 同款形式纪律）。
 */
export type SessionRef = {
  readonly sessionId: string;
  /** 引用视窗：只引用 seq ≤ upToSeq 的部分（缺省 = 引用方可见的最新）。 */
  readonly upToSeq?: number;
};

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

/**
 * J27/T-P1-61：重试作为一等事件（kimi engine retrying 同构最小面）——
 * provider 层的中间失败尝试（未产出 chunk 故 assistant/attempt 不落盘的
 * 那种）对事件流可见：attempt 0-based、delayMs 为重试前等待、error 为
 * kimi retryErrorFields 同构三字段。词汇表 19→20（走待澄清 #9 立案）。
 * turn/step 由 agent-child 在回调时从 loop 的当前 step 面读取（provider
 * 层自身不知 loop 状态）；无在途 step 时的重试（理论不可达，防御性缺省）
 * 落 turn=0/step=0。
 * F18/T-P1-102：生产者扩展到 **loop 级流恢复**（事件形状不变，语义记档）
 * ——流已产出增量后的失败由 loop 从锚点重建重发整 step（provider 级
 * withRetry 的 D15 边界在该域从不重试），每次恢复重发前落本事件；
 * attempt 在 loop 域内重新 0-based 起算、delayMs=0（立即重发）。
 */
export interface AssistantRetryingEvent extends EventBase {
  type: "assistant/retrying";
  turn: number;
  step: number;
  attempt: number;
  delayMs: number;
  error: { name: string; message: string; status?: number };
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

/**
 * 工具执行进度（B7，T-P1-16）：正在执行的工具经 ToolContext.reportProgress
 * 上报的流式进度——进度是流内事实（不变量 1），只有正在执行的工具拿得到
 * 上报通道。**turn 域事件**（非会话级元事件）：与 tool/call 同域——校验
 * 要求 turn/step 开启且 callId 在 openToolCalls 中（进度只能在所属调用
 * 未闭合时产生）。seqInCall 是调用内的进度序号（1 起单调递增），按
 * callId 聚合后有序——"进度按序到达"（B7 验收原文）。单调用进度条数
 * 上限见 loop.ts（卡内定形，防高频工具撑爆事件流）。
 * 词汇表 17→18 的裁决记录见 l0-events.md §8 落地记录 6 与待澄清表（供追认）。
 */
export interface ToolProgressEvent extends EventBase {
  type: "tool/progress";
  step: number;
  callId: string;
  /** 调用内进度序号（1 起单调递增）。 */
  seqInCall: number;
  /** 进度文本（工具自解释；投影/REPL 可见）。 */
  message: string;
}

export interface CompactionEvent extends EventBase {
  type: "compaction";
  /** 压缩摘要文本（P0 由假 provider 剧本生成；摘要质量属 F5 P1）。 */
  summary: string;
  /**
   * 会话标题（F5/T-P1-18）：首摘要顺带产出——引擎只在本会话无更早
   * compaction 事件时记录（标题是会话级元事实，首摘要定名）。可缺省：
   * 假摘要注入（P0 面）与后续压缩不带标题。
   */
  title?: string;
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
  // -------------------------------------------------------------------------
  // L8 六维度量（T-P1-92，codex·analytics/facts.rs:444-509 对位）——全部
  // 可选（旧流缺省兼容）；事件计数 21 不变（载荷扩展，词汇表立案 #12）。
  // -------------------------------------------------------------------------
  /**
   * 触发方式（codex CompactionTrigger）："auto"（引擎自动——溢出/换模）
   * | "manual"（用户显式 /compact——命令面随真实需求，槽位先留）。
   */
  trigger?: string;
  /**
   * 相位（codex CompactionPhase；F20/F21 的两相位映射到事件面 snake_case）：
   * "pre_turn"（轮收尾时的首次请求前）| "mid_turn"（step 边界）。
   * codex 的 standalone_turn/post_turn 是其编排特有，不引入。
   */
  phase?: string;
  /**
   * 实现面（codex CompactionImplementation）：当前唯一直值 "llm-summarizer"
   * （F5 的 LLM 摘要器）。**纪律**：单一实现期落唯一直值，第二实现出现时
   * 收闭集走立案（YAGNI 对冲过度设计）。
   */
  implementation?: string;
  /**
   * 策略面（codex CompactionStrategy）：**值域收闭集走立案（#18）**——
   * "full_summary"（全量摘要，正常路径）| "recent_window_fallback"（F11
   * 兜底检查点：前次摘要 + 恢复标记 + 近期窗口原文，ADR 0049/0302 的
   * retained-tail 我方位）。旧流只有 full_summary 语义。
   */
  strategy?: string;
  /**
   * F11/T-P1-101：兜底/失败原因的**闭集**判据（ADR 0302——"records
   * details.failureReason from a closed vocabulary … instead of provider
   * error text"，provider 错误原文绝不落流）：no_new_history（被摘要区间
   * 无消息）| summary_budget（预检/分块超预算）| summary_provider（摘要
   * 请求终态失败/空输出）| checkpoint_oversized（兜底检查点仍超窗）。
   * 仅 strategy="recent_window_fallback"（兜底成功）与 status="failed"
   * （manual fail-fast / 兜底不可行）携带。可选字段前向兼容。
   */
  failureReason?: string;
  /**
   * 状态（codex CompactionStatus 的我方子集）："started"（摘要调用前落——
   * E17/T-P1-93 中间态事实）| "completed"（结算；**缺省读作 completed**——
   * 旧流兼容）| "failed"（摘要失败降级升流内事实，T-P1-93）。codex 的
   * interrupted 不引入：中断时最后事实是 started（对账后投影可见"未完成"）。
   */
  status?: string;
  /**
   * F26/T-P1-100：压缩指纹（压缩相关配置的稳定哈希——摘要模型身份 + 摘要器
   * 种类 + 保留规则 + developer 保留预算，compactionFingerprint 计算）。下轮
   * 边界与当前指纹**双值齐备且不等** → 触发 comp_hash_changed 重压（codex
   * turn.rs:1304 纪律：缺值不提供足够信息触发——旧流无此字段即不触发）。
   * 三次落盘（started/failed/completed）同值：指纹描述的是本次压缩的配置面。
   * 可选字段向后兼容：词汇表立案 #17（事件计数 23 不变——载荷扩展）。
   */
  compHash?: string;
}

export interface CheckpointEvent extends EventBase {
  type: "checkpoint";
  /** 代码状态快照的提供方（E11：代码检查点）。 */
  provider: string;
  /** 指回快照的引用（如 git commit / 快照 id），JSON 安全。 */
  ref: JsonValue;
}

/**
 * 本次请求为何发出（DSH `RequestHeaderReason` 同款四值 + F5/T-P1-18 扩展一值）：
 * - "initial" 首次请求 / "resume" 续跑 / "change" 配置变更 / "series" 同轮后续 step；
 * - "compaction" 压缩摘要的副调用（F5/T-P1-18）：摘要请求不是 agent 轮的
 *   step，用四值中任何一个都是流内谎言——独立值让运维面可区分主轮与副调用。
 * 词汇载荷枚举扩展的裁决记录见 l0-events.md §8 落地记录 7 与待澄清表。
 */
export type RequestHeaderReason = "initial" | "resume" | "change" | "series" | "compaction";

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

/** goal 的状态三值（G3/G6，T-P1-12）。 */
export type GoalStatus = "active" | "achieved" | "abandoned";

/**
 * goal 事实变更（G3/G6，T-P1-12）：goal 跨轮保持的事实源（不变量 1——
 * 设定/达成/放弃/续期都是状态变更，各有事件承载）。会话级元事件：
 * 不要求 turn/step 开合上下文（session/revert / model/switch / todo/update
 * 同款，落流时 turn 挂流内最后轮空流兜 0）。载荷是变更后的**完整 goal
 * 事实**（E12 整值）——流内最新本事件即当前 goal；achieved/abandoned 后
 * text/deadline 保留终值（不抹历史事实）。deadline 为 epoch 毫秒（可缺省
 * = 无截止）。词汇表 16→17 的裁决记录见 l0-events.md §8 落地记录 5。
 */
export interface GoalSetEvent extends EventBase {
  type: "goal/set";
  text: string;
  deadline?: number;
  status: GoalStatus;
}

/**
 * fork 分支标记（E5，T-P1-40）：本会话由哪个父会话的哪个切点分出——
 * **落子流头部**（store.fork 在复制完父流历史后紧随追加），是子流 lineage
 * 的事实源（不变量 1：重启后仍可按流重建父子关系）。log-only：不进模型
 * 历史（模型请求消息装配不消费它），跨 compaction 保留（dsh·subagent
 * descriptor "The descriptor is log-only — a session event absent from
 * model history" 同构纪律）。cutSeq 是父流中"复制到的最后一条事件 seq"
 * （单值表达：position "before" 时 cutSeq = atSeq - 1、"after" 时 = atSeq；
 * cutSeq = 0 即空分支）。会话级元事件：session/revert / model/switch 同款
 * 纪律，不要求 turn/step 开合上下文。
 * 词汇表 18→19 的裁决记录见 l0-events.md §8 落地记录 8 与待澄清表（供追认）。
 */
export interface SessionForkEvent extends EventBase {
  type: "session/fork";
  parentSessionId: string;
  position: "before" | "after";
  cutSeq: number;
}

/**
 * 插件事件泛型逃生舱（C17，T-P1-72）：**唯一**一个允许插件/宿主扩展
 * 落流的泛型槽位（pi CustomEntry 的 `type: "custom"` 同构——"若需插件
 * 事件，只开一个泛型逃生舱类型，不改词汇表机制"）。namespace 非空
 * （命名空间必填——来源可检索，防匿名载荷）；payload 可选 JsonValue
 * （只传可序列化值）。log-only：不进模型历史（模型请求消息装配不消费
 * 它），跨 compaction 保留。会话级元事件：session/fork 同款纪律，不要求
 * turn/step 开合上下文。C15 双向钉死：这是词汇表里唯一的开放槽位——
 * 其他未知类型仍被拒（逃生舱只有一个，没有第二个）。
 * 词汇表 20→21 的裁决记录见 l0-events.md §8 落地记录 12 与待澄清表 #11。
 */
export interface PluginEvent extends EventBase {
  type: "plugin";
  namespace: string;
  payload?: JsonValue;
}

/**
 * 命令生命周期事件对（L7，T-P1-95）：dsh·session-projection-and-command-log
 * 的 command/run + command/done 同构——"命令的调用与裁决也要持久化，不只记
 * 工具；否则刷新/换端/fork 后'这条命令执行过'即丢失"。**log-only 会话级
 * 元事件**（不进模型历史；session/fork / plugin 同款纪律：不要求 turn/step
 * 开合上下文，turn 落 0）。run 前置（调用事实，含失败尝试）、done 结算
 * （commandId 配对不变量——run/done 配对由消费方按 commandId 关联）。
 * payload 结构化（name/args 由命令解析器自报——"never re-parses a line"）。
 * 与 L2 审计审计面分域：命令面是"执行过"的存在性记录，审批域结构化字段
 * （approver/category）仍走 L2。
 * 词汇表 21→23 的裁决记录见 l0-events.md §8 落地记录 16 与待澄清表 #15。
 */
export interface CommandRunEvent extends EventBase {
  type: "command/run";
  /** 配对键（run/done 一对一）；`c<序数>` 会话内单调。 */
  commandId: string;
  /** 命令名（斜杠后首个 token，如 "approve"）。 */
  name: string;
  /** 原始参数串（解析器自报；recordInput:false 的域命令可省——防与域事件重复）。 */
  args?: string;
  /** 来源端标识（CLI / 多端 host 预留位——N7 时并入注册面）。 */
  source?: string;
}

export interface CommandDoneEvent extends EventBase {
  type: "command/done";
  commandId: string;
  /** 结算二值闭集：success（请求已受理/动作已发生）| error（用法错误/类型化拒绝）。 */
  kind: "success" | "error";
  /** handler 结算的人话结果（成功行/拒绝理由——事实性数据，非展示层）。 */
  text?: string;
}

/**
 * surface roster 生命周期事件对（N8，T-P1-114）：多端 = surface roster，
 * 端的加入/离开由事件维护——**持久事件**（内存 roster 随进程消失，violate
 * "端的加入/离开是持久事件"验收）。log-only 会话级元事件（session/fork /
 * plugin / command 同款纪律：不要求 turn/step 开合上下文、turn 落 0、
 * 不进模型历史、跨 compaction 保留）。attach 携带 surfaceId 与投递方式
 * （N7 闭集 push|poll）；detach 携带 surfaceId 与可选 reason（断线/主动
 * 断开/被顶替）。恢复恒等：roster 从流重建（host/roster.ts activeRoster
 * 纯函数——流即状态），重启后端清单可见。两枚事件而非一枚 op 二值：
 * attach/detach 判据字段差异大（C14 结构化各自形状自洽）。
 * 词汇表 23→25 的裁决记录见 l0-events.md §8 落地记录 19 与待澄清表 #19。
 */
export interface SurfaceAttachEvent extends EventBase {
  type: "surface/attach";
  /** 端标识（连接内唯一；重复 attach 幂等不重复入册——roster 是集合）。 */
  surfaceId: string;
  /** 投递方式（N7 闭集 push|poll——连接面的形状快照）。 */
  deliveryKind?: "push" | "poll";
}

export interface SurfaceDetachEvent extends EventBase {
  type: "surface/detach";
  surfaceId: string;
  /** 离开原因（断线/主动断开/被顶替——自由文本可缺省）。 */
  reason?: string;
}

/**
 * 图片卸载决策（P2/T-P1-125，dsh·image-offload-events 锚点——专用事件持久化
 * 决策，不替换消息节点）：`targets` 逐项指认被卸载的图片出现（user/message
 * 事件的 seq + 该消息 attachments 数组中的下标）。**事件级投影事实**——非
 * log-only：buildChatMessages 消费它把被卸出现从模型请求面替换为占位文本
 * （dsh"required-on-read"语义：校验面拒绝非法引用——坏 seq/坏索引/重复卸载
 * 全部 ProjectError，绝不静默）。**只进不退**：卸载决策落流后无自动恢复
 * （回取 = AttachmentStore.read 显式动作）；投影在有效视窗内消费——revert
 * 切掉卸载事件即自然失效（用户显式回退优先于容量决策）。
 * 会话级投影事实：session/revert 同款纪律——不要求 turn/step 开合上下文
 * （turn 挂流内最后轮）；触发面 = offload wire 命令（编排面选定后落流）。
 * 词汇表 25→26 立案 #21（✅ 已追认 2026-09-28）；回退面 = 删事件 + 校验/投影/触发面接线。
 */
export interface ImageOffloadTarget {
  /** 被卸载图片所在的 user/message 事件 seq。 */
  readonly seq: number;
  /** 该消息 attachments 数组中的下标（升序、不重复、零基）。 */
  readonly imageIndexes: readonly number[];
}

export interface ImageOffloadEvent extends EventBase {
  type: "image/offload";
  targets: ImageOffloadTarget[];
}

/**
 * 会话归档标记（Q8，T-P2-102）——"归档是独立一档（ARCHIVED_SESSIONS_SUBDIR），
 * 不是删除"（codex·rollout/compression.rs 的归档目录先例：归档与删除分型）。
 * 归档动作把会话数据从主库移出到独立归档档**之前**落本条流尾——事件随会话
 * 数据一起进入归档档（归档档自带"这条会话何时因何归档"的流内事实，不依赖
 * 主库账本旁证）。**log-only 会话级元事件**（session/fork / plugin / command
 * 同款纪律：不要求 turn/step 开合上下文、turn 挂流内最后轮空流兜 0、不进
 * 模型历史、跨 compaction 保留）。reason 可选自由文本（清理超保留/手动/
 * 外部触发——展示与检索用，非判据字段）。
 * 词汇表 26→27 立案 #22（✅ 已追认 2026-09-28）；回退面 = 删事件 + project 校验 + 归档器
 * 落流接线（约 1.5 小时，全部为新增面——不触碰既有 26 事件语义）。
 */
export interface SessionArchiveEvent extends EventBase {
  type: "session/archive";
  /** 归档原因（可缺省——自由文本，非判据）。 */
  reason?: string;
}

import type { AttachmentRef } from "../attachments/types.js";

export type SessionEvent =
  | TurnStartEvent
  | TurnEndEvent
  | StepStartEvent
  | StepEndEvent
  | UserMessageEvent
  | SystemMessageEvent
  | AssistantMessageEvent
  | AssistantAttemptEvent
  | AssistantRetryingEvent
  | ToolCallEvent
  | ToolResultEvent
  | ToolProgressEvent
  | CompactionEvent
  | CheckpointEvent
  | RequestHeaderEvent
  | SessionRevertEvent
  | ModelSwitchEvent
  | TodoUpdateEvent
  | GoalSetEvent
  | SessionForkEvent
  | PluginEvent
  | CommandRunEvent
  | CommandDoneEvent
  | SurfaceAttachEvent
  | SurfaceDetachEvent
  | ImageOffloadEvent
  | SessionArchiveEvent;

/** 27 事件类型清单（封闭联合的运行时面；C16 要求与 SessionEvent 严格一致）。 */
export const EVENT_TYPES = [
  "turn/start",
  "turn/end",
  "step/start",
  "step/end",
  "user/message",
  "system/message",
  "assistant/message",
  "assistant/attempt",
  "assistant/retrying",
  "tool/call",
  "tool/result",
  "tool/progress",
  "compaction",
  "checkpoint",
  "request/header",
  "session/revert",
  "model/switch",
  "todo/update",
  "goal/set",
  "session/fork",
  "plugin",
  "command/run",
  "command/done",
  "surface/attach",
  "surface/detach",
  "image/offload",
  "session/archive",
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
