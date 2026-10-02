/**
 * T-7-09 验收（F1/F2）：
 * ① 嵌套目录 a/b/c 下运行：a/AGENTS.md 与 a/b/AGENTS.md 同时生效，且 b 的
 *    冲突项（同标题小节）覆盖 a；
 * ② 提示词文件改动不需要碰任何 .ts——基础提示缺省从 base.md 文件读取
 *    （真文件，vitest 直跑 src 路径），改文件即改输出；
 * ③ 权限段消费 T-6-02 renderPermissionsPrompt（真模板）+ describeWritableRoots
 *    注入；档位由装配决定（on_request/never 内容互异）。
 * F2 加载语义为自研（收集 + 小节就近覆盖），头注释已声明。
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  assembleSystemPrompt,
  basePromptPath,
  collectAgentsFiles,
  mergeAgentsDocs,
  parseAgentsDoc,
} from "./system-prompt.js";

/** 假 fs：路径 → 内容的 Map。 */
/** Windows 分隔符统一：fixture 键与断言一律经 path.join 构造。 */
const P = (...segs: string[]) => path.join(...segs);

function fakeFs(files: Record<string, string>) {
  return {
    exists: (p: string) => Object.hasOwn(files, p),
    readFile: (p: string) => {
      const c = files[p];
      if (c === undefined) throw new Error(`ENOENT: ${p}`);
      return c;
    },
  };
}

const A_AGENTS = [
  "# 项目 a",
  "",
  "这是 a 层的前导说明。",
  "",
  "## 测试规范",
  "所有测试放 tests/ 目录。",
  "",
  "## 代码风格",
  "缩进用 4 空格。",
].join("\n");

const B_AGENTS = [
  "## 测试规范",
  "测试与源码同目录放置。",
  "",
  "## 提交规范",
  "提交信息用中文。",
].join("\n");

describe("回复语言指令段（T-P3-141——qwen outputLanguage 同构）", () => {
  const deps = (outputLanguage?: "zh-CN" | "en") => ({
    approvalTier: "on_request" as const,
    describeWritableRoots: async () => "F:/repo",
    cwd: "F:/repo",
    root: "F:/repo",
    existsFile: () => false,
    readFile: () => "",
    basePrompt: "基础提示。",
    ...(outputLanguage !== undefined ? { outputLanguage } : {}),
  });

  it("en → 英文指令段；zh-CN → 中文指令段", async () => {
    const en = await assembleSystemPrompt(deps("en"));
    expect(en).toContain("## Output language");
    expect(en).toContain("Always write user-facing replies in English");
    const zh = await assembleSystemPrompt(deps("zh-CN"));
    expect(zh).toContain("## 回复语言");
    expect(zh).toContain("始终用简体中文撰写面向用户的回复");
  });

  it("缺省（auto/未设置）→ 不加段（装配零变化）", async () => {
    const none = await assembleSystemPrompt(deps(undefined));
    expect(none).not.toContain("Output language");
    expect(none).not.toContain("回复语言");
  });
});

describe("验收①：嵌套目录收集 + 就近覆盖（F2）", () => {
  it("a/b/c 下运行：a 与 a/b 的 AGENTS.md 同时生效，b 的『测试规范』覆盖 a", async () => {
    const { exists, readFile } = fakeFs({
      [P("F:/repo/a", "AGENTS.md")]: A_AGENTS,
      [P("F:/repo/a/b", "AGENTS.md")]: B_AGENTS,
    });
    const prompt = await assembleSystemPrompt({
      approvalTier: "on_request",
      describeWritableRoots: async () => "F:/repo/a",
      cwd: "F:/repo/a/b/c",
      root: "F:/repo",
      existsFile: exists,
      readFile,
      basePrompt: "基础提示。",
    });
    // a 的独有小节生效
    expect(prompt).toContain("## 代码风格");
    expect(prompt).toContain("缩进用 4 空格。");
    // b 的独有小节生效（同时生效）
    expect(prompt).toContain("## 提交规范");
    expect(prompt).toContain("提交信息用中文。");
    // 冲突项：『测试规范』取 b（近层），a 的内容被覆盖
    expect(prompt).toContain("测试与源码同目录放置。");
    expect(prompt).not.toContain("所有测试放 tests/ 目录。");
    // 前导：只有 a 有（远层在前拼接）
    expect(prompt).toContain("这是 a 层的前导说明。");
  });

  it("收集序列 = [远 → 近]（cwd 向上到 root 含 root 层）", () => {
    const { exists } = fakeFs({
      [P("F:/repo", "AGENTS.md")]: "root",
      [P("F:/repo/a/b", "AGENTS.md")]: "b",
    });
    const files = collectAgentsFiles(P("F:/repo/a/b/c"), P("F:/repo"), exists);
    expect(files).toEqual([P("F:/repo", "AGENTS.md"), P("F:/repo/a/b", "AGENTS.md")]);
  });

  it("root 是收集边界：root 之上不再向上", () => {
    const { exists } = fakeFs({ [P("F:/repo/a", "AGENTS.md")]: "root" });
    const files = collectAgentsFiles(P("F:/repo/a"), P("F:/repo/a"), exists);
    expect(files).toEqual([P("F:/repo/a", "AGENTS.md")]); // F:/AGENTS.md 即使存在也不收
  });

  it("读取失败的层级跳过（用户文件容错），不破坏其余层级", async () => {
    const prompt = await assembleSystemPrompt({
      approvalTier: "on_request",
      describeWritableRoots: async () => "x",
      cwd: "F:/repo/a",
      root: "F:/repo",
      existsFile: () => true, // 说有
      readFile: (p) => {
        if (p === P("F:/repo/a", "AGENTS.md")) throw new Error("EACCES"); // 读不了
        if (p === P("F:/repo", "AGENTS.md")) return "## 根级规范\nroot 规则。";
        throw new Error(`ENOENT: ${p}`);
      },
      basePrompt: "b。",
    });
    expect(prompt).toContain("## 根级规范");
    expect(prompt).toContain("root 规则。");
  });

  it("mergeAgentsDocs 纯函数：无前导/空文件/深层标题归属父节", () => {
    expect(parseAgentsDoc("# 标题\n前导。\n## A\na1\n### A.1\na2")).toEqual({
      preamble: "# 标题\n前导。",
      sections: new Map([["A", "a1\n### A.1\na2"]]),
    });
    expect(mergeAgentsDocs([{ filepath: "x", content: "" }])).toBe("");
  });
});

