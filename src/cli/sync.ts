/**
 * `aegent sync` 子命令（C3 补口——N9/N10 配置跨设备同步的生产消费入口）：
 * 把 sync 域五模块（coordinator/merge/vault/journal/store）与 WebDAV 传输
 * 面接成一条真实命令——一次调用完成"拉→三方合并→本地应用→推"（N10：
 * 冲突显式拒绝零 apply，绝不后写覆盖先写）。
 *
 * 配置面：远端 = settings.webdav 段（url/username/remoteRoot——与数据中心
 * 页 WebDAV 卡同一配置）；同步口令 = env AEGENT_SYNC_PASSPHRASE（凭据不进
 * 命令行，D8 同向）；同步实体 = settings.json（剔除同步/本地态自身段——
 * 防自指回写）+ ~/.aegent/rules.txt + ~/.aegent/AGENTS.md 三件（payload 为
 * 结构化 JSON，vault 加密面在 coordinator 内）。设备基线（knownBase）持久
 * 化于 <home>/.aegent/sync-base.json（per-device acknowledged base——N10
 * 的真正落点），导入日志 <home>/.aegent/sync-journal.jsonl（崩溃可恢复）。
 */

import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { createCredentialStore } from "../session/credentials.js";
import { loadSettings } from "../session/settings.js";
import { syncOnce, type SyncOnceResult } from "../sync/coordinator.js";
import type { SyncEntity } from "../sync/merge.js";
import type { RemoteStore } from "../sync/store.js";
import {
  davGet,
  davMkcolRecursive,
  davObjectUrl,
  davPut,
  WEBDAV_MAX_OBJECT_BYTES,
  type WebdavConfig,
} from "../host/webdav-transfer.js";

export const SYNC_COMMAND_USAGE =
  "用法：aegent sync [--settings <path>] [--dry-run]（远端与口令：settings.webdav 段 + env AEGENT_SYNC_PASSPHRASE）";

/** 同步实体 domain 闭集（applyEntity 的写回路由依据）。 */
export const DOMAIN_SETTINGS = "settings-file";
export const DOMAIN_FILE = "file";

export interface SyncCommandIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

function home(): string {
  return process.env["AEGENT_HOME"] ?? path.join(os.homedir(), ".aegent");
}

/** settings 路径解析（--settings 覆盖；与 CLI 主入口同一缺省）。 */
function settingsPathOf(argv: readonly string[], explicit?: string): string {
  const i = argv.indexOf("--settings");
  if (explicit !== undefined) return explicit;
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1] as string;
  return path.join(home(), "settings.json");
}

/** WebDAV 远端 store（davGet/davPut 的 RemoteStore 适配——404 = undefined）。 */
export function createWebdavRemoteStore(config: WebdavConfig): RemoteStore {
  return {
    async read(key: string) {
      const result = await davGet(config, davObjectUrl(config, key), WEBDAV_MAX_OBJECT_BYTES);
      if (!result.ok) throw new Error(`WebDAV 读取失败：${result.message}`);
      return result.body ?? undefined; // null（404）→ undefined（RemoteStore 语义）
    },
    async write(key: string, content: string) {
      const url = davObjectUrl(config, key);
      await davMkcolRecursive(config, url); // 远端目录不存在自动建（批次 4 同语义）
      const result = await davPut(config, url, content);
      if (!result.ok) throw new Error(`WebDAV 写入失败：${result.message}`);
    },
  };
}

/** 同步自身段与本地态键（settings.json 实体剔除面——防自指与本地态覆盖）。 */
const LOCAL_ONLY_SETTINGS_KEYS = new Set(["webdav", "backup", "onboardingDone", "activeProfile", "activeProject"]);

/** 收集本地三实体（settings/rules/全局指令）。 */
export function collectSyncEntities(settingsFile: string): SyncEntity[] {
  const entities: SyncEntity[] = [];
  if (existsSync(settingsFile)) {
    const parsed = JSON.parse(readFileSync(settingsFile, "utf8")) as Record<string, unknown>;
    const shared: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!LOCAL_ONLY_SETTINGS_KEYS.has(k)) shared[k] = v;
    }
    entities.push({
      domain: DOMAIN_SETTINGS,
      entityId: "settings.json",
      label: "设置（剔除同步/本地态段）",
      payload: { settings: shared } as import("../kernel/events.js").JsonRecord,
    });
  }
  const rulesPath = path.join(home(), "rules.txt");
  if (existsSync(rulesPath)) {
    entities.push({
      domain: DOMAIN_FILE,
      entityId: "rules.txt",
      label: "用户规则（rules.txt）",
      payload: { content: readFileSync(rulesPath, "utf8") },
    });
  }
  const agentsPath = path.join(home(), "AGENTS.md");
  if (existsSync(agentsPath)) {
    entities.push({
      domain: DOMAIN_FILE,
      entityId: "AGENTS.md",
      label: "全局指令（AGENTS.md）",
      payload: { content: readFileSync(agentsPath, "utf8") },
    });
  }  return entities;
}

