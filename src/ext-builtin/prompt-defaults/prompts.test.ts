import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILTIN_PROMPT_TEMPLATES,
  buildPromptMarkdown,
  expandFileReferences,
  expandShellInjections,
  loadPromptTemplatesFromRoots,
  lookupPromptTemplate,
  validatePromptName,
} from "../../kernel/prompts.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-prompts-"));
  tmpDirs.push(dir);
  return dir;
}

function writePrompt(root: string, rel: string, content: string): void {
  const target = path.join(root, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

describe("提示词模板文件域（T-P3-146 C）", () => {
  it("扫描：命名空间相对路径 + frontmatter 四键 + 首到先得遮蔽", () => {
    const project = makeRoot();
    const user = makeRoot();
    writePrompt(project, ".zcode/prompts/review.md", "---\ndescription: 项目版\nargument-hint: [scope]\n---\n\n正文 A\n");
    writePrompt(user, ".aegent/prompts/review.md", "---\ndescription: 用户版\n---\n\n正文 B\n");
    writePrompt(user, ".aegent/prompts/ns/init.md", "正文 C\n");
    const r = loadPromptTemplatesFromRoots([path.join(project, ".zcode", "prompts"), path.join(user, ".aegent", "prompts")]);
    expect(r.roots).toHaveLength(2);
    const review = r.templates.find((t) => t.name === "review");
    expect(review?.description).toBe("项目版"); // 项目级遮蔽用户级（首到先得）
    expect(review?.argumentHint).toBe("[scope]");
    const ns = r.templates.find((t) => t.name === "ns/init");
    expect(ns?.content).toBe("正文 C");
    // 跨根同名落诊断（弃用者可见）
    expect(r.diagnostics.some((d) => d.code === "duplicate_name" && d.path.includes("review"))).toBe(true);
  });
  it("坏文件产诊断跳过不炸：frontmatter 不合形状 / 名称非法", () => {
    const root = makeRoot();
    writePrompt(root, "prompts/bad.md", "---\nthis is not kv\n---\n\n正文\n");
    writePrompt(root, "prompts/Not Slug!.md", "正文\n");
    const r = loadPromptTemplatesFromRoots([path.join(root, "prompts")]);
    expect(r.templates).toHaveLength(0);
    expect(r.diagnostics.map((d) => d.code).sort()).toEqual(["invalid_name", "parse_failed"]);
  });
  it("名称校验：段 slug / Windows 保留名 / 冒号面（保存侧同规则）", () => {
    expect(validatePromptName("review")).toBeUndefined();
    expect(validatePromptName("ci/build")).toBeUndefined();
    expect(validatePromptName("ci/build-x._9")).toBeUndefined();
    expect(validatePromptName("Bad/Name")).toBeDefined();
    expect(validatePromptName("con")).toBeDefined();
    expect(validatePromptName("a../b")).toBeDefined();
  });
  it("frontmatter 组装保留未知键（zcode preserveFrontmatterLines 纪律）", () => {
    const md = buildPromptMarkdown({
      description: "新描述",
      argumentHint: "[x]",
      content: "正文",
      preserveLines: ["custom-key: 保留我", "description: 旧的"],
    });
    expect(md).toContain("custom-key: 保留我");
    expect(md).toContain("description: 新描述");
    expect(md).not.toContain("旧的");
    expect(md.endsWith("正文\n")).toBe(true);
    // frontmatter 块行序：未知键在前（保留序）、消费键随后
    const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(md);
    expect(block?.[1]?.split(/\r?\n/)).toEqual(["custom-key: 保留我", "description: 新描述", "argument-hint: [x]"]);
  });
  it("展开查找面：文件优先、内置垫底、停用剔除（用户同名覆盖 /init）", () => {
    const root = makeRoot();
    writePrompt(root, "prompts/init.md", "我的 init 覆盖版\n");
    const files = loadPromptTemplatesFromRoots([path.join(root, "prompts")]).templates;
    expect(lookupPromptTemplate("init", files, [])?.filePath).not.toBe("builtin://init");
    expect(lookupPromptTemplate("init", [], [])?.name).toBe("init");
    expect(lookupPromptTemplate("init", [], [])?.filePath).toBe(BUILTIN_PROMPT_TEMPLATES[0]?.filePath);
    expect(lookupPromptTemplate("init", files, ["init"])).toBeUndefined(); // 停用 = 不可见
  });
});

describe("动态展开两件（T-P3-146 H）", () => {
  it("expandFileReferences：命中注入 <file> 块、去重、未命中保留原文", async () => {
    const ws = makeRoot();
    writeFileSync(path.join(ws, "a.txt"), "AAA", "utf8");
    const out = await expandFileReferences("看 @a.txt 和 @a.txt 与 @missing.md", { workspaceRoot: ws });
    expect(out).toContain('<file path="a.txt">');
    expect(out).toContain("AAA");
    expect((out.match(/<file path="a.txt">/g) ?? []).length).toBe(1); // 去重
    expect(out).toContain("@missing.md"); // 未命中保留
  });
  it("expandShellInjections：无注入原样返回；有注入回填 stdout", async () => {
    const same = await expandShellInjections("没有注入的正文");
    expect(same).toBe("没有注入的正文");
    const cmd = process.platform === "win32" ? "!`echo hi`" : "!`printf hi2`";
    const out = await expandShellInjections(`结果：${cmd}`);
    expect(out.startsWith("结果：")).toBe(true);
    expect(out.length).toBeGreaterThan("结果：".length);
  }, 20_000);
});