describe("验收②：提示词文件改动不需要碰 .ts（F1）", () => {
  it("不注入 basePrompt 时输出含真 base.md 内容（文件是唯一事实源）", async () => {
    const realBase = readFileSync(basePromptPath(), "utf8");
    const prompt = await assembleSystemPrompt({
      approvalTier: "on_request",
      describeWritableRoots: async () => "F:/repo",
      cwd: "F:/repo",
      existsFile: () => false,
      readFile: () => "",
    });
    expect(prompt).toContain(realBase.trim()); // 改 base.md → 输出即变,零 .ts diff
  });
});

describe("验收③：权限段由装配决定（T-6-02 模板 × PathGuard 描述）", () => {
  it.each(["on_request", "never"] as const)(
    "%s 档：输出含对应模板内容与 describeWritableRoots 的产出",
    async (tier) => {
      const prompt = await assembleSystemPrompt({
        approvalTier: tier,
        describeWritableRoots: async () => "F:/repo/src、F:/repo/tests",
        cwd: "F:/repo",
        existsFile: () => false,
        readFile: () => "",
        basePrompt: "基础。",
      });
      expect(prompt).toContain("F:/repo/src、F:/repo/tests"); // {{WRITABLE_ROOTS}} 全量替换
      expect(prompt).toContain("审批"); // 模板正文进入输出
      // 档位互异：装配的档位决定内容（对另一档的特征做负断言）
      const other = tier === "on_request" ? "一律拒绝" : "会询问";
      expect(prompt).not.toContain(other);
    },
  );
});

describe("T-P3-151 C2：记忆末层（~/.aegent/memory/MEMORY.md）", () => {
  const mkDeps = (deps: Partial<Parameters<typeof assembleSystemPrompt>[0]> = {}) => ({
    approvalTier: "on_request" as const,
    describeWritableRoots: async () => "F:/repo",
    cwd: "F:/repo",
    existsFile: () => false,
    readFile: () => "",
    basePrompt: "基础。",
    ...deps,
  });

  it("memoryPath 存在且非空 → 「## 持久记忆」独立段进装配末层（agents 之后）", async () => {
    const prompt = await assembleSystemPrompt(mkDeps({
      existsFile: (p) => p.endsWith("MEMORY.md") || p.endsWith("AGENTS.md"),
      readFile: (p) => (p.endsWith("AGENTS.md") ? "## 风格\n用 Tab 缩进" : "- 偏好中文回复"),
      memoryPath: "C:/Users/u/.aegent/memory/MEMORY.md",
    }));
    expect(prompt).toContain("## 持久记忆");
    expect(prompt).toContain("偏好中文回复");
    expect(prompt).toContain("## 风格"); // AGENTS.md 段同在
    const agentsIdx = prompt.indexOf("## 风格");
    const memoryIdx = prompt.indexOf("## 持久记忆");
    expect(memoryIdx).toBeGreaterThan(agentsIdx); // 记忆在指令层之后
  });

  it("memoryPath 缺席或文件不存在 → 零记忆段（既有行为零变化）", async () => {
    const prompt = await assembleSystemPrompt(mkDeps({}));
    expect(prompt).not.toContain("持久记忆");
  });

  it("记忆文件为空白 → 不加空段", async () => {
    const prompt = await assembleSystemPrompt(mkDeps({
      existsFile: () => true,
      readFile: () => "   \n  ",
      memoryPath: "C:/Users/u/.aegent/memory/MEMORY.md",
    }));
    expect(prompt).not.toContain("## 持久记忆");
  });
});
