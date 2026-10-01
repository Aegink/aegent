/**
 * 插件脚手架测试（T-P3-148 H/J）——四模板生成即过安装期校验、拒绝非空
 * 目录、dev 市场 upsert（稳定名/保序/越界拒绝）。
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { scaffoldPlugin, upsertDevMarketplace, devMarketplaceName, PLUGIN_TEMPLATE_IDS, type PluginTemplateId } from "./plugin-scaffold.js";
import { validateManifest } from "./plugin-manifest.js";

const CAPS = ["registerTool", "subscribe", "hooks"];
const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-scaffold-"));
  tmpRoots.push(dir);
  return dir;
}

describe("scaffoldPlugin 四模板", () => {
  for (const template of PLUGIN_TEMPLATE_IDS) {
    it(`${template}：生成文件全部存在且 manifest 过安装期校验`, () => {
      const dir = path.join(tmpDir(), "myplug");
      const r = scaffoldPlugin({ slug: "myplug", template, targetDir: dir });
      expect(r.files).toContain("plugin.json");
      expect(r.files).toContain("README.md");
      expect(existsSync(path.join(dir, "plugin.json"))).toBe(true);
      const manifest = JSON.parse(readFileSync(path.join(dir, "plugin.json"), "utf8"));
      const parsed = validateManifest(manifest, CAPS);
      expect(parsed.ok).toBe(true);
      if (template === "view-basic" || template === "full") {
        expect(r.files).toContain("views/index.html");
      }
      if (template === "agent-tool" || template === "full") {
        expect(r.files).toContain("index.js");
        expect(manifest.capabilities).toContain("registerTool");
      }
      if (template === "skill-pack" || template === "full") {
        expect(r.files.some((f) => f.startsWith("skills/"))).toBe(true);
      }
      if (template === "full") {
        expect(manifest.contributes.commands.length).toBeGreaterThan(0);
        expect(manifest.contributes.settings.length).toBeGreaterThan(0);
      }
    });
  }

  it("非空目录拒绝；非法 slug / 未知模板拒绝", () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, "occupied.txt"), "x", "utf8");
    expect(() => scaffoldPlugin({ slug: "x", template: "view-basic", targetDir: dir })).toThrow(/非空/);
    expect(() => scaffoldPlugin({ slug: "Bad Slug", template: "view-basic", targetDir: path.join(tmpDir(), "y") })).toThrow(/slug/);
    expect(() => scaffoldPlugin({ slug: "x", template: "nope" as PluginTemplateId, targetDir: path.join(tmpDir(), "z") })).toThrow(/未知模板/);
  });

  it("生成到已存在但空的目录合法", () => {
    const dir = tmpDir();
    const r = scaffoldPlugin({ slug: "empty-ok", template: "skill-pack", targetDir: dir });
    expect(r.files.length).toBeGreaterThan(0);
  });
});

describe("upsertDevMarketplace（J）", () => {
  it("登记 → 更新同名 → 条目保序；市场名跨调用稳定", () => {
    const ws = tmpDir();
    const pluginDir = path.join(ws, "plugins", "alpha");
    const first = upsertDevMarketplace({ workspaceRoot: ws, name: "alpha", dir: pluginDir, version: "0.1.0", description: "第一个" });
    const second = upsertDevMarketplace({ workspaceRoot: ws, name: "alpha", dir: pluginDir, version: "0.2.0" });
    expect(first.marketplaceName).toBe(second.marketplaceName);
    expect(devMarketplaceName(ws)).toBe(first.marketplaceName);
    const raw = JSON.parse(readFileSync(first.marketplacePath, "utf8"));
    expect(raw.name).toBe(first.marketplaceName);
    expect(raw.plugins).toHaveLength(1);
    expect(raw.plugins[0].version).toBe("0.2.0");
    // 保序：再登记一个插件，alpha 在前
    upsertDevMarketplace({ workspaceRoot: ws, name: "beta", dir: path.join(ws, "plugins", "beta"), version: "1.0.0" });
    const raw2 = JSON.parse(readFileSync(first.marketplacePath, "utf8"));
    expect(raw2.plugins.map((p: { name: string }) => p.name)).toEqual(["alpha", "beta"]);
  });

  it("插件目录越出 workspace/plugins 拒绝", () => {
    const ws = tmpDir();
    expect(() =>
      upsertDevMarketplace({ workspaceRoot: ws, name: "x", dir: path.join(tmpDir(), "elsewhere"), version: "1.0.0" }),
    ).toThrow(/之内/);
  });
});

describe("脚手架产物可被 loader 消费（形状面）", () => {
  it("full 模板的目录结构与贡献命名空间预期一致", () => {
    const dir = path.join(tmpDir(), "fullp");
    const r = scaffoldPlugin({ slug: "fullp", template: "full", targetDir: dir });
    expect(readdirSync(dir).sort()).toEqual(["README.md", "index.js", "plugin.json", "skills", "views"]);
    expect(r.manifest.name).toBe("fullp");
  });
});
