/**
 * 压缩模块（F4/T-7-01 范围：消费接口；F3/F20/F21/T-7-02 范围：生命周期引擎）——
 * overflow.ts 的输出是本模块的输入：溢出判定与 provider 超限错误经映射函数
 * 转成 `CompactionRequest`。
 *
 * 压缩是生命周期，不是函数（F20）：所有压缩走同一条
 * pre hook（可中止）→ 摘要生成 → `compaction` 事件落盘 → post hook（观察）
 * 的链路（codex·compact_token_budget.rs:19-23 的纪律——"It is still modeled
 * as compaction so compact hooks and ContextCompaction turn items observe the
 * same lifecycle"）。中止只发生在 pre hook（压缩未发生、无新窗口）；post hook
 * 压缩已落盘，只观察不回滚（事件源 append-only）。
 *
 * 相位（F21）：P0 只做 `PreTurn | MidTurn` 两相位（Q13 裁决；zcode·turn-loop.ts:68
 * 的判定实证——本 turn 尚无已完成模型 step 即 PreTurn，否则 MidTurn）。
 * StandaloneTurn（独立压缩轮）/ PostTurn 是 F21 全枚举的 P1 槽位，不实现。
 *
 * 摘要质量属 F5（P1）——本引擎只提供生命周期与切点，summarizer 由装配注入
 * （P0 测试用假 provider 剧本）。
 */

import {
  type OverflowVerdict,
  estimateMessagesTokens,
  isContextWindowExceeded,
} from "./overflow.js";
import type { SessionEvent } from "../kernel/events.js";
import { Projector } from "../session/project.js";
import { type SessionStore } from "../session/store.js";
import { buildChatMessages, effectiveEvents } from "../session/messages.js";
import { latestBalancedCutAtOrBefore } from "./tool-pairing.js";
import { RapidRefillError, type RapidRefillGuard } from "./rapid-refill.js";
import { SummaryGenerationError } from "./llm-summarizer.js";
import type { ChatMessage } from "../models/provider.js";
import type { TokenUsage } from "../kernel/events.js";

/** 压缩请求：溢出的两种来源（本地提前判定 / provider 拒绝）+ 换模压缩（F24）+ 指纹重压（F26）各自带齐上下文。 */
export type CompactionRequest =
  | {
      /** 本地估算判溢出（发请求前的 A4 面，F10 的"provider 在返回 usage 前拒绝"之前）。 */
      reason: "local-overflow";
      estimatedTokens: number;
      contextWindow: number;
    }
  | {
      /** provider 拒绝（ContextWindowExceeded 分支，codex·compact.rs:315 形态）。 */
      reason: "provider-overflow";
      /** provider 错误的展示消息（C14：判据在 overflow 识别层，这里只留展示面）。 */
      message: string;
    }
  | {
      /** 换更小上下文模型先压缩（F24 ModelDownshift；换模本体 J6 是 P1）。 */
      reason: "model-downshift";
      targetModel: { provider: string; modelId: string };
      targetContextWindow: number;
    }
  | {
      /**
       * 压缩指纹变更重压（F26/T-P1-100，codex CompactionReason::CompHashChanged
       * 的我方位）。触发判定在 compHashChangeRequest（双值齐备且不等才触发）。
       */
      reason: "comp-hash-changed";
    };

/**
 * 事件 `compaction.reason` 的词表映射（codex·compact_model_fallback.rs:27-30 的
 * CompactionReason 序列化风格）：两种溢出源在事件面共用 codex 的 "context_limit"
 * （区分在 request 类型上）；换模压缩 = "model_downshift"（F24 验收字面值）；
 * 指纹重压 = "comp_hash_changed"（F26 验收字面值——词汇表预留槽位兑现）。
 */
export function compactionReasonOf(request: CompactionRequest): string {
  switch (request.reason) {
    case "model-downshift":
      return "model_downshift";
    case "comp-hash-changed":
      return "comp_hash_changed";
    case "local-overflow":
    case "provider-overflow":
      return "context_limit";
  }
}

