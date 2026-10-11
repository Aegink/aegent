/**
 * W15a/T9-5 验收：能力分片面 + 权限闭集 + 贡献↔权限绑定 + inject 数据化
 * + 热重载"上限快照、变宽即拒"。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CONTRIBUTION_PERMISSION_BINDINGS,
  expandGrantedPermissions,
  PLUGIN_CAPABILITY_SHARDS,
  PLUGIN_INJECTABLE_SERVICES,
  PLUGIN_PERMISSIONS,
} from "../../core/index.js";
import { loadPlugin, PluginSdkError, type PluginCapabilities } from "../../mcp/plugin-sdk.js";
import { validateManifest, PluginManifestError } from "./plugin-manifest.js";
import {
  assembledCapabilityShards,
  loadConfiguredPlugins,
  resetCapabilityCeilings,
} from "./plugin-loader.js";
import { ToolRegistry } from "../../core/index.js";

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows 句柄释放竞态
    }
  }
});

function makePluginDir(manifest: Record<string, unknown>, indexJs: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-shard-"));
  roots.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest), "utf-8");
  writeFileSync(join(dir, "index.js"), indexJs, "utf-8");
  return dir;
}

const noopActivate = `export default { async onActivate() {} };\n`;

describe("权限闭集与分片（W15a/T9-5）", () => {
  it("闭集形状：PLUGIN_PERMISSIONS flat 字符串 + 分片映射（pi-desktop 形状）", () => {
    expect(PLUGIN_PERMISSIONS.every((p) => typeof p === "string")).toBe(true);
    // 分片展开 ⊆ 闭集（映射完整性）
    for (const perms of Object.values(PLUGIN_CAPABILITY_SHARDS)) {
      for (const p of perms) expect(PLUGIN_PERMISSIONS).toContain(p);
    }
    // 绑定表的值 ⊆ 闭集
    for (const perm of Object.values(CONTRIBUTION_PERMISSION_BINDINGS)) {
      expect(PLUGIN_PERMISSIONS).toContain(perm);
    }
  });

  it("声明未实现即拒装：manifest 声明宿主未装配的分片 → 拒绝", () => {
    // 宿主只装配了基线（无 net/session.read 依赖）
    const available = assembledCapabilityShards({});
    expect(available).toEqual([
      "registerTool",
      "subscribe",
      "hooks",
      "settings.read",
      "command.register",
      "skill.register",
      "view.register",
      "mcp.register",
      "settings.schema",
    ]);
    const result = validateManifest(
      { name: "acme", trust: "untrusted", capabilities: ["session.read"] },
      available,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("session.read");
    // 闭集外声明同样拒绝
    const outside = validateManifest(
      { name: "acme", trust: "untrusted", capabilities: ["time-travel"] },
      available,
    );
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.errors[0]).toContain("闭集外能力声明");
  });

  it("贡献↔权限绑定：commands 贡献未声明 command.register → 拒绝", () => {
    const available = assembledCapabilityShards({});
    const missing = validateManifest(
      {
        name: "acme",
        trust: "untrusted",
        capabilities: ["registerTool"],
        contributes: { commands: [{ name: "hi", template: "hey" }] },
      },
      available,
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors[0]).toContain("commands");
      expect(missing.errors[0]).toContain("command.register");
    }
    // 声明后通过
    const granted = validateManifest(
      {
        name: "acme",
        trust: "untrusted",
        capabilities: ["registerTool", "command.register"],
        contributes: { commands: [{ name: "hi", template: "hey" }] },
      },
      available,
    );
    expect(granted.ok).toBe(true);
  });

  it("inject 数据化：服务名闭集 + 声明需 service.invoke", () => {
    const available = assembledCapabilityShards({ injectableServices: {} });
    // 闭集外服务名
    const bogus = validateManifest(
      { name: "acme", trust: "untrusted", capabilities: ["service.invoke"], inject: ["bogus"] },
      available,
    );
    expect(bogus.ok).toBe(false);
    if (!bogus.ok) expect(bogus.errors[0]).toContain("inject 服务名闭集外");
    // 缺 service.invoke 权限
    const noPerm = validateManifest(
      { name: "acme", trust: "untrusted", capabilities: [], inject: ["session"] },
      available,
    );
    expect(noPerm.ok).toBe(false);
    if (!noPerm.ok) expect(noPerm.errors[0]).toContain("service.invoke");
    // 合法：闭集内 + 权限在位
    const ok = validateManifest(
      { name: "acme", trust: "untrusted", capabilities: ["service.invoke"], inject: ["session"] },
      available,
    );
    expect(ok.ok).toBe(true);
    expect(PLUGIN_INJECTABLE_SERVICES).toContain("session");
  });
});

describe("SDK 网关前置断言（W15a/T9-5）", () => {
  it("pluginSettings 未声明 settings.read → 访问即类型化拒绝", async () => {
    await expect(
      loadPlugin(
        {
          manifest: { name: "acme", trust: "untrusted", capabilities: ["registerTool"] },
          onActivate: (caps: PluginCapabilities) => {
            void caps.pluginSettings;
          },
        },
        { availableCapabilities: assembledCapabilityShards({}) },
      ),
    ).rejects.toThrow(/权限未声明：settings.read/);
  });

  it("分片网关放行：声明在位 + 宿主实现在位 → net/session 可用", async () => {
    const seen: string[] = [];
    await loadPlugin(
      {
        manifest: {
          name: "acme",
          trust: "untrusted",
          capabilities: ["net", "session.read", "settings.read"],
        },
        onActivate: async (caps: PluginCapabilities) => {
          const net = await caps.net.fetch("https://example.com", { timeoutMs: 1_000 });
          seen.push(`net:${String(net.status)}`);
          const session = await caps.session.read({ limit: 5 });
          seen.push(`session:${session.ok ? "ok" : "denied"}`);
          seen.push(`settings:${typeof caps.pluginSettings}`);
        },
      },
      {
        availableCapabilities: assembledCapabilityShards({ netFetch: 1, sessionRead: 1 }),
        netFetch: async () => ({ status: 200, body: "hi" }),
        sessionRead: async () => ({ ok: true, rows: [] }),
      },
    );
    expect(seen).toEqual(["net:200", "session:ok", "settings:object"]);
  });

  it("services.get：未声明/未装配 拒绝 + 合法取用（闭集外由清单校验拦截——防御纵深）", async () => {
    const marker = { hello: "service" };
    const outcomes: string[] = [];
    await loadPlugin(
      {
        manifest: {
          name: "acme",
          trust: "untrusted",
          capabilities: ["service.invoke"],
          inject: ["telemetry", "session"],
        },
        onActivate: (caps: PluginCapabilities) => {
          try {
            caps.services.get("channel");
          } catch (e) {
            outcomes.push(e instanceof Error ? e.message : String(e));
          }
          try {
            caps.services.get("session");
          } catch (e) {
            outcomes.push(e instanceof Error ? e.message : String(e));
          }
          const svc = caps.services.get("telemetry");
          outcomes.push(`got:${JSON.stringify(svc)}`);
        },
      },
      {
        availableCapabilities: assembledCapabilityShards({ injectableServices: { telemetry: marker } }),
        injectableServices: { telemetry: marker },
      },
    );
    expect(outcomes[0]).toContain("未在 manifest.inject 声明");
    expect(outcomes[1]).toContain("宿主未装配");
    expect(outcomes[2]).toContain('got:{"hello":"service"}');
  });
});

describe("热重载上限快照（W15a/T9-5 变宽即拒）", () => {
  it("首载授予集是上限：重载声明新权限 → 类型化拒绝", async () => {
    resetCapabilityCeilings();
    const registry = new ToolRegistry({ env: undefined, sessionId: "s0" });
    const dirA = makePluginDir(
      { name: "widener", trust: "untrusted", capabilities: ["registerTool"] },
      noopActivate,
    );
    const entry = { name: "widener", enabled: true, source: dirA, transport: "inprocess" as const };
    const first = await loadConfiguredPlugins(registry, [entry], {});
    expect(first.reports[0]?.ok).toBe(true);
    // 重载：同一插件声明新分片（权限变宽）
    const dirB = makePluginDir(
      { name: "widener", trust: "untrusted", capabilities: ["registerTool", "net"] },
      noopActivate,
    );
    const second = await loadConfiguredPlugins(
      registry,
      [{ ...entry, source: dirB }],
      { netFetch: async () => ({ status: 200, body: "" }) },
    );
    expect(second.reports[0]?.ok).toBe(false);
    expect(second.reports[0]?.error).toContain("热重载能力变宽被拒绝");
    // 同宽重载放行
    const third = await loadConfiguredPlugins(registry, [{ ...entry, source: dirA }], {});
    expect(third.reports[0]?.ok).toBe(true);
    resetCapabilityCeilings();
  });
});

describe("expandGrantedPermissions（分片展开）", () => {
  it("分片名展开为权限组 + 直接权限并入", () => {
    const granted = expandGrantedPermissions(["registerTool", "net.fetch"]);
    expect(granted.has("tool.register")).toBe(true);
    expect(granted.has("net.fetch")).toBe(true);
    expect(granted.has("event.subscribe")).toBe(false);
  });
});

// PluginSdkError 引用保活（错误类型面）
void PluginSdkError;
void PluginManifestError;
