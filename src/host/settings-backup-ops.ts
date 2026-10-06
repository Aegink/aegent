/**
 * 备份中心域 ops（T-P3-153 B——cc-switch·BackupListSection 行为锚）：
 * 列表 / 立即备份 / 恢复（恢复前 safety 滚动备份） / 删除。备份文件恒为
 * `<settingsPath>.bak.<N>`；序号按整数白名单构造（pideck backupIpc 路径
 * 逃逸检查同语义——无用户可控路径成分）。
 */

import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseSettingsShape, type SettingsShape } from "../session/settings.js";
import { backupSettingsFile, summarizePackage } from "../session/settings-transfer.js";

export interface SettingsBackupInfo {
  index: number;
  name: string;
  sizeBytes: number;
  mtimeMs: number;
}

function typedError(code: string, message: string): Error {
  const error = new Error(message);
  (error as unknown as { code: string }).code = code;
  return error;
}

function backupPath(settingsPath: string, index: number): string {
  return `${settingsPath}.bak.${index}`;
}

/** 备份清单（目录扫描——文件名白名单 `<name>.bak.<纯数字>`，其余忽略）。 */
export function listSettingsBackupsOp(settingsPath: string): { backups: SettingsBackupInfo[] } {
  const prefix = `${basename(settingsPath)}.bak.`;
  const dir = dirname(settingsPath);
  const out: SettingsBackupInfo[] = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(prefix)) continue;
      const index = name.slice(prefix.length);
      if (!/^\d+$/.test(index)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (!st.isFile()) continue;
      out.push({ index: Number(index), name, sizeBytes: st.size, mtimeMs: st.mtimeMs });
    }
  } catch {
    // 目录不存在 = 无备份（空清单）
  }
  out.sort((a, b) => a.index - b.index);
  return { backups: out };
}

/** 立即备份（当前配置滚动入 bak.0——无配置文件时类型化拒绝）。 */
export function createSettingsBackupOp(settingsPath: string): { created: true } {
  if (!existsSync(settingsPath)) {
    throw typedError("BACKUP_NO_SOURCE", "配置文件不存在——无备份可做");
  }
  backupSettingsFile(settingsPath);
  return { created: true };
}

/** 备份文件定位（序号白名单——非负整数；不存在类型化拒绝）。 */
function requireBackupFile(settingsPath: string, index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw typedError("BACKUP_BAD_INDEX", `备份序号非法：${String(index)}（须为非负整数）`);
  }
  const p = backupPath(settingsPath, index);
  if (!existsSync(p)) {
    throw typedError("BACKUP_NOT_FOUND", `备份不存在：bak.${index}`);
  }
  return p;
}

/**
 * 恢复备份（B2——cc-switch「恢复前自动 safety backup」行为锚）：先读源内
 * 容（safety 滚动会移位旧 bak 序号）、JSON+形状校验通过后才写回——坏备份
 * 类型化拒绝，主配置不受影响。
 */
export function restoreSettingsBackupOp(
  settingsPath: string,
  index: number,
): { applied: true; settings: SettingsShape; summary: string[] } {
  const source = requireBackupFile(settingsPath, index);
  const content = readFileSync(source, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw typedError("BACKUP_CORRUPT", `备份 bak.${index} 不是合法 JSON——拒绝恢复`);
  }
  const settings = parseSettingsShape(parsed);
  backupSettingsFile(settingsPath); // safety：当前配置先滚动入 bak.0
  writeFileSync(settingsPath, content, "utf8");
  return { applied: true, settings, summary: summarizePackage(settings) };
}

/** 删除备份（单删——确认面在 UI 模态）。 */
export function deleteSettingsBackupOp(settingsPath: string, index: number): { deleted: true } {
  const p = requireBackupFile(settingsPath, index);
  unlinkSync(p);
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// 周期自动备份（T-P3-174 批次 4）：host 侧定时 tick 判据 + 保留策略。
// "上次备份时间"不另存账本——bak.0 的 mtime 即持久事实（重启无损，天然幂
// 等：同一 tick 窗口内 host 重启不会重复备份）。
// ---------------------------------------------------------------------------

/** 自动备份 tick（host setInterval 每小时调一次）：距上次备份 ≥ interval
 * 小时才真正滚动。返回 tick 是否产生了新备份。 */
export function autoBackupTickOp(
  settingsPath: string,
  options: { auto?: boolean; intervalHours?: number; keep?: number },
  now: number = Date.now(),
): { backedUp: boolean } {
  if (options.auto !== true) return { backedUp: false };
  const intervalMs = Math.max(1, options.intervalHours ?? 24) * 3_600_000;
  if (existsSync(settingsPath)) {
    const latest = `${settingsPath}.bak.0`;
    if (existsSync(latest) && now - statSync(latest).mtimeMs < intervalMs) {
      return { backedUp: false }; // 未到间隔——tick 静默跳过
    }
  }
  createSettingsBackupOp(settingsPath);
  applyBackupRetentionPolicy(settingsPath, options.keep ?? 5);
  return { backedUp: true };
}

/** 保留策略：序号 ≥ keep 的备份最老先删（手动/自动共用 bak 序号体系——
 *  keep 动态收窄时超出序号一并清理，目录扫描面容错无残留账目）。 */
export function applyBackupRetentionPolicy(settingsPath: string, keep: number): { removed: number[] } {
  const removed: number[] = [];
  for (const backup of listSettingsBackupsOp(settingsPath).backups) {
    if (backup.index >= keep) {
      try {
        unlinkSync(backupPath(settingsPath, backup.index));
        removed.push(backup.index);
      } catch {
        // 单份删除失败不中断策略（下一 tick 重试）
      }
    }
  }
  return { removed };
}

/**
 * 周期自动备份 tick（T-P3-174 批次 4——自 server.ts main 下沉：行数纪律
 * 拆分）。每 30 分钟醒一次，距上次备份（bak.0 的 mtime = 持久事实）≥
 * intervalHours 才真正滚动；配置活值经 settingsGateway 读，UI 改完下一
 * tick 即生效；重启无损。
 */
export function createBackupTicker(
  settingsGateway: { get(): Promise<SettingsShape> },
  settingsPath: string,
): NodeJS.Timeout {
  const ticker = setInterval(() => {
    void (async () => {
      try {
        const settings = await settingsGateway.get();
        const tick = autoBackupTickOp(settingsPath, {
          auto: settings.backup?.auto,
          intervalHours: settings.backup?.intervalHours,
          keep: settings.backup?.keep,
        });
        if (tick.backedUp) {
          process.stdout.write(`[backup] 周期自动备份完成（interval=${settings.backup?.intervalHours ?? 24}h）\n`);
        }
      } catch (e) {
        process.stderr.write(`[backup] 周期自动备份失败：${e instanceof Error ? e.message : String(e)}\n`);
      }
    })();
  }, 30 * 60_000);
  ticker.unref?.();
  return ticker;
}