/** 应用远端实体到本地文件（JSON 校验先行——坏数据不落盘）。 */
export function applySyncEntity(settingsFile: string, entity: SyncEntity): void {
  if (entity.domain === DOMAIN_SETTINGS) {
    const shared = (entity.payload as { settings?: Record<string, unknown> }).settings;
    if (shared === undefined || typeof shared !== "object") {
      throw new Error(`远端 settings 实体形状非法（${entity.entityId}）`);
    }
    const current = existsSync(settingsFile)
      ? (JSON.parse(readFileSync(settingsFile, "utf8")) as Record<string, unknown>)
      : {};
    const merged = { ...current, ...shared, webdav: current["webdav"], backup: current["backup"] };
    mkdirSync(path.dirname(settingsFile), { recursive: true });
    writeFileSync(settingsFile, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    return;
  }
  if (entity.domain === DOMAIN_FILE) {
    const content = (entity.payload as { content?: unknown }).content;
    if (typeof content !== "string") {
      throw new Error(`远端文件实体形状非法（${entity.entityId}）`);
    }
    const target = path.join(home(), entity.entityId);
    if (!target.startsWith(home() + path.sep)) {
      throw new Error(`实体键越界（${entity.entityId}）`);
    }
    mkdirSync(home(), { recursive: true });
    writeFileSync(target, content, "utf8");
    return;
  }
  throw new Error(`未知同步 domain：${entity.domain}`);
}

function readKnownBase(): { base?: SyncEntity[] } {
  const file = path.join(home(), "sync-base.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as { base?: SyncEntity[] };
  } catch {
    return {}; // 坏基线视作无（远端 manifest.base 兜底——合并仍有保护）
  }
}

function writeKnownBase(base: readonly SyncEntity[]): void {
  mkdirSync(home(), { recursive: true });
  writeFileSync(
    path.join(home(), "sync-base.json"),
    `${JSON.stringify({ base }, null, 2)}\n`,
    "utf8",
  );
}

/** sync 子命令入口；返回进程退出码。 */
export async function runSyncCommand(argv: readonly string[], io: SyncCommandIo, settingsExplicit?: string): Promise<number> {
  const dryRun = argv.includes("--dry-run");
  const settingsFile = settingsPathOf(argv, settingsExplicit);
  const passphrase = process.env["AEGENT_SYNC_PASSPHRASE"] ?? "";
  if (passphrase === "") {
    io.err("缺同步口令：设 env AEGENT_SYNC_PASSPHRASE 后重试（口令不进命令行/配置文件）");
    return 1;
  }
  try {
    const { settings } = await loadSettings(settingsFile);
    const wd = settings.webdav ?? {};
    if (wd.url === undefined || wd.url === "") {
      io.err("WebDAV 未配置（settings.webdav.url 缺失）——先在数据中心页填写服务地址");
      return 1;
    }
    const config: WebdavConfig = {
      url: wd.url,
      ...(wd.username !== undefined ? { username: wd.username } : {}),
      ...(wd.remoteRoot !== undefined ? { remoteRoot: wd.remoteRoot } : {}),
      ...(await createCredentialStore()
        .getKey("webdav")
        .then((p) => (p !== null && p !== "" ? { password: p } : {}))),
    };
    const local = collectSyncEntities(settingsFile);
    io.out(`本地实体 ${String(local.length)} 件（${local.map((e) => e.entityId).join("、")}）`);
    const { base } = readKnownBase();
    if (dryRun) {
      io.out("--dry-run：只读探测（远端 manifest 可达性）——不合并不写入");
      const remote = createWebdavRemoteStore(config);
      const manifest = await remote.read("manifest.json");
      io.out(manifest === undefined ? "远端 manifest：不存在（首次同步将创建）" : "远端 manifest：在位");
      return 0;
    }
    const result: SyncOnceResult = await syncOnce({
      local,
      remote: createWebdavRemoteStore(config),
      passphrase,
      applyEntity: (entity) => applySyncEntity(settingsFile, entity),
      ...(base !== undefined ? { knownBase: base } : {}),
      journalPath: path.join(home(), "sync-journal.jsonl"),
    });
    writeKnownBase(result.base);
    io.out(`同步完成：应用 ${String(result.applied)} / 日志跳过 ${String(result.skippedByJournal)}`);
    if (result.conflicts.length > 0) {
      io.err(`冲突 ${String(result.conflicts.length)} 条（未应用——请在本机改好后重试或手动合并）：`);
      for (const c of result.conflicts) io.err(`  - ${c.domain}/${c.entityId}`);
      return 1;
    }
    return 0;
  } catch (e) {
    io.err(`sync 命令失败：${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
