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
  type McpServerEntry,
  type SettingsShape,
} from "../session/settings.js";
import { maskToken } from "../models/oauth.js";
import { probeProvider, type HealthCheckResult } from "../models/health.js";
import type { CredentialStore } from "../session/credentials.js";
import type { SqliteEventStorage } from "../session/db.js";
import { probeServer } from "../mcp/registry-bridge.js";
import type { McpToolInfo } from "../mcp/client.js";

/** settings patch 白名单段（提段整体替换；version 不许 patch——迁移链单向门）。 */
export const SETTINGS_PATCH_SECTIONS = [
  "providers",
  "permission",
  "sandbox",
  "appearance",
  "logging",
  "projects",
  "activeProject",
  "pricing",
  "prompts",
  "mcp",
  "onboardingDone",
  "defaultProvider",
  "defaultModel",
] as const;

/** U17/T-P3-119 连接校验回执（向导"测连接"——launch 一次握手+列工具后关闭）。 */
export interface McpCheckResult {
  readonly ok: boolean;
  readonly protocolVersion?: string;
  readonly tools?: McpToolInfo[];
  readonly error?: { code: string; message: string };
}

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
  /**
   * 健康探测（U5/T-P3-104——J16 probeProvider 的 UI 消费面）：按条目名
   * 探测其 baseUrl 可达性；探测不触碰熔断器（J16 分域不变量）。
   */
  probeProvider(name: string): Promise<HealthCheckResult>;
  /** U3/T-P3-105：会话删除（硬删除三表事务；库未配置时类型化拒绝）。 */
  sessionDelete(sessionId: string): Promise<{ deleted: boolean }>;
  /**
   * U17/T-P3-119：MCP server 连接校验（launch 一次握手 + tools/list 后
   * 关闭——向导"测连接"数据面；失败转类型化回执不上抛）。
   */
  mcpCheck(entry: McpServerEntry): Promise<McpCheckResult>;
}

/** 生产缺省探测依赖（真网络——tests 注入 fake）。 */
function defaultHealthProbe(): (name: string, baseUrl: string) => Promise<HealthCheckResult> {
  return (name, baseUrl) => probeProvider({ provider: name, baseUrl });
}

/** 生产实现：settings.json 真文件 + credentials.bin 凭据库 + J16 健康探测。 */
export class FileSettingsGateway implements SettingsGateway {
  constructor(
    private readonly settingsPath: string,
    private readonly credentials: CredentialStore,
    private readonly healthProbe: (name: string, baseUrl: string) => Promise<HealthCheckResult> = defaultHealthProbe(),
    /** U3：会话删除的目标库（host 的 SQLite 事件库——未配置 = 删除面不可用）。 */
    private readonly sessionDb?: SqliteEventStorage,
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

  async probeProvider(name: string): Promise<HealthCheckResult> {
    const settings = await this.get();
    const entry = settings.providers.find((p) => p.name === name);
    if (entry === undefined) {
      const error = new Error(`provider「${name}」不在配置中`);
      (error as unknown as { code: string }).code = "PROVIDER_NOT_FOUND";
      throw error;
    }
    if (entry.baseUrl === undefined || entry.baseUrl.trim() === "") {
      const error = new Error(`provider「${name}」未配置 baseUrl，无法探测`);
      (error as unknown as { code: string }).code = "PROVIDER_NO_BASE_URL";
      throw error;
    }
    return this.healthProbe(name, entry.baseUrl);
  }

  async sessionDelete(sessionId: string): Promise<{ deleted: boolean }> {
    if (this.sessionDb === undefined) {
      const error = new Error("host 未配置 SQLite 事件库，会话删除不可用");
      (error as unknown as { code: string }).code = "SESSION_DB_UNAVAILABLE";
      throw error;
    }
    return { deleted: this.sessionDb.deleteSession(sessionId) };
  }

  async mcpCheck(entry: McpServerEntry): Promise<McpCheckResult> {
    try {
      const r = await probeServer(entry, { requestTimeoutMs: 8_000 });
      return { ok: true, protocolVersion: r.protocolVersion, tools: r.tools };
    } catch (e) {
      return {
        ok: false,
        error: {
          code: "MCP_CHECK_FAILED",
          message: e instanceof Error ? e.message : String(e),
        },
      };
    }
  }
}
