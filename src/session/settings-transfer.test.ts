// U20/T-P3-122：配置导入导出——往返 + 凭据排除 + 备份滚动 + 坏包拒绝。
// T-P3-153 A 域：包 v2（选择性导出+版本迁移链+域合并导入）。
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultSettings, parseSettingsShape, type SettingsShape } from "./settings.js";
import {
  applyImportedSettings,
  applyPartialImport,
  backupSettingsFile,
  buildImportPreview,
  exportSettingsPackage,
  exportSettingsPayload,
  resolveImportedPackage,
  SETTINGS_PACKAGE_VERSION,
  SETTINGS_BACKUP_KEEP,
  SettingsImportError,
  TRANSFER_DOMAINS,
  TRANSFER_DOMAIN_IDS,
} from "./settings-transfer.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function sampleSettings(): SettingsShape {
  const s = defaultSettings();
  s.providers = [{ name: "main", adapter: "openai", baseUrl: "https://x", model: "gpt-main" }];
  s.defaultProvider = "main";
  s.defaultModel = "gpt-main";
  s.permission = { approvalTimeoutMs: 60_000 };
  s.sandbox = { network: "deny" };
  s.prompts = [{ name: "review", content: "评审 {{file}}" }];
  s.profiles = [{ name: "coding", defaultProvider: "main" }];
  return s;
}

describe("exportSettingsPayload", () => {
  it("导出往返：导出 → 导入解析 = 原配置；导出串零 apiKey（凭据排除断言）", () => {
    const s = sampleSettings();
    const text = exportSettingsPayload(s);
    // 零明文双保险：settings 无 key 字段、导出串无 apiKey 键
    expect(text).not.toContain('"apiKey"');
    const preview = buildImportPreview(text);
    expect(preview.settings.providers).toEqual(s.providers);
    expect(preview.settings.defaultProvider).toBe("main");
    expect(preview.settings.profiles).toHaveLength(1);
    // 摘要行可读（确认对话框依据）
    expect(preview.summary.some((l) => l.includes("供应商条目 1 个"))).toBe(true);
    expect(preview.summary.some((l) => l.includes("提示词模板 1 个"))).toBe(true);
  });
});

describe("buildImportPreview 坏包拒绝", () => {
  it("非 JSON / kind 不符 / 缺 settings / 形状非法 → 类型化拒绝", () => {
    expect(() => buildImportPreview("{not json")).toThrow(SettingsImportError);
    try {
      buildImportPreview(JSON.stringify({ kind: "other" }));
      expect.unreachable();
    } catch (e) {
      expect((e as SettingsImportError).code).toBe("SETTINGS_IMPORT_BAD_KIND");
    }
    expect(() =>
      buildImportPreview(JSON.stringify({ kind: "aegent-settings-export" })),
    ).toThrow(/缺 settings 段/);
    expect(() =>
      buildImportPreview(
        JSON.stringify({ kind: "aegent-settings-export", settings: { providers: "x" } }),
      ),
    ).toThrow(/providers 须为数组/);
  });
});

describe("applyImportedSettings 本地态", () => {
  it("onboardingDone 不被覆盖；activeProfile 仅同名档保留", () => {
    const current = parseSettingsShape({
      ...defaultSettings(),
      onboardingDone: true,
      activeProfile: "coding",
      defaultProvider: "old",
    });
    const imported = parseSettingsShape({
      ...defaultSettings(),
      profiles: [{ name: "cheap", defaultProvider: "mini" }],
      defaultProvider: "mini",
    });
    const merged = applyImportedSettings(current, imported);
    expect(merged.onboardingDone).toBe(true); // 本地态保留
    expect(merged.activeProfile).toBeUndefined(); // 导入包无同名档 → 清位
    expect(merged.defaultProvider).toBe("mini"); // 配置段替换
    // 导入包含同名档 → activeProfile 保留
    const imported2 = parseSettingsShape({
      ...defaultSettings(),
      profiles: [{ name: "coding", defaultProvider: "main" }],
    });
    const merged2 = applyImportedSettings(current, imported2);
    expect(merged2.activeProfile).toBe("coding");
  });
});

