import { describe, expect, it } from "vitest";

import { defaultAskRule, evaluateRule, wildcardMatch } from "./evaluate.js";
import type { Rule } from "./evaluate.js";

function rule(
  permission: string,
  pattern: string,
  action: Rule["action"],
): Rule {
  return { permission, pattern, action };
}

describe("C1 · 三维求值", () => {
  const rules = [
    rule("Bash", "git status", "allow"),
    rule("Bash", "git push*", "ask"),
    rule("Bash", "rm -rf*", "deny"),
  ];

  it("allow：精确规则命中放行", () => {
    expect(evaluateRule("Bash", "git status", rules)).toEqual(rules[0]);
  });

  it("ask：规则落询问", () => {
    expect(evaluateRule("Bash", "git push --force", rules)).toEqual(rules[1]);
  });

  it("deny：规则落拒绝", () => {
    expect(evaluateRule("Bash", "rm -rf /", rules)).toEqual(rules[2]);
  });
});

describe("C3 · 默认落 ask（需求 §8 第 2 条）", () => {
  it("无任何规则时落 ask", () => {
    expect(evaluateRule("Bash", "anything", [])).toEqual(
      defaultAskRule("Bash", "anything"),
    );
  });

  it("有规则但均不命中时同样落 ask，且默认规则带回查询维度的 permission", () => {
    const verdict = evaluateRule("Write", "/etc/hosts", [
      rule("Bash", "*", "allow"),
    ]);
    expect(verdict.action).toBe("ask");
    expect(verdict.permission).toBe("Write");
  });
});

describe("C4 · 双维通配（permission × pattern）", () => {
  it("Bash(git status) 规则精确放行 git status 且不放过 git push", () => {
    const rules = [rule("Bash", "git status", "allow")];
    expect(evaluateRule("Bash", "git status", rules).action).toBe("allow");
    expect(evaluateRule("Bash", "git push", rules).action).toBe("ask");
  });

  it("permission 维度也要命中：同 pattern 不同工具不跨用", () => {
    const rules = [rule("Bash", "git status", "allow")];
    expect(evaluateRule("Write", "git status", rules).action).toBe("ask");
  });

  it("permission 维度支持通配：Bash* 规则管住 Bash 系工具", () => {
    const rules = [rule("Bash*", "*", "ask")];
    expect(evaluateRule("Bash", "ls", rules).action).toBe("ask");
  });

  it("星号跨段：git *status 命中 git status 与 git show-status", () => {
    expect(wildcardMatch("git status", "git *status")).toBe(true);
    expect(wildcardMatch("git show-status", "git *status")).toBe(true);
    expect(wildcardMatch("git status", "git status*")).toBe(true);
  });

  it("问号单字符：git status? 不命中 git status", () => {
    expect(wildcardMatch("git status!", "git status?")).toBe(true);
    expect(wildcardMatch("git status", "git status?")).toBe(false);
  });

  it("尾随'空格加星'使命令尾部可选：ls * 命中 ls 与 ls -la", () => {
    expect(wildcardMatch("ls", "ls *")).toBe(true);
    expect(wildcardMatch("ls -la", "ls *")).toBe(true);
    expect(wildcardMatch("lsx", "ls *")).toBe(false);
  });

  it("锚定全串：子串相似不算命中", () => {
    expect(wildcardMatch("git status --porcelain", "git status")).toBe(false);
    expect(wildcardMatch("xgit status", "git status")).toBe(false);
  });

  it("正则元字符按字面匹配：a+b 不命中 aab", () => {
    expect(wildcardMatch("a+b", "a+b")).toBe(true);
    expect(wildcardMatch("aab", "a+b")).toBe(false);
  });
});

describe("方言（与 opencode 的刻意差异，见 evaluate.ts 头注释）", () => {
  it("大小写敏感：Git STATUS 不命中 git status 规则", () => {
    const rules = [rule("Bash", "git status", "allow")];
    expect(evaluateRule("Bash", "Git STATUS", rules).action).toBe("ask");
  });

  it("反斜杠不归一：反斜杠是 shell 命令语法的一部分，按字面匹配", () => {
    expect(wildcardMatch(String.raw`echo "a\"b"`, String.raw`echo "a\"b"`)).toBe(
      true,
    );
    expect(wildcardMatch(String.raw`echo "a/"b"`, String.raw`echo "a\"b"`)).toBe(
      false,
    );
  });
});

describe("首匹配胜（C2/Q15：不抄 opencode 的 findLast）", () => {
  const wideFirst = [
    rule("Bash", "*", "allow"),
    rule("Bash", "git *", "ask"),
  ];

  it("宽规则在前：git status 落 allow（findLast 语义下会是 ask）", () => {
    expect(evaluateRule("Bash", "git status", wideFirst).action).toBe("allow");
  });

  it("窄规则在前：git status 落 ask——顺序决定结果", () => {
    const narrowFirst = [
      rule("Bash", "git *", "ask"),
      rule("Bash", "*", "allow"),
    ];
    expect(evaluateRule("Bash", "git status", narrowFirst).action).toBe("ask");
  });
});
