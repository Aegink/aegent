/**
 * 规则集模块（C2/Q15）——规则集是链中的一环，不是权威。
 *
 * 首匹配胜（first-match-wins）：规则按声明顺序求值，第一条匹配的规则
 * 生效，其后的永不生效——宽规则在前会遮住窄规则（验收②用例钉死）。
 * 这与 OpenCode 的 findLast（后匹配胜）方向相反，是有意的选择（Q15）。
 *
 * 本模块只管顺序语义；规则怎么算"匹配"是独立的关注点——双维通配
 * （C3/C4）在 evaluate.ts（T-5-02），参数匹配委托工具自身（C21）在
 * T-5-05。这里通过 match 注入匹配函数，规则形状对链保持透明。
 */

import type {
  PolicyAction,
  PolicyCall,
  PolicyModule,
  PolicyOutcome,
} from "./chain.js";
import type { DenialShape } from "./denial.js";

export interface RuleSetOptions<R> {
  readonly name: string;
  /** 声明顺序即优先级（首匹配胜，与 OpenCode findLast 相反）。 */
  readonly rules: readonly R[];
  /** 返回 undefined = 该规则不匹配本次调用（只是没命中，不是拒绝）。 */
  readonly match: (rule: R, call: PolicyCall) => PolicyAction | undefined;
  /**
   * 规则原文渲染（C18 的 verdict.rule 证据）——提供时，命中裁决附带
   * 该规则的原文（T-5-05 的加载器将传 raw 保留的原文）；不提供则裁决
   * 不带 rule 字段。
   */
  readonly ruleText?: (rule: R) => string;
  /**
   * C55 结构化拒绝面（T-P2-202）：命中规则声明了 justification/
   * alternatives 时构造拒绝形状（reason 字段 = 规则原文，与 ruleText
   * 同源）；不提供或规则无声明数据则裁决不带 denial——渲染在 gate 层。
   */
  readonly ruleDenial?: (rule: R) => DenialShape | undefined;
}

/**
 * 把一组有序规则装配成链上的一个策略模块：首条匹配规则的 action 即本
 * 模块裁决，全部不命中则弃权（undefined），把裁决权交还链上下一个模块。
 */
export function createRuleSetModule<R>(
  options: RuleSetOptions<R>,
): PolicyModule {
  const { name, rules, match, ruleText, ruleDenial } = options;
  return {
    name,
    async evaluate(call: PolicyCall): Promise<PolicyOutcome | undefined> {
      for (const rule of rules) {
        const action = match(rule, call);
        if (action !== undefined) {
          const denial = ruleDenial !== undefined ? ruleDenial(rule) : undefined;
          return {
            action,
            ...(ruleText !== undefined ? { rule: ruleText(rule) } : {}),
            ...(denial !== undefined ? { denial } : {}),
          };
        }
      }
      return undefined;
    },
  };
}
