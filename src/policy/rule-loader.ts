/**
 * 规则加载器（C38/C44/C26）——raw 原文保留 + 加载期样例校验 + 畸形规则
 * 显式标 never-match。规则文本形式 `Tool(args)` 的正式解析器（T-P1-67，
 * qwen·rule-parser.ts parseRule 同构）：裸名 / 带参 / invalid 三态 +
 * legacy `:*` 后缀展开（仅 command 分型）+ literal 分型的 key:value
 * 参数 matcher 解析。配置文本是权威——解析产物 raw 逐字节保留原文
 * （trim 后），verdict 回显可复制粘贴。
 *
 * 三种坏规则两种处置（来源纪律不同）：
 *   - 语法畸形（括号不闭合、空工具名等）→ 规则保留在集合里标 invalid，
 *     永不命中（qwen 的 invalid 同款——配置健壮性：一条坏规则不炸整个
 *     配置，但它的原文可见、可被 T-5-07 的 linter 点名）；
 *   - 样例自相矛盾（C44：matchExamples 样本未命中 / notMatchExamples
 *     样本反而命中）→ **加载即报错**并列出行号（codex
 *     validate_match_examples 纪律——作者声明的自测样例是承诺，违背
 *     承诺的规则比没有规则更危险，宁可拒绝装配）。
 *
 * 匹配与委托：loadedRuleMatch 是链上匹配函数（配 createRuleSetModule
 * 使用），工具名维度按 evaluate.ts 通配方言、参数维度按 C21 委托回
 * 工具匹配器；evaluate.ts 的 evaluateRule 是无委托的直接双维求值原语，
 * 两者参数维度共用同一通配方言（bashRuleMatcher 内部就是 wildcardMatch）。
 */

import type { PolicyAction, PolicyCall } from "./chain.js";
import type { RuleMatchable } from "./matchers.js";
import { wildcardMatch } from "./evaluate.js";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 加载后的规则：原文（C38）+ 解析产物 + 动作。 */
export interface LoadedRule {
  /** 规则原文，如 "Bash(git *)"——verdict.rule 回显的就是它（C18/C38）。 */
  readonly raw: string;
  /** 解析出的工具名维度（裸规则 / 空参数时即整个 raw 的工具部分）。 */
  readonly toolName: string;
  /** `Tool(args)` 的 args；裸规则或缺席时 undefined（工具级规则）。 */
  readonly argPattern?: string;
  readonly action: PolicyAction;
  /** 语法畸形标记（qwen 同款）：true 的规则永不命中，原文保留待 linter。 */
  readonly invalid: boolean;
  /** 来源行号（调用方提供，报错与 linter 定位用）。 */
  readonly line?: number;
  /**
   * literal 分型的 key:value 参数 matcher（C26 解析产物，qwen
   * toolParamMatchers 同构）——匹配接线随 T-P1-68 的分型路由落。
   */
  readonly toolParamMatchers?: readonly ToolParamMatcher[];
}

/** literal 分型 key:value 参数 matcher（qwen 同构：{key, valuePattern}）。 */
export interface ToolParamMatcher {
  readonly key: string;
  readonly valuePattern: string;
}

/** 加载输入：一行规则原文 + 动作 + 可选行号与样例。 */
export interface RuleSource {
  readonly raw: string;
  readonly action: PolicyAction;
  readonly line?: number;
  /** C44 正样例：这些样本必须命中本规则（经工具匹配器判定）。 */
  readonly matchExamples?: readonly string[];
  /** C44 反样例：这些样本必须不命中本规则。 */
  readonly notMatchExamples?: readonly string[];
}

/** 样例校验失败明细（加载报错时全部列出，不止第一条）。 */
export interface RuleViolation {
  readonly line?: number;
  readonly raw: string;
  readonly kind: "match-example" | "not-match-example" | "examples-without-args";
  readonly sample?: string;
}

export class RuleLoadError extends Error {
  constructor(readonly violations: readonly RuleViolation[]) {
    super(
      `权限规则加载失败（${violations.length} 条样例矛盾）：\n` +
        violations
          .map(
            (v) =>
              `  ${v.line !== undefined ? `第 ${v.line} 行 ` : ""}"${v.raw}" ` +
              (v.sample !== undefined ? `样例 "${v.sample}" ` : "") +
              v.kind,
          )
          .join("\n"),
    );
  }
}

// ---------------------------------------------------------------------------
// specifier 分型查表（T-P1-67 预置；T-P1-68 随 specifier-kinds.ts 的
// getSpecifierKind 正式化并接匹配路由。qwen getSpecifierKind 同构四值）
// ---------------------------------------------------------------------------

