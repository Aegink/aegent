/**
 * LLM 判官端口（C56，T-P1-80）——**只落四件纪律的接口面，不做判官本体**
 * （C42 两阶段判官是 P2；本文件是它的承载位与验收面）。
 *
 * 四件事（codex·guardian 对应物）：
 *   1. **abstain 落回人**：判官只产 allow/deny/abstain 三值闭集——abstain
 *      是显式结果而非缺省：gate 侧 abstain 一律落回既有 broker ask 通道
 *      （人不在场的静默放行是 C56 要防的"隐式放行"，静默拒绝同理）。
 *      codex GuardianAssessmentOutcome {Allow, Deny} 二值 + Status
 *      {TimedOut, Aborted} 显式状态的同构对应物。
 *   2. **判官自身预算**：输入字符上界 + 每会话请求次数上界（codex
 *      input_budget.rs / request_budget.rs·ExhaustedReviewBudget 同构）。
 *      预算耗尽 → 判官不被调 → 直接落回 ask——**预算耗尽不放行**。
 *   3. **超时常量被上层复用**：JUDGE_REVIEW_TIMEOUT_MS 导出常量，gate
 *      接线用它做调用超时（codex ext/guardian-reviewer lib.rs:41
 *      REVIEW_TIMEOUT = 90s pub const——reporting.rs 复用上报的同款纪律）。
 *   4. **受管可强制**：requireJudge 位——受管策略可要求 ask 必须经判官；
 *      判官 abstain/不可用 → 类型化失败而非静默（codex
 *      GuardianReviewOptions.require_guardian——"Requires Guardian rather
 *      than a manual approval"）。
 */

import type { JsonRecord } from "../core/index.js";

// ---------------------------------------------------------------------------
// 请求 / 裁决闭集
// ---------------------------------------------------------------------------

/** 判官复核请求：为何询问（原裁决证据）+ 调用事实。 */
export interface JudgeRequest {
  readonly tool: string;
  readonly args: JsonRecord;
  readonly sessionId: string;
  /** 原裁决理由（便宜路径为何落到 ask——判官修正假阳性的依据）。 */
  readonly askReason: string;
  /**
   * 取消信号（C42/T-P2-203 判官本体的 abort 语义面）：用户取消 → 判官
   * abstain（非失败、不计错误）。gate 当前无 turn 级 signal 面，缺省
   * 不传——信号接线随 loop 信号面扩展（记档）。
   */
  readonly signal?: AbortSignal;
}

/** 判官裁决闭集：abstain 是显式结果（不是缺省、不是失败吞没）。 */
export type JudgeVerdict =
  | { readonly outcome: "allow"; readonly reason: string }
  | { readonly outcome: "deny"; readonly reason: string }
  | { readonly outcome: "abstain"; readonly reason: string };

/** 判官端口——本体在 P2 C42（两阶段 LLM 判官），本批只定端口纪律。 */
export interface JudgePort {
  readonly name: string;
  review(request: JudgeRequest): Promise<JudgeVerdict>;
}

// ---------------------------------------------------------------------------
// 判官自身预算（codex input_budget / request_budget 同构）
// ---------------------------------------------------------------------------

/**
 * 判官输入字符上界：超过即预算拒绝（判官不被调，落回 ask）。刻意保守
 * ——判官输入含工具参数与原裁决证据，失控参数不进判官提示。
 */
export const JUDGE_INPUT_BUDGET_CHARS = 8_000;

/**
 * 每会话判官请求次数上界：判官是贵路径（LLM 调用），次数失控 = 成本
 * 失控；耗尽即判官退场，全部落回 ask（人兜底，不是放行兜底）。
 */
export const JUDGE_REQUESTS_PER_SESSION = 20;

/**
 * 判官调用超时（毫秒）——**刻意宽松**（90s）：判官本体要跑完整 LLM
 * 推理链（两阶段 C42 的预判 + 修正），超短超时会造成大量假 abstain、
 * 把判定成本转嫁给用户（每次假 abstain = 一次人工审批）；宽松超时 +
 * abstain 落回人的组合，宁慢不漏。导出常量被 gate 接线复用（上层不
 * 各自发明超时值——codex REVIEW_TIMEOUT pub const 同款纪律）。
 */
export const JUDGE_REVIEW_TIMEOUT_MS = 90_000;

/** 会话级预算记账：次数 + 输入字符双面（纯内存，随会话灭）。 */
export class JudgeBudgetTracker {
  private requests = 0;
  private chars = 0;

  /** 判官是否还有预算（次数与字符任一耗尽即无预算）。 */
  hasBudget(): boolean {
    return (
      this.requests < JUDGE_REQUESTS_PER_SESSION &&
      this.chars < JUDGE_INPUT_BUDGET_CHARS
    );
  }

  /** 记账一次判官调用（调前 hasBudget、调后 expend——调用方负责次序）。 */
  expend(inputChars: number): void {
    this.requests += 1;
    this.chars += inputChars;
  }

  /** 观测面：已消耗请求数 / 字符数（诊断与测试用）。 */
  usage(): { requests: number; chars: number } {
    return { requests: this.requests, chars: this.chars };
  }
}

/** 受管强制位下判官不可用的类型化错误（非静默——落回人也不是静默）。 */
export const JUDGE_UNAVAILABLE = "JUDGE_UNAVAILABLE";

export class JudgeUnavailableError extends Error {
  readonly code = JUDGE_UNAVAILABLE;
  constructor(readonly tool: string) {
    super(
      `工具 ${tool} 的 ask 复核被受管策略强制要求判官，但判官 abstain/不可用（C56：受管可强制——类型化失败而非静默落回）`,
    );
  }
}
