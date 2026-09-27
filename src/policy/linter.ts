/**
 * 权限规则 linter（C45/C23）——检出"永不生效"的规则，加载后跑、装前看。
 *
 * 参照 kimi·toolPolicy/evaluate.ts 的 findInactiveToolPatterns（检出永不
 * 匹配的模式并给类别）：unknown-tool 一类 P0 已收；P1（T-P1-66）随 MCP
 * 命名空间化注册（T-P1-64 `server__tool`）补齐 kimi 三类中剩余两类——
 *   - wildcard-tool-name（kimi wildcard-not-mcp 同构）：kimi 的判据是
 *     "glob 魔法字符出现在非 MCP 名上"（其 builtin 清单精确匹配）；我方
 *     工具名维度 wildcardMatch 全支持通配，无条件报会误报活规则（`bash*`
 *     能命中 bash）——判据落"注册表现存工具无一被该模式命中"（通配指向
 *     的工具集合为空 = 永不匹配，机验可判）；
 *   - incomplete-namespace-name（kimi incomplete-mcp-name 同构）：含 `__`
 *     但不是 "server__tool" 两段非空形状（段数≠2 或有空段）。注册表现存
 *     名豁免（server 名不含 `__` 但工具名自身可含——三段注册名合法）。
 * 我方新增两类保持：invalid-syntax（loadRules 标 invalid）与
 * no-matcher-for-args（带参规则但工具未登记参数匹配器，fail-closed 让它
 * 静默死掉，linter 负责让它**可见**）。
 *
 * linter 只警告不拦截：装一条死规则是用户配置错误，不是攻击面——
 * 拒绝装配会让有其他活规则的配置整体不可用，过狠（样例矛盾才拒，
 * 见 rule-loader.ts）。
 */

import type { LoadedRule } from "./rule-loader.js";
import type { RuleMatchable } from "./matchers.js";
import { wildcardMatch } from "./evaluate.js";

export type LintIssueKind =
  | "invalid-syntax"
  | "unknown-tool"
  | "no-matcher-for-args"
  | "wildcard-tool-name"
  | "incomplete-namespace-name";

export interface LintIssue {
  readonly kind: LintIssueKind;
  /** 规则原文（回显定位）。 */
  readonly raw: string;
  readonly line?: number;
  readonly detail: string;
}

const GLOB_MAGIC = /[*?[\]{}]/;

// ---------------------------------------------------------------------------
// 工具名维度判定（C23 三类，kimi findInactiveToolPatterns 同名意图的导出）
// ---------------------------------------------------------------------------

/** 工具名维度"永不匹配"的类别（unknown-tool 之外两类 T-P1-66 补齐）。 */
export type InactiveToolNameKind =
  | "wildcard-tool-name"
  | "incomplete-namespace-name"
  | "unknown-tool";

/**
 * 单个工具名的"永不匹配"判定（kimi findInactiveToolPatterns 的单名核心）：
 * 通配/魔法字符 → 注册表无一命中报 wildcard-tool-name；命名空间形状
 * 畸形（含 `__` 但非两段非空且注册表无此名）报 incomplete-namespace-name；
 * 裸名不在注册表报 unknown-tool。可命中返回 undefined。
 */
export function findInactiveRuleToolName(
  toolName: string,
  known: ReadonlySet<string>,
): InactiveToolNameKind | undefined {
  if (GLOB_MAGIC.test(toolName)) {
    // 判据 = 通配指向的工具集合为空（wildcardMatch 是我方真实方言——
    // 只有 * ? 是通配、大小写敏感，`Bash*` 这类大小写错位在此现形）
    return [...known].some((name) => wildcardMatch(name, toolName))
      ? undefined
      : "wildcard-tool-name";
  }
  if (toolName.includes("__")) {
    const segs = toolName.split("__");
    const wellFormed = segs.length === 2 && segs[0] !== "" && segs[1] !== "";
    // 注册表现存名豁免（工具名自身含 __ 的三段注册名合法，T-P1-64）
    if (!wellFormed && !known.has(toolName)) return "incomplete-namespace-name";
  }
  return known.has(toolName) ? undefined : "unknown-tool";
}

/** 批量版：对一组规则工具名逐个判定（kimi 同名函数意图的导出面）。 */
export function findInactiveRuleToolNames(
  toolNames: readonly string[],
  knownToolNames: readonly string[],
): Array<{ name: string; kind: InactiveToolNameKind }> {
  const known = new Set(knownToolNames);
  const out: Array<{ name: string; kind: InactiveToolNameKind }> = [];
  for (const name of toolNames) {
    const kind = findInactiveRuleToolName(name, known);
    if (kind !== undefined) out.push({ name, kind });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 规则集 lint
// ---------------------------------------------------------------------------

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
    const nameKind = findInactiveRuleToolName(rule.toolName, known);
    if (nameKind === "wildcard-tool-name") {
      issues.push({
        kind: nameKind,
        raw: rule.raw,
        ...(rule.line !== undefined ? { line: rule.line } : {}),
        detail: `工具模式 "${rule.toolName}" 在注册表现存工具中无一命中（永不匹配；命名空间通配如 "server__*" 需对应 server 已连接）`,
      });
    } else if (nameKind === "incomplete-namespace-name") {
      issues.push({
        kind: nameKind,
        raw: rule.raw,
        ...(rule.line !== undefined ? { line: rule.line } : {}),
        detail: `命名空间名 "${rule.toolName}" 形状不完整（MCP 工具名为 "server__tool" 两段非空），永不匹配`,
      });
    } else if (nameKind === "unknown-tool") {
      issues.push({
        kind: nameKind,
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