const COMMAND_SPECIFIER_TOOLS = new Set(["bash", "pwsh"]);
const PATH_SPECIFIER_TOOLS = new Set(["read", "write", "edit", "apply_patch"]);
const DOMAIN_SPECIFIER_TOOLS = new Set(["webfetch"]);

export type SpecifierKind = "command" | "path" | "domain" | "literal";

export function specifierKindOf(toolName: string): SpecifierKind {
  if (COMMAND_SPECIFIER_TOOLS.has(toolName)) return "command";
  if (PATH_SPECIFIER_TOOLS.has(toolName)) return "path";
  if (DOMAIN_SPECIFIER_TOOLS.has(toolName)) return "domain";
  return "literal";
}

// ---------------------------------------------------------------------------
// 解析（C26 正式解析器，qwen·rule-parser.ts parseRule 同构）
// ---------------------------------------------------------------------------

/** 正式解析产物：raw 原文权威（round-trip 回显）+ 工具名 + 参数维度。 */
export interface ParsedRulePattern {
  /** trim 后的原文（配置文本是权威——可复制粘贴回配置不变形）。 */
  readonly raw: string;
  readonly toolName: string;
  /** 参数维度（legacy 展开后的 command glob / plain 部分）；裸规则 undefined。 */
  readonly argPattern?: string;
  /** literal 分型的 key:value matcher（qwen toolParamMatchers 同构）。 */
  readonly toolParamMatchers?: readonly ToolParamMatcher[];
}

/** key 合法性（qwen 同款：标识符形状，连字符与点不支持）。 */
const PARAM_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * 拆 `Tool(argPattern)`（三态：裸名 / 带参 / invalid）。畸形（空串 /
 * 有左括号无右括号 / 空工具名）返回 undefined，由调用方标 invalid；
 * `Tool()` 空参数按裸工具处理（kimi 同款）。升级点（T-P1-67）：
 *   - 工具部分 trim（`Bash (git)` ≡ `Bash(git)`，qwen toolPart 同款）；
 *   - legacy `:*` 后缀展开仅 command 分型（`Bash(git:*)` → `git *`，
 *     防干扰 key:value 语法）；
 *   - literal 分型 key:value matcher 解析（key 合法性、非法 key 退回
 *     plain 部分；MCP 命名空间名跳过）。
 */
export function parseRulePattern(raw: string): ParsedRulePattern | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const openIdx = trimmed.indexOf("(");
  if (openIdx === -1) return { raw: trimmed, toolName: trimmed };
  if (!trimmed.endsWith(")")) return undefined;
  const toolName = trimmed.slice(0, openIdx).trim();
  const rawSpecifier = trimmed.slice(openIdx + 1, -1);
  if (toolName.length === 0) return undefined;
  if (rawSpecifier.length === 0) return { raw: trimmed, toolName };

  const kind = specifierKindOf(toolName);
  // legacy `:*` 后缀（qwen 同款：`git:*` → `git *`；仅 command 分型）
  const specifier =
    kind === "command" ? rawSpecifier.replace(/:(\*)/g, " $1") : rawSpecifier;

  let argPattern: string = specifier;
  let toolParamMatchers: ToolParamMatcher[] | undefined;
  if (kind === "literal" && !toolName.includes("__") && specifier.includes(":")) {
    const plainParts: string[] = [];
    const matchers: ToolParamMatcher[] = [];
    for (const part of specifier.split(",").map((p) => p.trim())) {
      const colonIdx = part.indexOf(":");
      const key = colonIdx > 0 ? part.substring(0, colonIdx).trim() : "";
      if (key !== "" && PARAM_KEY_RE.test(key)) {
        matchers.push({ key, valuePattern: part.substring(colonIdx + 1).trim() });
        continue;
      }
      plainParts.push(part);
    }
    if (matchers.length > 0) {
      toolParamMatchers = matchers;
      const plain = plainParts.join(",").trim();
      // plain 部分为空（纯 key:value）时 argPattern 保留原文形状而非
      // 退成 undefined——undefined 是"工具级规则"（匹配一切调用），
      // 会让未接线的 key:value 规则越过 fail-closed 放行一切
      argPattern = plain !== "" ? plain : specifier;
    }
  }
  return {
    raw: trimmed,
    toolName,
    ...(argPattern !== "" ? { argPattern } : {}),
    ...(toolParamMatchers !== undefined ? { toolParamMatchers } : {}),
  };
}

