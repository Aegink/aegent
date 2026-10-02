/**
 * 配置体检 op（T-P3-153 E——claude /doctor + codex doctor 行为锚：只读诊
 * 断、不改状态、行式可序列化结果）。七项检查：默认供应商引用 / providers
 * 字段完整 / MCP 条目 / prompts 附加根存在 / 备份链健康 / 凭据有无（只报
 * 有无不读值）/ 键位冲突。fail/warn 行带 section（UI 点击跳对应设置分节）。
 */

import { existsSync, readFileSync } from "node:fs";
import { parseSettingsShape, type SettingsShape } from "../session/settings.js";
import { listSettingsBackupsOp } from "./settings-backup-ops.js";

export interface CheckupRow {
  level: "ok" | "warn" | "fail";
  item: string;
  detail: string;
  /** settings 分节 id（providers/mcp/prompts/shortcuts/transfer——跳转锚）。 */
  section?: string;
}

export interface CheckupDeps {
  settingsPath: string;
  credentials: { listKeys(): Promise<{ name: string }[]> };
  getSettings(): Promise<SettingsShape>;
}

function row(level: CheckupRow["level"], item: string, detail: string, section?: string): CheckupRow {
  return { level, item, detail, ...(section !== undefined ? { section } : {}) };
}

/** 单项检查：默认供应商引用存在 + providers 字段完整/重名。 */
function checkProviders(s: SettingsShape): CheckupRow[] {
  const rows: CheckupRow[] = [];
  if (s.defaultProvider !== undefined && !s.providers.some((p) => p.name === s.defaultProvider)) {
    rows.push(row("fail", "默认供应商", `defaultProvider「${s.defaultProvider}」不在供应商清单中`, "providers"));
  } else if (s.defaultProvider === undefined && s.providers.length > 0) {
    rows.push(row("warn", "默认供应商", "已配置供应商但未设置默认——会话发起须手动选择", "providers"));
  } else {
    rows.push(row("ok", "默认供应商", s.defaultProvider ?? "（无供应商——未配置）", "providers"));
  }
  const seen = new Set<string>();
  for (const p of s.providers) {
    if (seen.has(p.name)) {
      rows.push(row("fail", "供应商重名", `「${p.name}」出现多次——凭据/探测按名匹配会错位`, "providers"));
    }
    seen.add(p.name);
    if (p.baseUrl === undefined || p.baseUrl.trim() === "") {
      rows.push(row("warn", "供应商端点", `「${p.name}」未配置 baseUrl`, "providers"));
    }
  }
  if (rows.every((r) => r.level === "ok")) {
    rows.push(row("ok", "供应商条目", `${s.providers.length} 个条目字段完整`, "providers"));
  }
  return rows;
}

/** 单项检查：MCP 条目命令/传输可解析 + 重名。 */
function checkMcp(s: SettingsShape): CheckupRow[] {
  const rows: CheckupRow[] = [];
  const seen = new Set<string>();
  for (const m of s.mcp ?? []) {
    if (seen.has(m.name)) rows.push(row("fail", "MCP 重名", `「${m.name}」出现多次——工具前缀会互相覆盖`, "mcp"));
    seen.add(m.name);
    if (m.command === undefined || m.command.trim() === "") {
      rows.push(row("fail", "MCP 启动命令", `「${m.name}」缺 command`, "mcp"));
    }
  }
  if (rows.length === 0) {
    rows.push(row("ok", "MCP 条目", `${s.mcp?.length ?? 0} 个条目形状完整`, "mcp"));
  }
  return rows;
}

/** 单项检查：prompts 附加根目录存在（仅文件域形态有 roots）。 */
function checkPrompts(s: SettingsShape): CheckupRow[] {
  const rows: CheckupRow[] = [];
  const roots = !Array.isArray(s.prompts) ? (s.prompts?.roots ?? []) : [];
  for (const root of roots) {
    if (!existsSync(root)) {
      rows.push(row("warn", "提示词附加源", `目录不存在：${root}`, "prompts"));
    }
  }
  if (rows.length === 0) {
    const n = Array.isArray(s.prompts) ? `${s.prompts.length} 条内联模板` : `${roots.length} 个附加根`;
    rows.push(row("ok", "提示词源", n, "prompts"));
  }
  return rows;
}

/** 单项检查：备份链健康（文件可读 + JSON 可解析——恢复面可用性）。 */
function checkBackups(settingsPath: string): CheckupRow[] {
  const { backups } = listSettingsBackupsOp(settingsPath);
  if (backups.length === 0) {
    return [row("warn", "配置备份", "尚无备份——建议先做一份（导入/恢复前也会自动备份）", "transfer")];
  }
  for (const b of backups) {
    try {
      JSON.parse(readBackup(settingsPath, b.index));
    } catch {
      return [row("fail", "配置备份", `备份 bak.${b.index} 无法解析——恢复面不可用`, "transfer")];
    }
  }
  return [row("ok", "配置备份", `${backups.length} 份备份均可解析`, "transfer")];
}

function readBackup(settingsPath: string, index: number): string {
  return readFileSync(`${settingsPath}.bak.${index}`, "utf8");
}

/** 单项检查：键位冲突（settings.shortcuts 覆盖值重复——后写覆盖先写）。 */
function checkShortcuts(s: SettingsShape): CheckupRow[] {
  const byCombo = new Map<string, string[]>();
  for (const [action, combo] of Object.entries(s.shortcuts ?? {})) {
    byCombo.set(combo, [...(byCombo.get(combo) ?? []), action]);
  }
  const dupes = [...byCombo.entries()].filter(([, actions]) => actions.length > 1);
  if (dupes.length === 0) {
    return [row("ok", "键位冲突", `覆盖 ${Object.keys(s.shortcuts ?? {}).length} 项，无冲突`, "shortcuts")];
  }
  return dupes.map(([combo, actions]) =>
    row("warn", "键位冲突", `${combo} 被多个动作占用：${actions.join("、")}`, "shortcuts"),
  );
}

/** 配置体检（只读——七项检查行式返回；单检查异常不中断整体）。 */
export async function settingsCheckupOp(deps: CheckupDeps): Promise<{ ranAt: string; rows: CheckupRow[] }> {
  const s = parseSettingsShape(await deps.getSettings());
  const rows: CheckupRow[] = [];
  rows.push(...checkProviders(s));
  rows.push(...checkMcp(s));
  rows.push(...checkPrompts(s));
  try {
    rows.push(...checkBackups(deps.settingsPath));
  } catch (e) {
    rows.push(row("fail", "配置备份", `备份清单读取失败：${e instanceof Error ? e.message : String(e)}`, "transfer"));
  }
  try {
    const credNames = new Set((await deps.credentials.listKeys()).map((c) => c.name));
    const missing = s.providers.filter((p) => !credNames.has(p.name));
    if (missing.length === 0 && s.providers.length > 0) {
      rows.push(row("ok", "供应商凭据", `${s.providers.length} 个条目均有凭据记录`, "providers"));
    } else if (missing.length > 0) {
      rows.push(row("warn", "供应商凭据", `缺凭据：${missing.map((p) => p.name).join("、")}（仅记录有无，不读值）`, "providers"));
    } else {
      rows.push(row("ok", "供应商凭据", "无供应商条目", "providers"));
    }
  } catch (e) {
    rows.push(row("warn", "供应商凭据", `凭据清单不可用：${e instanceof Error ? e.message : String(e)}`, "providers"));
  }
  rows.push(...checkShortcuts(s));
  return { ranAt: new Date().toISOString(), rows };
}
