/**
 * 权限规则 linter（C45）——检出"永不生效"的规则，加载后跑、装前看。
 *
 * 参照 kimi·toolPolicy/evaluate.ts 的 findInactiveToolPatterns（检出永不
 * 匹配的模式并给类别）裁剪为我方对应项：kimi 的 MCP 两类（wildcard-not-
 * mcp / incomplete-mcp-name）P0 无 MCP 不适用；我方新增两类由自身机制
 * 推出——语法畸形（loadRules 标 invalid，永不命中）与带参规则但工具未
 * 登记参数匹配器（T-5-05 的 fail-closed 让它静默死掉，linter 负责让它
 * **可见**）。未知工具名一类照收。
 *
 * linter 只警告不拦截：装一条死规则是用户配置错误，不是攻击面——
 * 拒绝装配会让有其他活规则的配置整体不可用，过狠（样例矛盾才拒，
 * 见 rule-loader.ts）。
 */

import type { LoadedRule } from "./rule-loader.js";
import type { RuleMatchable } from "./matchers.js";

export type LintIssueKind =
  | "invalid-syntax"
  | "unknown-tool"
  | "no-matcher-for-args";

export interface LintIssue {
  readonly kind: LintIssueKind;
  /** 规则原文（回显定位）。 */
  readonly raw: string;
  readonly line?: number;
  readonly detail: string;
}

const GLOB_MAGIC = /[*?[\]{}]/;

export function lintRules(
  rules: readonly LoadedRule[],
  options: {
    /** 注册表现存工具名（未知工具名判定依据）。 */
    knownToolNames: readonly string[];
    /** 参数匹配器注册表（与 loadedRuleMatch 同一张）。 */
    matchers: Readonly<Record<string, RuleMatchable>>;
  },
): LintIssue[] {
  const known = new Set(options.knownToolNames);
  const issues: LintIssue[] = [];
  for (const rule of rules) {
    if (rule.invalid) {
      issues.push({
        kind: "invalid-syntax",
        raw: rule.raw,
        ...(rule.line !== undefined ? { line: rule.line } : {}),
        detail: "规则语法畸形（空串/括号不闭合/空工具名），永不匹配",
      });
      continue;
    }
    const hasGlob = GLOB_MAGIC.test(rule.toolName);
    if (!hasGlob && !known.has(rule.toolName)) {
      issues.push({
        kind: "unknown-tool",
        raw: rule.raw,
        ...(rule.line !== undefined ? { line: rule.line } : {}),
        detail: `工具 "${rule.toolName}" 不在注册表现存工具名单中`,
      });
    }
    if (rule.argPattern !== undefined && options.matchers[rule.toolName] === undefined) {
      issues.push({
        kind: "no-matcher-for-args",
        raw: rule.raw,
        ...(rule.line !== undefined ? { line: rule.line } : {}),
        detail:
          hasGlob
            ? `工具名含通配且带参数模式，无法静态确认匹配器，运行时可能永不命中`
            : `工具 "${rule.toolName}" 未登记参数匹配器，带参规则永不命中（fail-closed）`,
      });
    }
  }
  return issues;
}
