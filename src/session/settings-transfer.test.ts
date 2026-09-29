// U20/T-P3-122：配置导入导出——往返 + 凭据排除 + 备份滚动 + 坏包拒绝。
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultSettings, parseSettingsShape, type SettingsShape } from "./settings.js";
import {
  applyImportedSettings,
  backupSettingsFile,
  buildImportPreview,
  exportSettingsPayload,
  SettingsImportError,
  SETTINGS_BACKUP_KEEP,
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
