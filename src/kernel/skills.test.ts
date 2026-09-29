/**
 * skills 目录加载测试（I2 / T-P1-08）——发现（含嵌套源）/ 诊断不炸 /
 * skill_load 全链 / 改 SKILL.md 零 .ts diff 机验（T-4-01 描述文件基建同款）/
 * 系统提示尾段 / 装配接线（contextLayer 首落带清单）。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadSkills,
  loadSkillsFromRoots,
  parseSkillFrontmatter,
  skillBody,
} from "./skills.js";
import { createSkillLoadTool } from "./tools/builtin/skill.js";
import { ToolRegistry } from "./tools/registry.js";
import { assembleSystemPrompt } from "../context/system-prompt.js";
import { createChildAssembly } from "./assembly.js";
import { InMemoryEventStorage, SessionStore } from "../session/store.js";
import { PathGuard } from "../sandbox/path-guard.js";
import { composeChain } from "./chain.js";

const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 建一个临时工作区并写入技能文件（相对 workspaceRoot 的路径）。 */
function makeWorkspace(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "skills-"));
  tmpRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return root;
}

describe("发现（验收①：含嵌套源）", () => {
  it("递归发现 .zcode/skills 下的 SKILL.md，名字取所在目录名", () => {
    const root = makeWorkspace({
      ".zcode/skills/alpha/SKILL.md":
        "---\nname: alpha\ndescription: 顶层技能\n---\nalpha 正文\n",
      ".zcode/skills/tools/beta/SKILL.md":
        "---\ndescription: 嵌套源技能（名字取目录名）\n---\nbeta 正文\n",
    });
    const { skills, diagnostics } = loadSkills(root);
    expect(diagnostics).toEqual([]);
    expect(skills.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
    const beta = skills.find((s) => s.name === "beta")!;
    expect(beta.description).toBe("嵌套源技能（名字取目录名）");
    expect(beta.filePath.endsWith(path.join(".zcode", "skills", "tools", "beta", "SKILL.md"))).toBe(true);
  });

  it("无技能目录 = 空清单零诊断（可选能力）；无 SKILL.md 的目录继续深入", () => {
    const root = makeWorkspace({
      ".zcode/skills/notes/readme.md": "不是技能（无 SKILL.md 的目录不产诊断）\n",
      ".zcode/skills/deep/a/b/SKILL.md": "---\ndescription: 深层\n---\nx\n",
    });
    const { skills, diagnostics } = loadSkills(root);
    expect(diagnostics).toEqual([]);
    expect(skills.map((s) => s.name)).toEqual(["b"]);
  });
});

describe("诊断不炸（验收②）", () => {
  it("frontmatter 缺损 / 坏行 / 重复名都产诊断码，好技能照常入清单", () => {
    const root = makeWorkspace({
      // 无 frontmatter → invalid_metadata
      ".zcode/skills/nofm/SKILL.md": "只有正文，没有 frontmatter\n",
      // frontmatter 行不合 key: value → parse_failed
      ".zcode/skills/badfm/SKILL.md": "---\nname 没有冒号\n---\nx\n",
      // 两个目录声明同名 → duplicate_name（后者弃用），先发现的保留
      ".zcode/skills/dup-a/SKILL.md": "---\nname: dup\ndescription: 先到\n---\nA\n",
      ".zcode/skills/dup-b/SKILL.md": "---\nname: dup\ndescription: 后到\n---\nB\n",
      // 好技能对照
      ".zcode/skills/good/SKILL.md": "---\ndescription: 正常技能\n---\nG\n",
    });
    const { skills, diagnostics } = loadSkills(root);
    const codes = diagnostics.map((d) => d.code).sort();
    expect(codes).toEqual(["duplicate_name", "invalid_metadata", "parse_failed"]);
    expect(skills.map((s) => s.name)).toEqual(["dup", "good"]);
    expect(skills.find((s) => s.name === "dup")!.description).toBe("先到");
    const dup = diagnostics.find((d) => d.code === "duplicate_name")!;
    expect(dup.path.includes(path.join("dup-b", "SKILL.md"))).toBe(true);
  });

  it("parseSkillFrontmatter / skillBody 纯函数边界", () => {
    expect(parseSkillFrontmatter("无块原文").fields.size).toBe(0);
    const { fields, error } = parseSkillFrontmatter(
      "---\nname: x\nunknown-key: 忽略\ndescription: y\n---\n正文",
    );
    expect(error).toBeUndefined();
    expect(fields.get("name")).toBe("x");
    expect(fields.get("unknown-key")).toBe("忽略");
    expect(fields.get("description")).toBe("y");
    expect(skillBody("---\nname: x\n---\n正文部分")).toBe("正文部分");
    expect(skillBody("无块原文")).toBe("无块原文");
  });
});

describe("skill_load 工具（验收③）", () => {
  function dispatchSkillLoad(root: string, args: Record<string, unknown>) {
    const registry = new ToolRegistry({
      descriptionsDir: path.join(path.dirname(new URL(import.meta.url).pathname), "tools", "descriptions"),
    });
    registry.registerTool(
      createSkillLoadTool({ pathGuard: PathGuard.forWorkspace(root), skillsRoot: root }),
    );
    return registry.dispatch({ callId: "c1", name: "skill_load", arguments: JSON.stringify(args) });
  }

  it("按名取正文（<skill> 块 + 剥 frontmatter）；未知名类型化错误", async () => {
    const root = makeWorkspace({
      ".zcode/skills/alpha/SKILL.md":
        "---\nname: alpha\ndescription: 技能说明\n---\n# 步骤\n1. 做事\n",
    });
    const ok = await dispatchSkillLoad(root, { name: "alpha" });
    expect(ok.isError).toBeUndefined();
    expect(ok.content).toContain('<skill name="alpha"');
    expect(ok.content).toContain("1. 做事");
    expect(ok.content).not.toContain("description: 技能说明"); // frontmatter 已剥

    const unknown = await dispatchSkillLoad(root, { name: "ghost" });
    expect(unknown.isError).toBe(true);
    expect(unknown.error).toMatchObject({ name: "SkillError", code: "SKILL_NOT_FOUND" });

    const badArgs = await dispatchSkillLoad(root, {});
    expect(badArgs.isError).toBe(true);
    expect(badArgs.error).toMatchObject({ code: "INVALID_ARGUMENTS" });
  });

  it("验收④：改 SKILL.md 零 .ts diff——清单与正文都跟文件走（不缓存）", async () => {
    const root = makeWorkspace({
      ".zcode/skills/alpha/SKILL.md":
        "---\nname: alpha\ndescription: 旧描述\n---\n旧正文\n",
    });
    expect(loadSkills(root).skills[0]!.description).toBe("旧描述");
    const before = await dispatchSkillLoad(root, { name: "alpha" });
    expect(before.content).toContain("旧正文");

    // 只改文件（测试无任何 .ts 改动）——重新发现即新清单、重新调用即新正文
    writeFileSync(
      path.join(root, ".zcode", "skills", "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: 新描述\n---\n新正文 v2\n",
      "utf8",
    );
    expect(loadSkills(root).skills[0]!.description).toBe("新描述");
    const after = await dispatchSkillLoad(root, { name: "alpha" });
    expect(after.content).toContain("新正文 v2");
    expect(after.content).not.toContain("旧正文");
  });
});

describe("系统提示尾段（验收④装配面）", () => {
  it("skills 传入时尾段含名+描述；缺省不加段（零行为变化）", async () => {
    const withSkills = await assembleSystemPrompt({
      approvalTier: "on_request",
      describeWritableRoots: async () => "（无）",
      cwd: process.cwd(),
      basePrompt: "BASE",
      skills: [{ name: "alpha", description: "技能说明" }],
    });
    expect(withSkills).toContain("## 可用技能");
    expect(withSkills).toContain("- alpha: 技能说明");
    expect(withSkills).toContain("skill_load");

    const withoutSkills = await assembleSystemPrompt({
      approvalTier: "on_request",
      describeWritableRoots: async () => "（无）",
      cwd: process.cwd(),
      basePrompt: "BASE",
    });
    expect(withoutSkills).not.toContain("可用技能");
  });
});

describe("U22/T-P3-125 技能管理面：disabled 停用 / tools 解析 / 多根合并", () => {
  it("disabled 名单过滤清单（装配面——停用技能不进清单不产诊断）", () => {
    const root = makeWorkspace({
      ".zcode/skills/alpha/SKILL.md": "---\nname: alpha\ndescription: A\n---\nA\n",
      ".zcode/skills/beta/SKILL.md": "---\nname: beta\ndescription: B\n---\nB\n",
    });
    const off = loadSkills(root, { disabled: ["beta"] });
    expect(off.skills.map((s) => s.name)).toEqual(["alpha"]);
    expect(off.diagnostics).toEqual([]);
    // 空名单 = 全量（零行为变化面）
    expect(loadSkills(root, { disabled: [] }).skills).toHaveLength(2);
  });

  it("frontmatter tools: 行解析（逗号/空白分隔去重）+ 缺省无字段", () => {
    const root = makeWorkspace({
      ".zcode/skills/withtools/SKILL.md":
        "---\nname: withtools\ndescription: 带工具集\ntools: read, edit  grep bash read\n---\nT\n",
      ".zcode/skills/plain/SKILL.md": "---\nname: plain\ndescription: 无工具集\n---\nP\n",
    });
    const { skills } = loadSkills(root);
    const withTools = skills.find((s) => s.name === "withtools")!;
    expect(withTools.tools).toEqual(["read", "edit", "grep", "bash"]);
    expect(skills.find((s) => s.name === "plain")!.tools).toBeUndefined();
  });

  it("loadSkillsFromRoots：多根合并 + origin 标注 + 跨根重名首到先得 + roots 报告", () => {
    const ws = makeWorkspace({
      ".zcode/skills/alpha/SKILL.md": "---\nname: alpha\ndescription: 工作区技能\n---\nA\n",
    });
    const external = makeWorkspace({
      ".zcode/skills/alpha/SKILL.md": "---\nname: alpha\ndescription: 外部同名（弃用）\n---\nA2\n",
      ".zcode/skills/gamma/SKILL.md": "---\nname: gamma\ndescription: 外部独有\n---\nG\n",
    });
    const merged = loadSkillsFromRoots(ws, [external]);
    expect(merged.roots).toHaveLength(2);
    const alpha = merged.skills.find((s) => s.name === "alpha")!;
    expect(alpha.description).toBe("工作区技能");
    expect(alpha.origin).toBe(path.join(ws, ".zcode", "skills"));
    expect(merged.skills.find((s) => s.name === "gamma")!.origin).toBe(
      path.join(external, ".zcode", "skills"),
    );
    expect(merged.diagnostics.some((d) => d.code === "duplicate_name")).toBe(true);
    // disabled 与多根正交（合并后过滤）
    const off = loadSkillsFromRoots(ws, [external], { disabled: ["gamma"] });
    expect(off.skills.map((s) => s.name)).toEqual(["alpha"]);
  });

  it("skill_load 工具透传 roots/disabled（装配消费一致面）", async () => {
    const ws = makeWorkspace({
      ".zcode/skills/alpha/SKILL.md": "---\nname: alpha\ndescription: 工作区\n---\nA\n",
    });
    const external = makeWorkspace({
      ".zcode/skills/gamma/SKILL.md": "---\nname: gamma\ndescription: 外部\n---\nG\n",
    });
    const registry = new ToolRegistry({
      descriptionsDir: path.join(path.dirname(new URL(import.meta.url).pathname), "tools", "descriptions"),
    });
    registry.registerTool(
      createSkillLoadTool({
        pathGuard: PathGuard.forWorkspace(ws),
        skillsRoot: ws,
        skillsRoots: [external],
        skillsDisabled: ["alpha"],
      }),
    );
    const dis = await registry.dispatch({
      callId: "c1",
      name: "skill_load",
      arguments: JSON.stringify({ name: "alpha" }),
    });
    expect(dis.isError).toBe(true);
    expect(dis.error).toMatchObject({ code: "SKILL_NOT_FOUND" });
    const ext = await registry.dispatch({
      callId: "c2",
      name: "skill_load",
      arguments: JSON.stringify({ name: "gamma" }),
    });
    expect(ext.isError).toBeUndefined();
    expect(ext.content).toContain('<skill name="gamma"');
    expect(ext.content).toContain("G\n");
  });
});

describe("装配接线：contextLayer 首落 system/message 带技能清单", () => {
  it("workspaceRoot 有技能 → system/message 含技能名；坏技能诊断落日志不炸", async () => {
    const root = makeWorkspace({
      ".zcode/skills/alpha/SKILL.md":
        "---\nname: alpha\ndescription: 集成技能\n---\n正文\n",
      ".zcode/skills/broken/SKILL.md": "没 frontmatter\n",
    });
    const warnings: string[] = [];
    const store = new SessionStore(new InMemoryEventStorage());
    const asm = createChildAssembly({
      sessionId: "s0",
      store,
      workspaceRoot: root,
      contextWindow: 100_000,
      approvalTimeoutMs: 5_000,
      logger: {
        debug: () => {},
        info: () => {},
        warn: (m: string) => warnings.push(m),
        error: () => {},
      },
    });
    // 手动跑 modelRequest 链（contextLayer 是链上最后一层）——系统提示
    // 首次落流发生在该层，terminal 假实现只需要可返回的空输出
    const contextLayer = asm.layers.modelRequest![
      asm.layers.modelRequest!.length - 1
    ]!;
    // system/message 要求开启的 turn+step（词汇表校验）——先落轮/步开启事件
    store.append("s0", [
      { type: "turn/start", turn: 1 },
      { type: "step/start", turn: 1, step: 1 },
    ]);
    const executor = composeChain({
      point: "modelRequest",
      layers: [contextLayer],
      terminal: async () => ({ content: "", toolCalls: [], timed: [] }),
    });
    await executor.run(
      { sessionId: "s0" },
      {
        turn: 1,
        step: 1,
        identity: { provider: "echo", modelId: "m1" },
        messages: [],
      },
    );
    const system = store
      .load("s0")
      .find((e) => e.type === "system/message");
    expect(system).toBeDefined();
    expect(JSON.stringify(system)).toContain("alpha");
    expect(JSON.stringify(system)).toContain("集成技能");
    expect(warnings.some((w) => w.includes("skill-lint") && w.includes("broken"))).toBe(true);
  });
});
