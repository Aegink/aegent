/**
 * settings 持久化测试（U1/T-P3-101）——验收三面：
 * ① 三档优先级合并（CLI 显式 > env AEGENT_* > 配置文件 > 缺省）；
 * ② 损坏 fail-closed（JSON 语法错带行列号 + 修复指引；字段类型错同理）；
 * ③ 默认值启动（无文件 → 缺省配置）+ save/load 往返。
 */

import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  SETTINGS_HINT,
  defaultSettings,
  loadSettings,
  parseSettingsFile,
  parseSettingsShape,
  resolveChildLaunchArgv,
  saveSettings,
} from "./settings.js";

describe("parseSettingsShape / parseSettingsFile", () => {
  it("缺省形状：无字段输入 = 缺省配置（默认值启动的形状基线）", () => {
    const s = parseSettingsShape({});
    expect(s).toEqual(defaultSettings());
  });

  it("providers 条目解析：name/adapter/baseUrl/model", () => {
    const s = parseSettingsShape({
      providers: [{ name: "main", adapter: "anthropic", baseUrl: "https://x", model: "m1" }],
      defaultProvider: "main",
    });
    expect(s.providers).toEqual([
      { name: "main", adapter: "anthropic", baseUrl: "https://x", model: "m1" },
    ]);
    expect(s.defaultProvider).toBe("main");
  });

  it("未知顶层键宽容忽略（前向兼容），已知字段类型错 fail-closed", () => {
    const s = parseSettingsShape({ futureField: 1, appearance: { theme: "light" } });
    expect(s.appearance?.theme).toBe("light");
    expect(() => parseSettingsShape({ providers: "not-array" })).toThrow(/providers 须为数组/);
    expect(() => parseSettingsShape({ permission: { approvalTimeoutMs: -1 } })).toThrow(
      /approvalTimeoutMs 须为正整数/,
    );
    expect(() => parseSettingsShape({ sandbox: { network: "maybe" } })).toThrow(/network 非法/);
    expect(() => parseSettingsShape({ appearance: { theme: "blue" } })).toThrow(/theme 非法/);
  });

  it("JSON 语法错 → SettingsError 带 1-based 行列号与修复指引", () => {
    const text = '{\n  "providers": [\n    bad\n  ]\n}';
    try {
      parseSettingsFile(text);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).name).toBe("SettingsError");
      const err = e as Error & { line?: number; column?: number };
      expect(err.line).toBe(3);
      expect(err.column).toBeGreaterThan(1);
      expect(err.message).toContain("第 3 行");
      expect(err.message).toContain(SETTINGS_HINT);
    }
  });

  it("顶层非对象 → SettingsError；坏版本号 → SettingsError", () => {
    expect(() => parseSettingsFile("[1]")).toThrow(/顶层必须是 JSON 对象/);
    expect(() => parseSettingsFile('{"version": 2}')).toThrow(/不支持的配置版本/);
  });
});

