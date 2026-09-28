/**
 * specifier 分型（C39/C53，T-P1-68）——kind 由工具类别推导（qwen
 * getSpecifierKind 同构四值闭集），按分型路由参数匹配语义：
 *   - command（bash/pwsh）：shell glob（复用 bashRuleMatcher 的
 *     wildcardMatch 方言，wildcardMatch 不动）；
 *   - path（read/write/edit/apply_patch）：gitignore 风格 glob **手写**
 *     （`*` 不跨段 / `**` 跨段 / `?` 单字符；不引 picomatch——依赖纪律
 *     与 wildcardMatch 语义差异（跨段）由独立函数承载）；
 *   - domain（webfetch）：host 后缀匹配（`domain:x.com` 剥前缀可选，
 *     子域命中——qwen matchesDomainPattern 同构）；
 *   - literal（其余）：精确字符串相等 + key:value 参数 matcher（C26
 *     解析产物在此消费；qwen matchesRule 的 literal 精确与
 *     evaluateParamMatchers 同构）。
 *
 * qwen 的 realpath canonical 候选（pathMatchMode）不落——我方路径归一
 * 归 sandbox 的 PathGuard（realpath），规则匹配层保持纯字符串形状。
 */

import type { PolicyCall } from "./chain.js";
import type { RuleMatchable } from "./matchers.js";
import { wildcardMatch } from "./evaluate.js";
import type { LoadedRule, ToolParamMatcher } from "./rule-loader.js";

export type SpecifierKind = "command" | "path" | "domain" | "literal";

const COMMAND_TOOLS = new Set(["bash", "pwsh"]);
const PATH_TOOLS = new Set(["read", "write", "edit", "apply_patch"]);
const DOMAIN_TOOLS = new Set(["webfetch"]);

/** 工具类别 → specifier 分型（qwen getSpecifierKind 同构；其余 → literal）。 */
export function getSpecifierKind(toolName: string): SpecifierKind {
  if (COMMAND_TOOLS.has(toolName)) return "command";
  if (PATH_TOOLS.has(toolName)) return "path";
  if (DOMAIN_TOOLS.has(toolName)) return "domain";
  return "literal";
}

// ---------------------------------------------------------------------------
// path：gitignore 风格 glob（手写，不引 picomatch）
// ---------------------------------------------------------------------------

/**
 * gitignore 风格路径匹配：`*` 不跨段、`**` 跨段（以斜杠结尾的 `**`
 * 可匹配零段）、`?` 单字符（均不含斜杠）；模式不含斜杠时只匹配路径
 * 末段（gitignore basename 语义——`edit(*.ts)` 匹配任意目录下的 .ts）；
 * 含斜杠时全串锚定。大小写敏感（evaluate.ts 同款纪律，路径归一归
 * PathGuard）。
 */
export function matchGitignorePath(pattern: string, pathValue: string): boolean {
  const p = pattern.replace(/\\/g, "/");
  const v = pathValue.replace(/\\/g, "/");
  const anchored = p.includes("/");
  // basename 语义：模式无 / 时对末段匹配（前导 / 的锚定形除外）
  const target = anchored || p.startsWith("/") ? v : v.slice(v.lastIndexOf("/") + 1);
  return gitignoreToRegExp(p).test(target);
}

