/**
 * 参数匹配委托（C21）——工具自己解释自己的参数怎么匹配规则。
 *
 * 形状取 kimi·matchesRule.ts：策略引擎只负责把规则的参数模式串
 * （argPattern）拆出来交下去，怎么算"参数命中"由工具的匹配器回答；
 * 工具没有匹配器时，带参数模式的规则**永不命中**（kimi 同款的
 * fail-closed：引擎不能替工具猜语义，猜错即放行）。
 *
 * sampleCall 用于加载期样例校验（C44）：把一条样本字符串构造成该工具
 * 的调用形状，让校验与运行时走同一条委托路径，避免两套匹配逻辑分叉。
 */

import type { PolicyCall } from "./chain.js";
import { wildcardMatch } from "./evaluate.js";

export interface RuleMatchable {
  /** 本次调用的参数是否匹配规则的参数模式（argPattern 由引擎解析交下）。 */
  matchesRule(argPattern: string, call: PolicyCall): boolean;
  /** 把样本字符串构造成该工具的调用形状（加载期样例校验用）。 */
  sampleCall(sample: string): PolicyCall;
}

/** bash 匹配器：模式串按 evaluate.ts 的通配方言匹配命令原文。 */
export const bashRuleMatcher: RuleMatchable = {
  matchesRule(argPattern, call) {
    const command = call.args.command;
    return typeof command === "string" && wildcardMatch(command, argPattern);
  },
  sampleCall(sample) {
    return { tool: "Bash", args: { command: sample } };
  },
};

/**
 * P0 内置匹配器注册表（卡面"先 bash"）。新工具实现 RuleMatchable 后在
 * 此登记；未登记工具的带参规则在 loadedRuleMatch 里永不命中（见上）。
 */
export const builtinRuleMatchers: Readonly<Record<string, RuleMatchable>> = {
  Bash: bashRuleMatcher,
};
