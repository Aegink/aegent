/**
 * 提示词模板库纯函数（U16/T-P3-118）——模板 CRUD 的库操作与 `{{var}}`
 * 变量占位的最小面（cc-switch·PromptLibrary/PromptFormPanel 行为映射：
 * 库列表 + 表单编辑 + 条目管理；🔴 只学行为不抄 React 结构）。
 *
 * 存储定形（卡面"settings 同域存储或独立档"二选一）：走 settings 同域
 * （SettingsShape.prompts 段——T-P3-103 的 settings 直答通道零新增 wire，
 * 段级整体替换语义下 UI 编辑后整段 patch）；本模块只落库操作与变量
 * 纯函数，持久化在 settings 面不复述。
 *
 * 与 I8 persona 的分界（卡面记档）：I8 是系统级 agent 人格预设（装配面），
 * 本库是用户自建模板（用户内容面）——两者不共用存储也不共用调用链。
 *
 * 变量语法（卡面风险条：`{{var}}` 单一约定——YAGNI 记档）：正则提取
 * `{{...}}` 内的非空白 token 作为变量名；renderTemplate 缺变量的占位符
 * 保留原文（不虚构值、不抛错——UI 提示手改）。
 */

import type { PromptEntry } from "./settings.js";

/** 坏条目（空名/空白正文——UI 表单 required 的纯函数兜底面）。 */
export class PromptLibraryError extends Error {
  override readonly name = "PromptLibraryError";
  readonly code = "PROMPT_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "PromptLibraryError";
  }
}

/**
 * 新增或更新模板（同名 = 原位替换保序；新名 = 追加队尾）。
 * name/content 非空白串——空白模板是坏条目（UI 表单 required 同款语义）。
 */
export function upsertPrompt(
  prompts: readonly PromptEntry[],
  entry: { name: string; content: string; description?: string },
): PromptEntry[] {
  if (entry.name.trim() === "") {
    throw new PromptLibraryError("模板名不可为空（库内唯一——斜杠调用的标识面）");
  }
  if (entry.content.trim() === "") {
    throw new PromptLibraryError("模板正文不可为空");
  }
  const next: PromptEntry = {
    name: entry.name,
    content: entry.content,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
  };
  const idx = prompts.findIndex((p) => p.name === entry.name);
  if (idx === -1) return [...prompts, next];
  return prompts.map((p, i) => (i === idx ? next : p));
}

/** 按名删除（幂等——不存在返回原数组）。 */
export function deletePrompt(prompts: readonly PromptEntry[], name: string): PromptEntry[] {
  const idx = prompts.findIndex((p) => p.name === name);
  if (idx === -1) return [...prompts];
  return [...prompts.slice(0, idx), ...prompts.slice(idx + 1)];
}

/** `{{var}}` 变量提取（去重保序；`{{`/`}}` 间空白串不算变量）。 */
export function extractTemplateVars(content: string): string[] {
  const vars: string[] = [];
  for (const m of content.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)) {
    const name = m[1];
    if (name !== undefined && !vars.includes(name)) vars.push(name);
  }
  return vars;
}

/** 变量填充：命中替换、缺变量保留 `{{var}}` 原文（不虚构不抛错——UI 提示手改）。 */
export function renderTemplate(content: string, vars: Record<string, string>): string {
  return content.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (whole, name?: string) => {
    if (name === undefined) return whole;
    const v = vars[name];
    return v !== undefined ? v : whole;
  });
}
