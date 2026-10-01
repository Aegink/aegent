/**
 * 插件市场测试（T-P3-148 K/L/M）——输入判定表/git URL 归一化/清单 fail-soft
 * 解析 + local 源安装全链（add→plugins→install→缓存+记录+settings 落盘→
 * 更新检查→卸载）；git 函数的参数校验面（净化/超时语义走实现审读，网络面
 * 不做在线测试）。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  marketAdd,
  marketList,
  marketPlugins,
  marketRemove,
  marketplaceStorageRoot,
  type MarketOpContext,
} from "./plugins-marketplace.js";
import { normalizeGitUrl, parseMarketSourceInput, parseMarketplaceManifest } from "./plugins-marketplace-parse.js";
import {
  marketCheckUpdates,
  marketInstallPlugin,
  marketUninstallPlugin,
  isNewerVersion,
} from "./plugins-marketplace-install.js";
import { gitArgError } from "./plugins-marketplace-git.js";
import { loadSettings } from "../session/settings.js";

const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpDir(prefix = "aegent-market-"): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

const PLUGIN_MANIFEST = {
  name: "demo",
  version: "0.1.0",
  description: "演示插件",
  trust: "untrusted",
  capabilities: [],
};

function makeMarketFixture(): { home: string; settingsPath: string; marketDir: string; ctx: MarketOpContext } {
  const home = tmpDir("aegent-home-");
  const settingsPath = path.join(tmpDir("aegent-settings-"), "settings.json");
  writeFileSync(settingsPath, "{}", "utf8");
  const marketDir = path.join(tmpDir("aegent-marketrepo-"));
  mkdirSync(path.join(marketDir, "plugins", "demo"), { recursive: true });
  writeFileSync(
    path.join(marketDir, "marketplace.json"),
    JSON.stringify({
      name: "test-market",
      description: "测试市场",
      plugins: [{ name: "demo", source: "./plugins/demo", version: "0.1.0", description: "演示插件" }],
    }),
    "utf8",
  );
  writeFileSync(path.join(marketDir, "plugins", "demo", "plugin.json"), JSON.stringify(PLUGIN_MANIFEST), "utf8");
  writeFileSync(path.join(marketDir, "plugins", "demo", "index.js"), "export default { manifest: {}, onActivate() {} };\n", "utf8");
  return { home, settingsPath, marketDir, ctx: { homeDir: home, settingsPath } };
}

describe("输入判定表与归一化", () => {
  it("normalizeGitUrl：github https 补 .git、shorthand 展开、ssh/file 原样", () => {
    expect(normalizeGitUrl("https://github.com/a/b")).toBe("https://github.com/a/b.git");
    expect(normalizeGitUrl("https://github.com/a/b.git")).toBe("https://github.com/a/b.git");
    expect(normalizeGitUrl("a/b")).toBe("https://github.com/a/b.git");
    expect(normalizeGitUrl("git@github.com:a/b.git")).toBe("git@github.com:a/b.git");
    expect(normalizeGitUrl("/srv/repo.git")).toBe("/srv/repo.git");
    expect(() => normalizeGitUrl("not a url")).toThrow();
  });

  it("parseMarketSourceInput：git/.git/ssh/shorthand/本地目录/.json 文件", () => {
    const dir = tmpDir();
    expect(parseMarketSourceInput("https://x.example/repo.git#v2")).toEqual({
      source: { type: "git", url: "https://x.example/repo.git", ref: "v2" },
    });
    const shorthand = parseMarketSourceInput("a/b#main");
    expect("source" in shorthand && shorthand.source).toMatchObject({ type: "git", url: "https://github.com/a/b.git" });
    expect(parseMarketSourceInput(dir)).toEqual({ source: { type: "directory", path: dir } });
    const file = path.join(dir, "m.json");
    writeFileSync(file, "{}", "utf8");
    expect(parseMarketSourceInput(file)).toEqual({ source: { type: "file", path: file } });
    expect("error" in parseMarketSourceInput("./no/such/path/here")).toBe(true);
  });

  it("gitArgError：sha 全 hex + 选项注入防护", () => {
    expect(gitArgError("sha", "abcd")).toBeDefined();
    expect(gitArgError("sha", "a".repeat(40))).toBeUndefined();
    expect(gitArgError("ref", "--upload-pack")).toBeDefined();
    expect(gitArgError("url", "")).toBeDefined();
  });

  it("parseMarketplaceManifest：坏条目跳过不炸市场（fail-soft）+ 重名去重", () => {
    const r = parseMarketplaceManifest(
      {
        name: "m1",
        plugins: [
          { name: "good", source: "./a" },
          { name: "bad path", source: "../escape" },
          { name: "good", source: "./b" },
          "junk",
        ],
      },
      "/tmp/market",
    );
    expect("manifest" in r && r.manifest.plugins).toHaveLength(1);
    const firstPlugin = "manifest" in r ? r.manifest.plugins[0] : undefined;
    expect(firstPlugin?.name).toBe("good");
  });
});

describe("local 源安装全链（K+L）", () => {
  it("add → plugins → install → 缓存/记录/settings 落盘 → updates → uninstall", async () => {
    const fx = makeMarketFixture();
    const added = await marketAdd(fx.ctx, fx.marketDir);
    expect(added).toMatchObject({ id: "test-market", pluginCount: 1 });
    expect(marketList(fx.ctx).marketplaces).toHaveLength(1);

    const listed = marketPlugins(fx.ctx, "test-market");
    expect(listed.plugins[0]?.manifestVersion).toBe("0.1.0");

    const installed = await marketInstallPlugin(fx.ctx, "test-market", "demo");
    expect(installed.updated).toBe(false); // 首装
    // 缓存目录
    const cache = path.join(marketplaceStorageRoot(fx.home), "cache", "test-market", "demo", "0.1.0");
    expect(JSON.parse(readFileSync(path.join(cache, "plugin.json"), "utf8")).name).toBe("demo");
    // settings.plugins 条目（host 落盘 + marketplace 来源标记）
    const { settings } = await loadSettings(fx.settingsPath);
    const entry = (settings.plugins ?? []).find((p) => p.name === "demo");
    expect(entry !== undefined).toBe(true);
    expect(entry?.marketplace).toBe("test-market");
    expect(entry?.source).toBe(cache);

    // 同版本重装 = 更新（updated:true）
    const again = await marketInstallPlugin(fx.ctx, "test-market", "demo");
    expect(again.updated).toBe(true);

    // 版本轴更新检查（市场条目 0.2.0 > 已装 0.1.0）
    writeFileSync(
      path.join(fx.marketDir, "marketplace.json"),
      JSON.stringify({
        name: "test-market",
        plugins: [{ name: "demo", source: "./plugins/demo", version: "0.2.0" }],
      }),
      "utf8",
    );
    await marketAdd(fx.ctx, fx.marketDir); // 重新 add 刷新快照（local 源重读）
    const updates = marketCheckUpdates(fx.ctx);
    expect(updates.updates).toHaveLength(1);
    expect(updates.updates[0]?.availableVersion).toBe("0.2.0");

    // 卸载：settings 条目 + 记录 + 缓存齐清
    await marketUninstallPlugin(fx.ctx, "test-market", "demo");
    const after = await loadSettings(fx.settingsPath);
    expect((after.settings.plugins ?? []).find((p) => p.name === "demo")).toBeUndefined();
    expect(existsSync(cache)).toBe(false);
  });

  it("清单名不一致拒装（codex store.rs 同规则）", async () => {
    const fx = makeMarketFixture();
    await marketAdd(fx.ctx, fx.marketDir);
    writeFileSync(
      path.join(fx.marketDir, "plugins", "demo", "plugin.json"),
      JSON.stringify({ ...PLUGIN_MANIFEST, name: "other" }),
      "utf8",
    );
    await expect(marketInstallPlugin(fx.ctx, "test-market", "demo")).rejects.toThrow(/不一致/);
  });

  it("清单校验失败拒装（fail-closed）", async () => {
    const fx = makeMarketFixture();
    writeFileSync(
      path.join(fx.marketDir, "plugins", "demo", "plugin.json"),
      JSON.stringify({ ...PLUGIN_MANIFEST, trust: "bogus" }),
      "utf8",
    );
    await marketAdd(fx.ctx, fx.marketDir);
    await expect(marketInstallPlugin(fx.ctx, "test-market", "demo")).rejects.toThrow(/fail-closed/);
  });

  it("remove 删注册表与快照", async () => {
    const fx = makeMarketFixture();
    await marketAdd(fx.ctx, fx.marketDir);
    marketRemove(fx.ctx, "test-market");
    expect(marketList(fx.ctx).marketplaces).toHaveLength(0);
  });
});

describe("isNewerVersion（版本轴）", () => {
  it("semver 比较与非 semver 不等判定", () => {
    expect(isNewerVersion("0.2.0", "0.1.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("abc", "abd")).toBe(true);
    expect(isNewerVersion("abc", "abc")).toBe(false);
  });
});
