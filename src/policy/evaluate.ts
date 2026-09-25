/**
 * 规则求值（C1/C3/C4）——双维通配 + 默认 ask 兜底的首匹配求值。
 *
 * 双维形状取 opencode·permission/index.ts 的 evaluate：规则在 permission
 * （工具名）与 pattern（参数模式串）两个维度上各做一次通配匹配，两维
 * 同时命中才算命中。匹配方向用我方 T-5-01 的**首匹配胜**（Q15/C2），
 * 不抄 opencode 的 findLast（后匹配胜）——方向相反，chain.test/evaluate.test
 * 有对照用例钉死。
 *
 * 通配语义取 opencode·util/wildcard.ts 的 match：锚定全串、星号跨任意、
 * 问号单字符、尾随"空格加星"使命令尾部可选（`ls *` 同时命中 `ls` 与
 * `ls -la`）。与 opencode 的两处刻意差异（方言，见测试）：
 *   - 大小写敏感（opencode 在 Windows 上不敏感）——路径大小写问题归
 *     阶段 6 的路径守卫统一 realpath 处理，规则匹配保持可预测；
 *   - 不做反斜杠归一（opencode 把两个入参的 \\ 都替换成斜杠）——
 *     pattern 维度会承载 shell 命令原文，反斜杠是其语法的一部分，
 *     归一会造成假匹配。
 */

import type { PolicyAction } from "./chain.js";

/** 一条权限规则：permission 维度匹配工具名，pattern 维度匹配参数模式串。 */
export interface Rule {
  readonly permission: string;
  readonly pattern: string;
  readonly action: PolicyAction;
}

/**
 * 单维通配匹配：pattern 中 `*` 跨任意字符、`?` 匹配单字符，其余字符按
 * 字面匹配；锚定全串（首尾都必须对上）。尾随"空格加星"（如 `ls *`）
 * 额外命中去掉该尾部的短串（`ls`）——opencode 同款语义。
 */
export function wildcardMatch(str: string, pattern: string): boolean {
  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // 转义正则元字符（星号问号除外）
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  if (escaped.endsWith(" .*")) {
    escaped = escaped.slice(0, -3) + "( .*)?";
  }
  return new RegExp(`^${escaped}$`, "s").test(str);
}

/**
 * 默认规则（C3）：无规则命中时落 ask 而非 allow——不变量 3"权限默认
 * ask，白名单是显式例外"在求值层的落点（需求 §8 第 2 条）。
 */
export function defaultAskRule(permission: string, pattern: string): Rule {
  return { action: "ask", permission, pattern: "*" };
}

/**
 * 求值一条 (permission, pattern) 调用：按声明顺序找第一条两维都命中的
 * 规则（首匹配胜），返回该规则；全部不命中返回默认 ask 规则。
 * 返回值恒为 Rule（命中规则本身即证据——C18 的 rule 原文由此回显）。
 */
export function evaluateRule(
  permission: string,
  pattern: string,
  rules: readonly Rule[],
): Rule {
  for (const rule of rules) {
    if (
      wildcardMatch(permission, rule.permission) &&
      wildcardMatch(pattern, rule.pattern)
    ) {
      return rule;
    }
  }
  return defaultAskRule(permission, pattern);
}
