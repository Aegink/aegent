/**
 * 配置导入导出与深链分享（U20/T-P3-122 → T-P3-153 数据中心 A 域）——配置包
 * 的导出/导入/确认/备份/版本迁移/选择性导出（cc-switch·ImportExportSection
 * /BackupListSection + deeplink 三确认行为锚：**导入必确认**——深链/分享来
 * 的配置是不可信输入，确认面是 C 族防线的用户侧延伸）。
 *
 * 零明文纪律（卡面明示）：凭据独立存 credentials.bin（DPAPI），settings
 * 本就零 key——导出包整份 settings 即安全，但仍做导出内容断言（无
 * "apiKey" 键）双保险；**凭据永不打包**（换机凭据走各自的录入面）。
 *
 * 本地态不分发（定形）：onboardingDone（首跑引导）/activeProfile（当前档
 * 指针）/activeProject（当前项目指针）不进导出包、不被导入覆盖（replace
 * 模式沿用 activeProfile 同名档保留例外——merge 模式一律保留本机值）。
 *
 * 包版本（T-P3-153 A3——qwen $version + MigrationScheduler 锚）：v2 起支
 * 持选择性导出（partial + domains 域清单）；v1 旧包经迁移链收敛（1→2 恒
 * 等——v1 即整包）。版本高于当前 = 类型化拒绝（提示升级）。
 */

import { copyFileSync, existsSync, renameSync, unlinkSync } from "node:fs";
import {
  parseSettingsShape,
  type SettingsShape,
} from "./settings.js";

/** 本地态键（不进导出包、不被导入覆盖——见头注）。 */
const LOCAL_ONLY_KEYS = ["onboardingDone", "activeProfile", "activeProject"] as const;

/**
 * 选择性导出域→settings 顶层键映射（A1——pi-desktop 十同步域白名单锚）。
 * 并集 = 可导出全集；与 SETTINGS_PATCH_SECTIONS 的差集恰为 LOCAL_ONLY_KEYS
 * 三键（partition 完整性有单测锁定）。UI 侧域标签在 transfer.js（展示层）。
 */
export const TRANSFER_DOMAINS = {
  providers: ["providers", "defaultProvider", "defaultModel", "profiles"],
  prompts: ["prompts"],
  mcp: ["mcp"],
  projects: ["projects"],
  appearance: ["appearance"],
  keymap: ["shortcuts"],
  enhancement: ["enhancement"],
  advanced: ["permission", "sandbox", "logging", "pricing", "skills", "subagents", "stt", "tts", "plugins"],
} as const satisfies Record<string, readonly string[]>;
export type TransferDomainId = keyof typeof TRANSFER_DOMAINS;
export const TRANSFER_DOMAIN_IDS = Object.keys(TRANSFER_DOMAINS) as TransferDomainId[];

/** 导出包形状（kind 校验——导入面拒绝非 aegent 配置包；v2 起可部分包）。 */
export interface SettingsExportPackage {
  readonly version: 2;
  readonly kind: "aegent-settings-export";
  readonly exportedAt: string;
  /** 部分包标记（v2 新增——缺省/false = 整包 replace 语义）。 */
  readonly partial?: boolean;
  /** partial=true 时的域清单（TRANSFER_DOMAINS 键闭集）。 */
  readonly domains?: readonly string[];
  readonly settings: Record<string, unknown>;
}

function stripLocalKeys(s: Record<string, unknown>): Record<string, unknown> {
  const out = { ...s };
  for (const key of LOCAL_ONLY_KEYS) delete out[key];
  return out;
}

/**
 * 导出配置包（A1 选择性导出——domains 缺省 = 全域整包；部分包只含所选域
 * 的键且本地态键恒剔除）。零凭据断言双保险（导出串无 "apiKey" 键）。
 */
