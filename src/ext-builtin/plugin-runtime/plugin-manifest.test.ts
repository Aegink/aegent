/**
 * 插件清单安装期校验测试（I9 / T-P1-09）——未实现能力拒绝且列明缺哪项、
 * 闭集外字段拒绝、合法清单安装后能力可用（trusted→内核链 / untrusted→观察轨）、
 * 声明未实现 handler 拒绝、uninstall 摘除。
 */

import { describe, expect, it } from "vitest";

import { composeChain } from "../../kernel/chain.js";
import { HookRegistry } from "../../kernel/hooks.js";
import {
  PluginManifestError,
  installPlugin,
  validateManifest,
} from "./plugin-manifest.js";

const AVAILABLE = ["observe_events", "read_workspace"] as const;

const goodManifest = {
  name: "acme",
  trust: "untrusted",
  capabilities: ["observe_events"],
  hooks: [{ point: "toolCall", name: "watch" }],
};

describe("validateManifest（I9 安装期全量校验）", () => {
  it("合法清单通过", () => {
    const result = validateManifest(goodManifest, AVAILABLE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.name).toBe("acme");
      expect(result.manifest.trust).toBe("untrusted");
      expect(result.manifest.hooks).toEqual([
        { point: "toolCall", name: "watch" },
      ]);
    }
  });

  it("声明未实现能力 → 拒绝且错误列明缺哪项（不是警告不是忽略）", () => {
    const result = validateManifest(
      { ...goodManifest, capabilities: ["observe_events", "execute_commands"] },
      AVAILABLE,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("execute_commands"); // 列明缺哪项
      expect(result.errors[0]).toContain("observe_events"); // 宿主已实现清单
    }
  });

  it("闭集外字段拒绝", () => {
    const result = validateManifest(
      { ...goodManifest, stealth: true },
      AVAILABLE,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("stealth");
    }
  });

  it("trust 闭集枚举 / 非 object 清单 / hooks 坏形状与重复声明都拒绝", () => {
    const badTrust = validateManifest({ ...goodManifest, trust: "maybe" }, AVAILABLE);
    expect(badTrust.ok).toBe(false);

    expect(validateManifest(null, AVAILABLE).ok).toBe(false);
    expect(validateManifest([goodManifest], AVAILABLE).ok).toBe(false);

    const badPoint = validateManifest(
      { ...goodManifest, hooks: [{ point: "onEveryTick", name: "x" }] },
      AVAILABLE,
    );
    if (!badPoint.ok) expect(badPoint.errors[0]).toContain("onEveryTick");
    else expect.unreachable("坏 point 应拒绝");

    const dupHooks = validateManifest(
      {
        ...goodManifest,
        hooks: [
          { point: "toolCall", name: "watch" },
          { point: "turnEnd", name: "watch" },
        ],
      },
      AVAILABLE,
    );
    if (!dupHooks.ok) expect(dupHooks.errors[0]).toContain("重复声明");
    else expect.unreachable("重复 hook 声明应拒绝");
  });
});

