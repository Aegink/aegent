/**
 * settings 数据中心域 op 一行收敛分发（T-P3-153——settings-gateway 行数纪
 * 律拆分位，同 tryProjectSettingsOp/tryPluginSettingsOp 模式）：配置包导出
 * /导入、备份中心四 op、会话导出/回导、体检、会话删除。域依赖经
 * gateway.transferDeps() 投影（settingsPath/事件库/凭据为构造私有面）。
 */

import type { SettingsCall } from "./protocol-settings.js";
import type { SettingsGateway, TransferDeps } from "./settings-gateway-types.js";
import { withSettingsRmw } from "./settings-rmw.js";
import type { SessionEvent } from "../kernel/events.js";
import type { SqliteEventStorage } from "../session/db.js";
import type { SessionStore } from "../session/store.js";
import {
  createSettingsBackupOp,
  deleteSettingsBackupOp,
  listSettingsBackupsOp,
  restoreSettingsBackupOp,
} from "./settings-backup-ops.js";
import { sessionExportFromEvents, sessionImportOp } from "./session-export-op.js";
import { settingsCheckupOp } from "./settings-checkup-op.js";
import { exportSettingsPackage } from "../session/settings-transfer.js";
import { tryLoggingSettingsOp } from "./logging-ops.js";
import { exportSessionDb, isSessionDbExportFormat } from "../session/db-export.js";
import { checkpointTimelineFromEvents, restoreWorkspaceToCheckpoint } from "../session/checkpoint-timeline.js";
import { createGitRunner } from "../session/git-checkpoint.js";
import {
  webdavFetchRemoteInfo,
  webdavSyncNow,
  webdavTest,
  type WebdavDeps,
} from "./webdav-transfer.js";

/** bridge 侧会话域依赖（session-export 拦截用——store 在 bridge 手里）。 */
export interface SessionBridgeDeps {
  store?: SessionStore;
  sessionId: string;
  sessionsLibrary?: SqliteEventStorage;
}

// ---------------------------------------------------------------------------
// T-P3-174 批次 4 helper：跨会话事件读面 / WebDAV 编排（行数纪律——主 switch
// 只留 case 骨架，编排细节收敛此处）
// ---------------------------------------------------------------------------

/**
 * 时间线/回退的权威数据源 = host 库全量读（不走"本会话内存序优先"——
 * host 镜像是纯内存读面，对活动会话恒非空但只含启动后的增量，会吞掉库
 * 里的历史 checkpoint；checkpoint 事件在轮末 flush 时已随流落库，库即全
 * 量真相——与 session-export 的 U3 放宽读面分域）。
 */
function readSessionEvents(
  sessionDb: SqliteEventStorage,
  sessionId: string,
): readonly SessionEvent[] {
  return sessionDb.readAll(sessionId);
}

/** WebDAV 依赖装配（配置包构建/应用复用 gateway 既有面——零凭据纪律在
 *  exportSettingsPackage 内成立）。 */
async function webdavDeps(
  gateway: SettingsGateway,
  deps: TransferDeps,
): Promise<WebdavDeps> {
  const settings = await deps.getSettings();
  const wd = settings.webdav ?? {};
  if (wd.url === undefined || wd.url === "") {
    throw new Error("WebDAV 未配置（settings.webdav.url 缺失）——先在数据中心页填写服务地址");
  }
  return {
    config: {
      url: wd.url,
      ...(wd.username !== undefined ? { username: wd.username } : {}),
      ...(wd.remoteRoot !== undefined ? { remoteRoot: wd.remoteRoot } : {}),
    },
    credentials: deps.credentials,
    buildLocalPackage: async () => {
      const s = await deps.getSettings();
      return exportSettingsPackage(s).text;
    },
    applyRemotePackage: async (packageText: string) => {
      const parsed = JSON.parse(packageText) as Record<string, unknown>;
      await gateway.importSettings(parsed);
    },
  };
}

