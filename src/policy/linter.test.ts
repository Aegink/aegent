/**
 * C45/C23 规则 linter 测试（T-P1-66 独立成文件）——既有三类判据用例在
 * self-guard.test.ts / ceiling-exit.test.ts（回归面），本文件承载 T-P1-66
 * 扩的两类（wildcard-tool-name / incomplete-namespace-name）与
 * findInactiveRuleToolNames 纯函数单测。
 */
import { describe, expect, it } from "vitest";

import { builtinRuleMatchers } from "./matchers.js";
import { loadRules } from "./rule-loader.js";
import {
  findInactiveRuleToolNames,
  lintRules,
} from "./linter.js";

const KNOWN_TOOLS = ["bash", "read", "write", "edit", "glob", "grep"];

function lint(raw: string, line?: number) {
  const rules = loadRules(
    [{ raw, action: "allow", ...(line !== undefined ? { line } : {}) }],
    builtinRuleMatchers,
  );
  return lintRules(rules, {
    knownToolNames: KNOWN_TOOLS,
  });
}

describe("C23 · 策略自检扩面（T-P1-66）", () => {
  it("验收①：通配指向空集的规则报 wildcard-tool-name（注册表现存无一命中）", () => {
    // 大小写错位（我方方言大小写敏感，Bash* 命中不了 bash）
    const [caseMiss] = lint("Bash*(git *)", 3);
    expect(caseMiss).toMatchObject({
      kind: "wildcard-tool-name",
      raw: "Bash*(git *)",
      line: 3,
    });
    expect(caseMiss?.detail).toContain("无一命中");

    // 命名空间通配指向未连接的 server（注册表无 github__ 工具）
    const [noServer] = lint("github__*", 4);
    expect(noServer?.kind).toBe("wildcard-tool-name");
  });

  it("通配能命中注册表现存工具时不报（活规则零误报）", () => {
    expect(lint("b*")).toEqual([]); // b* 命中 bash
    expect(lint("g*p")).toEqual([]); // g*p 命中 glob/grep
  });

  it("验收②：命名空间形状畸形三类各报 incomplete-namespace-name", () => {
    for (const raw of ["a__", "__b", "a__b__c"]) {
      const [issue] = lint(raw);
      expect(issue).toMatchObject({
        kind: "incomplete-namespace-name",
        raw,
      });
      expect(issue?.detail).toContain("server__tool");
    }
  });

  it("两段非空的命名空间名走 unknown-tool（正确形状查注册表）；注册表现存名豁免畸形判定", () => {
    const [ghost] = lint("github__create_issue");
    expect(ghost?.kind).toBe("unknown-tool");

    // 三段名若注册表现存（工具名自身含 __）不报畸形——豁免防误报
    expect(findInactiveRuleToolNames(["a__b__c"], ["a__b__c"])).toEqual([]);
  });

  it("验收④：findInactiveRuleToolNames 三类各一可单测（kimi 同名函数意图）", () => {
    const found = findInactiveRuleToolNames(
      ["Bash*", "a__", "ghost", "bash"],
      KNOWN_TOOLS,
    );
    expect(found).toEqual([
      { name: "Bash*", kind: "wildcard-tool-name" },
      { name: "a__", kind: "incomplete-namespace-name" },
      { name: "ghost", kind: "unknown-tool" },
    ]);
  });
});

describe("C53 · basename 参数规则绑绝对路径（T-P1-68）", () => {
  it("验收⑤：command 分型裸 basename 规则报 basename-unanchored（可检索）", () => {
    const [issue] = lint("bash(git)", 7);
    expect(issue).toMatchObject({
      kind: "basename-unanchored",
      raw: "bash(git)",
      line: 7,
    });
    expect(issue?.detail).toContain("PATH");

    // 非 basename 形状不报：带空格 glob / 含路径分隔 / 非 command 分型
    expect(lint("bash(git *)").map((i) => i.kind)).toEqual([]);
    expect(lint("bash(C:\\tools\\git.exe *)").map((i) => i.kind)).toEqual([]);
    expect(lint("read(secrets)", 1).map((i) => i.kind)).toEqual([]); // path 分型非 basename 语义
  });
});

describe("C40 · 参数名存在性警告（T-P2-201）", () => {
  const KNOWN_PARAMS: Record<string, readonly string[]> = {
    agent: ["model", "type", "depth"],
    bash: ["command"],
  };

  function lintWith(
    sources: Parameters<typeof loadRules>[0],
    knownToolParams: Readonly<Record<string, readonly string[]>> | undefined,
  ) {
    const rules = loadRules(sources, builtinRuleMatchers);
    return lintRules(rules, {
      knownToolNames: [...KNOWN_TOOLS, "agent"],
      ...(knownToolParams !== undefined ? { knownToolParams } : {}),
    });
  }

  it("验收⑥：matcher key 不在工具参数 schema 中报 unknown-param-name（可检索）", () => {
    const issues = lintWith(
      [{ raw: "agent(modle:opus)", action: "allow", line: 3 }],
      KNOWN_PARAMS,
    );
    const unknown = issues.filter((i) => i.kind === "unknown-param-name");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({ raw: "agent(modle:opus)", line: 3 });
    expect(unknown[0]?.detail).toContain("modle");

    // key 在名单内不报
    expect(
      lintWith([{ raw: "agent(model:opus)", action: "allow" }], KNOWN_PARAMS).filter(
        (i) => i.kind === "unknown-param-name",
      ),
    ).toEqual([]);
  });

  it("声明式 matcher 的 key 同样受检（合并后单一字段）", () => {
    const issues = lintWith(
      [
        {
          raw: "bash(git *)",
          action: "allow",
          paramMatchers: [{ key: "dryrun", valuePattern: "true" }],
        },
      ],
      KNOWN_PARAMS, // bash 只有 command
    );
    const unknown = issues.filter((i) => i.kind === "unknown-param-name");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.detail).toContain("dryrun");
  });

  it("无 schema 名单（缺省/无条目）与未知工具、通配工具名都跳过——宁可漏报不误报", () => {
    // 不提供 knownToolParams：完全不检查
    expect(
      lintWith([{ raw: "agent(wat:1)", action: "allow" }], undefined).filter(
        (i) => i.kind === "unknown-param-name",
      ),
    ).toEqual([]);
    // 工具在名单但无 schema 条目：跳过
    expect(
      lintWith(
        [{ raw: "glob(pat:*?)", action: "allow" }],
        KNOWN_PARAMS,
      ).filter((i) => i.kind === "unknown-param-name"),
    ).toEqual([]);
    // 未知工具：unknown-tool 另报，参数名不重复报
    const ghost = lintWith(
      [{ raw: "ghost(wat:1)", action: "allow" }],
      KNOWN_PARAMS,
    );
    expect(ghost.map((i) => i.kind)).toContain("unknown-tool");
    expect(ghost.map((i) => i.kind)).not.toContain("unknown-param-name");
  });
});
