/**
 * 插件贡献解析测试（T-P3-148 B/D/E）——临时目录夹具：命令 file/template
 * 双形式 + 技能目录扫描 + MCP env {setting} 引用解析（缺失整台跳过）。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolvePluginContributions } from "./plugin-contributions.js";
import { loadSkillsFromRoots } from "../../kernel/skills.js";
import type { PluginManifest } from "./plugin-manifest.js";

const dirs: string[] = [];

function makePluginDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-plugin-contrib-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function manifest(name: string, contributes: Record<string, unknown>): PluginManifest {
  return { name, trust: "untrusted", capabilities: [], contributes } as unknown as PluginManifest;
}

describe("resolvePluginContributions", () => {
  it("命令 template 内联形式：短名 + 占位符推导 + filePath 兜底 plugin.json", () => {
    const dir = makePluginDir();
    const r = resolvePluginContributions(
      manifest("demo", { commands: [{ name: "deploy", template: "部署到 $1", argumentHint: "<env>" }] }),
      dir,
      {},
    );
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0]!.name).toBe("deploy"); // 短名语义（T-P3-148 反馈④）
    expect(r.commands[0]!.content).toBe("部署到 $1");
    expect(r.commands[0]!.argumentHint).toBe("<env>");
    expect(r.commands[0]!.placeholders).toEqual(["$1"]);
    expect(r.commands[0]!.filePath).toBe(path.join(dir, "plugin.json"));
    expect(r.diagnostics).toHaveLength(0);
  });

  it("命令 file 形式：frontmatter 消费 + 正文剥离", () => {
    const dir = makePluginDir();
    mkdirSync(path.join(dir, "commands"));
    writeFileSync(
      path.join(dir, "commands", "greet.md"),
      "---\ndescription: 问候\nargument-hint: <名字>\n---\n你好 $1",
      "utf8",
    );
    const r = resolvePluginContributions(
      manifest("demo", { commands: [{ file: "commands/greet.md" }] }),
      dir,
      {},
    );
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0]!.name).toBe("greet");
    expect(r.commands[0]!.description).toBe("问候");
    expect(r.commands[0]!.content).toBe("你好 $1");
  });

  it("命令文件缺失落 not_found 诊断并跳过", () => {
    const dir = makePluginDir();
    const r = resolvePluginContributions(
      manifest("demo", { commands: [{ name: "x", file: "commands/missing.md" }] }),
      dir,
      {},
    );
    expect(r.commands).toHaveLength(0);
    expect(r.diagnostics[0]?.code).toBe("not_found");
  });

  it("技能目录：预览名字空间化 + extraDirs 扫描名一致（D 消费口同源）", () => {
    const dir = makePluginDir();
    mkdirSync(path.join(dir, "skills", "helper"), { recursive: true });
    writeFileSync(
      path.join(dir, "skills", "helper", "SKILL.md"),
      "---\nname: helper\ndescription: 帮手技能\n---\n正文",
      "utf8",
    );
    const r = resolvePluginContributions(manifest("demo", { skills: ["skills"] }), dir, {});
    expect(r.skillDirs).toEqual([{ dir: path.join(dir, "skills"), namePrefix: "demo" }]);
    expect(r.skillNames).toEqual(["demo/helper"]);
    // 运行时消费口：loadSkillsFromRoots extraDirs 产出同一命名空间名
    const scanned = loadSkillsFromRoots(dir, [], { extraDirs: r.skillDirs });
    expect(scanned.skills.map((s) => s.name)).toContain("demo/helper");
    expect(scanned.skills.find((s) => s.name === "demo/helper")?.origin).toBe(path.join(dir, "skills"));
  });

  it("MCP：env 字面直传 + {setting} 引用解析 + 运行时名三段式", () => {
    const dir = makePluginDir();
    const r = resolvePluginContributions(
      manifest("demo", {
        mcpServers: [
          { serverName: "local", command: "node", args: ["srv.js"], env: { LITERAL: "x", TOKEN: { setting: "apiKey" } } },
        ],
        settings: [{ name: "apiKey", type: "string" }],
      }),
      dir,
      { apiKey: "secret-1" },
    );
    expect(r.mcpServers).toHaveLength(1);
    expect(r.mcpServers[0]!.name).toBe("plugin:demo:local");
    expect(r.mcpServers[0]!.env).toEqual({ LITERAL: "x", TOKEN: "secret-1" });
  });

  it("MCP：引用设置未配置 → 整台 server 跳过 + setting_missing 诊断（pi CONFIG_MISSING 同语义）", () => {
    const dir = makePluginDir();
    const r = resolvePluginContributions(
      manifest("demo", {
        mcpServers: [{ serverName: "local", command: "node", env: { TOKEN: { setting: "apiKey" } } }],
        settings: [{ name: "apiKey", type: "string" }],
      }),
      dir,
      {},
    );
    expect(r.mcpServers).toHaveLength(0);
    expect(r.diagnostics[0]?.code).toBe("setting_missing");
  });

  it("无 contributes = 空贡献零诊断（旧插件零成本）", () => {
    const dir = makePluginDir();
    const r = resolvePluginContributions({ name: "old", trust: "untrusted", capabilities: [] } as PluginManifest, dir, {});
    expect(r.commands).toHaveLength(0);
    expect(r.skillDirs).toHaveLength(0);
    expect(r.mcpServers).toHaveLength(0);
    expect(r.diagnostics).toHaveLength(0);
  });
});