/** 本地判定 → 压缩请求；未溢出返回 null（不压，正常发请求）。 */
export function compactionRequestFromVerdict(
  verdict: OverflowVerdict,
): CompactionRequest | null {
  if (!verdict.overflow) return null;
  return {
    reason: "local-overflow",
    estimatedTokens: verdict.estimatedTokens,
    contextWindow: verdict.contextWindow,
  };
}

// ---------------------------------------------------------------------------
// 压缩指纹（F26/T-P1-100，codex CompHashChanged 的我方位）
// ---------------------------------------------------------------------------

/** 引擎缺省保留条数（chooseRetainedTail 的未配置口径——指纹面与引擎同源）。 */
export const DEFAULT_RETAINED_FROM_END = 1;

/**
 * F11 兜底近期窗口的保留目标（token，本地估算口径；卡内定形——ADR 0302
 * "bounded by the keep-recent target and by what the safe budget leaves"的
 * 我方目标值，安全预算复检由 contextWindow 硬限承担）。
 */
export const RECENT_WINDOW_TARGET_TOKENS = 8_192;

/** 指纹覆盖面（卡内定形：只覆盖"影响摘要内容或重建"的配置，防止窄漏报/宽误报）。 */
export interface CompactionFingerprintInput {
  /** 生成摘要的模型身份（缺省截断摘要器 / 自定义注入摘要器时缺席）。 */
  model?: { provider: string; modelId: string };
  /** 摘要器种类：llm（真摘要模型）| truncating（缺省截断）| custom（注入）。 */
  summarizerKind: string;
  /** 保留规则（keepRules.retainedFromEnd——切点选择影响摘要覆盖区间）。 */
  retainedFromEnd: number;
  /** F23 developer 注入消息的独立保留预算（新窗口重建面配置）。 */
  developerBudgetTokens: number;
}

/**
 * FNV-1a 32 位哈希（无依赖、跨进程稳定）。序列化用显式字面量固定键序——
 * 不能用 JSON.stringify replacer 数组做键排序：它会作用于**所有层级**，
 * 嵌套对象（model）的键不在清单里就被整层丢弃（指纹对 model 变化失明，
 * 首版实现被测试当场抓出）。
 */
