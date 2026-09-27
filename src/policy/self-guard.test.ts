import { describe, expect, it } from "vitest";

import type { PolicyCall } from "./chain.js";
import type { Verdict } from "./decision.js";
import { builtinRuleMatchers } from "./matchers.js";
import { lintRules } from "./linter.js";
import { loadRules } from "./rule-loader.js";
import { enforceSelfGuard, SELF_EDIT_PROTECTED_NAMES } from "./self-guard.js";

const writeCall = (path: string): PolicyCall => ({
  tool: "write",
  args: { path, content: "x" },
});
const editCall = (path: string): PolicyCall => ({
  tool: "edit",
  args: { path, oldText: "a", newText: "b" },
});
const readCall = (path: string): PolicyCall => ({
  tool: "read",
  args: { path },
});

const ALLOW: Verdict = { action: "allow", reason: "链裁决放行" };

describe("C35 · 自我修改防线（编辑器级）", () => {
  it("受保护清单：permissions.json 与 AGENTS.md（只能追加不能替换）", () => {
    expect([...SELF_EDIT_PROTECTED_NAMES]).toEqual([
      "agents.md",
      "permissions.json",
    ]);
  });

  it("C36：清单运行时冻结——mutate 直接 throw（T-P1-70）", () => {
    expect(() => (SELF_EDIT_PROTECTED_NAMES as string[]).push(".evil")).toThrow();
  });

  it("路径任一段命中即受保护，大小写不敏感", () => {
    expect(find("config/permissions.json")).toBe("permissions.json");
    expect(find("/repo/AGENTS.md")).toBe("AGENTS.md");
    expect(find("a\\b\\agents.md")).toBe("agents.md");
    expect(find("/repo/notes.md")).toBeUndefined();
  });

  it("验收①：agent 写 config/permissions.json（含 allow 规则增项）被拒", () => {
    // 场景：agent 试图往权限配置里塞 allow 规则——即便链上已有 allow 裁决
    const verdict = enforceSelfGuard(
      ALLOW,
      writeCall("config/permissions.json"),
      { agentInitiated: true },
    );
    expect(verdict.action).toBe("deny");
    expect(verdict.reason).toContain("用户可手动修改");
  });

  it("agent 对 AGENTS.md 的 write 与 edit 同样被拒", () => {
    for (const call of [writeCall("/repo/AGENTS.md"), editCall("/repo/AGENTS.md")]) {
      const verdict = enforceSelfGuard(ALLOW, call, { agentInitiated: true });
      expect(verdict.action).toBe("deny");
      expect(verdict.reason).toContain("AGENTS.md");
    }
  });

  it("验收②：同文件用户操作（非 agent 上下文）可写——防线在'agent 发起'判定", () => {
    const verdict = enforceSelfGuard(
      ALLOW,
      writeCall("config/permissions.json"),
      { agentInitiated: false },
    );
    expect(verdict).toBe(ALLOW); // 原样透传，不拦
  });

  it("普通路径与非写类调用不受防线影响；read 指令文件合法（loop 本来就要读）", () => {
    expect(
      enforceSelfGuard(ALLOW, writeCall("/repo/README.md"), { agentInitiated: true }),
    ).toBe(ALLOW);
    expect(enforceSelfGuard(ALLOW, readCall("/repo/AGENTS.md"), { agentInitiated: true })).toBe(
      ALLOW,
    );
  });
});

function find(path: string): string | undefined {
  // findSelfEditProtectedSegment 的便捷别名（保持 import 面最小）
  return (
    path
      .split(/[\\/]+/)
      .find((segment) =>
        (SELF_EDIT_PROTECTED_NAMES as readonly string[]).includes(
          segment.toLowerCase(),
        ),
      ) ?? undefined
  );
}

describe("C45 · 规则 linter（永不生效规则输出警告）", () => {
  const KNOWN_TOOLS = ["bash", "read", "write", "edit", "glob", "grep"];

  function lint(raw: string, line?: number) {
    const rules = loadRules(
      [{ raw, action: "allow", ...(line !== undefined ? { line } : {}) }],
      builtinRuleMatchers,
    );
    return lintRules(rules, { knownToolNames: KNOWN_TOOLS });
  }

  it("验收③：喂一条永不匹配的规则输出警告（未知工具名 + 带参无匹配器双警告）", () => {
    const issues = lint("Bashh(git *)", 9);
    expect(issues.map((i) => i.kind)).toEqual([
      "unknown-tool",
      "no-matcher-for-args",
    ]);
    expect(issues[0]).toMatchObject({ raw: "Bashh(git *)", line: 9 });
    expect(issues[0]?.detail).toContain("Bashh");
  });

  it("语法畸形规则报 invalid-syntax；MCP 命名空间带 specifier 报 no-matcher-for-args", () => {
    const [broken] = lint("Bash(git");
    expect(broken).toMatchObject({ kind: "invalid-syntax", raw: "Bash(git" });

    // T-P1-68 分型路由后已知工具（write→path）带参有匹配语义不再报；
    // 永不命中面收窄为未知工具 / 通配 / MCP 命名空间带 specifier
    const dead = loadRules(
      [{ raw: "srv__tool(x)", action: "allow", line: 4 }],
      builtinRuleMatchers,
    );
    const issues = lintRules(dead, {
      knownToolNames: [...KNOWN_TOOLS, "srv__tool"],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "no-matcher-for-args",
      raw: "srv__tool(x)",
      line: 4,
    });
    expect(issues[0]?.detail).toContain("server__tool");
  });

  it("健康规则零警告；工具名通配带参给'无法静态确认'变体", () => {
    expect(lint("bash(git *)")).toEqual([]);
    expect(lint("read")).toEqual([]);
    expect(lint("write(/a/**)")).toEqual([]); // path 分型路由后有匹配语义
    const [wild] = lint("b*(git *)");
    expect(wild?.kind).toBe("no-matcher-for-args");
    expect(wild?.detail).toContain("无法静态确认");
  });

  it("linter 只警告不拒绝：死规则照常加载在集合里", () => {
    // 与 loadRules 的样例硬拒（C44）分层：lint 是装后体检，不是装前拦截
    const rules = loadRules([{ raw: "Bashh(git *)", action: "allow" }], builtinRuleMatchers);
    expect(rules).toHaveLength(1);
  });
});
