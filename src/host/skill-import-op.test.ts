import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  skillImportApply,
  skillImportScan,
  type SkillImportItem,
} from "./skill-import-op.js";
import { deleteSkillDir } from "./skills-gateway.js";
import type { SettingsShape } from "../session/settings.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-skill-import-"));
  tmpDirs.push(dir);
  return dir;
}

function writeSkill(dir: string, rel: string, content: string): void {
  const target = path.join(dir, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

describe("外部技能源扫描与导入（T-P3-144 批次 A）", () => {
  it("scan：目录技能 + 单文件技能（kimi 平面形态）+ 空正文跳过 + 跨源重名先到先得", async () => {
    const home = makeHome();
    writeSkill(
      home,
      ".claude/skills/review-pr/SKILL.md",
      "---\nname: review-pr\ndescription: 审查当前 diff\n---\n\n按步骤审查。\n",
    );
    writeSkill(home, ".claude/skills/with-assets/SKILL.md", "---\nname: wa\ndescription: 带附属资源\n---\n\n正文\n");
    writeSkill(home, ".claude/skills/with-assets/scripts/run.sh", "echo hi\n");
    writeSkill(home, ".agents/skills/flat-note.md", "无 frontmatter 的平面技能正文\n");
    writeSkill(home, ".agents/skills/empty.md", "---\nname: empty\ndescription: 空正文\n---\n\n   \n");
    writeSkill(
      home,
      ".agents/skills/review-pr/SKILL.md",
      "---\nname: review-pr\ndescription: 跨源同名（后者弃用）\n---\n\nx\n",
    );
    const ws = makeHome();
    writeSkill(ws, ".claude/skills/ws-only/SKILL.md", "---\nname: ws-only\ndescription: 项目级源\n---\n\nx\n");
    const r = await skillImportScan({ homeDir: home, workspaceRoot: ws });
    expect(r.candidates.map((c) => c.name).sort()).toEqual(["flat-note", "review-pr", "wa", "ws-only"]);
    const review = r.candidates.find((c) => c.name === "review-pr");
    expect(review?.sourceLabel).toBe("Claude Code");
    expect(review?.kind).toBe("dir");
    const flat = r.candidates.find((c) => c.name === "flat-note");
    expect(flat?.kind).toBe("file");
    expect(flat?.warning).toContain("name");
    const agentsReport = r.sources.find((s) => s.label === "通用（.agents）");
    expect(agentsReport?.skipped).toBe(2); // 空正文 + 跨源重名
  });

  it("apply：目录整拷（含附属资源）+ 单文件转目录形状（无 frontmatter 自动补）", async () => {
    const home = makeHome();
    writeSkill(home, ".claude/skills/with-assets/SKILL.md", "---\nname: with-assets\ndescription: d\n---\n\n正文\n");
    writeSkill(home, ".claude/skills/with-assets/scripts/run.sh", "echo hi\n");
    writeSkill(home, ".agents/skills/flat-note.md", "平面技能正文（无 frontmatter）\n");
    const ws = makeHome();
    const r = await skillImportApply(
      { homeDir: home, workspaceRoot: ws },
      [
        { name: "with-assets", sourcePath: path.join(home, ".claude", "skills", "with-assets"), kind: "dir" },
        { name: "flat-note", sourcePath: path.join(home, ".agents", "skills", "flat-note.md"), kind: "file" },
      ],
    );
    expect(r.imported).toHaveLength(2);
    expect(readFileSync(path.join(ws, ".zcode", "skills", "with-assets", "scripts", "run.sh"), "utf8")).toContain("hi");
    const md = readFileSync(path.join(ws, ".zcode", "skills", "flat-note", "SKILL.md"), "utf8");
    expect(md).toContain("name: flat-note");
    expect(md).toContain("平面技能正文");
  });

  it("apply：同名 skip（绝不覆盖）+ 非 slug 名称与源外路径进 failed（护栏）", async () => {
    const home = makeHome();
    writeSkill(home, ".claude/skills/mine/SKILL.md", "---\nname: mine\ndescription: d\n---\n\nv1\n");
    const ws = makeHome();
    writeSkill(ws, ".zcode/skills/mine/SKILL.md", "---\nname: mine\ndescription: 已存在\n---\n\nlocal\n");
    const items: SkillImportItem[] = [
      { name: "mine", sourcePath: path.join(home, ".claude", "skills", "mine"), kind: "dir" },
      { name: "Bad Name", sourcePath: path.join(home, ".claude", "skills", "mine"), kind: "dir" },
      { name: "evil", sourcePath: path.join(home, "系统目录"), kind: "dir" },
    ];
    const r = await skillImportApply({ homeDir: home, workspaceRoot: ws }, items);
    expect(r.skipped).toHaveLength(1);
    expect(readFileSync(path.join(ws, ".zcode", "skills", "mine", "SKILL.md"), "utf8")).toContain("local");
    expect(r.failed.map((f) => f.name)).toEqual(["Bad Name", "evil"]);
  });

  it("deleteSkillDir：受控根内删除 + 根外拒绝（护栏）", () => {
    const ws = makeHome();
    const extra = makeHome();
    writeSkill(ws, ".zcode/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: d\n---\n\nx\n");
    writeSkill(extra, "skills/beta/SKILL.md", "---\nname: beta\ndescription: d\n---\n\nx\n");
    const settings = { version: 1, providers: [], skills: { roots: [extra] } } as unknown as SettingsShape;
    const deleted = deleteSkillDir(settings, ws, path.join(ws, ".zcode", "skills", "alpha", "SKILL.md"));
    expect(deleted.deleted).toBe(true);
    expect(existsSync(path.join(ws, ".zcode", "skills", "alpha"))).toBe(false);
    // 附加根内的技能可删
    const beta = path.join(extra, "skills", "beta", "SKILL.md");
    expect(deleteSkillDir(settings, ws, beta).deleted).toBe(true);
    // 根外拒绝
    const outside = makeHome();
    writeSkill(outside, "skills/evil/SKILL.md", "x\n");
    expect(() => deleteSkillDir(settings, ws, path.join(outside, "skills", "evil", "SKILL.md"))).toThrow(
      /受控技能根/,
    );
    // 非 SKILL.md 目标拒绝
    expect(() => deleteSkillDir(settings, ws, path.join(ws, ".zcode", "skills"))).toThrow(/SKILL\.md/);
  });
});
