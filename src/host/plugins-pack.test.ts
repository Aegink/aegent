/**
 * 波 6 收尾面测试（T-P3-148 T/V/X）——打包 zip 结构与跳过规则、claude 兼容
 * 转换映射、plugin_define 动态插件（装载/登记/重名拒绝/重启即失语义）。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildStoreZip, collectPluginFiles, packPlugin } from "./plugins-pack.js";
import { claudeToAegentManifest, discoverManifestPath } from "../kernel/plugin-compat.js";
import { validateManifest } from "../kernel/plugin-manifest.js";
import { createPluginDefineTool } from "../../plugins/tools-builtin/plugin-define.js";
import { ToolRegistry } from "../kernel/tools/registry.js";

const CAPS = ["registerTool", "subscribe", "hooks"];
const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

describe("packPlugin（T）", () => {
  it("store-only zip 结构（PK 魔数）+ dist 产物 + sha256 稳定 + 凭据剔除", () => {
    const dir = tmpDir("aegent-pack-");
    writeFileSync(path.join(dir, "plugin.json"), JSON.stringify({ name: "demo", version: "0.3.0", trust: "untrusted", capabilities: [] }), "utf8");
    writeFileSync(path.join(dir, "index.js"), "export default { onActivate() {} };\n", "utf8");
    writeFileSync(path.join(dir, ".env"), "SECRET=1", "utf8");
    mkdirSync(path.join(dir, ".git"), { recursive: true });
    writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    const r1 = packPlugin(dir);
    const r2 = packPlugin(dir);
    expect(r1.file).toContain(`demo-0.3.0.aegentplug`);
    expect(r1.fileCount).toBe(2); // plugin.json + index.js（.env/.git 剔除）
    expect(r1.sha256).toBe(r2.sha256);
    const zip = readFileSync(r1.file);
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(existsSync(path.join(dir, "dist"))).toBe(true);
  });

  it("坏清单拒打包（fail-closed 预检）", () => {
    const dir = tmpDir("aegent-pack2-");
    writeFileSync(path.join(dir, "plugin.json"), "{ broken", "utf8");
    expect(() => packPlugin(dir)).toThrow(/预检失败/);
  });

  it("buildStoreZip：空清单也产出合法 EOCD", () => {
    const zip = buildStoreZip([]);
    expect(zip.length).toBe(22);
    expect(zip.readUInt32LE(0)).toBe(0x06054b50);
  });

  it("collectPluginFiles：跳过 node_modules/dist", () => {
    const dir = tmpDir("aegent-pack3-");
    mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
    mkdirSync(path.join(dir, "dist"), { recursive: true });
    writeFileSync(path.join(dir, "node_modules", "x", "i.js"), "1", "utf8");
    writeFileSync(path.join(dir, "dist", "old.aegentplug"), "1", "utf8");
    writeFileSync(path.join(dir, "plugin.json"), "{}", "utf8");
    const { files } = collectPluginFiles(dir);
    expect(files.map((f) => f.name)).toEqual(["plugin.json"]);
  });
});

describe("claude 兼容读入（V）", () => {
  it("清单位置回退链：.claude-plugin/plugin.json 可发现", () => {
    const dir = tmpDir("aegent-compat-");
    mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"), "{}", "utf8");
    expect(discoverManifestPath(dir)?.kind).toBe("claude");
    writeFileSync(path.join(dir, "plugin.json"), "{}", "utf8");
    expect(discoverManifestPath(dir)?.kind).toBe("aegent"); // 首选仍优先
  });

  it("claude 形状映射：skills 目录 + mcpServers 对象 + userConfig → settings；hooks 告警", () => {
    const dir = tmpDir("aegent-compat2-");
    const raw = {
      name: "claude-ish",
      version: "1.0.0",
      description: "claude 形状",
      skills: "./skills",
      commands: "./commands",
      mcpServers: {
        local: { command: "node", args: ["srv.js"], env: { K: "v" } },
        remote: { type: "http", url: "https://x" },
      },
      userConfig: {
        apiKey: { type: "string", description: "key", sensitive: true },
        limit: { type: "number", default: 5 },
      },
      hooks: { SessionStart: [] },
      agents: { helper: {} },
    };
    const result = claudeToAegentManifest(raw, dir, "claude");
    expect(result.warnings.some((w) => w.includes("hooks"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("agents"))).toBe(true);
    const parsed = validateManifest(result.raw, CAPS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.manifest.contributes?.skills).toEqual(["skills"]);
    expect(parsed.manifest.contributes?.mcpServers?.[0]?.serverName).toBe("local");
    expect(parsed.manifest.contributes?.mcpServers).toHaveLength(1); // http 跳过
    // userConfig 键 slug 化（camelCase → 小写段——我方设置键形状）
    expect(parsed.manifest.contributes?.settings?.find((s) => s.name === "apikey")?.sensitive).toBe(true);
  });
});

describe("plugin_define 动态插件（X）", () => {
  it("data URL 装载 → 工具登记 → 调用回声；重名拒绝；句柄进汇", async () => {
    const registry = new ToolRegistry();
    const handles: { dispose(): Promise<void> }[] = [];
    const tool = createPluginDefineTool({ toolRegistry: registry, handles });
    const result = await tool.execute({
      name: "dyn",
      code: `export default { async onActivate(caps) { caps.registerTool({ name: "hi", async execute(args) { return { content: "hi " + String(args?.who ?? "") }; } }); } };`,
    }, {} as never);
    expect(result).toMatchObject({ content: expect.stringContaining("dyn__hi") });
    expect(handles).toHaveLength(1);
    const out = await registry.dispatch({ callId: "t1", name: "dyn__hi", arguments: JSON.stringify({ who: "aegent" }) });
    expect(out).toMatchObject({ content: "hi aegent" });
    // 重名拒绝
    const again = await tool.execute({ name: "dyn", code: `export default { onActivate() {} };` }, {} as never);
    expect(again).toMatchObject({ isError: true });
    // dispose 后工具消失（重启即失的进程内等价：卸载即失效）
    await handles[0]!.dispose();
    expect(registry.names().filter((n) => n.startsWith("dyn__"))).toHaveLength(0);
  });

  it("坏源码 fail-closed 拒绝（BAD_MODULE）", async () => {
    const tool = createPluginDefineTool({ toolRegistry: new ToolRegistry(), handles: [] });
    const result = await tool.execute({ name: "bad", code: `export const x = 1;` }, {} as never);
    expect(result).toMatchObject({ isError: true });
  });
});
