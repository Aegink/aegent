/**
 * 参数匹配委托（C21）——工具自己解释自己的参数怎么匹配规则。
 *
 * 形状取 kimi·matchesRule.ts：策略引擎只负责把规则的参数模式串
 * （argPattern）拆出来交下去，怎么算"参数命中"由工具的匹配器回答。
 * T-P1-68 分型路由后，链上匹配由 loadedRuleMatch 按 getSpecifierKind
 * 分派（command/path/domain/literal 四分型全有内置匹配语义）；本模块
 * 的注册表承载 C44 样例校验与批准提案（proposeAmendment）等按工具名
 * 精确查表的消费面。sampleCall 用于加载期样例校验（C44）：把一条样本
 * 字符串构造成该工具的调用形状，让校验与运行时走同一条委托路径，
 * 避免两套匹配逻辑分叉。
 */

import type { PolicyCall } from "./chain.js";
import { wildcardMatch } from "./evaluate.js";
import { pathRuleMatcher, domainRuleMatcher } from "./specifier-kinds.js";

export interface RuleMatchable {
  /** 本次调用的参数是否匹配规则的参数模式（argPattern 由引擎解析交下）。 */
  matchesRule(argPattern: string, call: PolicyCall): boolean;
  /** 把样本字符串构造成该工具的调用形状（加载期样例校验用）。 */
  sampleCall(sample: string): PolicyCall;
  /**
   * 本调用的 pattern 维度取值（C48 引擎计算规则提案用）。无法提取时
   * 返回 undefined——该调用的批准只对本次有效，不能升级为规则。
   */
  patternOf?(call: PolicyCall): string | undefined;
}

/** bash 匹配器：模式串按 evaluate.ts 的通配方言匹配命令原文。 */
export const bashRuleMatcher: RuleMatchable = {
  matchesRule(argPattern, call) {
    const command = call.args.command;
    return typeof command === "string" && wildcardMatch(command, argPattern);
  },
  sampleCall(sample) {
    return { tool: "bash", args: { command: sample } };
  },
  patternOf(call) {
    const command = call.args.command;
    return typeof command === "string" ? command : undefined;
  },
};

/**
 * P0 内置匹配器注册表（键 = 注册表工具名（小写），与 PolicyCall.tool
 * 严格一致）。T-P1-68 分型路由后链上匹配经 loadedRuleMatch 按
 * getSpecifierKind 分派（command/path/domain/literal 全覆盖），本表
 * 保留给 C44 加载期样例校验（matchExamples 走同一匹配语义）与批准
 * 提案（proposeAmendment）等按工具名精确查表的消费面。path/domain
 * 分型注册进表使样例校验可用；literal 分型因 sampleCall 形状工具相关
 * 不注册（literal 工具的样例校验按矛盾拒绝——宁严勿松）。
 */
export const builtinRuleMatchers: Readonly<Record<string, RuleMatchable>> = {
  bash: bashRuleMatcher,
  pwsh: bashRuleMatcher,
  read: pathRuleMatcher,
  write: pathRuleMatcher,
  edit: pathRuleMatcher,
  apply_patch: pathRuleMatcher,
  webfetch: domainRuleMatcher,
};