function gitignoreToRegExp(pattern: string): RegExp {
  let re = "";
  const n = pattern.length;
  for (let i = 0; i < n; i++) {
    const ch = pattern[i];
    if (ch === undefined) break;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` 匹配零段或多段（gitignore 标准语义）；其余 `**` 跨段
        if (pattern[i + 2] === "/" && (i === 0 || pattern[i - 1] === "/")) {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i++;
        }
      } else {
        re += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      re += "[^/]";
      continue;
    }
    re += /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(`^${re}$`, "s");
}

/** path 分型参数匹配器：specifier 对 call.args.path 做 gitignore 匹配。 */
export const pathRuleMatcher: RuleMatchable = {
  matchesRule(argPattern, call) {
    const pathValue = call.args.path;
    return typeof pathValue === "string" && matchGitignorePath(argPattern, pathValue);
  },
  sampleCall(sample) {
    return { tool: "read", args: { path: sample } };
  },
  patternOf(call) {
    const pathValue = call.args.path;
    return typeof pathValue === "string" ? pathValue : undefined;
  },
};

// ---------------------------------------------------------------------------
// domain：host 后缀匹配（qwen matchesDomainPattern 同构）
// ---------------------------------------------------------------------------

/**
 * domain 匹配：specifier 的 `domain:` 前缀可选；host 精确相等或以
 * ".pattern" 结尾（子域命中）；大小写不敏感（域名语义）。
 */
export function matchDomainPattern(specifier: string, url: string): boolean {
  const pattern = (
    specifier.startsWith("domain:") ? specifier.substring(7) : specifier
  )
    .trim()
    .toLowerCase();
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (pattern === "" || host === "") return false;
  return host === pattern || host.endsWith("." + pattern);
}

/** domain 分型参数匹配器：specifier 对 call.args.url 的 host 匹配。 */
export const domainRuleMatcher: RuleMatchable = {
  matchesRule(argPattern, call) {
    const url = call.args.url;
    return typeof url === "string" && matchDomainPattern(argPattern, url);
  },
  sampleCall(sample) {
    return { tool: "webfetch", args: { url: `https://${sample}/` } };
  },
  patternOf(call) {
    const url = call.args.url;
    if (typeof url !== "string") return undefined;
    try {
      return new URL(url).hostname;
    } catch {
      return undefined;
    }
  },
};

// ---------------------------------------------------------------------------
// literal：精确相等 + key:value matcher（C26 解析产物的消费点）
// ---------------------------------------------------------------------------

/**
 * 具名参数 matcher 求值（C40 共享原语，T-P2-201）：全部 matcher 通过才
 * 命中（AND）。qwen evaluateParamMatchers 同构——args[key] 必须存在且为
 * string/number（缺 key = 不命中，不是跳过），值字符串按 evaluate.ts
 * 通配方言匹配 valuePattern。literal 分型与 command/path/domain 分型的
 * 声明式 matcher（rule-loader 合并产物）共用本函数——匹配语义单点。
 */
export function evaluateParamMatchers(
  matchers: readonly ToolParamMatcher[],
  args: PolicyCall["args"],
): boolean {
  return matchers.every((m) => {
    const v = (args as Record<string, unknown>)[m.key];
    if (typeof v !== "string" && typeof v !== "number") return false;
    return wildcardMatch(String(v), m.valuePattern);
  });
}

/**
 * literal 分型参数匹配（qwen matchesRule literal 分支 +
 * evaluateParamMatchers 同构）：
 *   - positional specifier（plain 部分）与 args 的任一顶层
 *     string/number 值精确相等（我方无 qwen 的"主参"传入约定，取
 *     "任一值精确相等"为 fallback 分型的对应物——精确相等不含子串，
 *     误配面有限）；
 *   - toolParamMatchers：args[key] 存在且为 string/number，其字符串值
 *     按 wildcardMatch 方言匹配 valuePattern（qwen 同款），全部满足。
 *   两者同时存在时 AND（qwen 同款）。
 */
export function matchLiteralSpecifier(
  plainSpecifier: string | undefined,
  paramMatchers: readonly ToolParamMatcher[] | undefined,
  args: PolicyCall["args"],
): boolean {
  let specifierMatched = true;
  if (plainSpecifier !== undefined) {
    specifierMatched = Object.values(args).some(
      (v) =>
        (typeof v === "string" || typeof v === "number") &&
        String(v) === plainSpecifier,
    );
  }
  if (!specifierMatched) return false;
  if (paramMatchers === undefined) return true;
  if (paramMatchers.length === 0) return true;
  return evaluateParamMatchers(paramMatchers, args);
}

/** literal 分型参数匹配器：按 LoadedRule 的 plain/matchers 双面判定。 */
export const literalRuleMatcher: RuleMatchable & {
  matchesLoadedRule(rule: LoadedRule, call: PolicyCall): boolean;
} = {
  matchesRule(argPattern, call) {
    // 无 plain/matchers 区分的裸入口（RuleMatchable 形状兼容）：整串精确
    return Object.values(call.args).some(
      (v) => (typeof v === "string" || typeof v === "number") && String(v) === argPattern,
    );
  },
  matchesLoadedRule(rule, call) {
    return matchLiteralSpecifier(
      rule.plainSpecifier,
      rule.toolParamMatchers,
      call.args,
    );
  },
  sampleCall(sample) {
    return { tool: "task", args: { subagentType: sample } };
  },
  patternOf(call) {
    return undefined; // literal 的 pattern 维度无单一取值（多参数面）
  },
};
