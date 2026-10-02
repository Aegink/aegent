/**
 * 链上规则匹配（C21/C39/C40/C55，T-P2-202 自 rule-loader.ts 分出——
 * 文件行数纪律）——加载产物（LoadedRule）到链上匹配函数的桥：
 * loadedRuleMatch 配 createRuleSetModule 使用，loadedRuleText /
 * loadedRuleDenial 是规则原文回显与结构化拒绝面的回调。
 */

import type { PolicyAction, PolicyCall } from "./chain.js";
import type { DenialShape } from "./denial.js";
import { bashRuleMatcher } from "./matchers.js";
import { wildcardMatch } from "./evaluate.js";
import {
  getSpecifierKind,
  domainRuleMatcher,
  pathRuleMatcher,
  literalRuleMatcher,
  evaluateParamMatchers,
} from "./specifier-kinds.js";
import type { LoadedRule } from "./rule-loader.js";

/**
 * 链上规则匹配函数（C21/C39/C40）：工具名维度通配 + 参数维度按
 * getSpecifierKind(call.tool) 分型路由——command → bashRuleMatcher 的
 * shell glob（既有方言）、path → gitignore 风格、domain → host 后缀、
 * literal → 精确 + key:value。invalid 规则永不命中；MCP 命名空间工具
 * （server__tool）的规则带 specifier 时永不命中（qwen 同款 reject——
 * 工具名已编码 server+tool 身份，specifier 无从解释；C40 声明式参数
 * matcher 同样计入 specifier——带参的 MCP 规则 fail-closed 不静默放行，
 * qwen 的 MCP 参数匹配面我方不取，记档 T-P2-201）。
 *
 * C40（T-P2-201）：规则带 toolParamMatchers（文本解析产物或声明式合并）
 * 时，command/path/domain 分型在 specifier 命中后**再 AND 参数 matcher**
 * （qwen evaluateParamMatchers 在标准分支同位共享的语义）；无 matcher 的
 * 规则零变化。
 */
export function loadedRuleMatch(): (rule: LoadedRule, call: PolicyCall) => PolicyAction | undefined {
  return (rule, call) => {
    if (rule.invalid) return undefined;
    // T-P3-151：工具名维度大小写宽容——registry 小写注册（bash/read/...）
    // 而 rules.txt 文本面惯用大写（Bash(git status)），此前大写规则永不
    // 命中真实调用（fail-closed 死规则）；分型判定（parseRulePattern 同步
    // 修复）与匹配两侧归一后，规则文本与调用名大小写解耦。
    if (!wildcardMatch(call.tool.toLowerCase(), rule.toolName.toLowerCase())) return undefined;
    const hasSpecifier =
      rule.argPattern !== undefined || rule.toolParamMatchers !== undefined;
    if (!hasSpecifier) return rule.action;
    // MCP 命名空间带 specifier 拒配（不静默忽略——qwen 同款语义）
    if (call.tool.includes("__")) return undefined;
    if (
      rule.toolParamMatchers !== undefined &&
      !evaluateParamMatchers(rule.toolParamMatchers, call.args)
    ) {
      return undefined;
    }
    switch (getSpecifierKind(call.tool.toLowerCase())) {
      case "command":
        return bashRuleMatcher.matchesRule(rule.argPattern ?? "", call)
          ? rule.action
          : undefined;
      case "path":
        return pathRuleMatcher.matchesRule(rule.argPattern ?? "", call)
          ? rule.action
          : undefined;
      case "domain":
        return domainRuleMatcher.matchesRule(rule.argPattern ?? "", call)
          ? rule.action
          : undefined;
      case "literal":
        return literalRuleMatcher.matchesLoadedRule(rule, call)
          ? rule.action
          : undefined;
    }
  };
}

/** verdict.rule 的规则原文回显（createRuleSetModule 的 ruleText 回调）。 */
export function loadedRuleText(rule: LoadedRule): string {
  return rule.raw;
}

/**
 * C55 命中规则的拒绝面数据（T-P2-202，createRuleSetModule 的 ruleDenial
 * 回调）：规则声明了 justification/alternatives 时构造拒绝形状（reason
 * 字段 = 规则原文，与 ruleText 同源——gate 渲染时以 verdict.reason 为主
 * 因、此处只取声明面字段）；无声明返回 undefined（既有拒绝零变化）。
 */
export function loadedRuleDenial(rule: LoadedRule): DenialShape | undefined {
  if (rule.justification === undefined && rule.alternatives === undefined) {
    return undefined;
  }
  return {
    reason: rule.raw,
    ...(rule.justification !== undefined ? { justification: rule.justification } : {}),
    ...(rule.alternatives !== undefined ? { alternatives: rule.alternatives } : {}),
  };
}
