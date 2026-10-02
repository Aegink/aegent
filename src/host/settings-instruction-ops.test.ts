/**
 * 指令中心追加/测试 op 测试（T-P3-151）——instruction-append 的归一/重复
 * 闸/落盘/文本段 + instruction-test-rule 的两层真实求值（首匹配胜/默认
 * ask/invalid 跳过）+ listInstructions 扩展形状（装配序/规则产物/宿主防护）。
 */

import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendInstruction,
  testInstructionRule,
} from "./settings-instruction-ops.js";
import { instructionPaths, listInstructions } from "./instructions-gateway.js";

const dirs: string[] = [];
function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "p151-instr-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function makePaths(home: string, workspace?: string) {
  return instructionPaths(workspace, home);
}

/** 写测试文件前递归建父目录（.aegent/memory 等深层位）。 */
function seedWrite(file: string, content: string, _encoding?: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

describe("instruction-append", () => {
  it("rule 形态 dryRun 归一行且不落盘", async () => {
    const home = makeHome();
    const paths = makePaths(home);
    const result = await appendInstruction(paths, "user-rules", "rule", "  Bash(git status)  ->  allow  ", true);
    expect(result.line).toBe("Bash(git status) -> allow");
    expect(result.saved).toBeUndefined();
    expect(existsSync(result.path)).toBe(false);
  });

  it("rule 形态落盘追加到文件末尾", async () => {
    const home = makeHome();
    const paths = makePaths(home);
    seedWrite(paths.rules, "# 注释\nBash(git status) -> allow\n");
    const result = await appendInstruction(paths, "user-rules", "rule", "Bash(git push) -> deny", false);
    expect(result.saved).toBe(true);
    const text = readFileSync(paths.rules, "utf8");
    expect(text).toBe("# 注释\nBash(git status) -> allow\nBash(git push) -> deny\n");
  });

  it("rule 形态同 raw 同 action 重复拒绝", async () => {
    const home = makeHome();
    const paths = makePaths(home);
    seedWrite(paths.rules, "Bash(git status) -> allow\n");
    await expect(
      appendInstruction(paths, "user-rules", "rule", "Bash(git status) -> allow", false),
    ).rejects.toThrow(/等价规则行/);
  });

  it("rule 形态同 raw 不同 action 不算重复（改判合法）", async () => {
    const home = makeHome();
    const paths = makePaths(home);
    seedWrite(paths.rules, "Bash(git status) -> allow\n");
    const result = await appendInstruction(paths, "user-rules", "rule", "Bash(git status) -> deny", false);
    expect(result.saved).toBe(true);
  });

  it("rule 形态多行/坏形状拒绝", async () => {
    const home = makeHome();
    const paths = makePaths(home);
    await expect(
      appendInstruction(paths, "user-rules", "rule", "Bash(git status) -> allow\nEdit -> deny", false),
    ).rejects.toThrow(/单行/);
    await expect(
      appendInstruction(paths, "user-rules", "rule", "只是一段话", false),
    ).rejects.toThrow(/形状/);
  });

  it("text 形态前置空行分隔追加", async () => {
    const home = makeHome();
    const paths = makePaths(home);
    seedWrite(paths.project, "## 既有约定\n- 保持缩进\n");
    const result = await appendInstruction(paths, "project-rules", "text", "## 新增\n- 新条目", false);
    expect(result.saved).toBe(true);
    const text = readFileSync(paths.projectRules, "utf8");
    expect(text).toBe("## 新增\n- 新条目\n");
  });

  it("text 形态在既有文件后空行分隔", async () => {
    const home = makeHome();
    const paths = makePaths(home);
    seedWrite(paths.projectRules, "## 既有\n");
    await appendInstruction(paths, "project-rules", "text", "## 追加段", false);
    const text = readFileSync(paths.projectRules, "utf8");
    expect(text).toBe("## 既有\n\n## 追加段\n");
  });
});

describe("instruction-test-rule", () => {
  it("用户层命中回显层/行号/原文", () => {
    const home = makeHome();
    const paths = makePaths(home);
    seedWrite(paths.rules, "# 注释\nBash(git status) -> allow\nBash(git push*) -> deny\n");
    const verdict = testInstructionRule(paths, "Bash", { command: "git push --force origin main" });
    expect(verdict.action).toBe("deny");
    expect(verdict.hit?.layer).toBe("user");
    expect(verdict.hit?.raw).toBe("Bash(git push*)");
    expect(verdict.hit?.line).toBe(3);
  });

  it("用户层不命中时项目层命中（首匹配胜顺序）", () => {
    const home = makeHome();
    const workspace = makeHome();
    const paths = makePaths(home, workspace);
    seedWrite(paths.rules, "WebFetch -> ask\n");
    seedWrite(paths.projectRules, "Bash(npm test*) -> allow\n");
    const verdict = testInstructionRule(paths, "Bash", { command: "npm test -- --watch" });
    expect(verdict.action).toBe("allow");
    expect(verdict.hit?.layer).toBe("project");
    expect(verdict.steps[0]?.layer).toBe("user");
    expect(verdict.steps[0]?.matched).toBe(false);
    expect(verdict.steps[1]?.matched).toBe(true);
  });

  it("两层无命中默认 ask", () => {
    const home = makeHome();
    const paths = makePaths(home);
    seedWrite(paths.rules, "Bash(git status) -> allow\n");
    const verdict = testInstructionRule(paths, "Bash", { command: "rm -rf /" });
    expect(verdict.action).toBe("ask");
    expect(verdict.hit).toBeUndefined();
    expect(verdict.note).toContain("默认 ask");
  });

  it("invalid 行不参与匹配（永不命中）", () => {
    const home = makeHome();
    const paths = makePaths(home);
    // 括号不闭合 = parseRulePattern 失败 → invalid 标记（永不命中）。
    seedWrite(paths.rules, "Bash(git status -> allow\n");
    const verdict = testInstructionRule(paths, "Bash", { command: "git status" });
    expect(verdict.action).toBe("ask");
    expect(verdict.hit).toBeUndefined();
  });

  it("尾随空格星额外命中裸命令（opencode 同款语义）", () => {
    const home = makeHome();
    const paths = makePaths(home);
    seedWrite(paths.rules, "Bash(ls *) -> allow\n");
    expect(testInstructionRule(paths, "Bash", { command: "ls" }).action).toBe("allow");
    expect(testInstructionRule(paths, "Bash", { command: "ls -la" }).action).toBe("allow");
    expect(testInstructionRule(paths, "Bash", { command: "lsof" }).action).toBe("ask");
  });
});

describe("listInstructions 扩展形状", () => {
  it("装配序/规则产物/宿主防护/项目规则与记忆文件位", () => {
    const home = makeHome();
    const workspace = makeHome();
    const paths = makePaths(home, workspace);
    seedWrite(paths.global, "全局指令");
    seedWrite(paths.rules, "Bash(git push) -> deny\n坏行\n");
    const view = listInstructions(paths);
    // A2 装配序：全局 → 项目 → 项目规则 → 用户规则 → 记忆。
    expect(view.assembly.order.map((o) => o.key)).toEqual([
      "global-agents",
      "project-agents",
      "project-rules",
      "user-rules",
      "memory",
    ]);
    expect(view.assembly.order[0]).toMatchObject({ exists: true, chars: 4 });
    // B1 规则产物：invalid 行不进集合（parseRulesText 坏行进 issues）。
    expect(view.ruleSets.layers[0]?.rules).toEqual([{ raw: "Bash(git push)", action: "deny", line: 1, invalid: false }]);
    expect(view.ruleSets.layers[0]?.issues).toHaveLength(1);
    expect(view.ruleSets.layers[0]?.layer).toBe("user");
    expect(view.ruleSets.layers[1]?.layer).toBe("project");
    expect(view.ruleSets.hostProtections.length).toBeGreaterThanOrEqual(5);
    // A3/C2 文件位路径形状。
    expect(view.projectRules.path).toBe(path.join(workspace, ".aegent", "rules.txt"));
    expect(view.memory.path).toBe(path.join(home, ".aegent", "memory", "MEMORY.md"));
    expect(view.projectRules.exists).toBe(false);
  });
});