describe("backupSettingsFile 滚动备份", () => {
  it("导入前快照：bak.0 最新、上限 5 份滚动、无文件静默", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-transfer-"));
    tmpDirs.push(dir);
    const settingsPath = path.join(dir, "settings.json");
    // 无现有文件 = 静默无备份
    backupSettingsFile(settingsPath);
    expect(existsSync(`${settingsPath}.bak.0`)).toBe(false);
    // 写 7 个版本 → bak.0 ~ bak.4 滚动保留
    for (let v = 0; v < 7; v++) {
      writeFileSync(settingsPath, JSON.stringify({ v }), "utf8");
      backupSettingsFile(settingsPath);
    }
    expect(existsSync(`${settingsPath}.bak.0`)).toBe(true);
    expect(JSON.parse(readFileSync(`${settingsPath}.bak.0`, "utf8")).v).toBe(6);
    expect(JSON.parse(readFileSync(`${settingsPath}.bak.1`, "utf8")).v).toBe(5);
    expect(JSON.parse(readFileSync(`${settingsPath}.bak.4`, "utf8")).v).toBe(2);
    expect(existsSync(`${settingsPath}.bak.5`)).toBe(false); // 上限 = keep
    expect(SETTINGS_BACKUP_KEEP).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// T-P3-153 A 域：配置包 v2（选择性导出 / 版本迁移链 / 域合并导入）
// ---------------------------------------------------------------------------

/** 可导出键全集基线（与 host SETTINGS_PATCH_SECTIONS 差 onboardingDone/
 * activeProfile/activeProject——partition 完整性锁定，漂移即测试红）。 */
const EXPORTABLE_KEYS = [
  "providers", "defaultProvider", "defaultModel", "profiles",
  "prompts", "mcp", "projects", "appearance", "shortcuts", "enhancement",
  "permission", "sandbox", "logging", "pricing", "skills", "subagents",
  "stt", "tts", "plugins",
] as const;

describe("TRANSFER_DOMAINS 域分区", () => {
  it("八域并集恰为可导出全集（无重叠、无遗漏、不含本地态键）", () => {
    const seen = new Set<string>();
    for (const domain of TRANSFER_DOMAIN_IDS) {
      for (const key of TRANSFER_DOMAINS[domain]) {
        expect(seen.has(key)).toBe(false); // 无重叠
        seen.add(key);
      }
    }
    expect([...seen].sort()).toEqual([...EXPORTABLE_KEYS].sort());
    for (const local of ["onboardingDone", "activeProfile", "activeProject"]) {
      expect(seen.has(local)).toBe(false); // 本地态键永不进包
    }
  });
});

describe("exportSettingsPackage v2", () => {
  it("整包导出：version 2、本地态键剔除、零 apiKey 断言", () => {
    const s = { ...sampleSettings(), onboardingDone: true, activeProject: "p1" } as SettingsShape;
    const { package: pkg, text } = exportSettingsPackage(s);
    expect(pkg.version).toBe(SETTINGS_PACKAGE_VERSION);
    expect(pkg.partial).toBeUndefined();
    expect(pkg.settings).not.toHaveProperty("onboardingDone");
    expect(pkg.settings).not.toHaveProperty("activeProject");
    expect(text).not.toContain('"apiKey"');
  });
  it("部分包导出：仅含所选域的键 + partial/domains 标记", () => {
    const s = sampleSettings();
    const { package: pkg, text } = exportSettingsPackage(s, ["prompts", "appearance"]);
    expect(pkg.partial).toBe(true);
    expect(pkg.domains).toEqual(["prompts", "appearance"]);
    expect(Object.keys(pkg.settings).sort()).toEqual(["appearance", "prompts"].sort());
    expect(text).not.toContain('"apiKey"');
  });
  it("未知域 → 类型化拒绝", () => {
    expect(() => exportSettingsPackage(sampleSettings(), ["nope"])).toThrow(SettingsImportError);
    try {
      exportSettingsPackage(sampleSettings(), ["nope"]);
    } catch (e) {
      expect((e as SettingsImportError).code).toBe("SETTINGS_IMPORT_UNKNOWN_DOMAIN");
    }
  });
});

describe("resolveImportedPackage 版本迁移", () => {
  it("v1 旧包（无 partial）→ replace 分型（迁移链恒等收敛）", () => {
    const resolved = resolveImportedPackage(JSON.parse(exportSettingsPayload(sampleSettings())));
    if (resolved.mode !== "replace") throw new Error("预期 replace 分型");
    expect(resolved.settings.providers).toHaveLength(1);
  });
  it("v2 部分包 → merge 分型 + domains 清单", () => {
    const { package: pkg } = exportSettingsPackage(sampleSettings(), ["mcp"]);
    const resolved = resolveImportedPackage(pkg);
    expect(resolved.mode).toBe("merge");
    if (resolved.mode === "merge") expect(resolved.domains).toEqual(["mcp"]);
  });
  it("v1 整包（显式 version:1 + kind）→ 迁移收敛为 v2 后 replace（迁移步必须抬版本——死循环回归）", () => {
    const v1Package = {
      version: 1,
      kind: "aegent-settings-export",
      exportedAt: "2026-10-03T00:00:00.000Z",
      settings: { version: 1, providers: [{ name: "main", adapter: "openai", baseUrl: "https://x", model: "m" }] },
    };
    const resolved = resolveImportedPackage(v1Package);
    if (resolved.mode !== "replace") throw new Error("预期 replace 分型");
    expect(resolved.settings.providers).toHaveLength(1);
  });
  it("裸 settings（旧 wire 语义误传——无 kind）→ BAD_KIND 快速拒绝", () => {
    const inner = { version: 1, providers: [{ name: "x", adapter: "openai", baseUrl: "https://x", model: "m" }] };
    try {
      resolveImportedPackage(inner);
      expect.unreachable();
    } catch (e) {
      expect((e as SettingsImportError).code).toBe("SETTINGS_IMPORT_BAD_KIND");
    }
  });
  it("版本过新 / 版本非法 → 类型化拒绝", () => {
    const tooNew = { version: SETTINGS_PACKAGE_VERSION + 1, kind: "aegent-settings-export", settings: {} };
    try {
      resolveImportedPackage(tooNew);
      expect.unreachable();
    } catch (e) {
      expect((e as SettingsImportError).code).toBe("SETTINGS_IMPORT_BAD_VERSION");
    }
    const bad = { version: "x", kind: "aegent-settings-export", settings: {} };
    expect(() => resolveImportedPackage(bad)).toThrow(SettingsImportError);
  });
  it("部分包 domains 未知域 → 类型化拒绝", () => {
    const pkg = { version: 2, kind: "aegent-settings-export", partial: true, domains: ["nope"], settings: {} };
    try {
      resolveImportedPackage(pkg);
      expect.unreachable();
    } catch (e) {
      expect((e as SettingsImportError).code).toBe("SETTINGS_IMPORT_UNKNOWN_DOMAIN");
    }
  });
});

describe("applyPartialImport 域合并", () => {
  it("仅覆盖包内所含域；本地态键保留；坏域值整包拒绝不落盘", () => {
    const current = parseSettingsShape({
      ...defaultSettings(),
      providers: [{ name: "old", adapter: "openai", baseUrl: "https://old", model: "m-old" }],
      defaultProvider: "old",
      projects: [{ id: "p1", name: "项目一", folders: ["F:/w"] }],
      onboardingDone: true,
      activeProfile: "coding",
    });
    // 部分包只带 providers 域（providers + defaultProvider + defaultModel + profiles）
    const { package: pkg } = exportSettingsPackage(sampleSettings(), ["providers"]);
    const resolved = resolveImportedPackage(pkg);
    if (resolved.mode !== "merge") throw new Error("预期 merge 分型");
    const merged = applyPartialImport(current, resolved.partial, resolved.domains);
    expect(merged.providers).toHaveLength(1);
    expect(merged.providers[0]?.name).toBe("main"); // 供应商域已覆盖
    expect(merged.defaultProvider).toBe("main");
    expect(merged.projects ?? []).toHaveLength(1); // 未选域不动
    expect((merged.projects ?? [])[0]?.id).toBe("p1");
    expect(merged.onboardingDone).toBe(true); // 本地态恒保留
    // 坏域值：providers 域给非法形状 → 整体 parse fail-closed
    expect(() => applyPartialImport(current, { providers: "垃圾" }, ["providers"])).toThrow(/providers 须为数组/);
  });
});

describe("buildImportPreview v2 分型", () => {
  it("整包 → mode=replace + 摘要；部分包 → mode=merge + domains", () => {
    const full = buildImportPreview(exportSettingsPayload(sampleSettings()));
    expect(full.mode).toBe("replace");
    expect(full.summary.some((l) => l.includes("供应商条目 1 个"))).toBe(true);
    const partial = buildImportPreview(exportSettingsPackage(sampleSettings(), ["prompts"]).text);
    expect(partial.mode).toBe("merge");
    expect(partial.domains).toEqual(["prompts"]);
  });
});