// ---------------------------------------------------------------------------
// 加载 + 校验
// ---------------------------------------------------------------------------

/**
 * 加载规则集：逐条解析（畸形标 invalid 不中断），随后跑 C44 样例校验，
 * 任一样例矛盾则整批拒绝（RuleLoadError 带全部违规与行号）。
 */
export function loadRules(
  sources: readonly RuleSource[],
  matchers: Readonly<Record<string, RuleMatchable>>,
): LoadedRule[] {
  const rules: LoadedRule[] = sources.map((source) => {
    const parsed = parseRulePattern(source.raw);
    if (parsed === undefined) {
      return {
        raw: source.raw,
        toolName: "",
        action: source.action,
        invalid: true,
        ...(source.line !== undefined ? { line: source.line } : {}),
      };
    }
    return {
      raw: parsed.raw,
      toolName: parsed.toolName,
      ...(parsed.argPattern !== undefined
        ? { argPattern: parsed.argPattern }
        : {}),
      ...(parsed.toolParamMatchers !== undefined
        ? { toolParamMatchers: parsed.toolParamMatchers }
        : {}),
      action: source.action,
      invalid: false,
      ...(source.line !== undefined ? { line: source.line } : {}),
    };
  });

  const violations: RuleViolation[] = [];
  for (const [index, source] of sources.entries()) {
    const rule = rules[index];
    if (rule === undefined || rule.invalid) continue;
    const withExamples =
      (source.matchExamples?.length ?? 0) + (source.notMatchExamples?.length ?? 0);
    if (withExamples === 0) continue;
    if (rule.argPattern === undefined) {
      // 工具级规则匹配一切样例（无从校验），带样例即矛盾（C44 宁严勿松）。
      pushAllViolations(violations, rule, source);
      continue;
    }
    const argPattern: string = rule.argPattern;
    const matcher = matchers[rule.toolName];
    if (matcher === undefined) {
      // 未登记匹配器的工具无法校验样例——同样按矛盾拒绝。
      pushAllViolations(violations, rule, source);
      continue;
    }
    for (const sample of source.matchExamples ?? []) {
      if (!matcher.matchesRule(argPattern, matcher.sampleCall(sample))) {
        violations.push({
          ...(rule.line !== undefined ? { line: rule.line } : {}),
          raw: rule.raw,
          kind: "match-example",
          sample,
        });
      }
    }
    for (const sample of source.notMatchExamples ?? []) {
      if (matcher.matchesRule(argPattern, matcher.sampleCall(sample))) {
        violations.push({
          ...(rule.line !== undefined ? { line: rule.line } : {}),
          raw: rule.raw,
          kind: "not-match-example",
          sample,
        });
      }
    }
  }
  if (violations.length > 0) throw new RuleLoadError(violations);
  return rules;
}

function pushAllViolations(
  violations: RuleViolation[],
  rule: LoadedRule,
  source: RuleSource,
): void {
  for (const sample of source.matchExamples ?? []) {
    violations.push({
      ...(rule.line !== undefined ? { line: rule.line } : {}),
      raw: rule.raw,
      kind: "examples-without-args",
      sample,
    });
  }
  for (const sample of source.notMatchExamples ?? []) {
    violations.push({
      ...(rule.line !== undefined ? { line: rule.line } : {}),
      raw: rule.raw,
      kind: "examples-without-args",
      sample,
    });
  }
}

// ---------------------------------------------------------------------------
// 链上匹配（配 createRuleSetModule 使用）
// ---------------------------------------------------------------------------

/**
 * 链上规则匹配函数（C21 委托路径）：工具名维度通配 + 参数维度委托。
 * invalid 规则永不命中；带参规则在调用方工具未登记匹配器时永不命中
 * （fail-closed，见 matchers.ts 头注释）。
 */
export function loadedRuleMatch(
  matchers: Readonly<Record<string, RuleMatchable>>,
): (rule: LoadedRule, call: PolicyCall) => PolicyAction | undefined {
  return (rule, call) => {
    if (rule.invalid) return undefined;
    if (!wildcardMatch(call.tool, rule.toolName)) return undefined;
    if (rule.argPattern === undefined) return rule.action;
    const matcher = matchers[call.tool];
    return matcher?.matchesRule(rule.argPattern, call) === true
      ? rule.action
      : undefined;
  };
}

/** verdict.rule 的规则原文回显（createRuleSetModule 的 ruleText 回调）。 */
export function loadedRuleText(rule: LoadedRule): string {
  return rule.raw;
}