export function exportSettingsPackage(
  settings: SettingsShape,
  domains?: readonly string[],
): { package: SettingsExportPackage; text: string; summary: string[] } {
  const selected = domains ?? TRANSFER_DOMAIN_IDS;
  for (const d of selected) {
    if (!(d in TRANSFER_DOMAINS)) {
      throw new SettingsImportError("SETTINGS_IMPORT_UNKNOWN_DOMAIN", `未知导出域：${String(d)}`);
    }
  }
  const partial = domains !== undefined;
  const raw = stripLocalKeys(settings as unknown as Record<string, unknown>);
  const filtered: Record<string, unknown> = {};
  if (partial) {
    for (const d of selected) {
      for (const key of TRANSFER_DOMAINS[d as TransferDomainId]) {
        if (raw[key] !== undefined) filtered[key] = raw[key];
      }
    }
  } else {
    Object.assign(filtered, raw);
  }
  const pkg: SettingsExportPackage = {
    version: 2,
    kind: "aegent-settings-export",
    exportedAt: new Date().toISOString(),
    ...(partial ? { partial: true, domains: [...selected] } : {}),
    settings: filtered,
  };
  const text = JSON.stringify(pkg, null, 2);
  if (text.includes('"apiKey"')) {
    throw new Error("导出包含 apiKey 字段（零明文纪律违反——拒绝导出）");
  }
  return { package: pkg, text, summary: summarizePackage(filtered as unknown as SettingsShape) };
}

/** 导出：配置包 JSON 串（旧签名兼容——全域整包导出）。 */
export function exportSettingsPayload(settings: SettingsShape): string {
  return exportSettingsPackage(settings).text;
}

/** 坏包类型化拒绝（非 JSON/kind 不符/形状非法/版本不可收敛——fail-closed）。 */
export type SettingsImportErrorCode =
  | "SETTINGS_IMPORT_BAD_JSON"
  | "SETTINGS_IMPORT_BAD_KIND"
  | "SETTINGS_IMPORT_BAD_SHAPE"
  | "SETTINGS_IMPORT_BAD_VERSION"
  | "SETTINGS_IMPORT_UNKNOWN_DOMAIN";

export class SettingsImportError extends Error {
  override readonly name = "SettingsImportError";
  readonly code: SettingsImportErrorCode;
  constructor(code: SettingsImportErrorCode, message: string) {
    super(message);
    this.name = "SettingsImportError";
    this.code = code;
  }
}

/** 当前配置包版本（迁移链的收敛目标——qwen SETTINGS_VERSION 同构）。 */
export const SETTINGS_PACKAGE_VERSION = 2;

/** v1→v2 迁移链（1→2 = 恒等变换 + **版本号抬升**——v1 即整包，v2 新增
 * partial/domains 可选字段；抬升是收敛保证：漏了即 while 死循环，有回归
 * 单测锁定）。后续版本在此登记 fromVersion→transform。 */
const PACKAGE_MIGRATIONS: Record<number, (p: Record<string, unknown>) => Record<string, unknown>> = {
  1: (p) => ({ ...p, version: SETTINGS_PACKAGE_VERSION }),
};

/** 版本收敛（codex migrate-rollouts DryRun 精神的静态版——不可收敛即拒绝）。 */
function migratePackage(raw: Record<string, unknown>): Record<string, unknown> {
  const rawVersion = raw["version"] ?? 1;
  if (typeof rawVersion !== "number" || !Number.isInteger(rawVersion) || rawVersion < 1) {
    throw new SettingsImportError("SETTINGS_IMPORT_BAD_VERSION", `配置包版本非法：${String(rawVersion)}`);
  }
  if (rawVersion > SETTINGS_PACKAGE_VERSION) {
    throw new SettingsImportError(
      "SETTINGS_IMPORT_BAD_VERSION",
      `配置包版本过新（v${rawVersion} > 当前 v${SETTINGS_PACKAGE_VERSION}）——请升级 aegent 后重试`,
    );
  }
  let pkg = raw;
  let v = rawVersion;
  while (v < SETTINGS_PACKAGE_VERSION) {
    const step = PACKAGE_MIGRATIONS[v];
    if (step === undefined) {
      throw new SettingsImportError("SETTINGS_IMPORT_BAD_VERSION", `无法迁移的配置包版本：${v}`);
    }
    pkg = step(pkg);
    // 进度保险：迁移步必须抬版本——未抬（或回填旧值）也强制步进，杜绝死循环
    v = typeof pkg["version"] === "number" && pkg["version"] > v ? pkg["version"] : v + 1;
  }
  return pkg;
}

