import { describe, expect, it } from "vitest";

import { assemblePolicyChain, type PolicyCall } from "./chain.js";
import { builtinRuleMatchers } from "./matchers.js";
import { lintRules } from "./linter.js";
import {
  RuleLoadError,
  loadedRuleMatch,
  loadedRuleText,
  loadRules,
  parseRulePattern,
} from "./rule-loader.js";
import { createRuleSetModule } from "./rules.js";

const bashCall = (command: string): PolicyCall => ({
  tool: "bash",
  args: { command },
});

describe("解析与 raw 保留（C38）", () => {
  it("Tool(argPattern) 拆解，原文原样保留", () => {
    const rules = loadRules(
      [{ raw: "bash(git *)", action: "ask" }],
      builtinRuleMatchers,
    );
    expect(rules[0]).toMatchObject({
      raw: "bash(git *)",
      toolName: "bash",
      argPattern: "git *",
      invalid: false,
    });
  });

  it("裸工具规则无 argPattern；Tool() 空参数按裸工具（kimi 同款）", () => {
    const rules = loadRules(
      [{ raw: "bash", action: "deny" }, { raw: "bash()", action: "ask" }],
      builtinRuleMatchers,
    );
    expect(rules[0]).toMatchObject({ toolName: "bash", action: "deny" });
    expect(rules[0]?.argPattern).toBeUndefined();
    expect(rules[1]).toMatchObject({ toolName: "bash" });
    expect(rules[1]?.argPattern).toBeUndefined();
  });

  it("畸形规则保留原文标 invalid（qwen never-match 纪律），加载不炸", () => {
    const rules = loadRules(
      [
        { raw: "bash(git", action: "allow", line: 2 },
        { raw: "(git *)", action: "allow", line: 3 },
        { raw: "   ", action: "allow", line: 4 },
      ],
      builtinRuleMatchers,
    );
    expect(rules.map((r) => r.invalid)).toEqual([true, true, true]);
    // never-match：畸形规则对任何调用都不产生裁决
    for (const rule of rules) {
      expect(loadedRuleMatch()(rule, bashCall("git status"))).toBeUndefined();
    }
  });

  it("parseRulePattern 直接暴露（畸形返回 undefined；产物含 raw 原文）", () => {
    expect(parseRulePattern("Read(./secrets/**)")).toEqual({
      raw: "Read(./secrets/**)",
      toolName: "Read",
      argPattern: "./secrets/**",
    });
    expect(parseRulePattern("Read(")).toBeUndefined();
    expect(parseRulePattern("")).toBeUndefined();
  });

  it("验收④ round-trip：解析产物 raw 逐字节保留 trim 后原文（配置可复制粘贴）", () => {
    for (const raw of [
      "bash",
      "bash(git *)",
      "bash(git:*)",
      "  bash(git *)  ",
      "agent(coder,model:opus)",
    ]) {
      const parsed = parseRulePattern(raw);
      expect(parsed).toBeDefined();
      expect(parsed?.raw).toBe(raw.trim());
    }
    // 规范形重建：非 legacy 输入可由 {toolName, argPattern} 重建出原文
    const rebuilt = parseRulePattern("bash(git status)");
    expect(rebuilt && `${rebuilt.toolName}(${rebuilt.argPattern})`).toBe(
      "bash(git status)",
    );
  });

  it("验收① 三态：裸名 / 带参 / 畸形标 invalid", () => {
    const rules = loadRules(
      [
        { raw: "bash", action: "deny" }, // 裸名
        { raw: "bash(git status)", action: "allow" }, // 带参
        { raw: "bash(git", action: "allow" }, // 畸形 → invalid
      ],
      builtinRuleMatchers,
    );
    expect(rules.map((r) => r.invalid)).toEqual([false, false, true]);
    expect(rules[0]).toMatchObject({ toolName: "bash", raw: "bash" });
    expect(rules[1]).toMatchObject({
      toolName: "bash",
      argPattern: "git status",
    });
  });

  it("验收② legacy `:*` 后缀：Bash(git:*) → `git *`（仅 command 分型展开）", () => {
    expect(parseRulePattern("bash(git:*)")).toMatchObject({
      raw: "bash(git:*)", // raw 权威保留原文
      toolName: "bash",
      argPattern: "git *", // 展开产物
    });
    // 非 command 分型不展开（path 分型的 `:*` 是字面量不误展开）
    expect(parseRulePattern("read(./a:*b)")).toMatchObject({
      argPattern: "./a:*b",
    });
  });

  it("验收③ literal 分型 key:value matcher：合法 / 非法 key / 空值警告", () => {
    // 合法 key：解析出 matchers；plain 部分保留为 argPattern
    const mixed = parseRulePattern("agent(coder,model:opus,type:*)");
    expect(mixed).toMatchObject({
      toolName: "agent",
      argPattern: "coder",
    });
    expect(mixed?.toolParamMatchers).toEqual([
      { key: "model", valuePattern: "opus" },
      { key: "type", valuePattern: "*" },
    ]);

    // 纯 key:value：argPattern 保留原文形状（不退 undefined——undefined
    // 是工具级语义，会让未接线的规则放行一切）
    const pure = parseRulePattern("agent(model:opus)");
    expect(pure?.toolParamMatchers).toEqual([{ key: "model", valuePattern: "opus" }]);
    expect(pure?.argPattern).toBe("model:opus");

    // 非法 key（连字符）退回 plain 部分，不产生 matcher
    const badKey = parseRulePattern("agent(coder,bad-key:v)");
    expect(badKey?.toolParamMatchers).toBeUndefined();
    expect(badKey?.argPattern).toBe("coder,bad-key:v");

    // 命名空间名跳过 key:value 解析（MCP 工具 specifier 含 : 不当 matcher）
    expect(parseRulePattern("srv__tool(a:b)")?.toolParamMatchers).toBeUndefined();

    // 空值模式加载后经 linter 报 empty-value-pattern（可检索警告）
    const warns = lintRules(
      loadRules([{ raw: "agent(model:)", action: "allow" }], builtinRuleMatchers),
      { knownToolNames: ["bash", "agent"] },
    ).filter((i) => i.kind === "empty-value-pattern");
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ kind: "empty-value-pattern" });
    expect(warns[0]?.detail).toContain("model");
  });

  it("path 分型的 Windows 盘符不被误解析为 key:value（C:\\ 形状保持）", () => {
    const win = parseRulePattern("edit(C:\\Users\\foo)");
    expect(win?.toolParamMatchers).toBeUndefined();
    expect(win?.argPattern).toBe("C:\\Users\\foo");
  });
});

