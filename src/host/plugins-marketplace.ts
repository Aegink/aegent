/**
 * 插件市场核心（T-P3-148 K——"git 仓库 + JSON 索引 = 市场"的宿主面）：
 *
 * 数据模型（zcode/codex 权威记录同构）：
 *   - `~/.aegent/plugins/known_marketplaces.json`：市场注册表（id/source/
 *     addedAt/lastUpdated/pluginCount/revision?/lastRefreshFailure?）；
 *   - `~/.aegent/plugins/marketplaces/<id>/marketplace.json`：市场清单快照
 *     （git 源 = clone 内的清单；local 源 = 原样拷贝）；
 *   - `~/.aegent/plugins/cache/<marketplace>/<plugin>/<version>/`：安装缓存
 *     （codex store.rs 同布局；安装链在 plugins-marketplace-install.ts）。
 *
 * 来源（v1 两态——npm/remote 随市场域扩展记档）：
 *   - local（目录）：清单原位读取；条目 source 相对市场根（codex 语义）；
 *   - git：add/refresh 时 clone 到快照目录（--depth 1 + 可选 ref/sha pin +
 *     rev-parse 复核）；更新 = ls-remote revision 比对（一致跳过——codex
 *     marketplace_upgrade 同语义）。
 *
 * 输入解析（zcode parseMarketplaceSourceInput 判定表裁剪）：.git|/_git/ →
 * git；github.com URL → git；ssh 形态 → git；`owner/repo` shorthand → git；
 * 本地路径（目录/.json 文件）。清单解析 fail-soft：坏条目跳过并告警，不炸
 * 整个市场（codex marketplace.rs:571-591 同语义）。
 */