/** 包解析分型（replace = 整份替换；merge = 部分包域合并）。 */
export type ResolvedImport =
  | { mode: "replace"; settings: SettingsShape; summary: string[] }
  | { mode: "merge"; partial: Record<string, unknown>; domains: string[]; summary: string[] };

/** 包解析管线（A2/A3——版本收敛→kind 校验→分型；纯函数零落盘）。 */
export function resolveImportedPackage(parsed: unknown): ResolvedImport {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SettingsImportError("SETTINGS_IMPORT_BAD_JSON", "导入包须为 JSON 对象");
  }
  const pkg = migratePackage(parsed as Record<string, unknown>);
  const kind = pkg["kind"];
  if (kind !== "aegent-settings-export") {
    throw new SettingsImportError(
      "SETTINGS_IMPORT_BAD_KIND",
      `导入包 kind 不符：${String(kind)}（须为 aegent-settings-export）`,
    );
  }
  const rawSettings = pkg["settings"];
  if (rawSettings === undefined || rawSettings === null || typeof rawSettings !== "object" || Array.isArray(rawSettings)) {
    throw new SettingsImportError("SETTINGS_IMPORT_BAD_SHAPE", "导入包缺 settings 段");
  }
  if (pkg["partial"] === true) {
    const domains = pkg["domains"];
    if (
      !Array.isArray(domains) ||
      domains.length === 0 ||
      domains.some((d) => typeof d !== "string" || !(d in TRANSFER_DOMAINS))
    ) {
      throw new SettingsImportError("SETTINGS_IMPORT_UNKNOWN_DOMAIN", "部分包 domains 非法（未知域或为空）");
    }
    const partial = rawSettings as Record<string, unknown>;
    return {
      mode: "merge",
      partial,
      domains: domains as string[],
      summary: summarizePackage(partial as unknown as SettingsShape),
    };
  }
  const imported = parseSettingsShape(rawSettings);
  return { mode: "replace", settings: imported, summary: summarizePackage(imported) };
}

/** 导入预览（**确认前的只读面**——包 JSON → 解析管线 → 配置与摘要）。 */
export function buildImportPreview(text: string): {
  settings: SettingsShape | Record<string, unknown>;
  summary: string[];
  mode: "replace" | "merge";
  domains?: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SettingsImportError("SETTINGS_IMPORT_BAD_JSON", "导入包不是合法 JSON");
  }
  const resolved = resolveImportedPackage(parsed);
  if (resolved.mode === "replace") {
    return { settings: resolved.settings, summary: resolved.summary, mode: "replace" };
  }
  return { settings: resolved.partial, summary: resolved.summary, mode: "merge", domains: resolved.domains };
}

/** 包内配置的摘要行（确认对话框的逐项列出——用户确认的依据面；容部分包
 * 缺域——providers 等键可能不存在，读数全部走可选链）。 */
export function summarizePackage(s: SettingsShape): string[] {
  const lines: string[] = [];
  lines.push(`供应商条目 ${s.providers?.length ?? 0} 个（默认 ${s.defaultProvider ?? "未设置"}）`);
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
 * 整包导入应用（replace 语义——v1/v2 整包共用）：本地态保留（onboardingDone
 * 不覆盖；activeProfile 仅当被导入包含同名档时保留），其余整份替换。
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

/**
 * 部分包域合并（A2——仅覆盖包内所含域，本地其余域不动；本地态键一律保留
 * 本机值；整体 parseSettingsShape fail-closed——坏域值整包拒绝不落盘，
 * opencode import upsert 幂等精神）。
 */
export function applyPartialImport(
  current: SettingsShape,
  partial: Record<string, unknown>,
  domains: readonly string[],
): SettingsShape {
  const merged = { ...current } as Record<string, unknown>;
  for (const d of domains) {
    const keys = TRANSFER_DOMAINS[d as TransferDomainId];
    if (keys === undefined) {
      throw new SettingsImportError("SETTINGS_IMPORT_UNKNOWN_DOMAIN", `未知导出域：${String(d)}`);
    }
    for (const key of keys) {
      if (key in partial && !(LOCAL_ONLY_KEYS as readonly string[]).includes(key)) {
        merged[key] = partial[key];
      }
    }
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