export function compactionFingerprint(input: CompactionFingerprintInput): string {
  const stable = JSON.stringify({
    model: input.model
      ? { provider: input.model.provider, modelId: input.model.modelId }
      : undefined,
    summarizerKind: input.summarizerKind,
    retainedFromEnd: input.retainedFromEnd,
    developerBudgetTokens: input.developerBudgetTokens,
  });
  let hash = 0x811c9dc5;
  for (let i = 0; i < stable.length; i++) {
    hash ^= stable.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * 指纹变更触发判定（装配 PreTurn 检查点消费）：最新**已结算**压缩的 compHash
 * 与当前指纹**双值齐备且不等**才发压缩请求（codex·session/turn.rs:1304 纪律——
 * "A missing hash does not provide enough information to trigger compaction"，
 * 旧流无指纹 / 引擎未接指纹都不触发）；指纹相同不重压。
 */
export function compHashChangeRequest(
  events: readonly SessionEvent[],
  currentHash: string | undefined,
): CompactionRequest | null {
  if (currentHash === undefined) return null;
  let latest: Extract<SessionEvent, { type: "compaction" }> | undefined;
  for (const e of effectiveEvents(events)) {
    if (e.type === "compaction" && (e.status === undefined || e.status === "completed")) {
      latest = e;
    }
  }
  const previous = latest?.compHash;
  if (previous === undefined || previous === currentHash) return null;
  return { reason: "comp-hash-changed" };
}

/**
 * provider 错误 → 压缩请求；非超限错误返回 null（错误按原路径处理，绝不在
 * 此吞掉——F10：恢复失败保留 provider 原始错误）。
 */
export function compactionRequestFromProviderError(
  error: unknown,
): CompactionRequest | null {
  if (!isContextWindowExceeded(error)) return null;
  return {
    reason: "provider-overflow",
    message: error instanceof Error ? error.message : String(error),
  };
}

// ---------------------------------------------------------------------------
// 相位（F21 / Q13 两相位）
// ---------------------------------------------------------------------------

export const COMPACTION_PHASES = ["PreTurn", "MidTurn"] as const;
export type CompactionPhase = (typeof COMPACTION_PHASES)[number];

/**
 * zcode·turn-loop.ts:68 同款判定（`modelStepCount === 0 ? PreRequest : MidTurn`）：
 * 入参是本 turn **已完成**的模型 step 数——0 表示第一次模型请求尚未发出（PreTurn），
 * 已有完成 step 则处于轮中（MidTurn，step 边界触发面）。
 */
/**
 * 相位的事件面值映射（F20/F21 的 PascalCase → 事件载荷 snake_case——
 * codex facts.rs serde rename_all = "snake_case" 同款序列化纪律）。
 */
export function eventPhaseOf(phase: CompactionPhase): "pre_turn" | "mid_turn" {
  return phase === "PreTurn" ? "pre_turn" : "mid_turn";
}

export function phaseForCompletedSteps(completedModelSteps: number): CompactionPhase {
  return completedModelSteps === 0 ? "PreTurn" : "MidTurn";
}

// ---------------------------------------------------------------------------
// 生命周期（pre hook → 摘要 → compaction 事件 → post hook）
// ---------------------------------------------------------------------------

/** 传给 pre/post hook 的介入上下文（F20：观察者与执行者解耦的契约面）。 */
export interface CompactionInvocation {
  sessionId: string;
  /** 压缩归属的轮（PreTurn = 收尾中的当前轮；MidTurn = 进行中的轮）。 */
  turn: number;
  phase: CompactionPhase;
  request: CompactionRequest;
  /** 压缩前完整 token 计数（E12 整值）。 */
  tokensBefore: number;
}

/** post hook 看到的结算事实（压缩已落盘）。 */
export interface CompactionSettled extends CompactionInvocation {
  summary: string;
  retainedTail: number;
  /** `compaction` 事件的 seq。 */
  seq: number;
}

/** pre hook 裁决：proceed 放行 / abort 中止（中止后无新窗口、无 compaction 事件）。 */
export type PreCompactOutcome = { action: "proceed" } | { action: "abort"; reason?: string };

/**
 * 摘要生成器（装配注入）：P0 面 = 假摘要注入（测试剧本/截断摘要器，返回
 * string）；F5/T-P1-18 真摘要 = LLM 生成（llm-summarizer.ts，可带会话标题
 * 返回对象）。入参 messages 是被摘要覆盖区间（seq ≤ retainedTail）的模型
 * 可见消息。返回 string（无标题）或 {summary, title?}——string 形状保持
 * P0 注入面零改动。
 */
export type SummarizerOutput =
  | string
  | { summary: string; title?: string; usage?: TokenUsage };

export type Summarizer = (input: {
  messages: ChatMessage[];
  invocation: CompactionInvocation;
}) => Promise<SummarizerOutput>;

/**
 * 保留规则（F23 的不可丢消息与配平切点在 T-7-03/T-7-05 细化）：retainedFromEnd
 * = 从尾部保留最近 N 个 user/system 消息边界起的全部原文，其余变摘要。
 * 默认 1——最后一个用户请求必须原文保留（模型要看到当前指令）。
 */
export interface KeepRules {
  retainedFromEnd?: number;
}

export type CompactionResult =
  | {
      kind: "compacted";
      summary: string;
      retainedTail: number;
      tokensBefore: number;
      /** `compaction` 事件 seq；新窗口从该事件读取重建参数（T-7-03）。 */
      seq: number;
    }
  | { kind: "aborted"; by: "pre-hook"; reason?: string };

export interface CompactionEngineDeps {
  sessionId: string;
  store: SessionStore;
  summarizer: Summarizer;
  preHook?: (invocation: CompactionInvocation) => PreCompactOutcome | Promise<PreCompactOutcome>;
  postHook?: (settled: CompactionSettled) => void | Promise<void>;
  keepRules?: KeepRules;
  /**
   * 压缩抖动断路器（F28，T-7-07）：提供时在 run 入口（生命周期第 0 段，先于
   * pre hook）评估——连续"压缩后几乎无进展又压缩"达阈值即硬失败；压缩成功后
   * 落账。工具步骤的 recordCompletedToolStep 由 loop/装配侧调用。
   */
  rapidRefillGuard?: RapidRefillGuard;
  /**
   * 压缩指纹取值（F26/T-P1-100）：提供时三次落盘（started/failed/completed）
   * 都写入 compHash 载荷——下轮边界 compHashChangeRequest 据此判"配置指纹
   * 变了重压"。缺省不接 = 零行为变化（事件无 compHash、不触发指纹重压）。
   */
  compHash?: () => string | undefined;
  /**
   * 上下文窗口（F11/T-P1-101 兜底预算面）：提供时兜底检查点做硬安全复检
   * （近期窗口原文超窗 → checkpoint_oversized）。缺省 undefined = 跳过该复检。
   */
  contextWindow?: number;
}

/** 压缩触发入参：相位与轮号由触发方（turn 边界 / step 边界装配）决定。 */
export interface CompactionRunInput {
  turn: number;
  phase: CompactionPhase;
  request: CompactionRequest;
  /**
   * 触发方式（F11/T-P1-101）：auto = 引擎自动（溢出/换模/指纹——失败走
   * 二级近期窗口兜底，run 不终止）；manual = 用户显式（/compact 命令面
   * ——ADR 0282 "keeps its fail-fast, no-fallback semantics"：失败照抛）。
   * 缺省 auto。事件 trigger 载荷同源（既有字段，值域不变）。
   */
  trigger?: "auto" | "manual";
}

/**
 * 压缩引擎：生命周期的执行体。切点从事件流内容现算（F17 的纪律；本卡用
 * user/system 边界策略，T-7-05 换成工具调用-结果配平状态机），覆盖范围是
 * 有效视窗（最新 session/revert 标记内——绝不摘要已被 revert 的内容）。
 */
export class CompactionEngine {
  constructor(private readonly deps: CompactionEngineDeps) {}

  async run(input: CompactionRunInput): Promise<CompactionResult> {
    const { sessionId, store } = this.deps;
    // 生命周期第 0 段：抖动断路器（F28）——拟算计数，达阈值即硬失败
    //（错误带全计数）。拟算值只在压缩成功后落账（阻断时状态冻结，干活解锁）。
    const refillDecision = this.deps.rapidRefillGuard?.evaluate();
    if (refillDecision?.shouldBlock) {
      throw new RapidRefillError(refillDecision);
    }
    // F26：压缩指纹（本 run 的配置指纹——三次落盘同值，取值时点在 run 入口）。
    const compHash = this.deps.compHash?.();

    const events = effectiveEvents(store.load(sessionId));
    const tokensBefore = tokensBeforeOf(events);
    const retainedTail = chooseRetainedTail(
      events,
      this.deps.keepRules?.retainedFromEnd ?? DEFAULT_RETAINED_FROM_END,
    );

    const invocation: CompactionInvocation = {
      sessionId,
      turn: input.turn,
      phase: input.phase,
      request: input.request,
      tokensBefore,
    };

    // 生命周期第 1 段：pre hook 可中止（中止 = 无摘要、无 compaction 事件、
    // 无新窗口——"hook 可介入/中止"的唯一裁决点）。
    if (this.deps.preHook) {
      const outcome = await this.deps.preHook(invocation);
      if (outcome.action === "abort") {
        return { kind: "aborted", by: "pre-hook", ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}) };
      }
    }

    // 生命周期第 1.5 段（E17/T-P1-93）：**started 中间态落流**——摘要调用前
    // 的原子操作开始事实（"原子操作的中间态也进事件流，投影不猜"）。此后
    // 崩溃 → 流内最后压缩事实是 started（restore 后投影可见"压缩进行中/未
    // 完成"），绝不静默丢失。载荷形状：summary/retainedTail 在 started 时点
    // 尚不存在——空串/0 是 started 时点的"完整状态"（E12），消费面按 status
    // 区分（new-window 只认 completed；投影如实记录）。
    store.append(sessionId, [
      {
        type: "compaction",
        turn: input.turn,
        summary: "",
        retainedTail: 0,
        tokensBefore,
        reason: compactionReasonOf(input.request),
        trigger: input.trigger ?? "auto",
        phase: eventPhaseOf(input.phase),
        implementation: "llm-summarizer",
        strategy: "full_summary",
        status: "started",
        ...(compHash !== undefined ? { compHash } : {}),
      },
    ]);

    // 摘要生成（被摘要区间 = 切点之前）。F5/T-P1-18：真摘要可带会话标题
    // 与 usage（SummarizerOutput 对象形状）；string 形状 = P0 假摘要注入面。
    let generated: { summary: string; title?: string; usage?: TokenUsage };
    try {
      const output = await this.deps.summarizer({
        messages: buildChatMessages(events, { upToSeq: retainedTail }),
        invocation,
      });
      generated = typeof output === "string" ? { summary: output } : output;
    } catch (e) {
      const failureReason =
        e instanceof SummaryGenerationError ? e.failureReason : "summary_provider";
      // manual 触发（用户显式 /compact 域——ADR 0282 fail-fast，no-fallback）：
      // E17 摘要失败升**流内事实**（status:"failed"）再上抛。
      if (input.trigger === "manual") {
        store.append(sessionId, [
          {
            type: "compaction",
            turn: input.turn,
            summary: "",
            retainedTail: 0,
            tokensBefore,
            reason: compactionReasonOf(input.request),
            trigger: input.trigger,
            phase: eventPhaseOf(input.phase),
            implementation: "llm-summarizer",
            strategy: "full_summary",
            status: "failed",
            failureReason,
            ...(compHash !== undefined ? { compHash } : {}),
          },
        ]);
        throw e;
      }
      // F11 二级兜底（auto，ADR 0049/0302）：摘要失败不再终止 run——落
      // "近期窗口检查点"（前次摘要携带 + 恢复标记 + 近期原文窗口）。兜底
      // 不可行（no_new_history / checkpoint_oversized）→ failed 事件 + 原错上抛。
      const fallback = await this.buildFallbackCheckpoint({
        events,
        retainedTail,
        input,
        tokensBefore,
        compHash,
        failureReason,
        refillDecision,
      });
      if (fallback.kind !== "infeasible") return fallback;
      // 不可行的终局归因 = 兜底为何没装上（checkpoint_oversized /
      // no_new_history）——比摘要侧原因更接近终局事实
      store.append(sessionId, [
        {
          type: "compaction",
          turn: input.turn,
          summary: "",
          retainedTail: 0,
          tokensBefore,
          reason: compactionReasonOf(input.request),
          trigger: input.trigger ?? "auto",
          phase: eventPhaseOf(input.phase),
          implementation: "llm-summarizer",
          strategy: "full_summary",
          status: "failed",
          failureReason: fallback.reason,
          ...(compHash !== undefined ? { compHash } : {}),
        },
      ]);
      throw e;
    }
    // 标题只在**首摘要**记录（会话级元事实，首摘要定名）。events 是本次压缩
    // 落盘前的有效视窗——其中无**已结算**压缩事件即本次是首摘要（E17 两段化
    // 后流内 started/failed 不算——title 判据与 new-window 的切换权威同口径）。
    const isFirstCompaction = !events.some(
      (e) => e.type === "compaction" && (e.status === undefined || e.status === "completed"),
    );
    const title =
      generated.title !== undefined && isFirstCompaction
        ? generated.title
        : undefined;

    // 生命周期第 2 段：compaction 事件落盘（词汇表 §3.2#12：整值载荷；reason
    // 按 codex CompactionReason 词表，F24 的换模压缩可从事件流回放）。
    const [committed] = store.append(sessionId, [
      {
        type: "compaction",
        turn: input.turn,
        summary: generated.summary,
        retainedTail,
        tokensBefore,
        reason: compactionReasonOf(input.request),
        // L8 六维度量（T-P1-92，codex facts.rs 对位）：trigger 随入参
        // （manual 槽位由 F11 兑现为引擎参数面）；implementation 唯一直值；
        // strategy 收闭集 {full_summary, recent_window_fallback}（#18）。
        trigger: input.trigger ?? "auto",
        phase: eventPhaseOf(input.phase),
        implementation: "llm-summarizer",
        strategy: "full_summary",
        status: "completed",
        ...(title !== undefined ? { title } : {}),
        ...(generated.usage !== undefined ? { usage: generated.usage } : {}),
        ...(compHash !== undefined ? { compHash } : {}),
      },
    ]);
    const seq = committed!.seq;

    // 生命周期第 3 段：post hook 观察（压缩已落盘，只观察不回滚）。
    const settled: CompactionSettled = { ...invocation, summary: generated.summary, retainedTail, seq };
    if (this.deps.postHook) await this.deps.postHook(settled);

    // 压缩成功落账抖动计数（拟算值此时才生效；F28）。
    if (refillDecision && this.deps.rapidRefillGuard) {
      this.deps.rapidRefillGuard.recordCompactSuccess(refillDecision);
    }

    return { kind: "compacted", summary: generated.summary, retainedTail, tokensBefore, seq };
  }

  /**
   * F11 二级兜底（ADR 0049/0302）：摘要生成失败后的"近期窗口检查点"——
   * 摘要位 = 前次已结算摘要携带 + 恢复标记（**不落 provider 错误原文**，
   * 闭集 failureReason）；retainedTail = 近期窗口切点（切点后的原文保留，
   * `latestBalancedCutAtOrBefore` 保证不劈开 tool 配对——"a provider rejects
   * a result whose call is missing"）。红线：事件流本体逐字节不变（兜底
   * 只换模型可见视图——compaction 事件是 append 的新事实，不改写历史）。
   * 返回 null = 兜底不可行（调用方落 failed 事件 + 上抛）。
   */
  private async buildFallbackCheckpoint(input: {
    events: readonly SessionEvent[];
    retainedTail: number;
    input: CompactionRunInput;
    tokensBefore: number;
    compHash: string | undefined;
    failureReason: string;
    refillDecision: ReturnType<RapidRefillGuard["evaluate"]> | undefined;
  }): Promise<CompactionResult | { kind: "infeasible"; reason: "no_new_history" | "checkpoint_oversized" }> {
    const { events, retainedTail, input: run, tokensBefore, compHash, failureReason, refillDecision } = input;
    const { sessionId, store } = this.deps;
    // no_new_history：被摘要区间没有任何模型可见消息（空区间——ADR 0302
    // 闭值），兜底窗口无从谈起。
    const hasCompactedMessages = events.some(
      (e) =>
        e.seq <= retainedTail &&
        (e.type === "user/message" || e.type === "assistant/message" || e.type === "system/message"),
    );
    // 近期窗口切点：消息边界升序逐个取配平切点（窗口 = 切点之后原文），
    // **首个 fitting 的边界给出 ≤ 保留目标的最大窗口**——近期上下文保留
    // 最大化；全部超目标时停在最小窗口（最后一条用户指令必保，
    // chooseRetainedTail 同款形状）。每一步都是配平切点——不劈开 tool 配对。
    const boundaries = events.filter(
      (e) => e.type === "user/message" || e.type === "system/message",
    );
    if (boundaries.length === 0) return { kind: "infeasible", reason: "no_new_history" };
    let cut = 0;
    for (const b of boundaries) {
      const candidate = latestBalancedCutAtOrBefore(events, b.seq - 1);
      cut = candidate;
      const rawTokens = estimateMessagesTokens(
        buildChatMessages(events.filter((ev) => ev.seq > candidate)),
      );
      if (rawTokens <= RECENT_WINDOW_TARGET_TOKENS) break;
    }
    // checkpoint_oversized：硬安全复检（contextWindow 提供时）——最小窗口
    // 仍超窗即兜底不可行（ADR 0049 "fallback checkpoints that remain
    // oversized emit CONTEXT_COMPACTION_FAILED"）。
    const rawAfterCut = buildChatMessages(events.filter((ev) => ev.seq > cut));
    if (!hasCompactedMessages) return { kind: "infeasible", reason: "no_new_history" };
    if (
      this.deps.contextWindow !== undefined &&
      estimateMessagesTokens(rawAfterCut) > this.deps.contextWindow
    ) {
      return { kind: "infeasible", reason: "checkpoint_oversized" };
    }
    // 前次已结算摘要（events 快照取自 started 落盘前——天然不含本次 run）。
    const previous = [...events]
      .reverse()
      .find(
        (e): e is Extract<SessionEvent, { type: "compaction" }> =>
          e.type === "compaction" && (e.status === undefined || e.status === "completed"),
      );
    const marker =
      `[压缩恢复标记] 本次摘要生成失败（${failureReason}）。上方为最近一次有效摘要` +
      `（可能滞后于实际进度）；下方保留近期窗口原文。完整历史仍在事件流中。`;
    const summary = previous !== undefined ? `${previous.summary}\n\n${marker}` : marker;

    const [committed] = store.append(sessionId, [
      {
        type: "compaction",
        turn: run.turn,
        summary,
        retainedTail: cut,
        tokensBefore,
        reason: compactionReasonOf(run.request),
        trigger: run.trigger ?? "auto",
        phase: eventPhaseOf(run.phase),
        implementation: "llm-summarizer",
        strategy: "recent_window_fallback",
        status: "completed",
        failureReason,
        ...(compHash !== undefined ? { compHash } : {}),
      },
    ]);
    const seq = committed!.seq;
    // post hook 观察（兜底检查点已落盘——ADR 0049 "A successful fallback
    // emits compaction_end"；观察者与成功摘要同面，renderer 告警由 strategy 值区分）。
    const invocation: CompactionInvocation = {
      sessionId,
      turn: run.turn,
      phase: run.phase,
      request: run.request,
      tokensBefore,
    };
    const settled: CompactionSettled = { ...invocation, summary, retainedTail: cut, seq };
    if (this.deps.postHook) await this.deps.postHook(settled);
    // 兜底检查点同样降低上下文压力——抖动计数落账（F28 口径一致）。
    if (refillDecision && this.deps.rapidRefillGuard) {
      this.deps.rapidRefillGuard.recordCompactSuccess(refillDecision);
    }
    return { kind: "compacted", summary, retainedTail: cut, tokensBefore, seq };
  }
}