describe("C44 · 加载期样例校验", () => {
  it("样例自洽的规则正常加载", () => {
    const rules = loadRules(
      [
        {
          raw: "bash(git *)",
          action: "allow",
          line: 5,
          matchExamples: ["git status", "git push"],
          notMatchExamples: ["rm -rf /"],
        },
      ],
      builtinRuleMatchers,
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.line).toBe(5);
  });

  it("正样例未命中的规则加载即报错，错误含行号与原文", () => {
    const load = () =>
      loadRules(
        [
          {
            raw: "bash(git push *)",
            action: "allow",
            line: 3,
            matchExamples: ["git status"],
          },
        ],
        builtinRuleMatchers,
      );
    expect(load).toThrow(RuleLoadError);
    try {
      load();
    } catch (e) {
      const err = e as RuleLoadError;
      expect(err.violations).toEqual([
        { line: 3, raw: "bash(git push *)", kind: "match-example", sample: "git status" },
      ]);
      expect(err.message).toContain("第 3 行");
      expect(err.message).toContain("bash(git push *)");
    }
  });

  it("反样例反而命中的规则同样报错；多条违规一次全列", () => {
    const load = () =>
      loadRules(
        [
          {
            raw: "bash(git *)",
            action: "ask",
            line: 7,
            matchExamples: ["git log"], // 合法
            notMatchExamples: ["git status"], // 反例实际命中 → 违规
          },
          {
            raw: "bash(rm *)",
            action: "deny",
            line: 12,
            matchExamples: ["ls"], // 正例未命中 → 违规
          },
        ],
        builtinRuleMatchers,
      );
    expect(load).toThrow(RuleLoadError);
    try {
      load();
    } catch (e) {
      const violations = (e as RuleLoadError).violations;
      expect(violations).toHaveLength(2);
      expect(violations[0]).toMatchObject({ line: 7, kind: "not-match-example" });
      expect(violations[1]).toMatchObject({ line: 12, kind: "match-example" });
    }
  });

  it("工具级规则与未登记工具的规则带样例即矛盾（examples-without-args）", () => {
    const load = () =>
      loadRules(
        [
          { raw: "bash", action: "allow", line: 2, matchExamples: ["anything"] },
          // T-P1-68 分型路由后 write（path）已登记可校验样例；未登记面
          // 换 literal 工具（sampleCall 形状工具相关不注册，宁严勿松）
          { raw: "grep(x)", action: "allow", line: 3, matchExamples: ["y"] },
        ],
        builtinRuleMatchers,
      );
    expect(load).toThrow(RuleLoadError);
    try {
      load();
    } catch (e) {
      const violations = (e as RuleLoadError).violations;
      expect(violations.map((v) => v.kind)).toEqual([
        "examples-without-args",
        "examples-without-args",
      ]);
      expect(violations.map((v) => v.line)).toEqual([2, 3]);
    }
  });
});