describe("loadSettings / saveSettings", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-settings-"));
  const file = path.join(dir, "settings.json");

  it("文件缺失 → 缺省配置（默认值启动）", async () => {
    const { settings } = await loadSettings(path.join(dir, "absent.json"));
    expect(settings).toEqual(defaultSettings());
  });

  it("save → load 往返一致（U14 即改即存的底层）", async () => {
    const s = parseSettingsShape({
      providers: [{ name: "main", baseUrl: "https://api.example.com", model: "m1" }],
      defaultProvider: "main",
      sandbox: { network: "deny" },
    });
    await saveSettings(file, s);
    const { settings } = await loadSettings(file);
    expect(settings).toEqual(s);
    // 零明文纪律抽查：settings.json 不承载 apiKey 字段
    const text = await readFile(file, "utf8");
    expect(text).not.toContain("apiKey");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("resolveChildLaunchArgv（优先级链：显式 > env > file > 缺省）", () => {
  const settings = parseSettingsShape({
    providers: [
      { name: "main", adapter: "anthropic", baseUrl: "https://file.example.com", model: "file-model" },
      { name: "backup", baseUrl: "https://backup.example.com", model: "backup-model" },
    ],
    defaultProvider: "main",
    defaultModel: "global-model",
    permission: { approvalTimeoutMs: 60_000 },
    sandbox: { network: "deny", workspace: "C:/ws", db: "C:/db.sqlite" },
  });

  it("空输入 → 文件档整体生效（defaultProvider 选中条目，适配器名注入）", () => {
    const { args } = resolveChildLaunchArgv([], {}, settings);
    expect(args[args.indexOf("--provider") + 1]).toBe("anthropic"); // 条目 adapter
    expect(args[args.indexOf("--model") + 1]).toBe("file-model");
    expect(args[args.indexOf("--base-url") + 1]).toBe("https://file.example.com");
    expect(args[args.indexOf("--db") + 1]).toBe("C:/db.sqlite");
    expect(args[args.indexOf("--network") + 1]).toBe("deny");
    expect(args[args.indexOf("--approval-timeout") + 1]).toBe("60000");
  });

  it("env 占用 provider 槽 → 文件档条目整体不参与（env 三件套面自洽）", () => {
    const { args } = resolveChildLaunchArgv(
      [],
      { AEGENT_PROVIDER: "openai", AEGENT_MODEL: "env-model", AEGENT_DB: "E:/env.sqlite" },
      settings,
    );
    expect(args).not.toContain("--provider");
    expect(args).not.toContain("--base-url"); // 条目 baseUrl 不注入
    expect(args).not.toContain("--model"); // env 槽留给子进程 env 回退
    expect(args[args.indexOf("--db") + 1]).toBe("E:/env.sqlite"); // 非耦合槽照常
    expect(args[args.indexOf("--network") + 1]).toBe("deny");
  });

  it("显式参数最高（env 与文件档都不越过 childArgs 已有槽位）", () => {
    const explicit = ["--provider", "anthropic", "--model", "cli-model", "--db", "C:/cli.sqlite"];
    const { args } = resolveChildLaunchArgv(
      explicit,
      { AEGENT_PROVIDER: "openai", AEGENT_MODEL: "env-model" },
      settings,
    );
    expect(args.filter((a) => a === "--provider")).toHaveLength(1);
    expect(args[args.indexOf("--model") + 1]).toBe("cli-model");
    expect(args[args.indexOf("--db") + 1]).toBe("C:/cli.sqlite");
    // provider 槽被显式占用 → 条目整体不参与（baseUrl 不掺和）
    expect(args).not.toContain("--base-url");
  });

  it("defaultModel 全局回退（条目缺 model 时；defaultModel 不独立启动模型面）", () => {
    const minimal = parseSettingsShape({
      providers: [{ name: "bare" }],
      defaultProvider: "bare",
      defaultModel: "global-model",
    });
    const { args } = resolveChildLaunchArgv([], {}, minimal);
    expect(args[args.indexOf("--model") + 1]).toBe("global-model");
    expect(args[args.indexOf("--provider") + 1]).toBe("openai"); // 条目无 adapter → 缺省 openai
    const noProvider = parseSettingsShape({ defaultModel: "global-model" });
    expect(resolveChildLaunchArgv([], {}, noProvider).args).not.toContain("--model");
  });

  it("defaultProvider 未配置时模型面不注入（缺省 echo 装配）；apiKey 仅显式/env 面", () => {
    const noDefault = parseSettingsShape({ providers: [{ name: "main" }] });
    const { args } = resolveChildLaunchArgv([], {}, noDefault);
    expect(args).not.toContain("--provider");
    expect(args).not.toContain("--model");
    const { args: bare } = resolveChildLaunchArgv([], {}, settings);
    expect(bare).not.toContain("--api-key"); // settings 零 key——apiKey 仅 env/显式
    const { args: withEnv } = resolveChildLaunchArgv([], { AEGENT_API_KEY: "sk-env" }, settings);
    expect(withEnv[withEnv.indexOf("--api-key") + 1]).toBe("sk-env");
  });
});
