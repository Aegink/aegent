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
