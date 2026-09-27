/**
 * C39/C53 specifier 分型测试（T-P1-68）——四分型推导、gitignore 风格
 * path 匹配、domain host 后缀、literal 精确 + key:value。
 */
import { describe, expect, it } from "vitest";

import { getSpecifierKind, matchGitignorePath, matchDomainPattern, literalRuleMatcher } from "./specifier-kinds.js";
import type { LoadedRule } from "./rule-loader.js";

describe("C39 · specifier 分型（kind 由工具类别推导）", () => {
  it("验收①：四分型推导各一（command/path/domain/literal 闭集）", () => {
    expect(getSpecifierKind("bash")).toBe("command");
    expect(getSpecifierKind("pwsh")).toBe("command");
    expect(getSpecifierKind("read")).toBe("path");
    expect(getSpecifierKind("write")).toBe("path");
    expect(getSpecifierKind("edit")).toBe("path");
    expect(getSpecifierKind("apply_patch")).toBe("path");
    expect(getSpecifierKind("webfetch")).toBe("domain");
    expect(getSpecifierKind("task")).toBe("literal"); // 其余 → literal
    expect(getSpecifierKind("srv__tool")).toBe("literal"); // MCP 名不在推导表
  });

  it("验收②：path matcher 跨段语义（** 跨段、* 不跨段、? 单字符、basename 语义）", () => {
    // ** 跨段
    expect(matchGitignorePath("/src/**", "/src/a.ts")).toBe(true);
    expect(matchGitignorePath("/src/**", "/src/a/b/c.ts")).toBe(true);
    // * 不跨段
    expect(matchGitignorePath("/src/*", "/src/a.ts")).toBe(true);
    expect(matchGitignorePath("/src/*", "/src/a/b.ts")).toBe(false);
    // ? 单字符
    expect(matchGitignorePath("/src/a?.ts", "/src/ab.ts")).toBe(true);
    expect(matchGitignorePath("/src/a?.ts", "/src/abc.ts")).toBe(false);
    // 无斜杠模式 → basename 语义（任意目录末段）
    expect(matchGitignorePath("*.ts", "/any/deep/dir/mod.ts")).toBe(true);
    // ** 以斜杠结尾可匹配零段
    expect(matchGitignorePath("/src/**/b.ts", "/src/b.ts")).toBe(true);
    expect(matchGitignorePath("/src/**/b.ts", "/src/x/b.ts")).toBe(true);
    // Windows 反斜杠归一
    expect(matchGitignorePath("/src/**", "\\src\\a.ts")).toBe(true);
  });

  it("验收③：domain host 后缀匹配（子域命中、非后缀不命中、前缀可选）", () => {
    expect(matchDomainPattern("domain:x.com", "https://x.com/a")).toBe(true);
    expect(matchDomainPattern("domain:x.com", "https://sub.x.com/")).toBe(true);
    expect(matchDomainPattern("domain:x.com", "https://notexample.com/")).toBe(false);
    expect(matchDomainPattern("x.com", "https://api.x.com/")).toBe(true); // 剥前缀可选
    expect(matchDomainPattern("domain:x.com", "not-a-url")).toBe(false);
  });

  it("验收④：literal 精确 + key:value（plainSpecifier 与 matchers AND）", () => {
    const rule = (over: Partial<LoadedRule>): LoadedRule =>
      ({
        raw: "task(Explore)",
        toolName: "task",
        argPattern: "Explore",
        plainSpecifier: "Explore",
        action: "allow",
        invalid: false,
        ...over,
      }) as LoadedRule;

    // positional 精确：args 任一值精确等于 "Explore"
    expect(
      literalRuleMatcher.matchesLoadedRule(rule({}), {
        tool: "task",
        args: { subagentType: "Explore" },
      }),
    ).toBe(true);
    // 精确相等不含子串
    expect(
      literalRuleMatcher.matchesLoadedRule(rule({}), {
        tool: "task",
        args: { subagentType: "Explore codebase" },
      }),
    ).toBe(false);

    // key:value：model wildcardMatch opus
    const kv = rule({
      raw: "agent(model:opus)",
      argPattern: "model:opus", // 纯 key:value 保留原文形状
      plainSpecifier: undefined,
      toolParamMatchers: [{ key: "model", valuePattern: "opus" }],
    });
    expect(
      literalRuleMatcher.matchesLoadedRule(kv, {
        tool: "agent",
        args: { model: "opus" },
      }),
    ).toBe(true);
    expect(
      literalRuleMatcher.matchesLoadedRule(kv, {
        tool: "agent",
        args: { model: "haiku" },
      }),
    ).toBe(false);

    // plain + matchers 同时存在 AND
    const both = rule({
      raw: "agent(coder,model:opus)",
      argPattern: "coder",
      plainSpecifier: "coder",
      toolParamMatchers: [{ key: "model", valuePattern: "opus" }],
    });
    expect(
      literalRuleMatcher.matchesLoadedRule(both, {
        tool: "agent",
        args: { model: "opus" },
      }),
    ).toBe(false); // plain "coder" 无匹配值
    expect(
      literalRuleMatcher.matchesLoadedRule(both, {
        tool: "agent",
        args: { role: "coder", model: "opus" },
      }),
    ).toBe(true);
  });
});