/** WebDAV 同步编排：探测（needsConfirm）→ 确认执行 → 状态回写 settings。 */
async function webdavSyncOp(
  gateway: SettingsGateway,
  deps: TransferDeps,
  call: SettingsCall,
): Promise<unknown> {
  const action = call.action;
  if (action !== "up" && action !== "down") {
    throw new Error(`webdav-sync 的 action 非法：${String(action)}（合法：up|down）`);
  }
  const wdDeps = await webdavDeps(gateway, deps);
  const settings = await deps.getSettings();
  if (call.confirm !== true) {
    // 两段式第一步：探测远端（UI 据此弹确认框——冲突策略 = 用户方向选择）
    const info = await webdavFetchRemoteInfo(wdDeps);
    if (!info.ok) return { ok: false, message: info.message };
    return {
      needsConfirm: true,
      remote: info.remote,
      lastSyncAt: settings.webdav?.lastSyncAt,
      lastError: settings.webdav?.lastError,
    };
  }
  // 第二步：执行（down 需要第一步的 remote manifest——confirm 时 host 重新
  // 探测，保证应用的 manifest 与远端实时一致）
  const info = action === "down" ? await webdavFetchRemoteInfo(wdDeps) : { ok: true as const, remote: null };
  if (!info.ok) return { ok: false, message: info.message };
  const result = await webdavSyncNow(wdDeps, action, info.remote);
  // 状态持久化（成功 = lastSyncAt；失败 = lastError——UI 上次同步时间与
  // 失败横幅的数据源；cc-switch·status.last_error 同构）
  const now = Date.now();
  const webdavPatch = result.ok
    ? { lastSyncAt: now, lastError: "" }
    : { lastSyncAt: settings.webdav?.lastSyncAt, lastError: result.message };
  try {
    await gateway.update({ webdav: { ...(settings.webdav ?? {}), ...webdavPatch } });
  } catch {
    // 状态回写失败不推翻同步结果本身（结果如实返回）
  }
  return result;
}

