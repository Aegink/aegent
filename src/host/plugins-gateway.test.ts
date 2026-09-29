/**
 * 插件管理面测试（T-P3-133）——settings plugins 段 parse / 安装期清单
 * 校验（零代码执行）/ 装配装载（inprocess 工具进注册表 + ws 审批开关 +
 * never-fail 跳过 + 停用不装载）。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkPluginDir, listPlugins } from "./plugins-gateway.js";
import { loadConfiguredPlugins } from "../kernel/plugin-loader.js";
import { ToolRegistry } from "../kernel/tools/registry.js";
import { defaultSettings, parseSettingsShape } from "../session/settings.js";

const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const GOOD_MANIFEST = {
  name: "demo",
  trust: "trusted",
  capabilities: ["registerTool", "subscribe"],
};

/** 建一个最小合法插件目录（清单 + 入口 default 导出 AegentPlugin）。 */
function makePluginDir(body: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-plugin-"));
  tmpRoots.push(dir);
  writeFileSync(path.join(dir, "plugin.json"), JSON.stringify(GOOD_MANIFEST), "utf8");
  writeFileSync(path.join(dir, "index.js"), body, "utf8");
  return dir;
}

/** 入口模块体内联 manifest（AegentPlugin 契约：manifest 必填）。 */
const ENTRY_WITH_MANIFEST =
  `export default { manifest: ${JSON.stringify(GOOD_MANIFEST)}, onActivate() {} };\n`;

describe("settings plugins 段（parseSettingsShape）", () => {
  it("往返一致 + transport 闭集 + 重名/__ 分隔符 fail-closed", () => {
    const s = parseSettingsShape({
      plugins: [
        { name: "demo", source: "D:/plugins/demo" },
        { name: "remote", transport: "ws", source: "ws://127.0.0.1:9000", allowTools: true, enabled: false },
      ],
    });
    expect(s.plugins).toHaveLength(2);
    expect(s.plugins![0]).toEqual({ name: "demo", source: "D:/plugins/demo" });
    expect(s.plugins![1]).toEqual({ name: "remote", transport: "ws", source: "ws://127.0.0.1:9000", allowTools: true, enabled: false });
    expect(parseSettingsShape(JSON.parse(JSON.stringify(s))).plugins).toEqual(s.plugins);
    expect(() => parseSettingsShape({ plugins: [{ name: "a__b", source: "x" }] })).toThrow(/__/);
    expect(() => parseSettingsShape({ plugins: [{ name: "a", source: "x" }, { name: "a", source: "y" }] })).toThrow(/重复/);
    expect(() => parseSettingsShape({ plugins: [{ name: "a", source: "x", transport: "http" }] })).toThrow(/transport 非法/);
    expect(() => parseSettingsShape({ plugins: [{ name: "a" }] })).toThrow(/source 缺失/);
    expect(defaultSettings().plugins).toBeUndefined();
  });
});

