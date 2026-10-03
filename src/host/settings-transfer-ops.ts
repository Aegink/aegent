/**
 * settings 数据中心域 op 一行收敛分发（T-P3-153——settings-gateway 行数纪
 * 律拆分位，同 tryProjectSettingsOp/tryPluginSettingsOp 模式）：配置包导出
 * /导入、备份中心四 op、会话导出/回导、体检、会话删除。域依赖经
 * gateway.transferDeps() 投影（settingsPath/事件库/凭据为构造私有面）。
 */

import type { SettingsCall } from "./protocol-settings.js";
import type { SettingsGateway, TransferDeps } from "./settings-gateway-types.js";
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

/** bridge 侧会话域依赖（session-export 拦截用——store 在 bridge 手里）。 */
export interface SessionBridgeDeps {
  store?: SessionStore;
  sessionId: string;
  sessionsLibrary?: SqliteEventStorage;
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
    default:
      return tryLoggingSettingsOp(gateway, call); // T-P3-154 日志中心族 fallback（bridge 零增量串联）
  }
}
