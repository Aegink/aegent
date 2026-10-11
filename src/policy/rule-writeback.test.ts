/**
 * W13a/T9-3 验收：批准写回项目层规则（限层 + 原子 + schema 校验 + 幂等 +
 * 并发锁串行化）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertProjectRulesPath,
  createProjectRuleWriteback,
  RuleWritebackError,
} from "./rule-writeback.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows 句柄释放竞态：临时目录留给系统回收
    }
  }
});

function makeRulesPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-rule-wb-"));
  dirs.push(dir);
  return join(dir, ".aegent", "rules.txt");
}

describe("createProjectRuleWriteback（W13a/T9-3 批准写回）", () => {
  it("写回成功：行格式合法（读侧往返可解析）+ 原子落盘", async () => {
    const path = makeRulesPath();
    const wb = createProjectRuleWriteback({ projectRulesPath: path });
    const result = await wb.appendRule("bash(git status)", "allow");
    expect(result.written).toBe(true);
    expect(result.line).toBe("bash(git status) -> allow");
    const text = readFileSync(path, "utf-8");
    expect(text).toContain("bash(git status) -> allow");
    // 无 .tmp 残留（rename 原子替换完成）
    expect(() => readFileSync(`${path}.tmp`, "utf-8")).toThrow();
  });

  it("限层：非 .aegent/rules.txt 路径构造期类型化拒绝（用户层不可达）", () => {
    const dir = mkdtempSync(join(tmpdir(), "aegent-rule-wb-"));
    dirs.push(dir);
    expect(() =>
      createProjectRuleWriteback({ projectRulesPath: join(dir, "rules.txt") }),
    ).toThrow(expect.objectContaining({ code: "RULE_WRITEBACK_PATH" }));
    expect(() => assertProjectRulesPath(join(dir, "rules.txt"))).toThrow(
      RuleWritebackError,
    );
    // 用户层形状同样拒绝
    expect(() =>
      assertProjectRulesPath(join(dir, "..", ".aegent", "rules.txt").replace("..", "home")),
    ).not.toThrow();
  });

  it("schema 校验：坏 raw（含换行）写前拒绝不落盘", async () => {
    const path = makeRulesPath();
    const wb = createProjectRuleWriteback({ projectRulesPath: path });
    await expect(wb.appendRule("bad\nline", "allow")).rejects.toMatchObject({
      code: "RULE_WRITEBACK_INVALID",
    });
    // 文件未被创建（写前拒绝——零半态）
    expect(() => readFileSync(path, "utf-8")).toThrow();
  });

  it("幂等：同 raw+action 重复写回 no-op（written=false）", async () => {
    const path = makeRulesPath();
    const wb = createProjectRuleWriteback({ projectRulesPath: path });
    await wb.appendRule("bash(npm test)", "allow");
    const again = await wb.appendRule("bash(npm test)", "allow");
    expect(again.written).toBe(false);
    const text = readFileSync(path, "utf-8");
    expect(text.match(/bash\(npm test\) -> allow/g)).toHaveLength(1);
  });

  it("并发锁：并发写回串行落盘（两行都不丢）", async () => {
    const path = makeRulesPath();
    const wb = createProjectRuleWriteback({ projectRulesPath: path });
    await Promise.all([
      wb.appendRule("bash(cmd-a)", "allow"),
      wb.appendRule("bash(cmd-b)", "allow"),
      wb.appendRule("bash(cmd-c)", "ask"),
    ]);
    const text = readFileSync(path, "utf-8");
    expect(text).toContain("bash(cmd-a) -> allow");
    expect(text).toContain("bash(cmd-b) -> allow");
    expect(text).toContain("bash(cmd-c) -> ask");
  });

  it("已有文件追加保留原内容（注释与既有规则不动）", async () => {
    const path = makeRulesPath();
    const dir = path.slice(0, path.lastIndexOf(".aegent"));
    mkdirSync(join(dir, ".aegent"), { recursive: true });
    writeFileSync(
      join(dir, ".aegent", "rules.txt"),
      "# 手写注释\nbash(git status) -> ask\n",
      "utf-8",
    );
    const wb = createProjectRuleWriteback({ projectRulesPath: path });
    await wb.appendRule("bash(npm run build)", "allow");
    const text = readFileSync(path, "utf-8");
    expect(text).toContain("# 手写注释");
    expect(text).toContain("bash(git status) -> ask");
    expect(text).toContain("bash(npm run build) -> allow");
  });
});
