/**
 * 批准作用域与规则提案（C47/C48）。
 *
 * 形状取 codex·protocol.rs 的 ReviewDecision 变体族（Approved /
 * ApprovedForSession / ApprovedExecpolicyAmendment / Denied…）：批准是
 * 一次带作用域的决策，"本次放行"与"放行并记住"是不同的变体。
 *
 * C48 的结构纪律：**规则提案由引擎计算**（proposeAmendment 从工具调用
 * 提取），审批人只能对"引擎算好的提案 + 作用域"表态；模型侧永远只能
 * 发命令（工具调用），不能发提案——stripProposedAmendments 把模型参数
 * 里捎带的提案字段剥除并出警告（防御纵深：引擎本就只信自己算的提案，
 * 剥除是为了让"模型试图夹带"可被观测）。
 *
 * 持久化边界（卡面）：P0 只落一次性（不缓存）与会话（进程内缓存）；
 * project / user / managed 三档作用域只在枚举里占位，持久化随 C22 P1。
 */

import type { JsonRecord } from "../core/index.js";
import type { PolicyCall, PolicyModule } from "./chain.js";
import type { RuleMatchable } from "./matchers.js";

// ---------------------------------------------------------------------------
// 作用域与决策（C47）
// ---------------------------------------------------------------------------

/** 批准的持久化作用域（C47 五档；P0 持久化只做前两档）。 */
export const REVIEW_SCOPES = [
  "once",
  "session",
  "project",
  "user",
  "managed",
] as const;

export type ReviewScope = (typeof REVIEW_SCOPES)[number];

// 穷尽闸门（C16 同款自觉）：REVIEW_SCOPES 漏变体编译期失败。
type _ScopeExhaustive = Exclude<ReviewScope, (typeof REVIEW_SCOPES)[number]> extends never
  ? true
  : never;
const _SCOPE_EXHAUSTIVE: _ScopeExhaustive = true;
void _SCOPE_EXHAUSTIVE;

/** 审批人的决定：放行（带作用域）或拒绝。deny 无作用域可言（无物可记）。 */
export type ReviewDecision =
  | { readonly action: "allow"; readonly scope: ReviewScope }
  | { readonly action: "deny"; readonly reason?: string };

// ---------------------------------------------------------------------------
// 规则提案（C48：引擎算，模型不发）
// ---------------------------------------------------------------------------

/** 引擎计算出的规则提案：审批人接受后按所选作用域生效。 */
export interface RuleProposal {
  /** 规则原文（如 bash(git status)），与 C18 的 verdict.rule 同一形状。 */
  readonly raw: string;
  readonly permission: string;
  readonly pattern: string;
}

/**
 * 从工具调用计算提案：pattern 维度由该工具的匹配器提供（C21 同一知识
 * 面）。工具缺席/无法提取时返回 undefined——本次批准只能一次性，不能
 * 升级为规则。P0 提案粒度是精确调用值（bash 即完整命令原文），放宽
 * 粒度属审批 UX，P1 再议。
 */
export function proposeAmendment(
  call: PolicyCall,
  matchers: Readonly<Record<string, RuleMatchable>>,
): RuleProposal | undefined {
  const pattern = matchers[call.tool]?.patternOf?.(call);
  if (pattern === undefined) return undefined;
  return { raw: `${call.tool}(${pattern})`, permission: call.tool, pattern };
}

// 模型参数里捎带规则提案的保留键（大小写不敏感剥除）。闭集是已知的
// 局限：模型可发明别的键名——结构保证是引擎从不读模型输出的提案，
// 剥除只为观测"试图夹带"。
const RESERVED_PROPOSAL_KEYS: ReadonlySet<string> = new Set([
  "ruleproposal",
  "proposedrule",
  "proposedamendment",
  "permissionproposal",
]);

export interface StripProposalsResult {
  /** 剥除后的参数（无保留键时为原引用）。只扫顶层键，不深挖值。 */
  readonly args: JsonRecord;
  readonly strippedKeys: readonly string[];
  /** 人话警告记录（C15 下无对应 session 事件类型，由接线方决定去向）。 */
  readonly warnings: readonly string[];
}

