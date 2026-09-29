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
import {
  loadSkillsFromRoots,
  skillBody,
  SKILL_FILENAME,
  SKILLS_DIR,
} from "../kernel/skills.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  instructionPaths,
  listInstructions,
  saveInstruction,
  type InstructionTarget,
} from "./instructions-gateway.js";
import {
  applyImportedSettings,
  backupSettingsFile,
  summarizePackage,
} from "../session/settings-transfer.js";
import {
  subagentCatalog,
  type SubagentDefinition,
} from "../session/subagents-config.js";
import type { McpToolInfo } from "../mcp/client.js";

/** U22/T-P3-125 技能正文字节上限（pi-desktop·SkillEditorSheet MAX_SKILL_BYTES 同值）。 */
export const MAX_SKILL_BODY_BYTES = 128 * 1024;

/** 读 SKILL.md 并剥 frontmatter（skills-list 的编辑器回填面——读失败回空串）。 */
function readSkillBody(filePath: string): string {
  try {
    return skillBody(readFileSync(filePath, "utf8"));
  } catch {
    return "";
  }
}

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
  "enhancement",
  "profiles",
  "activeProfile",
  "onboardingDone",
  "defaultProvider",
  "defaultModel",
  "skills",
  "subagents",
  "shortcuts",
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
  /** U20/T-P3-122：配置包导入（备份滚动 + 本地态合并 + 落盘）。 */
  importSettings(imported: Record<string, unknown>): Promise<{ applied: true; summary: string[] }>;
  /**
   * U22/T-P3-125：技能清单（多根扫描——workspace 主目录 + skills.roots
   * 附加来源；disabled 停用过滤与装配面同链）。技能目录不可用（无
   * workspaceRoot）时类型化拒绝。
   */
  skillsList(): Promise<{
    skills: {
      name: string;
      description: string;
      tools?: readonly string[];
      filePath: string;
      origin: string;
      /** 技能正文（frontmatter 之后——编辑器回填面；清单同屏编辑用）。 */
      body: string;
    }[];
    diagnostics: { code: string; message: string; path: string }[];
    roots: string[];
    disabled: string[];
  }>;
  /**
   * U22/T-P3-125：技能编辑器写回（新建/编辑——写 workspace 技能目录的
   * SKILL.md；name slug 与字节上限在此层校验，编辑覆盖既有技能）。
   */
  skillSave(payload: {
    name: string;
    description: string;
    body: string;
    tools?: readonly string[];
  }): Promise<{ saved: true; path: string }>;
  /**
   * U23/T-P3-126：子代理管理页清单（内置五预设 + 用户自定义分区——
   * 覆盖记录折叠进内置行；每项带工具集/模型/fallbacks 的 chips 数据面）。
   */
  subagentsList(): Promise<{
    builtins: (SubagentDefinition & { enabled: boolean; overridden: boolean })[];
    custom: SubagentDefinition[];
  }>;
  /**
   * U24/T-P3-127：指令中心数据面（三文件位——workspace AGENTS.md /
   * 全局 ~/.aegent/AGENTS.md / 用户规则 ~/.aegent/rules.txt；各带存在性
   * 与内容；规则位附 lint issues——parseRulesText 逐行校验）。
   */
  instructionsList(): Promise<{
    project: { path: string; exists: boolean; content: string };
    global: { path: string; exists: boolean; content: string };
    rules: { path: string; exists: boolean; content: string; issues: { line: number; message: string }[] };
  }>;
  /**
   * U24/T-P3-127：指令文件写回（target 白名单三位——host 侧路径收敛，
   * 防任意文件写；保存确认面在 UI 层）。
   */
  instructionSave(target: "project-agents" | "global-agents" | "user-rules", content: string): Promise<{ saved: true; path: string }>;
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
    /**
     * U22/T-P3-125：技能目录根（workspace 主目录——skills-list 扫描与
     * skill-save 写入的根；缺省 undefined = 技能管理面不可用）。
     */
    private readonly workspaceRoot?: string,
    /**
     * U24/T-P3-127：home 目录根（全局 AGENTS.md 与用户规则文件的定位——
     * 缺省 os.homedir()；测试注入临时目录）。
     */
    private readonly homeDir: string = homedir(),
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

  /**
   * U20/T-P3-122：导入（备份滚动 → 本地态合并 → 落盘）。确认在 UI 侧
   * （buildImportPreview 摘要 + 用户对话框）；本面只做最终校验与落盘。
   */
  async importSettings(
    imported: Record<string, unknown>,
  ): Promise<{ applied: true; summary: string[] }> {
    const current = await this.get();
    backupSettingsFile(this.settingsPath);
    const merged = applyImportedSettings(current, parseSettingsShape(imported));
    await saveSettings(this.settingsPath, merged);
    return { applied: true, summary: summarizePackage(merged) };
  }

  /** 类型化拒绝的辅助（错误消息有界在 protocol 层——此处原文即回执）。 */
  private skillsUnavailable(): never {
    const error = new Error("host 未配置 workspace，技能管理面不可用");
    (error as unknown as { code: string }).code = "SKILLS_UNAVAILABLE";
    throw error;
  }

  async skillsList(): Promise<{
    skills: {
      name: string;
      description: string;
      tools?: readonly string[];
      filePath: string;
      origin: string;
      body: string;
    }[];
    diagnostics: { code: string; message: string; path: string }[];
    roots: string[];
    disabled: string[];
  }> {
    if (this.workspaceRoot === undefined) this.skillsUnavailable();
    const settings = await this.get();
    const disabled = settings.skills?.disabled ?? [];
    const result = loadSkillsFromRoots(this.workspaceRoot!, settings.skills?.roots, {
      disabled,
    });
    return {
      skills: result.skills.map((s) => ({
        name: s.name,
        description: s.description,
        ...(s.tools !== undefined ? { tools: s.tools } : {}),
        filePath: s.filePath,
        origin: s.origin ?? "",
        // 正文随清单回（编辑器回填——技能清单量小，逐文件读成本可忽略；
        // 读失败如实回空串不虚构——编辑保存会整体覆盖，无注入面）
        body: readSkillBody(s.filePath),
      })),
      diagnostics: result.diagnostics,
      roots: result.roots,
      disabled: [...disabled],
    };
  }

  async skillSave(payload: {
    name: string;
    description: string;
    body: string;
    tools?: readonly string[];
  }): Promise<{ saved: true; path: string }> {
    if (this.workspaceRoot === undefined) this.skillsUnavailable();
    // 双重防线（parse 层已校验 slug——此处防内部绕行调用）：目录名安全 +
    // 正文字节上限（128KB——超大正文不是技能是数据，fail-closed）。
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(payload.name) || payload.name.includes("..")) {
      const error = new Error(`技能名须为 slug 形状：${payload.name}`);
      (error as unknown as { code: string }).code = "SKILL_BAD_NAME";
      throw error;
    }
    const bodyBytes = Buffer.byteLength(payload.body, "utf8");
    if (bodyBytes > MAX_SKILL_BODY_BYTES) {
      const error = new Error(`技能正文超限：${bodyBytes} 字节（上限 ${MAX_SKILL_BODY_BYTES}）`);
      (error as unknown as { code: string }).code = "SKILL_BODY_TOO_LARGE";
      throw error;
    }
    // frontmatter 组装（name/description/tools 与正文——I2 目录纪律：有
    // SKILL.md 的目录即技能；编辑 = 同名覆盖，新建 = 建目录）。
    const frontmatter = [
      "---",
      `name: ${payload.name}`,
      `description: ${payload.description.replace(/\r?\n/g, " ")}`,
      ...(payload.tools !== undefined && payload.tools.length > 0 ? [`tools: ${payload.tools.join(", ")}`] : []),
      "---",
      "",
      "",
    ].join("\n");
    const dir = path.join(this.workspaceRoot!, SKILLS_DIR, payload.name);
    const target = path.join(dir, SKILL_FILENAME);
    await mkdir(dir, { recursive: true });
    const tmp = `${target}.tmp`;
    await writeFile(tmp, `${frontmatter}${payload.body}\n`, "utf8");
    await rename(tmp, target);
    return { saved: true, path: target };
  }

  async subagentsList(): Promise<{
    builtins: (SubagentDefinition & { enabled: boolean; overridden: boolean })[];
    custom: SubagentDefinition[];
  }> {
    const settings = await this.get();
    return subagentCatalog(settings.subagents);
  }

  async instructionsList(): Promise<ReturnType<typeof listInstructions>> {
    return listInstructions(instructionPaths(this.workspaceRoot, this.homeDir));
  }

  async instructionSave(
    target: InstructionTarget,
    content: string,
  ): Promise<{ saved: true; path: string }> {
    if (target === "project-agents" && this.workspaceRoot === undefined) this.skillsUnavailable();
    return saveInstruction(instructionPaths(this.workspaceRoot, this.homeDir), target, content);
  }
}
