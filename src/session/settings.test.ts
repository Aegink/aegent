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
  applyProfile,
  defaultSettings,
  failoverOrderFromProviders,
  loadSettings,
  parseSettingsFile,
  parseSettingsShape,
  resolveChildLaunchArgv,
  resolveEnhancementTarget,
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

  it("appearance 全字段 parse（T-P3-141）：枚举闭集 + 形状/上限 fail-closed", () => {
    const ok = parseSettingsShape({
      appearance: {
        themeMode: "schedule",
        scheduleLightStart: "07:00",
        scheduleDarkStart: "19:00",
        skin: "catppuccin",
        accent: "green",
        pluginTheme: "acme",
        uiFontSize: 16,
        fontBase: "Consolas",
        fontMono: "JetBrains Mono",
        chatShowReasoning: false,
        showTimestamps: true,
        chatContentWidth: "wide",
        animations: false,
        colorBlindFriendly: true,
        backgroundImageOpacity: 55,
        language: "system",
        outputLanguage: "en",
      },
    });
    expect(ok.appearance?.themeMode).toBe("schedule");
    expect(ok.appearance?.skin).toBe("catppuccin");
    expect(ok.appearance?.uiFontSize).toBe(16);
    expect(ok.appearance?.chatContentWidth).toBe("wide");
    expect(ok.appearance?.language).toBe("system");
    // 空串的可清除字段落 undefined（清除语义）
    const cleared = parseSettingsShape({ appearance: { skin: "", accent: "" } });
    expect(cleared.appearance?.skin).toBeUndefined();
    // 枚举/形状/上限 fail-closed
    expect(() => parseSettingsShape({ appearance: { themeMode: "auto" } })).toThrow(/themeMode 非法/);
    expect(() => parseSettingsShape({ appearance: { scheduleLightStart: "7点" } })).toThrow(/scheduleLightStart/);
    expect(() => parseSettingsShape({ appearance: { uiFontSize: 15 } })).toThrow(/uiFontSize 非法/);
    expect(() => parseSettingsShape({ appearance: { chatContentWidth: "max" } })).toThrow(/chatContentWidth 非法/);
    expect(() => parseSettingsShape({ appearance: { showTimestamps: "yes" } })).toThrow(/showTimestamps 须为布尔/);
    expect(() => parseSettingsShape({ appearance: { backgroundImage: "data:text/html;base64,AAAA" } })).toThrow(
      /backgroundImage 须为/,
    );
    expect(() =>
      parseSettingsShape({ appearance: { backgroundImage: `data:image/png;base64,${"A".repeat(4_200_001)}` } }),
    ).toThrow(/3MB/);
    expect(() => parseSettingsShape({ appearance: { backgroundImageOpacity: 120 } })).toThrow(
      /backgroundImageOpacity/,
    );
    expect(() => parseSettingsShape({ appearance: { language: "fr" } })).toThrow(/language 非法/);
    expect(() => parseSettingsShape({ appearance: { outputLanguage: "fr" } })).toThrow(/outputLanguage 非法/);
    // dataURL 合法形状通过
    const withBg = parseSettingsShape({ appearance: { backgroundImage: "data:image/png;base64,AAAA" } });
    expect(withBg.appearance?.backgroundImage).toBe("data:image/png;base64,AAAA");
  });

  it("mcp 段解析（U17/T-P3-119）：形状校验 fail-closed（重名/分隔符/args 类型/enabled）", () => {
    const s = parseSettingsShape({
      mcp: [
        { name: "demo", command: "node", args: ["server.js"] },
        { name: "off", command: "node", enabled: false },
      ],
    });
    expect(s.mcp).toEqual([
      { name: "demo", command: "node", args: ["server.js"] },
      { name: "off", command: "node", enabled: false },
    ]);
    expect(() => parseSettingsShape({ mcp: "no" })).toThrow(/mcp 须为数组/);
    expect(() => parseSettingsShape({ mcp: [{ command: "node" }] })).toThrow(/mcp\[\].name 缺失/);
    expect(() => parseSettingsShape({ mcp: [{ name: "a__b", command: "node" }] })).toThrow(
      /命名空间分隔符/,
    );
    expect(() =>
      parseSettingsShape({
        mcp: [
          { name: "a", command: "node" },
          { name: "a", command: "node" },
        ],
      }),
    ).toThrow(/mcp server 名重复：a/);
    expect(() => parseSettingsShape({ mcp: [{ name: "a", command: "node", args: [1] }] })).toThrow(
      /args 须为字符串数组/,
    );
    expect(() =>
      parseSettingsShape({ mcp: [{ name: "a", command: "node", enabled: "yes" }] }),
    ).toThrow(/enabled 须为布尔值/);
  });

  it("mcp 条目 env/timeoutMs（T-P3-143）：合法透传 + 非法 fail-closed", () => {
    const ok = parseSettingsShape({
      mcp: [{ name: "mem", command: "npx", env: { MY_KEY: "v1", EMPTY: "" }, timeoutMs: 20_000 }],
    });
    expect(ok.mcp?.[0]?.env).toEqual({ MY_KEY: "v1", EMPTY: "" });
    expect(ok.mcp?.[0]?.timeoutMs).toBe(20_000);
    expect(() =>
      parseSettingsShape({ mcp: [{ name: "a", command: "node", env: "K=V" }] }),
    ).toThrow(/env 须为对象/);
    expect(() =>
      parseSettingsShape({ mcp: [{ name: "a", command: "node", env: { K: 1 } }] }),
    ).toThrow(/env\.K 须为字符串/);
    expect(() =>
      parseSettingsShape({ mcp: [{ name: "a", command: "node", timeoutMs: 0 }] }),
    ).toThrow(/timeoutMs 须为正数/);
    expect(() =>
      parseSettingsShape({ mcp: [{ name: "a", command: "node", timeoutMs: "soon" }] }),
    ).toThrow(/timeoutMs 须为正数/);
  });

  it("enhancement 段解析（U18/T-P3-120）：任务条目校验 fail-closed", () => {
    const s = parseSettingsShape({
      enhancement: {
        judge: { provider: "main", model: "gpt-mini", reasoning: "low" },
        summarizer: { provider: "main" },
      },
    });
    expect(s.enhancement?.judge).toEqual({ provider: "main", model: "gpt-mini", reasoning: "low" });
    expect(s.enhancement?.summarizer).toEqual({ provider: "main" });
    // T-P3-147 B：provider 放宽可选（缺省 = 回退链语义）——显式键仍须非空串
    expect(parseSettingsShape({ enhancement: { judge: { model: "x" } } }).enhancement?.judge).toEqual({
      model: "x",
    });
    expect(() => parseSettingsShape({ enhancement: { judge: { provider: "" } } })).toThrow(
      /enhancement.judge.provider/,
    );
    expect(() =>
      parseSettingsShape({ enhancement: { judge: { provider: "main", reasoning: "max" } } }),
    ).toThrow(/reasoning 非法/);
    // T-P3-147 B：fallbacks 有序备选（形状校验 + 至少一项有值）
    expect(
      parseSettingsShape({
        enhancement: { judge: { provider: "main", fallbacks: [{ provider: "mini" }, { model: "gpt-x" }] } },
      }).enhancement?.judge?.fallbacks,
    ).toEqual([{ provider: "mini" }, { model: "gpt-x" }]);
    expect(() =>
      parseSettingsShape({ enhancement: { judge: { provider: "main", fallbacks: [{}] } } }),
    ).toThrow(/fallbacks/);
    // T-P3-147 G/E/H：总闸 / 标题 / 摘要指令覆写
    const gated = parseSettingsShape({ enhancement: { enabled: false } });
    expect(gated.enhancement?.enabled).toBe(false);
    const titled = parseSettingsShape({
      enhancement: { title: { provider: "main", prompt: "起个标题" } },
    });
    expect(titled.enhancement?.title?.prompt).toBe("起个标题");
    expect(
      parseSettingsShape({ enhancement: { summaryPrompt: "自定义摘要指令" } }).enhancement?.summaryPrompt,
    ).toBe("自定义摘要指令");
    expect(() => parseSettingsShape({ enhancement: { enabled: "yes" } })).toThrow(/enabled 须为布尔/);
    expect(() =>
      parseSettingsShape({ enhancement: { title: { provider: "main", prompt: "x".repeat(2001) } } }),
    ).toThrow(/title.prompt 超限/);
    // 未提供任务 = 段缺省（不虚构空对象）
    expect(parseSettingsShape({}).enhancement).toBeUndefined();
  });

  it("resolveEnhancementTarget 回退链（U18）：任务 model → 条目 model → defaultModel", () => {
    const providers = [
      { name: "main", adapter: "openai" as const, baseUrl: "https://x", model: "gpt-main" },
      { name: "mini", adapter: "openai" as const, baseUrl: "https://y", model: "gpt-mini" },
    ];
    // 任务级 model 显式 → 覆盖条目 model
    expect(
      resolveEnhancementTarget({ provider: "main", model: "gpt-judge" }, providers, "gpt-d"),
    ).toEqual({ entry: providers[0], modelId: "gpt-judge" });
    // 任务未配 model → 回退条目 model
    expect(resolveEnhancementTarget({ provider: "mini" }, providers, "gpt-d")).toEqual({
      entry: providers[1],
      modelId: "gpt-mini",
    });
    // 条目也无 model → 回退 defaultModel（主模型链）
    const bare = [{ name: "main", adapter: "openai" as const, baseUrl: "https://x" }];
    expect(resolveEnhancementTarget({ provider: "main" }, bare, "gpt-d")).toEqual({
      entry: bare[0],
      modelId: "gpt-d",
    });
    // 条目不存在 = undefined（不虚构辅助模型面）
    expect(resolveEnhancementTarget({ provider: "ghost" }, providers, "gpt-d")).toBeUndefined();
    // 任务未配置 = undefined（零行为）
    expect(resolveEnhancementTarget(undefined, providers, "gpt-d")).toBeUndefined();
  });

  it("Profiles 档（U19/T-P3-121）：parse 校验 fail-closed + applyProfile 产切换 patch", () => {
    const s = parseSettingsShape({
      profiles: [
        {
          name: "coding",
          defaultProvider: "main",
          defaultModel: "gpt-big",
          permission: { approvalTimeoutMs: 60_000 },
          sandbox: { network: "deny" },
        },
        { name: "cheap", defaultProvider: "mini" },
      ],
      activeProfile: "coding",
    });
    expect(s.profiles).toHaveLength(2);
    expect(s.activeProfile).toBe("coding");
    expect(() => parseSettingsShape({ profiles: [{ defaultProvider: "x" }] })).toThrow(
      /profiles\[\].name 缺失/,
    );
    expect(() => parseSettingsShape({ profiles: [{ name: "a" }] })).toThrow(
      /profiles\[\].defaultProvider 缺失/,
    );
    expect(() =>
      parseSettingsShape({
        profiles: [
          { name: "a", defaultProvider: "x" },
          { name: "a", defaultProvider: "y" },
        ],
      }),
    ).toThrow(/profiles 档名重复：a/);
    // 切换 = 批量写生效段（providers 清单不进 patch——组合档不改清单）
    const patch = applyProfile(s.profiles![0]!);
    expect(patch).toEqual({
      defaultProvider: "main",
      defaultModel: "gpt-big",
      permission: { approvalTimeoutMs: 60_000 },
      sandbox: { network: "deny" },
    });
    expect(patch["providers"]).toBeUndefined();
    expect(patch["profiles"]).toBeUndefined();
  });

  it("failoverOrderFromProviders（U19——J15 队列序消费面）：providers 数组序 = failover 序", () => {
    const providers = [
      { name: "first", adapter: "openai" as const, baseUrl: "https://a", model: "m1" },
      { name: "second", adapter: "anthropic" as const, baseUrl: "https://b", model: "m2" },
      { name: "no-model", adapter: "openai" as const, baseUrl: "https://c" }, // 无 model → defaultModel 兜底（U5 装配同源）
      { name: "fourth", adapter: "openai" as const, baseUrl: "https://d", model: "m4" },
    ];
    const order = failoverOrderFromProviders(providers, "m-default");
    expect(order).toEqual([
      { name: "first", provider: "openai", modelId: "m1" },
      { name: "second", provider: "anthropic", modelId: "m2" },
      { name: "no-model", provider: "openai", modelId: "m-default" },
      { name: "fourth", provider: "openai", modelId: "m4" },
    ]);
    // 顺序即优先级：数组序不变 = 队列序不变（UI 上移/下移改 settings 数组序）
    expect(order.map((o) => o.name)).toEqual(["first", "second", "no-model", "fourth"]);
    // 无 defaultModel 且条目无 model → 跳过（无法成 identity）
    expect(failoverOrderFromProviders([providers[2]!], undefined)).toEqual([]);
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

  it("logging 段（U14/T-P3-132 #28 补落）：rawLogDir 往返 + 非法值 fail-closed", () => {
    const s = parseSettingsShape({ logging: { rawLogDir: "C:/logs/raw" } });
    expect(s.logging).toEqual({ rawLogDir: "C:/logs/raw" });
    // 往返：save → load 读回一致
    const round = parseSettingsShape(JSON.parse(JSON.stringify(s)));
    expect(round.logging).toEqual({ rawLogDir: "C:/logs/raw" });
    // 空串与非字符串 fail-closed
    expect(() => parseSettingsShape({ logging: { rawLogDir: "" } })).toThrow(/非空字符串/);
    expect(() => parseSettingsShape({ logging: { rawLogDir: 3 } })).toThrow(/非空字符串/);
    expect(() => parseSettingsShape({ logging: "x" })).toThrow(/logging 须为对象/);
    // 缺省形状含空 logging 段
    expect(defaultSettings().logging).toEqual({});
  });

  it("projects/activeProject 段（U11/T-P3-110）：项目档往返 + 形状 fail-closed", () => {
    const s = parseSettingsShape({
      projects: [{ name: "aegent", workspace: "F:/aegent", instructions: "遵守 AGENTS.md" }],
      activeProject: "aegent",
    });
    expect(s.projects).toEqual([{ name: "aegent", workspace: "F:/aegent", instructions: "遵守 AGENTS.md" }]);
    expect(s.activeProject).toBe("aegent");
    // 缺 name / 缺 workspace fail-closed
    expect(() => parseSettingsShape({ projects: [{ workspace: "X" }] })).toThrow(/name 缺失/);
    expect(() => parseSettingsShape({ projects: [{ name: "x" }] })).toThrow(/workspace 缺失/);
    expect(() => parseSettingsShape({ projects: {} })).toThrow(/projects 须为数组/);
    expect(() => parseSettingsShape({ projects: [{ name: "x", workspace: 1 }] })).toThrow(/非空字符串/);
    // 缺省形状含空 projects 段、activeProject undefined
    expect(defaultSettings().projects).toEqual([]);
    expect(defaultSettings().activeProject).toBeUndefined();
  });

  it("skills 段（U22/T-P3-125）：disabled/roots 往返 + 形状 fail-closed", () => {
    const s = parseSettingsShape({
      skills: { disabled: ["beta"], roots: ["D:/skills-extra", "E:/shared-skills"] },
    });
    expect(s.skills).toEqual({ disabled: ["beta"], roots: ["D:/skills-extra", "E:/shared-skills"] });
    // 往返一致
    expect(parseSettingsShape(JSON.parse(JSON.stringify(s))).skills).toEqual(s.skills);
    // 空数组归一为缺省（不落空段）
    expect(parseSettingsShape({ skills: { disabled: [], roots: [] } }).skills).toBeUndefined();
    // 形状坏 fail-closed：非对象 / 非字符串数组 / 空串成员
    expect(() => parseSettingsShape({ skills: "x" })).toThrow(/skills 须为对象/);
    expect(() => parseSettingsShape({ skills: { disabled: [1] } })).toThrow(/skills\.disabled/);
    expect(() => parseSettingsShape({ skills: { disabled: [""] } })).toThrow(/skills\.disabled/);
    expect(() => parseSettingsShape({ skills: { roots: ["a", ""] } })).toThrow(/skills\.roots/);
    // 缺省形状无 skills 段
    expect(defaultSettings().skills).toBeUndefined();
  });

  it("pricing 段（U12/T-P3-111）：计价条目往返 + 负数/缺字段 fail-closed", () => {
    const s = parseSettingsShape({
      pricing: [
        { provider: "openai", modelId: "gpt-x", inputPerMTok: 1.25, cachedInputPerMTok: 0.125, outputPerMTok: 10, cacheWritePerMTok: 0 },
      ],
    });
    expect(s.pricing).toEqual([
      { provider: "openai", modelId: "gpt-x", inputPerMTok: 1.25, cachedInputPerMTok: 0.125, outputPerMTok: 10, cacheWritePerMTok: 0 },
    ]);
    expect(() => parseSettingsShape({ pricing: [{ modelId: "m" }] })).toThrow(/provider 缺失/);
    expect(() =>
      parseSettingsShape({ pricing: [{ provider: "p", modelId: "m", inputPerMTok: -1, cachedInputPerMTok: 0, outputPerMTok: 1 }] }),
    ).toThrow(/inputPerMTok 须为非负数/);
    expect(() =>
      parseSettingsShape({ pricing: [{ provider: "p", modelId: "m", cachedInputPerMTok: 0, outputPerMTok: 1 }] }),
    ).toThrow(/inputPerMTok 须为非负数/);
    // 缺省形状无 pricing（undefined——无价格不虚构）
    expect(defaultSettings().pricing).toBeUndefined();
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

  it("logging.rawLogDir 装配注入（T-P3-132）：file 档补位 / env 同值 / 显式占用不覆盖", () => {
    const withLog = parseSettingsShape({ logging: { rawLogDir: "C:/file-logs" } });
    // 文件档 → --raw-log-dir 注入（agent-child 既有 argv 面零改动）
    const { args } = resolveChildLaunchArgv([], {}, withLog);
    expect(args[args.indexOf("--raw-log-dir") + 1]).toBe("C:/file-logs");
    // env 有值 → 注入 env 同值（子进程内 argv 覆盖 env，结果不变）
    const { args: envWins } = resolveChildLaunchArgv([], { AEGENT_RAW_LOG_DIR: "E:/env-logs" }, withLog);
    expect(envWins[envWins.indexOf("--raw-log-dir") + 1]).toBe("E:/env-logs");
    // 显式参数最高（childArgs 已有槽位不重复注入）
    const { args: explicit } = resolveChildLaunchArgv(["--raw-log-dir", "C:/cli-logs"], {}, withLog);
    expect(explicit.filter((a) => a === "--raw-log-dir")).toHaveLength(1);
    expect(explicit[explicit.indexOf("--raw-log-dir") + 1]).toBe("C:/cli-logs");
    // 无 logging 档 → 不注入
    expect(resolveChildLaunchArgv([], {}, settings).args).not.toContain("--raw-log-dir");
  });

  it("sandbox.mode 装配注入（T-P3-140 批次 A）：file 档跟随 / 显式槽占用不覆盖", () => {
    const withMode = parseSettingsShape({
      providers: [{ name: "main", baseUrl: "https://f.example.com", model: "m" }],
      defaultProvider: "main",
      sandbox: { mode: "workspace-write" },
    });
    const { args } = resolveChildLaunchArgv([], {}, withMode);
    expect(args[args.indexOf("--sandbox-mode") + 1]).toBe("workspace-write");
    // 显式参数最高：childArgs 已有 --sandbox-mode 槽位不重复注入
    const explicit = resolveChildLaunchArgv(["--sandbox-mode", "read-only"], {}, withMode);
    expect(explicit.args.filter((a) => a === "--sandbox-mode")).toHaveLength(1);
    expect(explicit.args[explicit.args.indexOf("--sandbox-mode") + 1]).toBe("read-only");
    // 无 mode 档 → 不注入（缺省 = 全自动直通，装配面零变化）
    expect(resolveChildLaunchArgv([], {}, settings).args).not.toContain("--sandbox-mode");
  });

  it("writeWhitelist 逐条注入 --write-whitelist（顺序保持；空清单不注入）", () => {
    const withList = parseSettingsShape({
      providers: [{ name: "main", baseUrl: "https://f.example.com", model: "m" }],
      defaultProvider: "main",
      sandbox: { writeWhitelist: ["F:/libs", "F:/data"] },
    });
    const { args } = resolveChildLaunchArgv([], {}, withList);
    const first = args.indexOf("--write-whitelist");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(args[first + 1]).toBe("F:/libs");
    // 重复旗标交错排列：[flag, v1, flag, v2, ...]——第二处按序续找
    const second = args.indexOf("--write-whitelist", first + 1);
    expect(second).toBeGreaterThan(first);
    expect(args[second + 1]).toBe("F:/data");
    expect(resolveChildLaunchArgv([], {}, settings).args).not.toContain("--write-whitelist");
  });

  it("outputLanguage 装配注入（T-P3-141）：非 auto 跟随 / auto 与缺省不注入", () => {
    const withLang = parseSettingsShape({
      providers: [{ name: "main", baseUrl: "https://f.example.com", model: "m" }],
      defaultProvider: "main",
      appearance: { outputLanguage: "en" },
    });
    const { args } = resolveChildLaunchArgv([], {}, withLang);
    expect(args[args.indexOf("--output-language") + 1]).toBe("en");
    // auto 与缺省 → 不注入（装配零变化）
    const auto = parseSettingsShape({
      providers: [{ name: "main", baseUrl: "https://f.example.com", model: "m" }],
      defaultProvider: "main",
      appearance: { outputLanguage: "auto" },
    });
    expect(resolveChildLaunchArgv([], {}, auto).args).not.toContain("--output-language");
    expect(resolveChildLaunchArgv([], {}, settings).args).not.toContain("--output-language");
  });

  it("sandbox 段 parse：mode 闭集校验 + writeWhitelist 形状校验（fail-closed）", () => {
    expect(() =>
      parseSettingsShape({
        providers: [{ name: "m" }],
        defaultProvider: "m",
        sandbox: { mode: "everything-goes" },
      }),
    ).toThrow(/sandbox.mode/);
    expect(() =>
      parseSettingsShape({
        providers: [{ name: "m" }],
        defaultProvider: "m",
        sandbox: { writeWhitelist: [""] },
      }),
    ).toThrow(/writeWhitelist/);
    // 合法值通过且去重保序
    const ok = parseSettingsShape({
      providers: [{ name: "m" }],
      defaultProvider: "m",
      sandbox: { mode: "read-only", writeWhitelist: ["F:/a", "F:/a", "F:/b"] },
    });
    expect(ok.sandbox?.mode).toBe("read-only");
    expect(ok.sandbox?.writeWhitelist).toEqual(["F:/a", "F:/b"]);
  });

  it("profiles[].sandbox 带 mode（批次 F）：合法档透传 + 非法档 fail-closed", () => {
    const ok = parseSettingsShape({
      providers: [{ name: "m" }],
      defaultProvider: "m",
      profiles: [{ name: "p1", defaultProvider: "m", sandbox: { mode: "workspace-write" } }],
    });
    expect(ok.profiles?.[0]?.sandbox?.mode).toBe("workspace-write");
    expect(() =>
      parseSettingsShape({
        providers: [{ name: "m" }],
        defaultProvider: "m",
        profiles: [{ name: "p2", defaultProvider: "m", sandbox: { mode: "sudo" } }],
      }),
    ).toThrow(/profiles\[\].sandbox.mode/);
  });

  it("profiles v2（T-P3-142）：permission.mode 捆绑 + 资源三态快照 + 校验 fail-closed", () => {
    const ok = parseSettingsShape({
      providers: [{ name: "m" }],
      defaultProvider: "m",
      profiles: [
        {
          name: "coding",
          defaultProvider: "m",
          defaultModel: "big",
          permission: { mode: "auto", approvalTimeoutMs: 30_000 },
          sandbox: { mode: "workspace-write", network: "deny" },
          mcpEnabled: ["fetch", "git"],
          skillsDisabled: ["demo-skill"],
          pluginsEnabled: ["theme-nightfall"],
        },
      ],
    });
    const p = ok.profiles?.[0];
    expect(p?.permission).toEqual({ mode: "auto", approvalTimeoutMs: 30_000 });
    expect(p?.sandbox).toEqual({ mode: "workspace-write", network: "deny" });
    expect(p?.mcpEnabled).toEqual(["fetch", "git"]);
    expect(p?.skillsDisabled).toEqual(["demo-skill"]);
    expect(p?.pluginsEnabled).toEqual(["theme-nightfall"]);
    // permission.mode 五档闭集 fail-closed
    expect(() =>
      parseSettingsShape({
        providers: [{ name: "m" }],
        defaultProvider: "m",
        profiles: [{ name: "p3", defaultProvider: "m", permission: { mode: "yolo" } }],
      }),
    ).toThrow(/profiles\[\].permission.mode/);
    // 资源三态：数组形状 + 上限校验
    expect(() =>
      parseSettingsShape({
        providers: [{ name: "m" }],
        defaultProvider: "m",
        profiles: [{ name: "p4", defaultProvider: "m", mcpEnabled: [""] }],
      }),
    ).toThrow(/profiles\[\].mcpEnabled/);
    expect(() =>
      parseSettingsShape({
        providers: [{ name: "m" }],
        defaultProvider: "m",
        profiles: [{ name: "p5", defaultProvider: "m", skillsDisabled: Array(101).fill("x") }],
      }),
    ).toThrow(/profiles\[\].skillsDisabled/);
    // 空数组 = 拍到空集（合法——切换时清空该资源组）
    const empty = parseSettingsShape({
      providers: [{ name: "m" }],
      defaultProvider: "m",
      profiles: [{ name: "p6", defaultProvider: "m", pluginsEnabled: [] }],
    });
    expect(empty.profiles?.[0]?.pluginsEnabled).toEqual([]);
  });
});