import { existsSync, mkdirSync, cpSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { loadSettings, saveSettings } from "../session/settings.js";
import { validateManifest, type PluginManifest } from "../kernel/plugin-manifest.js";
import { PLUGIN_AVAILABLE_CAPABILITIES } from "./plugins-gateway.js";
import {
  normalizeGitUrl,
  parseMarketSourceInput,
  parseMarketplaceManifest,
  type MarketEntry,
  type MarketplaceManifest,
  type MarketSourceInput,
} from "./plugins-marketplace-parse.js";
export {
  normalizeGitUrl,
  parseMarketSourceInput,
  parseMarketplaceManifest,
  type MarketEntry,
  type MarketplaceManifest,
  type MarketSourceInput,
};
import {
  gitCloneSource,
  gitRemoteRevision,
  makeStagingDir,
  pluginRootFromClone,
} from "./plugins-marketplace-git.js";

export const MARKET_STORAGE_DIRNAME = "plugins";

export function marketplaceStorageRoot(homeDir: string): string {
  return path.join(homeDir, ".aegent", MARKET_STORAGE_DIRNAME);
}

// ---------------------------------------------------------------------------
// 记录 IO（原子写——tmp + rename）
// ---------------------------------------------------------------------------

export interface KnownMarketplaceRecord {
  id: string;
  name: string;
  description?: string;
  source: { type: "local"; path: string } | { type: "git"; url: string; ref?: string; sha?: string };
  addedAt: string;
  lastUpdated?: string;
  pluginCount?: number;
  revision?: string;
  lastRefreshFailure?: { code: string; failedAt: string; message: string };
}

export interface InstalledPluginRecord {
  id: string;
  name: string;
  marketplace: string;
  version: string;
  installPath: string;
  installedAt: string;
  updatedAt: string;
}

function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function atomicWrite(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

import { writeFileSync } from "node:fs";

function nowIso(): string {
  return new Date().toISOString();
}

export function sanitizeSegment(value: string): string {
  return value.replace(/[^\w.@-]/g, "-").slice(0, 64);
}

function knownFile(root: string): string {
  return path.join(root, "known_marketplaces.json");
}

function installedFile(root: string): string {
  return path.join(root, "installed_plugins.json");
}

export function readKnown(root: string): KnownMarketplaceRecord[] {
  const data = readJson<{ version: number; marketplaces: KnownMarketplaceRecord[] }>(knownFile(root));
  return Array.isArray(data?.marketplaces) ? data.marketplaces : [];
}

function writeKnown(root: string, records: KnownMarketplaceRecord[]): void {
  atomicWrite(knownFile(root), { version: 1, marketplaces: records });
}

export function readInstalled(root: string): InstalledPluginRecord[] {
  const data = readJson<{ version: number; plugins: InstalledPluginRecord[] }>(installedFile(root));
  return Array.isArray(data?.plugins) ? data.plugins : [];
}

export function writeInstalled(root: string, records: InstalledPluginRecord[]): void {
  atomicWrite(installedFile(root), { version: 1, plugins: records });
}

// ---------------------------------------------------------------------------
// 清单形状与 source 解析
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 市场操作（add / remove / refresh / list / plugins）
// ---------------------------------------------------------------------------

export interface MarketOpContext {
  readonly homeDir: string;
  /** settings.json 路径（安装/卸载直接落 settings.plugins 条目——缺省时
   * install 类型化拒绝，卸载仍可清记录与缓存）。 */
  readonly settingsPath?: string;
}

function snapshotDir(root: string, id: string): string {
  return path.join(root, "marketplaces", sanitizeSegment(id));
}

function snapshotManifestPath(root: string, id: string): string {
  return path.join(snapshotDir(root, id), "marketplace.json");
}

/** 读快照清单（缺失/坏 JSON = 类型化错误——refresh 修复面）。 */
export function readMarketSnapshot(root: string, id: string): MarketplaceManifest {
  const file = snapshotManifestPath(root, id);
  const raw = readJson<unknown>(file);
  if (raw === undefined) throw new Error(`市场快照缺失：${file}（先刷新）`);
  const parsed = parseMarketplaceManifest(raw, snapshotDir(root, id));
  if ("error" in parsed) throw new Error(`市场快照损坏：${parsed.error}`);
  return parsed.manifest;
}

function readManifestFromDir(dir: string): { manifest: MarketplaceManifest; root: string } {
  const file = path.join(dir, "marketplace.json");
  if (!existsSync(file)) throw new Error(`目录缺少 marketplace.json：${dir}`);
  const parsed = parseMarketplaceManifest(JSON.parse(readFileSync(file, "utf8")), dir);
  if ("error" in parsed) throw new Error(`市场清单损坏：${parsed.error}`);
  return { manifest: parsed.manifest, root: dir };
}

/** git 源拉取到 staging（clone + 可选 pin 校验）→ 返回 {dir, revision}。 */
async function fetchGitMarket(source: { type: "git"; url: string; ref?: string; sha?: string }, staging: string): Promise<string> {
  await gitCloneSource({
    url: source.url,
    dest: staging,
    ...(source.ref !== undefined ? { ref: source.ref } : {}),
    ...(source.sha !== undefined ? { sha: source.sha } : {}),
  });
  return gitRemoteRevision(source.url, source.ref);
}

/** 添加市场（解析 → 快照落位 → 注册表 upsert——保留 addedAt）。 */
export async function marketAdd(ctx: MarketOpContext, input: string): Promise<{ id: string; name: string; pluginCount: number; revision?: string }> {
  const root = marketplaceStorageRoot(ctx.homeDir);
  const parsed = parseMarketSourceInput(input);
  if ("error" in parsed) throw new Error(parsed.error);
  const sourceInput = parsed.source;
  let manifest: MarketplaceManifest;
  let revision: string | undefined;
  const staging = makeStagingDir(root, "market-add-");
  try {
    if (sourceInput.type === "directory") {
      const r = readManifestFromDir(sourceInput.path);
      manifest = r.manifest;
    } else if (sourceInput.type === "file") {
      const parsedRaw = JSON.parse(readFileSync(sourceInput.path, "utf8")) as unknown;
      const r = parseMarketplaceManifest(parsedRaw, path.dirname(sourceInput.path));
      if ("error" in r) throw new Error(`市场清单损坏：${r.error}`);
      manifest = r.manifest;
    } else {
      revision = await fetchGitMarket(sourceInput, staging);
      const r = readManifestFromDir(staging);
      manifest = r.manifest;
    }
    const id = sanitizeSegment(manifest.name);
    const previous = readKnown(root).find((r) => r.id === id);
    const known = readKnown(root).filter((r) => r.id !== id);
    // 快照落位（local 源拷清单文件；git 源整 clone 换名——backup+rename）
    const snapDir = snapshotDir(root, id);
    const snapFile = snapshotManifestPath(root, id);
    if (sourceInput.type === "git") {
      const backup = `${snapDir}.backup-${Date.now()}`;
      if (existsSync(snapDir)) renameSync(snapDir, backup);
      try {
        mkdirSync(path.dirname(snapDir), { recursive: true });
        renameSync(staging, snapDir);
      } catch (e) {
        if (existsSync(backup)) renameSync(backup, snapDir);
        throw e;
      }
      if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
    } else {
      mkdirSync(snapDir, { recursive: true });
      const srcFile = sourceInput.type === "directory"
        ? path.join(sourceInput.path, "marketplace.json")
        : sourceInput.path;
      writeFileSync(snapFile, readFileSync(srcFile, "utf8"), "utf8");
    }
    known.push({
      id,
      name: manifest.name,
      ...(manifest.description !== undefined ? { description: manifest.description } : {}),
      source:
        sourceInput.type === "directory"
          ? { type: "local", path: sourceInput.path }
          : sourceInput.type === "file"
            ? { type: "local", path: sourceInput.path }
            : { type: "git", url: sourceInput.url, ...(sourceInput.ref !== undefined ? { ref: sourceInput.ref } : {}) },
      addedAt: previous?.addedAt ?? nowIso(),
      lastUpdated: nowIso(),
      pluginCount: manifest.plugins.length,
      ...(revision !== undefined ? { revision } : {}),
    });
    writeKnown(root, known);
    return { id, name: manifest.name, pluginCount: manifest.plugins.length, ...(revision !== undefined ? { revision } : {}) };
  } finally {
    // staging 若未 rename 走 best-effort 清理（git 分支成功即已搬走）
    rmSync(staging, { recursive: true, force: true });
  }
}

/** 移除市场（注册表删除 + 快照删除；已装插件不删——各自 uninstall）。 */
export function marketRemove(ctx: MarketOpContext, id: string): { removed: true } {
  const root = marketplaceStorageRoot(ctx.homeDir);
  const known = readKnown(root);
  const hit = known.find((r) => r.id === id);
  if (hit === undefined) throw new Error(`市场不存在：${id}`);
  writeKnown(root, known.filter((r) => r.id !== id));
  rmSync(snapshotDir(root, id), { recursive: true, force: true });
  return { removed: true };
}

/** 刷新市场（git = ls-remote 比对，一致跳过；local = 重读清单）。 */
export async function marketRefresh(ctx: MarketOpContext, id: string): Promise<{ id: string; changed: boolean; revision?: string; pluginCount: number }> {
  const root = marketplaceStorageRoot(ctx.homeDir);
  const known = readKnown(root);
  const record = known.find((r) => r.id === id);
  if (record === undefined) throw new Error(`市场不存在：${id}`);
  try {
    let changed = false;
    let revision: string | undefined;
    let pluginCount: number;
    if (record.source.type === "git") {
      const remote = await gitRemoteRevision(record.source.url, record.source.ref);
      revision = remote;
      if (record.revision === remote) {
        const manifest = readMarketSnapshot(root, id);
        pluginCount = manifest.plugins.length;
        writeKnown(root, known.map((r) => (r.id === id ? { ...r, lastUpdated: nowIso(), pluginCount } : r)));
        return { id, changed: false, revision, pluginCount };
      }
      const staging = makeStagingDir(root, "market-refresh-");
      try {
        await gitCloneSource({
          url: record.source.url,
          dest: staging,
          ...(record.source.ref !== undefined ? { ref: record.source.ref } : {}),
          ...(record.source.sha !== undefined ? { sha: record.source.sha } : {}),
        });
        const snapDir = snapshotDir(root, id);
        const backup = `${snapDir}.backup-${Date.now()}`;
        if (existsSync(snapDir)) renameSync(snapDir, backup);
        try {
          renameSync(staging, snapDir);
        } catch (e) {
          if (existsSync(backup)) renameSync(backup, snapDir);
          throw e;
        }
        if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
      changed = true;
    } else {
      // local：目录源重读；file 源重拷
      const snapFile = snapshotManifestPath(root, id);
      const srcFile = path.join(record.source.path, "marketplace.json");
      const raw = existsSync(srcFile) ? readFileSync(srcFile, "utf8") : readFileSync(record.source.path, "utf8");
      writeFileSync(snapFile, raw, "utf8");
      changed = true;
    }
    const manifest = readMarketSnapshot(root, id);
    pluginCount = manifest.plugins.length;
    writeKnown(root, known.map((r) =>
      r.id === id
        ? { ...r, lastUpdated: nowIso(), pluginCount, ...(revision !== undefined ? { revision } : {}), lastRefreshFailure: undefined }
        : r,
    ));
    return { id, changed, ...(revision !== undefined ? { revision } : {}), pluginCount };
  } catch (e) {
    // 刷新失败写 lastRefreshFailure 而非删记录（zcode 同语义）
    const message = e instanceof Error ? e.message : String(e);
    writeKnown(root, readKnown(root).map((r) =>
      r.id === id ? { ...r, lastRefreshFailure: { code: "REFRESH_FAILED", failedAt: nowIso(), message } } : r,
    ));
    throw e;
  }
}

/** 市场清单视图（注册表 + 每市场条目数）。 */
export function marketList(ctx: MarketOpContext): { marketplaces: KnownMarketplaceRecord[] } {
  const root = marketplaceStorageRoot(ctx.homeDir);
  return { marketplaces: readKnown(root) };
}

/** 市场插件列表（快照条目 + 本地条目的盘上描述回填）。 */
export function marketPlugins(ctx: MarketOpContext, id: string): { marketplace: string; plugins: (MarketEntry & { manifestVersion?: string })[] } {
  const root = marketplaceStorageRoot(ctx.homeDir);
  const manifest = readMarketSnapshot(root, id);
  const known = readKnown(root).find((r) => r.id === id);
  const marketRoot = known?.source.type === "local" && existsSync(known.source.path) && statSync(known.source.path).isDirectory()
    ? known.source.path
    : snapshotDir(root, id);
  const plugins = manifest.plugins.map((entry) => {
    if (entry.source.type !== "local") return entry;
    const pluginJson = path.resolve(marketRoot, entry.source.path, "plugin.json");
    if (!existsSync(pluginJson)) return entry;
    try {
      const raw = JSON.parse(readFileSync(pluginJson, "utf8")) as Record<string, unknown>;
      return {
        ...entry,
        ...(typeof raw["version"] === "string" ? { manifestVersion: raw["version"] } : {}),
        ...(entry.description === undefined && typeof raw["description"] === "string" ? { description: raw["description"] } : {}),
      };
    } catch {
      return entry;
    }
  });
  return { marketplace: id, plugins };
}

/** 已安装插件记录（uninstall/update 的所有权权威证据）。 */
export function listInstalled(ctx: MarketOpContext): InstalledPluginRecord[] {
  return readInstalled(marketplaceStorageRoot(ctx.homeDir));
}