/** 剥除模型工具调用参数里捎带的规则提案字段（验收①）。 */
export function stripProposedAmendments(args: JsonRecord): StripProposalsResult {
  const strippedKeys: string[] = [];
  const warnings: string[] = [];
  const cleaned: JsonRecord = {};
  let touched = false;
  for (const [key, value] of Object.entries(args)) {
    if (RESERVED_PROPOSAL_KEYS.has(key.toLowerCase())) {
      strippedKeys.push(key);
      warnings.push(
        `模型消息携带规则提案字段 "${key}"（值已剥除）——` +
          "规则提案由引擎计算，模型只能发命令（C48）",
      );
      touched = true;
      continue;
    }
    cleaned[key] = value;
  }
  return touched
    ? { args: cleaned, strippedKeys, warnings }
    : { args, strippedKeys, warnings };
}

// ---------------------------------------------------------------------------
// 会话级批准缓存（C47 的 session 档）
// ---------------------------------------------------------------------------

/**
 * 会话级批准缓存：scope=session 的批准记入，同会话同规则后续调用免问；
 * 新会话重新询问。进程内 Map（P0 单进程；跨进程恢复随恢复路径 P1）。
 *
 * C34（T-P1-69）：仓库自带配置授予的批准带 trustGated 标记——信任变化
 * 时**不移除记录而读当前信任**（qwen trustGated 同款：过滤不记账），
 * 未信任时该批准不生效、恢复信任即还原。
 */
export class ApprovalScopeCache {
  /** sessionId → (ruleRaw → 是否 trustGated)。 */
  private readonly approved = new Map<string, Map<string, boolean>>();

  constructor(private readonly nowSessionId?: string) {}

  /**
   * 记录一次批准。仅 scope=session 生效：once 不留痕；project / user /
   * managed 的持久化随 C22 P1，P0 显式不缓存（宁可多问不可多放）。
   * trustGated：该批准来自仓库自带配置（C34），仅信任期间生效。
   */
  record(
    sessionId: string,
    ruleRaw: string,
    scope: ReviewScope,
    options?: { trustGated?: boolean },
  ): void {
    if (scope !== "session") return;
    let rules = this.approved.get(sessionId);
    if (rules === undefined) {
      rules = new Map();
      this.approved.set(sessionId, rules);
    }
    rules.set(ruleRaw, options?.trustGated ?? false);
  }

  /**
   * 查询批准。trusted === false 时 trustGated 批准不生效（C34 每次读
   * 当前信任——撤销即刻暂停、恢复即还原）；其余照常。
   */
  isApproved(
    sessionId: string,
    ruleRaw: string,
    options?: { trusted?: boolean },
  ): boolean {
    const trustGated = this.approved.get(sessionId)?.get(ruleRaw);
    if (trustGated === undefined) return false;
    if (trustGated && options?.trusted === false) return false;
    return true;
  }
}

/**
 * 会话批准历史作为链上一环（kimi SessionApprovalHistory 同位）：已有
 * 会话级批准的调用直接放行（带规则原文证据），否则弃权交后续模块。
 * sessionId 装配期绑定——链按会话组装（P0 单会话单链）。
 */
export function createSessionApprovalModule(options: {
  readonly cache: ApprovalScopeCache;
  readonly sessionId: string;
  readonly matchers: Readonly<Record<string, RuleMatchable>>;
  /**
   * C34 项目信任活查询（T-P1-69）：trustGated 批准仅信任期间生效。
   * 每次评估活查询（每次决策读当前信任）；缺省 = 未启用（全部照常）。
   */
  readonly trustState?: () => boolean | undefined;
  readonly name?: string;
}): PolicyModule {
  const { cache, sessionId, matchers } = options;
  return {
    name: options.name ?? "session-approval-history",
    async evaluate(call) {
      const proposal = proposeAmendment(call, matchers);
      if (proposal === undefined) return undefined;
      if (!cache.isApproved(sessionId, proposal.raw, { trusted: options.trustState?.() }))
        return undefined;
      return {
        action: "allow",
        rule: proposal.raw,
        reason: `会话级批准（scope=session）：同会话同规则免再询问（C47）`,
      };
    },
  };
}
