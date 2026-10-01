import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deletePromptFile,
  listPrompts,
  savePrompt,
  promptsConfigOf,
} from "./prompts-gateway.js";
import { promptImportApply, promptImportScan } from "./prompt-import-op.js";
import type { SettingsShape } from "../session/settings.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-prompt-gw-"));
  tmpDirs.push(dir);
  return dir;
}

function baseSettings(prompts?: SettingsShape["prompts"]): SettingsShape {
  const s: SettingsShape = {
    version: 1,
    providers: [],
    permission: {},
    sandbox: {},
    appearance: { theme: "dark", language: "zh-CN" },
    logging: {},
    projects: [],
    prompts,
    mcp: [],
    profiles: [],
  };
  return s;
}

describe("提示词管理面（T-P3-146 C）", () => {
  it("迁移：旧内联库数组段一次性落成用户级文件 + 标记；二次读取不重复", async () => {
    const home = makeHome();
    const s = baseSettings([
      { name: "review", content: "旧库正文", description: "旧库描述" },
      { name: "Bad Name!", content: "非法名跳过" },
    ]);
    const r1 = await listPrompts(s, undefined, home);
    expect(r1.migratedFromSettings).toBe(1);
    const file = path.join(home, ".aegent", "prompts", "review.md");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("旧库正文");
    expect(existsSync(path.join(home, ".aegent", "prompts", "Bad Name!.md"))).toBe(false);
    const r2 = await listPrompts(s, undefined, home);
    expect(r2.migratedFromSettings).toBeUndefined(); // 标记在位 = 不重复
    expect(r2.prompts.filter((p) => p.source === "user")).toHaveLength(1);
  });
  it("保存：slug 校验 / 保留名 / 冒号拒绝 / 128KB 上限 / 项目与用户双落点", async () => {
    const home = makeHome();
    const ws = makeHome();
    const deps = { homeDir: home, workspaceRoot: ws };
    await expect(savePrompt({ name: "Bad!", content: "x" }, deps)).rejects.toMatchObject({ code: "PROMPT_BAD_NAME" });
    await expect(savePrompt({ name: "help", content: "x" }, deps)).rejects.toMatchObject({ code: "PROMPT_BAD_NAME" });
    await expect(savePrompt({ name: "a:b", content: "x" }, deps)).rejects.toMatchObject({ code: "PROMPT_BAD_NAME" });
    await expect(savePrompt({ name: "big", content: "x".repeat(131073) }, deps)).rejects.toMatchObject({ code: "PROMPT_BODY_TOO_LARGE" });
    const project = await savePrompt({ name: "review", content: "正文", argumentHint: "[scope]", scope: "project" }, deps);
    expect(project.path).toBe(path.join(ws, ".zcode", "prompts", "review.md"));
    const user = await savePrompt({ name: "review", content: "用户版", scope: "user" }, deps);
    expect(user.path).toBe(path.join(home, ".aegent", "prompts", "review.md"));
    // 编辑保留未知 frontmatter 键
    writeFileSync(project.path, "---\ncustom: keep\n---\n\n旧正文\n", "utf8");
    await savePrompt({ name: "review", content: "新正文", scope: "project" }, deps);
    const raw = readFileSync(project.path, "utf8");
    expect(raw).toContain("custom: keep");
    expect(raw).toContain("新正文");
  });
  it("清单：停用标记 / source 分类 / 配置投影；删除护栏（受控根外拒绝）", async () => {
    const home = makeHome();
    const ws = makeHome();
    await savePrompt({ name: "a", content: "x" }, { homeDir: home, workspaceRoot: ws });
    await savePrompt({ name: "b", content: "y", scope: "user" }, { homeDir: home, workspaceRoot: ws });
    const s = baseSettings({ disabled: ["a"], roots: [], allowShellExpansion: true });
    const view = await listPrompts(s, ws, home);
    expect(view.config).toEqual({ disabled: ["a"], roots: [], allowShellExpansion: true });
    const a = view.prompts.find((p) => p.name === "a");
    const b = view.prompts.find((p) => p.name === "b");
    expect(a?.disabled).toBe(true);
    expect(a?.source).toBe("project");
    expect(b?.source).toBe("user");
    expect(promptsConfigOf(baseSettings([{ name: "x", content: "y" }]))).toEqual({ disabled: [], roots: [], allowShellExpansion: false });
    // 删除护栏：受控根内可删；根外拒绝
    expect(deletePromptFile(s, { homeDir: home, workspaceRoot: ws }, b!.filePath).deleted).toBe(true);
    expect(existsSync(b!.filePath)).toBe(false);
    try {
      deletePromptFile(s, { homeDir: home, workspaceRoot: ws }, path.join(home, "evil.md"));
      expect.unreachable("护栏应拒绝");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("PROMPT_DELETE_UNCONTROLLED");
    }
  });
});

describe("外部命令导入（T-P3-146 D）", () => {
  it("scan：多源候选 + 命名空间 + 警告；apply：复制进 workspace 主目录 + 护栏", async () => {
    const home = makeHome();
    const ws = makeHome();
    const cmdDir = path.join(home, ".claude", "commands");
    mkdirSync(path.join(cmdDir, "ns"), { recursive: true });
    writeFileSync(path.join(cmdDir, "review.md"), "---\ndescription: 审查\n---\n\n审查正文\n", "utf8");
    writeFileSync(path.join(cmdDir, "ns", "deploy.md"), "部署正文\n", "utf8");
    const scan = await promptImportScan({ homeDir: home, workspaceRoot: ws });
    const claude = scan.sources.find((s) => s.label === "Claude Code（用户）");
    expect(claude?.exists).toBe(true);
    expect(claude?.count).toBe(2);
    const review = scan.candidates.find((c) => c.name === "review");
    expect(review?.description).toBe("审查");
    expect(review?.sourcePath).toBe(path.join(cmdDir, "review.md"));
    expect(scan.candidates.find((c) => c.name === "ns/deploy")?.warning).toContain("缺 description");
    // apply：护栏外来源拒绝
    const apply = await promptImportApply(
      { homeDir: home, workspaceRoot: ws },
      scan.candidates.map((c) => ({ name: c.name, sourcePath: c.sourcePath })),
    );
    expect(apply.imported).toHaveLength(2);
    expect(existsSync(path.join(ws, ".zcode", "prompts", "review.md"))).toBe(true);
    expect(existsSync(path.join(ws, ".zcode", "prompts", "ns", "deploy.md"))).toBe(true);
    // 同名绝不覆盖 + 越界路径拒绝
    const again = await promptImportApply({ homeDir: home, workspaceRoot: ws }, [
      { name: "review", sourcePath: path.join(cmdDir, "review.md") },
      { name: "evil", sourcePath: path.join(home, "evil.md") },
    ]);
    expect(again.skipped).toEqual([{ name: "review", reason: "同名模板已存在（绝不覆盖）" }]);
    expect(again.failed[0]?.error).toContain("护栏拒绝");
  });
});