describe("C21 · 参数匹配委托（链上路径）", () => {
  it("bash 规则经匹配器命中命令；首匹配胜 + raw 进 verdict（验收②）", async () => {
    const rules = loadRules(
      [
        { raw: "bash(git status)", action: "allow" },
        { raw: "bash(git *)", action: "ask" },
      ],
      builtinRuleMatchers,
    );
    const chain = assemblePolicyChain({
      user: [
        createRuleSetModule({
          name: "user-rules",
          rules,
          match: loadedRuleMatch(),
          ruleText: loadedRuleText,
        }),
      ],
    });
    const verdict = await chain.evaluate(bashCall("git status"));
    expect(verdict.action).toBe("allow");
    expect(verdict.rule).toBe("bash(git status)"); // raw 原文回显
  });

  it("MCP 命名空间工具带 specifier 的规则永不命中（qwen 拒配同款），链弃权", async () => {
    const rules = loadRules(
      [{ raw: "srv__tool(x)", action: "allow" }],
      builtinRuleMatchers,
    );
    const match = loadedRuleMatch();
    expect(match(rules[0]!, { tool: "srv__tool", args: { x: 1 } })).toBeUndefined();
  });

  it("裸工具规则不经委托，按工具名通配命中", async () => {
    const rules = loadRules([{ raw: "bash", action: "deny" }], builtinRuleMatchers);
    const match = loadedRuleMatch();
    expect(match(rules[0]!, bashCall("anything"))).toBe("deny");
  });

  it("工具名维度通配：B* 规则命中 Bash 调用", () => {
    const rules = loadRules([{ raw: "b*(git *)", action: "ask" }], builtinRuleMatchers);
    const match = loadedRuleMatch();
    expect(match(rules[0]!, bashCall("git push"))).toBe("ask");
  });

  it("C39 分型路由：path 规则按 gitignore 语义命中 write 调用", () => {
    const rules = loadRules(
      [{ raw: "write(/a/**)", action: "allow" }],
      builtinRuleMatchers,
    );
    const match = loadedRuleMatch();
    expect(match(rules[0]!, { tool: "write", args: { path: "/a/b/c.txt" } })).toBe("allow");
    expect(match(rules[0]!, { tool: "write", args: { path: "/b/c.txt" } })).toBeUndefined();
  });

  it("验收⑥ C53：绑绝对路径清单后只命中清单内绝对路径命令", () => {
    const rules = loadRules(
      [{ raw: "bash(C:\tools\git.exe *)", action: "allow" }],
      builtinRuleMatchers,
    );
    const match = loadedRuleMatch();
    // 只命中以清单内绝对路径开头的命令
    expect(match(rules[0]!, bashCall("C:\tools\git.exe status"))).toBe("allow");
    // 裸短名（按 PATH 解析）与 PATH 上其他位置的同名可执行都不命中
    expect(match(rules[0]!, bashCall("git status"))).toBeUndefined();
    expect(match(rules[0]!, bashCall("C:\evil\git.exe status"))).toBeUndefined();
  });
});