describe("theme 贡献（T-P3-141——pi-desktop 主题即插件同构）", () => {
  it("合法 theme 通过并回读（base 闭集 + 相对 css）", () => {
    const result = validateManifest(
      { ...goodManifest, theme: { name: "Acme Night", base: "dark", css: "theme.css" } },
      AVAILABLE,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.theme).toEqual({ name: "Acme Night", base: "dark", css: "theme.css" });
    }
  });

  it("theme 缺 name 可省略（回退插件名）", () => {
    const result = validateManifest({ ...goodManifest, theme: { base: "light", css: "theme.css" } }, AVAILABLE);
    expect(result.ok).toBe(true);
  });

  it("theme.base 非法 / css 绝对路径 / css 上跳 → 逐项拒绝", () => {
    const badBase = validateManifest({ ...goodManifest, theme: { base: "auto", css: "t.css" } }, AVAILABLE);
    expect(badBase.ok).toBe(false);
    if (!badBase.ok) expect(badBase.errors.join("；")).toContain("theme.base");
    // 绝对路径两形状：POSIX 根 + 盘符（String.raw 保反斜杠字面——heredoc 转义陷阱）
    const absPosix = validateManifest({ ...goodManifest, theme: { base: "dark", css: "/etc/t.css" } }, AVAILABLE);
    expect(absPosix.ok).toBe(false);
    const absWin = validateManifest(
      { ...goodManifest, theme: { base: "dark", css: String.raw`C:\evil\t.css` } },
      AVAILABLE,
    );
    expect(absWin.ok).toBe(false);
    const upJump = validateManifest({ ...goodManifest, theme: { base: "dark", css: "../t.css" } }, AVAILABLE);
    expect(upJump.ok).toBe(false);
    if (!upJump.ok) expect(upJump.errors.join("；")).toContain("..");
  });
});

describe("installPlugin（安装 = 校验通过后注册 hooks 贡献）", () => {
  it("合法清单安装后能力可用：trusted 进内核链（hook 名带插件前缀）", async () => {
    const registry = new HookRegistry();
    installPlugin<undefined, string, string>(
      registry,
      {
        name: "acme-core",
        trust: "trusted",
        capabilities: ["observe_events"],
        hooks: [{ point: "toolCall", name: "wrap" }],
      },
      { wrap: async (_$, e, next) => `core(${await next(e)})` },
      AVAILABLE,
    );
    const kernel = registry.layer<undefined, string, string>("toolCall")!;
    const executor = composeChain<undefined, string, string>({
      point: "toolCall",
      layers: [kernel],
      terminal: async (_$, e) => e,
    });
    const outcome = await executor.run(undefined, "x");
    expect(outcome.value).toBe("core(x)"); // 安装后能力可用（内核链直调）
  });

  it("untrusted 插件安装后走观察轨（不进内核链）", async () => {
    const registry = new HookRegistry();
    installPlugin<undefined, string, string>(
      registry,
      goodManifest,
      { watch: (_$, e) => `watched:${e}` },
      AVAILABLE,
    );
    expect(registry.layer("toolCall")).toBeUndefined(); // 内核链不挂
    const trail = registry.untrustedLayer<undefined, string, string>("toolCall")!;
    const observed = await trail(undefined, "evt", Object.assign(
      async () => undefined as never,
      { point: "toolCall" as const, trace: Object.freeze([]), budget: Object.freeze({}) },
    ));
    expect(observed).toBe("watched:evt"); // 安装后能力可用（观察面）
  });

  it("声明了未提供 handler 的 hook → 拒绝安装（声明了就要实现），已注册部分回滚", () => {
    const registry = new HookRegistry();
    expect(() =>
      installPlugin<undefined, string, string>(
        registry,
        {
          name: "acme",
          trust: "trusted",
          capabilities: ["observe_events"],
          hooks: [
            { point: "toolCall", name: "provided" },
            { point: "turnEnd", name: "missing" },
          ],
        },
        { provided: (_$, e, next) => next(e) },
        AVAILABLE,
      ),
    ).toThrow(PluginManifestError);
    // 提供的 hook 已回滚（注册表干净，无半态安装）
    expect(registry.layer("toolCall")).toBeUndefined();
  });

  it("uninstall 摘除插件全部 hooks", () => {
    const registry = new HookRegistry();
    const { uninstall } = installPlugin<undefined, string, string>(
      registry,
      { name: "acme", trust: "trusted", capabilities: [], hooks: [{ point: "toolCall", name: "w" }] },
      { w: (_$, e, next) => next(e) },
      AVAILABLE,
    );
    expect(registry.layer("toolCall")).toBeDefined();
    uninstall();
    expect(registry.layer("toolCall")).toBeUndefined();
  });
});