/** 数据中心族分发（命中返回结果——普通值或 Promise；未命中返回 undefined）。 */
export function tryTransferSettingsOp(
  gateway: SettingsGateway,
  call: SettingsCall,
  session?: SessionBridgeDeps,
): unknown {
  const TRANSFER_OPS = new Set([
    "import", "session-delete", "export-settings",
    "settings-backup-list", "settings-backup-create", "settings-backup-restore", "settings-backup-delete",
    "session-export", "session-import", "settings-checkup",
    // T-P3-174 批次 4：整库导出 / WebDAV 云同步 / 检查点时间线
    "db-export", "webdav-test", "webdav-sync", "checkpoint-timeline", "checkpoint-restore",
  ]);
  if (!TRANSFER_OPS.has(call.op)) {
    return tryLoggingSettingsOp(gateway, call); // T-P3-154：非 transfer 族 → 日志中心族兜底
  }
  const deps: TransferDeps = gateway.transferDeps();
  switch (call.op) {
    // U20/T-P3-122 → T-P3-153：导入（整包上送——kind/版本/域合并解析在 host）
    case "import":
      return gateway.importSettings(call.settings!);
    case "session-delete":
      return gateway.sessionDelete(call.sessionId!);
    case "export-settings":
      return deps.getSettings().then((s) => exportSettingsPackage(s, call.domains));
    case "settings-backup-list":
      return listSettingsBackupsOp(deps.settingsPath);
    case "settings-backup-create":
      return createSettingsBackupOp(deps.settingsPath);
    case "settings-backup-restore":
      return restoreSettingsBackupOp(deps.settingsPath, call.index!);
    case "settings-backup-delete":
      return deleteSettingsBackupOp(deps.settingsPath, call.index!);
    // T-P3-153 C：会话导出（store 在 bridge 手里——数据源与 query events
    // 同读面：本会话内存序无 write-behind 滞后，跨会话回源 sessionsLibrary
    // ——U3 放宽；policy-audit 同款拦截先例）
    case "session-export": {
      const events = session?.store?.load(call.sessionId!) ?? [];
      const library = session?.sessionsLibrary;
      const crossSession = events.length === 0 && call.sessionId !== session?.sessionId;
      const libraryEvents = crossSession && library !== undefined ? library.readAll(call.sessionId!) : [];
      return sessionExportFromEvents(
        events.length > 0 ? events : libraryEvents,
        {
          sessionId: call.sessionId!,
          format: call.format as "md" | "html" | "json",
          ...(call.redact === false ? { redact: false } : {}),
        },
        library?.getTitle(call.sessionId!)?.title,
      );
    }
    case "session-import":
      return sessionImportOp(deps.sessionDb, call.content!);
    case "settings-checkup":
      return settingsCheckupOp({
        settingsPath: deps.settingsPath,
        credentials: deps.credentials,
        getSettings: deps.getSettings,
      });
    // T-P3-174 批次 4：会话库整库导出（dir = UI pick_folder 选定目录——
    // host 不自选落点；format 闭集 sqlite|sql）。
    case "db-export": {
      if (deps.sessionDb === undefined) {
        throw new Error("会话库未启用（--host-db 缺失）——整库导出不可用");
      }
      if (!isSessionDbExportFormat(call.format)) {
        throw new Error(`导出格式非法：${String(call.format)}（合法：sqlite|sql）`);
      }
      if (typeof call.dir !== "string" || call.dir === "") {
        throw new Error("db-export 需要 dir（导出目录）");
      }
      return exportSessionDb(deps.sessionDb.db, call.dir, call.format);
    }
    // T-P3-174 批次 4：WebDAV 云同步（两段式——无 confirm 先探测远端返回
    // 信息给 UI 确认框；confirm=true 按方向执行并回写 lastSyncAt/lastError）。
    case "webdav-test":
      return webdavDeps(gateway, deps).then((wd) => webdavTest(wd));
    case "webdav-sync":
      return webdavSyncOp(gateway, deps, call);
    // T-P3-174 批次 4：检查点时间线（跨会话读面——sessionsLibrary 权威）。
    case "checkpoint-timeline": {
      if (deps.sessionDb === undefined) {
        return { items: [] };
      }
      const events = readSessionEvents(deps.sessionDb, call.sessionId!);
      return checkpointTimelineFromEvents(events, deps.workspaceRoot ?? process.cwd());
    }
    case "checkpoint-restore": {
      if (deps.sessionDb === undefined) {
        throw new Error("会话库未启用——检查点时间线不可用");
      }
      if (typeof call.seq !== "number" || !Number.isInteger(call.seq) || call.seq < 0) {
        throw new Error("checkpoint-restore 需要非负整数 seq（回退目标检查点）");
      }
      const events = readSessionEvents(deps.sessionDb, call.sessionId!);
      return restoreWorkspaceToCheckpoint(events, call.seq, createGitRunner(deps.workspaceRoot ?? process.cwd()));
    }
    default:
      return tryLoggingSettingsOp(gateway, call); // T-P3-154 日志中心族 fallback（bridge 零增量串联）
  }
}

/**
 * 配置包导入实现（U20/T-P3-153 A2/A3——自 settings-gateway 下沉：行数纪律
 * 拆分）。kind 校验+版本迁移+replace/merge 分型在 resolveImportedPackage；
 * 备份滚动先于任何落盘（恢复点语义不变）。
 */
export async function importSettingsOp(
  settingsPath: string,
  packageRaw: Record<string, unknown>,
  getSettings: () => Promise<import("../session/settings.js").SettingsShape>,
): Promise<{ applied: true; summary: string[] }> {
  const { resolveImportedPackage, applyImportedSettings, applyPartialImport, summarizePackage, backupSettingsFile } =
    await import("../session/settings-transfer.js");
  const { saveSettings } = await import("../session/settings.js");
  // 读-改-写互斥（settings-rmw）：导入与并发段级补丁不互相覆盖
  return withSettingsRmw(async () => {
    const current = await getSettings();
    const resolved = resolveImportedPackage(packageRaw);
    backupSettingsFile(settingsPath);
    const merged =
      resolved.mode === "replace"
        ? applyImportedSettings(current, resolved.settings)
        : applyPartialImport(current, resolved.partial, resolved.domains);
    await saveSettings(settingsPath, merged);
    return { applied: true, summary: summarizePackage(merged) };
  });
}
