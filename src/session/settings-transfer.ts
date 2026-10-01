/**
 * 配置导入导出与深链分享（U20/T-P3-122）——配置包的导出/导入/确认/备份
 * （cc-switch·ImportExportSection/BackupListSection + deeplink 三确认行为
 * 锚：**导入必确认**——深链/分享来的配置是不可信输入，确认面是 C 族防线
 * 的用户侧延伸）。
 *
 * 零明文纪律（卡面明示）：凭据独立存 credentials.bin（DPAPI），settings
 * 本就零 key——导出包整份 settings 即安全，但仍做导出内容断言（无
 * "apiKey" 键）双保险；**凭据永不打包**（换机凭据走各自的录入面）。
 *
 * 本地态不分发（定形）：onboardingDone（首跑引导是本机状态）不进导出包、
 * 不被导入覆盖；activeProfile 只在被导入包含同名档时保留，否则清位。
 */

import { copyFileSync, existsSync, renameSync, unlinkSync } from "node:fs";
import {
  parseSettingsShape,
  type SettingsShape,
} from "./settings.js";

/** 导出包形状（kind 校验——导入面拒绝非 aegent 配置包）。 */
export interface SettingsExportPackage {
  readonly version: 1;
  readonly kind: "aegent-settings-export";
  readonly exportedAt: string;
  readonly settings: SettingsShape;
}

/** 导出：配置包 JSON 串（pretty 打印——分享面可读、diff 友好）。 */
export function exportSettingsPayload(settings: SettingsShape): string {
  const payload: SettingsExportPackage = {
    version: 1,
    kind: "aegent-settings-export",
    exportedAt: new Date().toISOString(),
    settings,
  };
  const text = JSON.stringify(payload, null, 2);
  if (text.includes('"apiKey"')) {
    throw new Error("导出包含 apiKey 字段（零明文纪律违反——拒绝导出）");
  }
  return text;
}

/** 坏包类型化拒绝（非 JSON/kind 不符/形状非法——导入面 fail-closed）。 */
export type SettingsImportErrorCode =
  | "SETTINGS_IMPORT_BAD_JSON"
  | "SETTINGS_IMPORT_BAD_KIND"
  | "SETTINGS_IMPORT_BAD_SHAPE";

export class SettingsImportError extends Error {
  override readonly name = "SettingsImportError";
  readonly code: SettingsImportErrorCode;
  constructor(code: SettingsImportErrorCode, message: string) {
    super(message);
    this.name = "SettingsImportError";
    this.code = code;
  }
}

/**
 * 导入预览（**确认前的只读面**——校验 + 摘要，不落盘）：包 JSON → kind
 * 校验 → parseSettingsShape 形状校验 → 返回配置与变更摘要行。
 */
export function buildImportPreview(text: string): {
  settings: SettingsShape;
  summary: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SettingsImportError("SETTINGS_IMPORT_BAD_JSON", "导入包不是合法 JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SettingsImportError("SETTINGS_IMPORT_BAD_JSON", "导入包须为 JSON 对象");
  }
  const kind = (parsed as Record<string, unknown>)["kind"];
  if (kind !== "aegent-settings-export") {
    throw new SettingsImportError(
      "SETTINGS_IMPORT_BAD_KIND",
      `导入包 kind 不符：${String(kind)}（须为 aegent-settings-export）`,
    );
  }
  const rawSettings = (parsed as Record<string, unknown>)["settings"];
  if (rawSettings === undefined || rawSettings === null) {
    throw new SettingsImportError("SETTINGS_IMPORT_BAD_SHAPE", "导入包缺 settings 段");
  }
  const imported = parseSettingsShape(rawSettings);
  return { settings: imported, summary: summarizePackage(imported) };
}

/** 包内配置的摘要行（确认对话框的逐项列出——用户确认的依据面）。 */
export function summarizePackage(s: SettingsShape): string[] {
  const lines: string[] = [];
  lines.push(`供应商条目 ${s.providers.length} 个（默认 ${s.defaultProvider ?? "未设置"}）`);
  if (s.defaultModel !== undefined) lines.push(`默认模型 ${s.defaultModel}`);
  if (s.permission?.approvalTimeoutMs !== undefined) {
    lines.push(`审批超时 ${s.permission.approvalTimeoutMs}ms`);
  }
  if (s.sandbox?.network !== undefined) lines.push(`网络档 ${s.sandbox.network}`);
  if (s.sandbox?.workspace !== undefined) lines.push(`工作区 ${s.sandbox.workspace}`);
  if (s.projects?.length) lines.push(`项目 ${s.projects.length} 个`);
  // T-P3-146 C：prompts 双形态——数组（旧内联库）计条目数；对象（文件域配置）
  // 有 roots 时计附加根数
  if (Array.isArray(s.prompts) && s.prompts.length > 0) {
    lines.push(`提示词模板 ${s.prompts.length} 个`);
  } else if (!Array.isArray(s.prompts) && s.prompts?.roots?.length) {
    lines.push(`提示词模板附加源 ${s.prompts.roots.length} 个`);
  }
  if (s.mcp?.length) lines.push(`MCP server ${s.mcp.length} 个`);
  if (s.profiles?.length) lines.push(`配置档 ${s.profiles.length} 个`);
  if (s.enhancement?.judge !== undefined) lines.push("判官辅助模型已配置");
  if (s.enhancement?.summarizer !== undefined) lines.push("摘要辅助模型已配置");
  return lines;
}

/**
 * 导入应用：本地态保留（onboardingDone 不覆盖；activeProfile 仅当被导入
 * 包含同名档时保留），其余整份替换——返回合并后的配置（落盘在 gateway 面）。
 */
export function applyImportedSettings(
  current: SettingsShape,
  imported: SettingsShape,
): SettingsShape {
  const activeProfile = current.activeProfile;
  const merged: SettingsShape = {
    ...imported,
    onboardingDone: current.onboardingDone,
  };
  if (
    activeProfile === undefined ||
    !(merged.profiles ?? []).some((p) => p.name === activeProfile)
  ) {
    delete merged.activeProfile;
  } else {
    merged.activeProfile = activeProfile;
  }
  return parseSettingsShape(merged);
}

/** 备份滚动上限（settings.json.bak.0 ~ bak.4——最近 5 份）。 */
export const SETTINGS_BACKUP_KEEP = 5;

/**
 * 导入前自动备份（cc-switch·BackupListSection 行为锚：滚动保留最近 N 份
 * ——bak.0 最新；无现有文件 = 无备份可做，静默返回）。
 */
export function backupSettingsFile(settingsPath: string, keep: number = SETTINGS_BACKUP_KEEP): void {
  if (!existsSync(settingsPath)) return;
  // bak.N-1 → bak.N（最老的被挤出删除）
  const oldest = `${settingsPath}.bak.${keep - 1}`;
  if (existsSync(oldest)) unlinkSync(oldest);
  for (let i = keep - 2; i >= 0; i--) {
    const from = `${settingsPath}.bak.${i}`;
    if (existsSync(from)) renameSync(from, `${settingsPath}.bak.${i + 1}`);
  }
  copyFileSync(settingsPath, `${settingsPath}.bak.0`);
}
