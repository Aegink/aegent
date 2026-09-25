/**
 * max() 聚合（C43）——最严格者胜的全序合并。
 *
 * 全序取 codex·execpolicy 的 `matched_rules.iter().map(decision).max()`：
 * allow < ask < deny（codex 的 Allow < Prompt < Forbidden 同构），abstain
 * 作中性元（"没意见"不参与拉高也不拉低，max 的单位元）。
 *
 * 这是 C35（禁止自我修改权限）的**结构解**：合并是 max（单调），任何
 * 决策来源追加一条意见，结果只可能不变或更严——"加规则在数学上不可能
 * 放宽"。自我加白（往配置里塞 allow）因此在聚合层失效，不依赖防线外的
 * 自觉。
 *
 * 与链权威（T-5-01）的边界：链是**单来源内部**的裁决机制（首个非
 * undefined 者胜，谁裁决谁赢）；max() 是**多来源之间**的合并机制
 * （链裁决、硬拦出口、审批默认等各自一个意见，取最严）。两套语义
 * 并存、各管一层，不互相替代——见 aggregate.test 的边界用例。
 */

import type { Decision } from "./decision.js";

/** 全序（从严到严排：abstain 中性 < allow < ask < deny）。唯一定义处。 */
export const DECISION_ORDER = [
  "abstain",
  "allow",
  "ask",
  "deny",
] as const;

// C16 同款自觉：DECISION_ORDER 必须穷尽 Decision，漏变体编译期失败。
type _OrderExhaustive = Exclude<
  Decision,
  (typeof DECISION_ORDER)[number]
> extends never
  ? true
  : never;
const _ORDER_EXHAUSTIVE: _OrderExhaustive = true;
void _ORDER_EXHAUSTIVE;

/** 决策的严格度（越大越严）。 */
export function decisionSeverity(decision: Decision): number {
  return DECISION_ORDER.indexOf(decision);
}

/**
 * max 聚合：取最严意见。空集或全 abstain → abstain（无人有意见）。
 * 单调性（C43 验收①）：对任意决策集 S 与追加意见 d，
 * severity(max(S ∪ {d})) >= severity(max(S))。
 */
export function maxDecision(decisions: readonly Decision[]): Decision {
  let strictest: Decision = "abstain";
  for (const decision of decisions) {
    if (decisionSeverity(decision) > decisionSeverity(strictest)) {
      strictest = decision;
    }
  }
  return strictest;
}
