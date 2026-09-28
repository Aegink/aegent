/**
 * settings 直答网关（U14/T-P3-103）——wire settings 信封的 host 侧实现：
 * 配置读（get）/段级补丁写（update，即改即存的文件面）/凭据管理（U2 的
 * credentials.bin）。全部走 session 域的 settings/credentials 模块——
 * "分节与 settings 模块一一对应"的对应点，配置面不落两次。
 *
 * 快照即规格（U14 验收）：UI 改 → update 落文件 → 重启 loadSettings 生效
 * （server.test 以真临时文件断言这一条链）。
 */

import {
  loadSettings,
  parseSettingsShape,
  saveSettings,
  type SettingsShape,
} from "../session/settings.js";
import { maskToken } from "../models/oauth.js";
import type { CredentialStore } from "../session/credentials.js";

/** settings patch 白名单段（提段整体替换；version 不许 patch——迁移链单向门）。 */
export const SETTINGS_PATCH_SECTIONS = [
  "providers",
  "permission",
  "sandbox",
  "appearance",
  "defaultProvider",
  "defaultModel",
] as const;

/** 段级补丁合并（UI 发整段——providers 数组整体替换、对象段整体替换）。 */
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
  // 合并后整体验证（fail-closed——坏段拒绝且不落盘）
  return parseSettingsShape(merged);
}

export interface SettingsGateway {
  get(): Promise<SettingsShape>;
  update(patch: Record<string, unknown>): Promise<SettingsShape>;
  /** 凭据面（list/get 只回掩码——明文永不出现信封回执里）。 */
  credentialsSet(provider: string, key: string): Promise<{ masked: string }>;
  credentialsDelete(provider: string): Promise<{ deleted: boolean }>;
  credentialsList(): Promise<{ name: string; updatedAt: string; masked?: string }[]>;
}

/** 生产实现：settings.json 真文件 + credentials.bin 凭据库。 */
export class FileSettingsGateway implements SettingsGateway {
  constructor(
    private readonly settingsPath: string,
    private readonly credentials: CredentialStore,
  ) {}

  async get(): Promise<SettingsShape> {
    return (await loadSettings(this.settingsPath)).settings;
  }

  async update(patch: Record<string, unknown>): Promise<SettingsShape> {
    const merged = applySettingsPatch(await this.get(), patch);
    await saveSettings(this.settingsPath, merged);
    return merged;
  }

  async credentialsSet(provider: string, key: string): Promise<{ masked: string }> {
    await this.credentials.setKey(provider, key);
    return { masked: maskToken(key) };
  }

  async credentialsDelete(provider: string): Promise<{ deleted: boolean }> {
    return { deleted: await this.credentials.deleteKey(provider) };
  }

  async credentialsList(): Promise<{ name: string; updatedAt: string; masked?: string }[]> {
    const metas = await this.credentials.listKeys();
    const out: { name: string; updatedAt: string; masked?: string }[] = [];
    for (const meta of metas) {
      const key = await this.credentials.getKey(meta.name);
      out.push({ ...meta, ...(key !== undefined ? { masked: maskToken(key) } : {}) });
    }
    return out;
  }
}
