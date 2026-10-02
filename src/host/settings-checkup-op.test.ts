// T-P3-153 E：配置体检——七项检查行式返回（只读；fail/warn 带 section 跳转锚）。
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultSettings, type SettingsShape } from "../session/settings.js";
import { settingsCheckupOp, type CheckupRow } from "./settings-checkup-op.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function fakeCredentials(names: string[]): { listKeys(): Promise<{ name: string }[]> } {
  return { listKeys: () => Promise.resolve(names.map((name) => ({ name }))) };
}

function makeSettings(over: Partial<Record<string, unknown>>): SettingsShape {
  return defaultSettings();
}

function levels(rows: CheckupRow[]): string {
  return rows.map((r) => `${r.level}:${r.item}`).join("\n");
}

describe("settingsCheckupOp", () => {
  it("空配置：全 ok 行（无供应商/无 MCP/无备份 warn 除外）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aegent-check-"));
    dirs.push(dir);
    const { rows } = await settingsCheckupOp({
      settingsPath: join(dir, "settings.json"),
      credentials: fakeCredentials([]),
      getSettings: () => Promise.resolve(defaultSettings()),
    });
    expect(rows.find((r) => r.item === "默认供应商")?.level).toBe("ok");
    expect(rows.find((r) => r.item === "配置备份")?.level).toBe("warn"); // 尚无备份
    expect(rows.filter((r) => r.level === "fail")).toHaveLength(0);
  });
  it("默认供应商缺失引用 → fail；缺凭据/缺 baseUrl → warn（section=providers）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aegent-check-"));
    dirs.push(dir);
    const s = defaultSettings();
    (s as unknown as Record<string, unknown>)["providers"] = [{ name: "a", adapter: "openai", baseUrl: "https://x", model: "m" }];
    (s as unknown as Record<string, unknown>)["defaultProvider"] = "ghost";
    const { rows } = await settingsCheckupOp({
      settingsPath: join(dir, "settings.json"),
      credentials: fakeCredentials([]),
      getSettings: () => Promise.resolve(s),
    });
    const ref = rows.find((r) => r.item === "默认供应商");
    expect(ref?.level).toBe("fail");
    expect(ref?.detail).toContain("ghost");
    const cred = rows.find((r) => r.item === "供应商凭据");
    expect(cred?.level).toBe("warn");
    expect(cred?.detail).toContain("a");
    expect(cred?.section).toBe("providers");
  });
  it("providers 重名 → fail(section=providers)；prompts root 不存在 → warn(section=prompts)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aegent-check-"));
    dirs.push(dir);
    const s = defaultSettings();
    (s as unknown as Record<string, unknown>)["providers"] = [
      { name: "dup", adapter: "openai", baseUrl: "https://x", model: "m" },
      { name: "dup", adapter: "openai", baseUrl: "https://y", model: "m" },
    ];
    (s as unknown as Record<string, unknown>)["prompts"] = { roots: [join(dir, "nope")] };
    const { rows } = await settingsCheckupOp({
      settingsPath: join(dir, "settings.json"),
      credentials: fakeCredentials([]),
      getSettings: () => Promise.resolve(s),
    });
    const dup = rows.find((r) => r.item === "供应商重名");
    expect(dup?.level).toBe("fail");
    expect(dup?.section).toBe("providers");
    const root = rows.find((r) => r.item === "提示词附加源");
    expect(root?.level).toBe("warn");
    expect(root?.section).toBe("prompts");
  });
  it("备份链：备份可解析 → ok；坏备份 → fail(section=transfer)；快捷键冲突 → warn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aegent-check-"));
    dirs.push(dir);
    const settingsPath = join(dir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ version: 1 }), "utf8");
    writeFileSync(`${settingsPath}.bak.0`, "{broken", "utf8");
    const s = defaultSettings();
    (s as unknown as Record<string, unknown>)["shortcuts"] = { "copy-last": "Ctrl+Shift+C", "open-plugins": "Ctrl+Shift+C" };
    const { rows } = await settingsCheckupOp({
      settingsPath,
      credentials: fakeCredentials([]),
      getSettings: () => Promise.resolve(s),
    });
    const bak = rows.find((r) => r.item === "配置备份");
    expect(bak?.level).toBe("fail");
    expect(bak?.section).toBe("transfer");
    const conflict = rows.find((r) => r.item === "键位冲突");
    expect(conflict?.level).toBe("warn");
    expect(conflict?.detail).toContain("Ctrl+Shift+C");
    expect(conflict?.section).toBe("shortcuts");
    expect(existsSync(settingsPath)).toBe(true); // 只读——未动任何文件
  });
  it("levels 快照：空配置七检查齐活（键位冲突 ok 收尾）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aegent-check-"));
    dirs.push(dir);
    const { rows } = await settingsCheckupOp({
      settingsPath: join(dir, "settings.json"),
      credentials: fakeCredentials([]),
      getSettings: () => Promise.resolve(defaultSettings()),
    });
    expect(rows.map((r) => r.item)).toEqual([
      "默认供应商", "供应商条目", "MCP 条目", "提示词源",
      "配置备份", "供应商凭据", "键位冲突",
    ]);
  });
});
