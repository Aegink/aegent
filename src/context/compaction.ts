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
import type { ChatMessage } from "../models/provider.js";

/** 压缩请求：溢出的两种来源（本地提前判定 / provider 拒绝）+ 换模压缩（F24）各自带齐上下文。 */
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
    };

/**
 * 事件 `compaction.reason` 的词表映射（codex·compact_model_fallback.rs:27-30 的
 * CompactionReason 序列化风格）：两种溢出源在事件面共用 codex 的 "context_limit"
 * （区分在 request 类型上）；换模压缩 = "model_downshift"（F24 验收字面值）。
 */
export function compactionReasonOf(request: CompactionRequest): string {
  switch (request.reason) {
    case "model-downshift":
      return "model_downshift";
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
export type SummarizerOutput = string | { summary: string; title?: string };

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
}

/** 压缩触发入参：相位与轮号由触发方（turn 边界 / step 边界装配）决定。 */
export interface CompactionRunInput {
  turn: number;
  phase: CompactionPhase;
  request: CompactionRequest;
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

    const events = effectiveEvents(store.load(sessionId));
    const tokensBefore = tokensBeforeOf(events);
    const retainedTail = chooseRetainedTail(events, this.deps.keepRules?.retainedFromEnd ?? 1);

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

    // 摘要生成（被摘要区间 = 切点之前）。F5/T-P1-18：真摘要可带会话标题
    // （SummarizerOutput 的对象形状）；string 形状 = P0 假摘要注入面。
    const output = await this.deps.summarizer({
      messages: buildChatMessages(events, { upToSeq: retainedTail }),
      invocation,
    });
    const generated =
      typeof output === "string" ? { summary: output } : output;
    // 标题只在**首摘要**记录（会话级元事实，首摘要定名；卡内定形"优先
    // 复用既有载荷"——compaction 事件可选 title 字段）。events 是本次压缩
    // 落盘前的有效视窗——其中无 compaction 事件即本次是首摘要。
    const isFirstCompaction = !events.some((e) => e.type === "compaction");
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
        ...(title !== undefined ? { title } : {}),
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