/**
 * 压缩前 token 计数：优先 provider 送达的 usage（最近一条带 usage 的
 * assistant 消息，totalTokens 缺失时 input+output 折算），无 usage 时退回
 * 本地估算（overflow.ts 的保守估算——方向注释见该文件头）。
 */
function tokensBeforeOf(events: readonly SessionEvent[]): number {
  const projection = Projector.fold(events).projection;
  const usage = projection.lastUsage;
  if (usage) {
    return usage.totalTokens ?? usage.inputTokens + usage.outputTokens;
  }
  return estimateMessagesTokens(buildChatMessages(events));
}

/**
 * P0 切点：从尾部往回数第 N 个 user/system 消息边界，保留该消息及其后全部
 * 原文——retainedTail = 边界前一条事件的 seq（词汇表语义："新窗口从该 seq
 * 之后的事件重建"）。F17（T-7-05）：候选边界**不配平**（悬挂 tool/call 的
 * 崩溃残留等）时自动回退到最近的配平切点——内容现算，绝不依赖 step 标记，
 * 宁可少摘要也不劈开 assistant 工具调用与其结果。边界不足（消息太少）时
 * 全摘要：retainedTail = 配平验证过的流尾。
 */
function chooseRetainedTail(events: readonly SessionEvent[], retainedFromEnd: number): number {
  let found = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "user/message" || e.type === "system/message") {
      found++;
      if (found === retainedFromEnd) {
        return latestBalancedCutAtOrBefore(events, e.seq - 1);
      }
    }
  }
  return latestBalancedCutAtOrBefore(
    events,
    events.length > 0 ? events[events.length - 1]!.seq : 0,
  );
}

