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
 * 我方新增两类保持：invalid-syntax（loadRules 标 invalid）、
 * empty-value-pattern（C26 key:value 空值模式）与 no-matcher-for-args
 * （带参规则永不命中的三类来源：未知工具 / 通配工具名无法静态确认 /
 * MCP 命名空间名带 specifier 拒配——T-P1-68 分型路由后已知工具的带参
 * 规则均有匹配语义）、basename-unanchored（C53 basename 未绑绝对路径）、
 * unknown-param-name（C40 参数 matcher 的 key 不在工具参数 schema 中——
 * T-P2-201；knownToolParams 由调用方提供 schema 名单，无 schema 的工具
 * 跳过不误报）、missing-alternatives（C55 deny 规则未声明替代做法——
 * T-P2-202）。
 *
 * linter 只警告不拦截：装一条死规则是用户配置错误，不是攻击面——
 * 拒绝装配会让有其他活规则的配置整体不可用，过狠（样例矛盾才拒，
 * 见 rule-loader.ts）。
 */

import type { LoadedRule } from "./rule-loader.js";
import { wildcardMatch } from "./evaluate.js";
import { getSpecifierKind } from "./specifier-kinds.js";

export type LintIssueKind =
  | "invalid-syntax"
  | "unknown-tool"
  | "no-matcher-for-args"
  | "wildcard-tool-name"
  | "incomplete-namespace-name"
  | "empty-value-pattern"
  | "basename-unanchored"
  | "unknown-param-name"
  | "missing-alternatives";

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
 * 注：`a__b__c` 三段名若注册表现存（工具名自身含 __ 的注册名）豁免。
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
    /**
     * C40（T-P2-201）工具 → 参数名名单（工具参数 schema 的属性名）：
     * 提供且工具名精确命中名单时，参数 matcher 的 key 不在名单内报
     * unknown-param-name。缺省/无该工具条目 = 无 schema 可依，跳过不误报
     * （装配缺省面取 builtinToolParamNames()——真实 schema 派生）。
     */
    knownToolParams?: Readonly<Record<string, readonly string[]>>;
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
    // 带参规则永不命中的三类来源（T-P1-68 分型路由后收窄）：
    // 未知工具不会被调用；通配工具名无法静态确认分型；MCP 命名空间
    // 工具名已编码身份、specifier 无从解释（loadedRuleMatch 拒配）。
    // 已知非 MCP 工具的带参规则经四分型路由均有匹配语义，不再误报。
    if (rule.argPattern !== undefined || rule.toolParamMatchers !== undefined) {
      const noMatchDetail = !known.has(rule.toolName) && !hasGlob
        ? `工具 "${rule.toolName}" 未在注册表中，带参规则永不命中（fail-closed）`
        : hasGlob
          ? `工具名含通配且带参数模式，无法静态确认匹配器，运行时可能永不命中`
          : rule.toolName.includes("__")
            ? `MCP 工具名已编码 server__tool 身份，不支持 specifier（qwen 拒配同款），永不命中`
            : undefined;
      if (noMatchDetail !== undefined) {
        issues.push({
          kind: "no-matcher-for-args",
          raw: rule.raw,
          ...(rule.line !== undefined ? { line: rule.line } : {}),
          detail: noMatchDetail,
        });
      }
    }
    // C53：command 分型的 basename 参数规则（裸词、无通配、无路径分隔）
    // 须绑绝对路径清单（写成绝对路径 glob），否则可被 PATH 上同名可
    // 执行绕过——只警告不拦截（linter 纪律）
    if (
      getSpecifierKind(rule.toolName) === "command" &&
      rule.argPattern !== undefined &&
      rule.argPattern.length > 0 &&
      !/\s/.test(rule.argPattern) &&
      !GLOB_MAGIC.test(rule.argPattern) &&
      !/[/\\]/.test(rule.argPattern)
    ) {
      issues.push({
        kind: "basename-unanchored",
        raw: rule.raw,
        ...(rule.line !== undefined ? { line: rule.line } : {}),
        detail: `basename 参数规则 "${rule.argPattern}" 未绑绝对路径清单——按 PATH 解析可被同名可执行绕过（C53）；请写成绝对路径形式如 "bash(C:\\\\tools\\\\${rule.argPattern}.exe *)"`,
      });
    }
    // C26 key:value matcher 的空值模式（qwen debugLogger.warn 同构警告，
    // 落我方 linter 通道可检索）：空 pattern 只匹配空串，多半是笔误
    for (const m of rule.toolParamMatchers ?? []) {
      if (m.valuePattern === "") {
        issues.push({
          kind: "empty-value-pattern",
          raw: rule.raw,
          ...(rule.line !== undefined ? { line: rule.line } : {}),
          detail: `key "${m.key}" 的值为空模式——只匹配空字符串；需匹配任意值请用 "*"`,
        });
      }
    }
    // C40 参数名存在性（T-P2-201）：工具名可静态确认（注册表精确命中、
    // 无通配）且 schema 名单在位时，matcher key 不在名单 = 永不命中。
    // 名单缺该工具 = 无 schema 可依，跳过（宁可漏报不误报）。
    const paramNames = options.knownToolParams?.[rule.toolName];
    if (paramNames !== undefined && known.has(rule.toolName) && !hasGlob) {
      for (const m of rule.toolParamMatchers ?? []) {
        if (!paramNames.includes(m.key)) {
          issues.push({
            kind: "unknown-param-name",
            raw: rule.raw,
            ...(rule.line !== undefined ? { line: rule.line } : {}),
            detail: `参数 matcher 的 key "${m.key}" 不在工具 "${rule.toolName}" 的参数 schema 中（永不命中；请核对参数名——平面参数名，深路径不支持）`,
          });
        }
      }
    }
    // C55 拒绝纪律（T-P2-202）：forbidden（deny）类规则必须给替代做法
    // （alternatives）——"拒绝要能告诉用户怎么办"。缺声明即检出（警告
    // 不拦截——linter 既有纪律：拦截会让既有 deny 配置整体不可用，违反
    // "既有拒绝零变化"）；替代做法的渲染在 gate 层（renderDenial）。
    if (rule.action === "deny" && rule.alternatives === undefined) {
      issues.push({
        kind: "missing-alternatives",
        raw: rule.raw,
        ...(rule.line !== undefined ? { line: rule.line } : {}),
        detail:
          "forbidden（deny）规则未声明 alternatives 替代做法——被拒的调用无法知道怎么办（C55）；请在规则声明面补 alternatives",
      });
    }
  }
  return issues;
}