describe("listPlugins（安装期清单校验——零代码执行）", () => {
  it("合法目录：manifest 摘要在位（trust 徽标数据面）", () => {
    const dir = makePluginDir(ENTRY_WITH_MANIFEST);
    const view = listPlugins({ ...defaultSettings(), plugins: [{ name: "demo", source: dir }] });
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({ name: "demo", enabled: true, manifest: { name: "demo", trust: "trusted" } });
    expect(view[0]!.error).toBeUndefined();
  });

  it("缺清单/坏 JSON/缺入口/清单名不一致 → 类型化错误行不炸面", () => {
    const noManifest = mkdtempSync(path.join(tmpdir(), "aegent-plugin-"));
    tmpRoots.push(noManifest);
    const badJson = mkdtempSync(path.join(tmpdir(), "aegent-plugin-"));
    tmpRoots.push(badJson);
    writeFileSync(path.join(badJson, "plugin.json"), "{broken", "utf8");
    const noEntry = mkdtempSync(path.join(tmpdir(), "aegent-plugin-"));
    tmpRoots.push(noEntry);
    writeFileSync(path.join(noEntry, "plugin.json"), JSON.stringify(GOOD_MANIFEST), "utf8");
    const view = listPlugins({
      ...defaultSettings(),
      plugins: [
        { name: "a", source: noManifest },
        { name: "b", source: badJson },
        { name: "c", source: noEntry },
      ],
    });
    expect(view[0]!.error).toContain("缺少 plugin.json");
    expect(view[1]!.error).toContain("不是合法 JSON");
    expect(view[2]!.error).toContain("缺少入口 index.js");
  });

  it("停用条目跳过校验；ws 条目校验 URL 形状", () => {
    const view = listPlugins({
      ...defaultSettings(),
      plugins: [
        { name: "off", source: "Z:/nowhere", enabled: false },
        { name: "bad-url", transport: "ws", source: "http://x" },
        { name: "good-url", transport: "ws", source: "ws://127.0.0.1:9000" },
      ],
    });
    expect(view[0]!.error).toBeUndefined(); // 停用不校验（开关是开回的路径）
    expect(view[1]!.error).toContain("ws:// 或 wss://");
    expect(view[2]!.error).toBeUndefined();
  });

  it("checkPluginDir：安装表单的先校验面（合法/失败两路）", () => {
    const dir = makePluginDir(ENTRY_WITH_MANIFEST);
    expect(checkPluginDir(dir)).toMatchObject({ ok: true, name: "demo", trust: "trusted" });
    expect(checkPluginDir(path.join(dir, "no-such")).ok).toBe(false);
  });
});

describe("loadConfiguredPlugins（装配装载——never-fail）", () => {
  it("inprocess：default 导出装载、工具以 `插件名__工具名` 进注册表", async () => {
    const dir = makePluginDir(
      "export default {\n" +
        "  manifest: " + JSON.stringify(GOOD_MANIFEST) + ",\n" +
        "  onActivate(caps) {\n" +
        "    caps.registerTool({ name: 'hello', parameters: { type: 'object' }, execute: () => ({ content: '插件问好' }) });\n" +
        "  },\n" +
        "};\n",
    );
    const registry = new ToolRegistry();
    const { reports, disposeAll } = await loadConfiguredPlugins(registry, [
      { name: "demo", source: dir },
    ]);
    expect(reports).toEqual([{ name: "demo", transport: "inprocess", ok: true, toolCount: 1 }]);
    expect(registry.names()).toContain("demo__hello");
    const result = await registry.dispatch({
      callId: "c1",
      name: "demo__hello",
      arguments: "{}",
    });
    expect(result.content).toBe("插件问好");
    await disposeAll();
  });

  it("never-fail：单插件失败跳过、其余照常装载；停用条目不装载零报告错误", async () => {
    const good = makePluginDir(ENTRY_WITH_MANIFEST);
    const bad = mkdtempSync(path.join(tmpdir(), "aegent-plugin-"));
    tmpRoots.push(bad); // 无清单 = 装载失败
    const registry = new ToolRegistry();
    const { reports } = await loadConfiguredPlugins(registry, [
      { name: "bad", source: bad },
      { name: "demo", source: good },
      { name: "off", source: "Z:/nowhere", enabled: false },
    ]);
    expect(reports).toHaveLength(3);
    expect(reports[0]).toMatchObject({ name: "bad", ok: false });
    expect(reports[0]!.error).toContain("plugin.json");
    expect(reports[1]).toMatchObject({ name: "demo", ok: true });
    expect(reports[2]).toMatchObject({ name: "off", ok: true, toolCount: 0 }); // 停用跳过
    expect(registry.names().filter((n) => n.startsWith("bad__"))).toEqual([]);
  });

  it("清单名与 settings 记录不一致 → 装载拒绝（fail-closed）", async () => {
    const dir = makePluginDir(ENTRY_WITH_MANIFEST); // 清单 name=demo
    const registry = new ToolRegistry();
    const { reports } = await loadConfiguredPlugins(registry, [{ name: "other", source: dir }]);
    expect(reports[0]!.ok).toBe(false);
    expect(reports[0]!.error).toContain("清单名不一致");
  });
});
