/**
 * 插件市场安装链（T-P3-148 L/R——codex store.rs + zcode atomic-directory 的
 * Node 对齐裁剪）：
 *
 *   物化来源（local 拷贝 / git clone + pin 校验）→ 定位插件根（plugin.json）
 *   → 安装期 fail-closed 清单校验（I9 validateManifest——host 进程零代码执行）
 *   → staging 拷贝 + manifest 字节复核（防 TOCTOU——codex store.rs:672-689）
 *   → 原子激活（旧版本 backup → rename → 失败回滚）→ 版本化缓存
 *   `cache/<marketplace>/<plugin>/<version>`（活动版本："local" 优先，否则
 *   semver-lite 最大——codex store.rs:169-190 同语义）→ 权威记录
 *   installed_plugins.json + settings.plugins 条目（安装是 host 操作，UI 随后
 *   重拉 settings——marketplace 字段标记来源，uninstall/update 找得到）。
 *
 * 卸载 = 先移 settings 条目与记录再删缓存；更新 = 重物化 + 覆盖安装（保留
 * 启停与 options——zcode updateMarketplacePlugin 同语义）；清单变宽会被
 * fail-closed 拒装（pi auto-update 拒绝静默扩权同语义）。
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { loadSettings, saveSettings } from "../session/settings.js";
import { validateManifest } from "../kernel/plugin-manifest.js";
import { gitCloneSource, makeStagingDir, pluginRootFromClone } from "./plugins-marketplace-git.js";
import {
  marketplaceStorageRoot,
  readInstalled,
  readKnown,
  readMarketSnapshot,
  sanitizeSegment,
  writeInstalled,
  type MarketOpContext,
} from "./plugins-marketplace.js";
import type { MarketEntry } from "./plugins-marketplace-parse.js";
import { PLUGIN_AVAILABLE_CAPABILITIES } from "./plugins-gateway.js";

const VERSION_SEGMENT_RE = /^[A-Za-z0-9._+-]{1,64}$/;

/** 版本段（codex store.rs:461-514：非法字符 sha256 前 12 兜底）。 */
function versionSegment(version: string | undefined): string {
  const value = version?.trim() ?? "";
  if (value === "") return "local";
  if (VERSION_SEGMENT_RE.test(value) && !value.startsWith(".")) return value;
  return `v-${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
}

/** semver-lite 比较（非 semver 走字符串不等判定——zcode version-compare 裁剪）。 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string): number[] | undefined => {
    const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
    return m === null ? undefined : [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const a = parse(candidate);
  const b = parse(current);
  if (a === undefined || b === undefined) return candidate !== current;
  for (let i = 0; i < 3; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai !== bi) return ai > bi;
  }
  return false;
}

function nowIso(): string {
  return new Date().toISOString();
}

function listDirNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** 清旧版本（保留当前/local/更高 semver——codex remove_old_plugin_versions 同语义）。 */
function removeOldVersions(targetRoot: string, currentVersion: string): void {
  for (const name of listDirNames(targetRoot)) {
    if (name === currentVersion || name.startsWith(".") || name === "local") continue;
    if (currentVersion !== "local" && isNewerVersion(name, currentVersion)) continue;
    rmSync(path.join(targetRoot, name), { recursive: true, force: true });
  }
}

/** git 条目物化（clone + pin 校验 + 子目录定位 → staging 插件根）。 */
async function materializeGitEntry(entry: MarketEntry, stagingRoot: string): Promise<{ dir: string; cleanup: () => void }> {
  if (entry.source.type !== "git") throw new Error("materializeGitEntry 只接受 git source");
  const staging = makeStagingDir(stagingRoot, "plugin-src-");
  try {
    await gitCloneSource({
      url: entry.source.url,
      dest: staging,
      ...(entry.source.ref !== undefined ? { ref: entry.source.ref } : {}),
      ...(entry.source.sha !== undefined ? { sha: entry.source.sha } : {}),
    });
    const dir = pluginRootFromClone(staging, entry.source.subdir);
    return { dir, cleanup: () => rmSync(staging, { recursive: true, force: true }) };
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}

/** local 条目源路径解析（相对市场根——local 目录源优先，快照目录兜底）。 */
function localEntryPath(ctx: MarketOpContext, marketId: string, relativePath: string): string {
  const root = marketplaceStorageRoot(ctx.homeDir);
  const known = readKnown(root).find((r) => r.id === marketId);
  const base =
    known !== undefined && known.source.type === "local" && existsSync(known.source.path) && statSync(known.source.path).isDirectory()
      ? known.source.path
      : path.join(root, "marketplaces", sanitizeSegment(marketId));
  const abs = path.resolve(base, relativePath);
  if (!abs.startsWith(path.resolve(base) + path.sep)) {
    throw new Error(`local source 越出市场根：${relativePath}`);
  }
  return abs;
}

export interface MarketInstallResult {
  readonly name: string;
  readonly marketplace: string;
  readonly version: string;
  readonly installPath: string;
  /** false = 新装；true = 覆盖既有安装（更新/重装）。 */
  readonly updated: boolean;
}

/**
 * 市场装插件（解析条目 → 物化 → 校验 → 原子激活 → 记录 + settings 落盘）。
 * 幂等：同版本重装走覆盖（backup→rename）；新版本落新版本目录并清旧。
 */
export async function marketInstallPlugin(ctx: MarketOpContext, marketId: string, pluginName: string): Promise<MarketInstallResult> {
  const root = marketplaceStorageRoot(ctx.homeDir);
  const snapshot = readMarketSnapshot(root, marketId);
  const entry = snapshot.plugins.find((p) => p.name === pluginName);
  if (entry === undefined) throw new Error(`市场「${marketId}」没有插件「${pluginName}」`);
  const stagingRoot = path.join(root, ".staging");
  mkdirSync(stagingRoot, { recursive: true });
  const materialized =
    entry.source.type === "local"
      ? await (async () => {
          const src = localEntryPath(
            ctx,
            marketId,
            entry.source.type === "local" ? entry.source.path : "",
          );
          if (!existsSync(src)) throw new Error(`local source 不存在：${src}`);
          const staging = makeStagingDir(stagingRoot, "plugin-src-");
          cpSync(src, staging, { recursive: true });
          return { dir: staging, cleanup: () => rmSync(staging, { recursive: true, force: true }) };
        })()
      : await materializeGitEntry(entry, stagingRoot);
  try {
    const manifestPath = path.join(materialized.dir, "plugin.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`插件根缺少 plugin.json（市场插件须为 aegent 清单形态）：${materialized.dir}`);
    }
    const manifestBytes = readFileSync(manifestPath);
    const parsed = validateManifest(JSON.parse(manifestBytes.toString("utf8")), PLUGIN_AVAILABLE_CAPABILITIES);
    if (!parsed.ok) throw new Error(`清单校验失败（fail-closed）：${parsed.errors.join("；")}`);
    if (parsed.manifest.name !== entry.name) {
      throw new Error(`清单名不一致：plugin.json 是「${parsed.manifest.name}」，市场条目是「${entry.name}」`);
    }
    const version = versionSegment(parsed.manifest.version ?? entry.version);
    const targetRoot = path.join(root, "cache", sanitizeSegment(marketId), sanitizeSegment(entry.name));
    const targetVersion = path.join(targetRoot, version);
    // Windows 纪律：staging 必须与目标同卷（rename 原子性）——staging 根取
    // targetRoot 本体（先建好），跨卷 tmpdir 回退路径在本链不可用
    mkdirSync(targetRoot, { recursive: true });

    // staging 布局复刻最终布局 → manifest 字节复核（codex store.rs 同序）
    const stagedRoot = makeStagingDir(targetRoot, "install-");
    const stagedVersion = path.join(stagedRoot, entry.name, version);
    mkdirSync(path.dirname(stagedVersion), { recursive: true });
    cpSync(materialized.dir, stagedVersion, { recursive: true });
    try {
      const actual = readFileSync(path.join(stagedVersion, "plugin.json"));
      if (Buffer.compare(actual, manifestBytes) !== 0) {
        throw new Error("manifest 在安装 staging 期间发生变化（防篡改复核失败）");
      }
    } catch (e) {
      rmSync(stagedRoot, { recursive: true, force: true });
      throw e;
    }

    // 原子激活（backup → rename → 失败回滚）
    const hadVersion = existsSync(targetVersion);
    if (hadVersion) {
      const backup = `${targetVersion}.backup-${Date.now()}`;
      renameSync(targetVersion, backup);
      try {
        renameSync(stagedVersion, targetVersion);
      } catch (e) {
        renameSync(backup, targetVersion);
        rmSync(stagedRoot, { recursive: true, force: true });
        throw e;
      }
      rmSync(backup, { recursive: true, force: true });
    } else {
      try {
        renameSync(stagedVersion, targetVersion);
      } catch (e) {
        rmSync(stagedRoot, { recursive: true, force: true });
        throw e;
      }
    }
    rmSync(stagedRoot, { recursive: true, force: true });
    removeOldVersions(targetRoot, version);

    // 权威记录 + settings.plugins 条目（保留启停/options——更新语义）
    const installPath = targetVersion;
    const previous = readInstalled(root);
    const existing = previous.find((r) => r.name === entry.name && r.marketplace === marketId);
    const installed = previous.filter((r) => !(r.name === entry.name && r.marketplace === marketId));
    installed.push({
      id: `${entry.name}@${marketId}`,
      name: entry.name,
      marketplace: marketId,
      version,
      installPath,
      installedAt: existing?.installedAt ?? nowIso(),
      updatedAt: nowIso(),
    });
    writeInstalled(root, installed);
    if (ctx.settingsPath === undefined) throw new Error("market install 需要 settingsPath（gateway 装配缺失）");
    const { settings } = await loadSettings(ctx.settingsPath);
    const settingsEntry = (settings.plugins ?? []).find((p) => p.name === entry.name);
    const next = (settings.plugins ?? []).filter((p) => p.name !== entry.name);
    next.push({
      ...(settingsEntry ?? {}),
      name: entry.name,
      source: installPath,
      marketplace: marketId,
    });
    settings.plugins = next;
    await saveSettings(ctx.settingsPath, settings);
    return { name: entry.name, marketplace: marketId, version, installPath, updated: existing !== undefined };
  } finally {
    materialized.cleanup();
  }
}

/** 卸载市场插件（settings 条目 + 权威记录 + 缓存目录；先记录后删盘）。 */
export async function marketUninstallPlugin(ctx: MarketOpContext, marketId: string, pluginName: string): Promise<{ removed: true }> {
  const root = marketplaceStorageRoot(ctx.homeDir);
  if (ctx.settingsPath !== undefined) {
    const { settings } = await loadSettings(ctx.settingsPath);
    settings.plugins = (settings.plugins ?? []).filter((p) => !(p.name === pluginName && p.marketplace === marketId));
    await saveSettings(ctx.settingsPath, settings);
  }
  writeInstalled(root, readInstalled(root).filter((r) => !(r.name === pluginName && r.marketplace === marketId)));
  rmSync(path.join(root, "cache", sanitizeSegment(marketId), sanitizeSegment(pluginName)), { recursive: true, force: true });
  return { removed: true };
}

/** 更新检查（已装插件 vs 市场快照条目 version 轴——isNewerVersion 判定）。 */
export function marketCheckUpdates(ctx: MarketOpContext): {
  updates: { name: string; marketplace: string; installedVersion: string; availableVersion: string }[];
} {
  const root = marketplaceStorageRoot(ctx.homeDir);
  const updates: { name: string; marketplace: string; installedVersion: string; availableVersion: string }[] = [];
  for (const record of readInstalled(root)) {
    try {
      const entry = readMarketSnapshot(root, record.marketplace).plugins.find((p) => p.name === record.name);
      // U：版本轴优先（首个未 yanked 的 versions 条目）；缺省回退 entry.version
      const available = entry?.versions?.find((v) => v.yanked !== true)?.version ?? entry?.version;
      if (available !== undefined && isNewerVersion(available, record.version)) {
        updates.push({ name: record.name, marketplace: record.marketplace, installedVersion: record.version, availableVersion: available });
      }
    } catch {
      // 市场快照缺失/坏——该市场的更新检查跳过（refresh 修复面）
    }
  }
  return { updates };
}
