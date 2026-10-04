/**
 * settings 段级补丁语义（T-P3-153——settings-gateway 行数纪律拆分位）：
 * 白名单段闭集 + 合并后整体验证（fail-closed）。
 */

import { parseSettingsShape, type SettingsShape } from "../session/settings.js";

export const SETTINGS_PATCH_SECTIONS = [
  "providers", "permission", "sandbox", "appearance", "logging", "projects",
  "activeProject", "pricing", "prompts", "mcp", "enhancement", "profiles",
  "activeProfile", "onboardingDone", "defaultProvider", "defaultModel", "chat",
  "skills", "subagents", "shortcuts", "stt", "tts", "plugins",
] as const;

export function applySettingsPatch(current: SettingsShape, patch: Record<string, unknown>): SettingsShape {
  const merged: Record<string, unknown> = { ...current };
  for (const section of Object.keys(patch)) {
    if (!(SETTINGS_PATCH_SECTIONS as readonly string[]).includes(section)) {
      const error = new Error(`settings patch 未知段 "${section}"`);
      (error as unknown as { code: string }).code = "SETTINGS_PATCH_SECTION_UNKNOWN";
      throw error;
    }
    merged[section] = patch[section];
  }
  return parseSettingsShape(merged); // 合并后整体验证（fail-closed）
}
