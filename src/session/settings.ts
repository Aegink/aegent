/**
 * settings 持久化（U1/T-P3-101，cc-switch·config.rs 的单应用同构）——
 * 产品化配置面：provider 列表、默认 provider/model、权限档、沙箱档、外观。
 *
 * 行为取 cc-switch（配置分层 + 损坏 fail-closed + 迁移版本号）；不取其 Rust
 * 结构与多应用切换语义（我方单应用）。三入口（CLI/host/桌面壳——壳经 host）
 * 共用本模块与 resolveChildLaunchArgv，配置面不落两次。
 *
 * 优先级链（U1 验收①）：CLI 显式参数 > 环境变量（AEGENT_*，agent-child
 * parseArgs 的既有 env 回退）> 配置文件（本模块）> 缺省值。落法：父进程只把
 * **配置文件档**翻译成 childArgs 注入（且仅在显式参数与环境变量都缺位的槽
 * ——显式参数已在 childArgs 不重复；env 在子进程内 argv 覆盖 env 的顺序下
 * 自然胜出，故父进程遇 env 提供的槽跳过注入），子进程内最终顺序 =
 * argv（显式+file 注入）> env > 缺省。
 *
 * 损坏 fail-closed（U1 验收②）：JSON 语法错 → SettingsError 带 1-based
 * 行列号 + 修复指引；已知字段类型错同理。未知顶层键宽容忽略（前向兼容——
 * 迁移链 v1 起步，新增字段向后兼容；cc-switch serde 缺省同语义）。
 *
 * 零明文纪律：settings.json 永不承载 apiKey——凭据走 U2 凭据模块独立存储。
 */

import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { locateJsonError } from "../models/config.js";
import { SANDBOX_MODES, type SandboxMode } from "../sandbox/backend.js";
import { isValidSubagentSlug, type SubagentDefinition } from "./subagents-config.js";

// ---------------------------------------------------------------------------
// 形状（v1）
// ---------------------------------------------------------------------------

/** 适配协议闭集（T-P3-137——pi-desktop apiStyle 对齐：chat_completions /
 *  responses = OpenAI 双端点；anthropic_messages / google_generative_ai。
 *  会话装配面：openai* → openai-compat〔responses 回退 chat 端点——官方与
 *  主流网关双端点并存，记档〕；anthropic → anthropic-messages；google →
 *  google-generate（streamGenerateContent SSE 全实现）。 */
export const PROVIDER_ADAPTERS = ["openai", "openai-responses", "anthropic", "google"] as const;
export type ProviderAdapter = (typeof PROVIDER_ADAPTERS)[number];

/** 思考档位闭集（T-P3-137 三轮——pi-desktop ThinkingLevel 同集；目录
 *  reasoning_options 归一与高级面板胶囊共用；reasoning 字段默认档从这里取）。 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** 权限模式五档（T-P3-137 八轮 A——参考 agentscope 五档/pi-desktop 全局+会话
 *  双层/kimi 三档归一）：ask=每次询问（默认）；accept-edits=编辑类工具自动
 *  放行；read-only=只读（写类拒绝）；auto=全自动（仍拦 deny 规则与内置
 *  保护）；unattended=无人值守（ask 转 deny——C33 同语义）。会话内切换经
 *  config/refresh 通道（session-config.ts 模式目录成套写 knob）。 */
export const PERMISSION_MODES = [
  "ask",
  "accept-edits",
  "read-only",
  "auto",
  "unattended",
] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** 会话装配映射（适配实现选择——wire 身份收敛：responses 回退 openai）。 */
export function adapterForAssembly(
  adapter: ProviderAdapter,
): "openai" | "anthropic" | "google" {
  return adapter === "anthropic" ? "anthropic" : adapter === "google" ? "google" : "openai";
}

/**
 * 单模型规格（T-P3-137 · pi-desktop ModelBinding 行为锚的最小集）：
 * 模型级协议覆盖（同站混合协议——有的模型 openai、有的 anthropic）+
 * 别名/上下文窗口/最大输出/思考等级/实测标记（provider-test 真实发"你好"
 * 成功后写 true——"成功才算可以使用"）。
 */
export interface ProviderModelSpec {
  /** 模型 ID（请求 wire 的 model 字段；条目内唯一）。 */
  id: string;
  /** 模型级协议覆盖（缺省 = 条目 adapter）。 */
  adapter?: ProviderAdapter;
  alias?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  /**
   * 默认思考档（T-P3-137 三轮真实消费：openai-compat → reasoning_effort、
   * anthropic → thinking.budget_tokens、google → thinkingConfig.thinkingBudget；
   * off/缺省 = 请求不带思考参数）。
   */
  reasoning?: string;
  /** 该模型支持的思考档位（内置目录填充——高级面板胶囊选项面；缺省 = 全档可手选）。 */
  thinkingLevels?: string[];
  /** 附件能力·图片输入（内置目录填充可手改）。 */
  imageInput?: boolean;
  /** 附件能力·PDF 输入（内置目录填充可手改）。 */
  pdfInput?: boolean;
  /** 可供 AI 自动调度（子智能体委派选模——消费随子智能体装配面，记档）。 */
  forSubagents?: boolean;
  /**
   * 原生联网搜索（anthropic 形态真实附 web_search server 工具；
   * openai chat 端点无此能力——UI 校验禁勾 + 记档）。
   */
  webSearch?: boolean;
  verified?: boolean;
}

export interface ProviderEntry {
  /** 供应商名（人读标识；defaultProvider 与 U2 凭据键都指它）。 */
  name: string;
  /** 适配层（J3 不透明配置的解释方——缺省 openai 兼容；模型级可覆盖）。 */
  adapter?: ProviderAdapter;
  baseUrl?: string;
  model?: string;
  /** 启停（缺省 true——装配跳过停用条目；停用保留在清单，开关是开回的路径）。 */
  enabled?: boolean;
  /**
   * 服务级自定义请求头（T-P3-137——开源网关 Referer/Title 类）。保留键
   * （authorization/x-api-key/content-type/host/cookie/anthropic-version/
   * content-length）在 parse 时剔除——鉴权面不旁路（pi-desktop 同款语义）。
   */
  headers?: Record<string, string>;
  /**
   * 多模型清单（T-P3-137 新形态——pi-desktop「AI 服务」语义：一个服务多
   * 个模型，协议按模型覆盖）。缺省 = 旧单模型条目（entry.model）零兼容成本。
   */
  models?: ProviderModelSpec[];
}

/** 项目档（U11/T-P3-110——workspace + 项目级指令的组合档）。 */
export interface ProjectEntry {
  /** 项目名（人读标识；activeProject 指它）。 */
  name: string;
  /** workspace 根目录（新会话 --workspace 的取值）。 */
  workspace: string;
  /** 项目级指令（随会话的提示面；运行时注入随 U24 指令中心对齐）。 */
  instructions?: string;
}

/**
 * 插件装载条目（T-P3-133——pi-desktop InstalledPluginsPanel 行为锚的
 * 配置面投影）：transport 二选一——inprocess（子进程内 import 入口模块，
 * manifest 走 I9 安装期校验）或 ws（进程外插件 URL，I4 trust 恒 untrusted）。
 * 启停语义：停用条目保留在清单（enabledHandles——开关是开回的路径）。
 */
export interface PluginEntry {
  /** 插件名（清单内唯一；inprocess 须与 plugin.json 的 name 一致）。 */
  name: string;
  /** 传输面（缺省 inprocess——I5 SDK 直载；ws = I4 进程外隔离）。 */
  transport?: "inprocess" | "ws";
  /** 装载源：inprocess = 插件目录绝对路径（含 plugin.json）；ws = ws:// URL。 */
  source: string;
  /**
   * ws 插件工具登记开关（onToolRegistration 的装配消费——"不受信来源默认
   * deny，显式例外是策略面"；缺省 false = 工具不登记仅连接）。
   */
  allowTools?: boolean;
  /** 启停开关（缺省 true；停用保留清单）。 */
  enabled?: boolean;
}

/** 价格表条目（U12/T-P3-111——obs/cost.ts ModelPricing 的配置面形状；表驱动计价无内置价格）。 */
export interface PricingEntry {
  provider: string;
  modelId: string;
  inputPerMTok: number;
  cachedInputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok?: number;
}

/** 提示词模板条目（U16/T-P3-118——用户自建模板库；与 I8 persona 系统预设分界：这是用户内容面）。 */
export interface PromptEntry {
  /** 模板名（斜杠调用与库列表的标识——库内唯一）。 */
  name: string;
  /** 模板正文（`{{var}}` 占位符单一约定——变量面见 session/prompt-library.ts）。 */
  content: string;
  description?: string;
}

/** MCP server 条目（U17/T-P3-119——向导落档；装配消费在 agent-child）。 */
export interface McpServerEntry {
  /** server 名（工具名命名空间前缀——须非空且不含 "__"，registry-bridge 同规则）。 */
  name: string;
  /** stdio 启动命令与参数（HTTP/SSE transport 随 mcp 域扩展——I3 LIMITATIONS）。 */
  command: string;
  args?: string[];
  /** 启停开关（false = 装配跳过；缺省 true）。 */
  enabled?: boolean;
}

/**
 * 辅助任务模型条目（U18/T-P3-120——判官/摘要等增强任务与主对话模型分离，
 * pi-desktop·EnhancementModelCard / ADR 0121 行为锚）。provider 引用
 * providers 条目名（不裸写 baseUrl——凭据按条目名走 credentials 面）。
 */
export interface EnhancementModelEntry {
  /** providers 条目名（该条目的 adapter/baseUrl/凭据构造辅助模型面）。 */
  provider: string;
  /** 辅助任务模型 id（缺省回退 = 条目 model → defaultModel——主模型链）。 */
  model?: string;
  /** reasoning 档位（配置面记录——适配层 reasoning 请求面扩展后消费，记档）。 */
  reasoning?: "minimal" | "low" | "medium" | "high";
}

/**
 * 技能管理配置（U22/T-P3-125——I2 技能目录的管理面）：disabled = 停用名单
 * （装配消费——"启用开关"）；roots = 附加来源目录（多根扫描——RepoManager
 * 形态的本地化：管理本地目录清单而非 git 仓库，技能市场真实渠道不建）。
 */
export interface SkillsConfig {
  /** 停用技能名集合（loadSkills 的 disabled 过滤——新会话生效）。 */
  disabled?: string[];
  /** 附加技能来源目录（绝对路径；workspace 主目录恒在——数组序即扫描序）。 */
  roots?: string[];
}

export interface SettingsShape {
  version: 1;
  providers: ProviderEntry[];
  defaultProvider?: string;
  defaultModel?: string;
  /** 权限档（现有装配面词汇——approvalTimeoutMs 是 C 族审批上界；mode 是
   * T-P3-137 八轮权限模式五档——全局默认，会话内可经 config/refresh 切换）。 */
  permission?: {
    approvalTimeoutMs?: number;
    mode?: PermissionMode;
  };
  /**
   * 沙箱档（B8a 网络档 + workspace/事件库落位）。T-P3-140 批次 A：mode =
   * 沙箱三档（read-only / workspace-write / danger-full-access——闭集见
   * sandbox/backend.ts SANDBOX_MODES；缺省 = 全自动直通）；writeWhitelist
   * = 工作区外显式写白名单（PathGuard writeWhitelist 装配透传）。
   */
  sandbox?: {
    network?: "allow" | "deny";
    mode?: import("../sandbox/backend.js").SandboxMode;
    writeWhitelist?: readonly string[];
    workspace?: string;
    db?: string;
  };
  /** 外观（U14 主题全端一致暗/亮；语言 zh-CN 缺省）。 */
  appearance?: { theme?: "dark" | "light"; language?: "zh-CN" | "en" };
  /** 日志（U14/T-P3-132 #28 补落——E14 原始分片日志目录的持久化位；空 = 缺省不写）。 */
  logging?: { rawLogDir?: string };
  /** 项目档（U11——多项目列表；activeProject 生效语义 = 新会话启动）。 */
  projects?: ProjectEntry[];
  activeProject?: string;
  /** 价格表（U12——成本统计的计价来源；缺省无 = 成本如实缺席不虚构）。 */
  pricing?: PricingEntry[];
  /** 提示词模板库（U16——用户自建/编辑/删除；Composer / 补全调用）。 */
  prompts?: PromptEntry[];
  /** 技能管理（U22——停用名单 + 附加来源目录；装配消费见 kernel/skills.ts）。 */
  skills?: SkillsConfig;
  /** 子代理自定义（U23——同名覆盖内置预设；解析面见 session/subagents-config.ts）。 */
  subagents?: SubagentDefinition[];
  /** 快捷键覆盖（U25——action → 组合键规范串；部分覆盖语义，解析面见 ui/keymap.js）。 */
  shortcuts?: Record<string, string>;
  /**
   * 插件管理（T-P3-133——I4/I5/I9 的管理面延伸）：装载清单 + 启停。
   * inprocess 条目 = 插件目录（plugin.json 清单 + index.js 入口）；
   * ws 条目 = 进程外插件 URL（I4——trust 恒 untrusted）。
   */
  plugins?: PluginEntry[];
  /**
   * 语音转文字（U26/T-P3-129 实验性——OpenAI 协议端点复用，P4 消费端）。
   * key 零明文：凭据在 credentials 库以 provider 名 "stt" 录入（U2 面复用）。
   */
  stt?: {
    /** OpenAI 协议兼容端点根（如 https://api.openai.com/v1）。 */
    baseUrl: string;
    /** 转写模型名（如 whisper-1——provider 侧语义）。 */
    model: string;
    /** 语言提示（BCP-47 可选，如 zh）。 */
    language?: string;
  };
  /** MCP server 清单（U17——向导式添加落档；装配期连接注册，单 server 失败不炸启动）。 */
  mcp?: McpServerEntry[];
  /** 辅助任务模型（U18——judge/summarizer 独立配置；缺省回退主模型链）。 */
  enhancement?: {
    judge?: EnhancementModelEntry;
    summarizer?: EnhancementModelEntry;
  };
  /** Profiles 组合档（U19——命名场景快照；切换 = 批量写生效段）。 */
  profiles?: ProfileEntry[];
  /** 当前应用中的 Profile 名（UI 快速切换器标记——仅记录，不改变生效语义）。 */
  activeProfile?: string;
  /** 首跑引导（U13——引导清单完成标记；缺省 undefined = 未完成）。 */
  onboardingDone?: boolean;
}

/**
 * Profiles 组合档条目（U19/T-P3-121——provider+模型+权限档+沙箱档的命名
 * 组合；cc-switch·ProfileSwitcher 行为锚）。切换 = 批量写生效段（applyProfile
 * 产 patch——providers 清单不动）。
 */
export interface ProfileEntry {
  name: string;
  /** 切换后写入生效段的值（defaultProvider 必填——组合档的主锚）。 */
  defaultProvider: string;
  defaultModel?: string;
  permission?: { approvalTimeoutMs?: number };
  /** T-P3-140 批次 F：组合档带沙箱 mode（切换 = 批量写生效段，含 mode）。 */
  sandbox?: {
    network?: "allow" | "deny";
    mode?: import("../sandbox/backend.js").SandboxMode;
    writeWhitelist?: readonly string[];
    workspace?: string;
    db?: string;
  };
}

/** 缺省配置（无文件无环境也能启动——echo provider 最小装配）。 */
export function defaultSettings(): SettingsShape {
  return {
    version: 1,
    providers: [],
    permission: {},
    sandbox: {},
    appearance: { theme: "dark", language: "zh-CN" },
    logging: {},
    projects: [],
    prompts: [],
    mcp: [],
    profiles: [],
  };
}
export const SETTINGS_HINT =
  "修复指引：检查 settings.json 的 JSON 语法与字段类型；" +
  "若无法修复可删除该文件恢复缺省配置（凭据独立存储不受影响）";

/** 损坏配置的类型化拒绝（fail-closed——带行列号与修复指引）。 */
export class SettingsError extends Error {
  override readonly name = "SettingsError";
  readonly code = "SETTINGS_INVALID";
  readonly line?: number;
  readonly column?: number;
  constructor(message: string, pos?: { line: number; column: number }) {
    super(`${message}。${SETTINGS_HINT}`);
    this.name = "SettingsError";
    if (pos) {
      this.line = pos.line;
      this.column = pos.column;
    }
  }
}

// ---------------------------------------------------------------------------
// 解析与读写
// ---------------------------------------------------------------------------

function asPos(offset: number, text: string): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = (before.match(/\n/g) ?? []).length + 1;
  const lastNl = before.lastIndexOf("\n");
  return { line, column: offset - lastNl };
}

/** providers[].headers 的保留键（小写比对——鉴权与传输控制面不旁路；
 *  pi-desktop 剔除语义同源，anthropic-version 属协议控制同样剔除）。 */
const RESERVED_HEADER_KEYS = new Set([
  "authorization",
  "x-api-key",
  "host",
  "cookie",
  "content-type",
  "content-length",
  "accept-encoding",
  "anthropic-version",
]);

function assertString(value: unknown, where: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new SettingsError(`${where} 须为非空字符串`);
  }
  return value;
}

/** 严格校验已知字段（未知键宽容忽略——前向兼容）；合法即规范化返回。 */
export function parseSettingsShape(raw: unknown): SettingsShape {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SettingsError("settings.json 顶层必须是 JSON 对象");
  }
  const rec = raw as Record<string, unknown>;
  const version = rec["version"] ?? 1;
  if (version !== 1) {
    throw new SettingsError(`不支持的配置版本：${String(version)}（当前 1）`);
  }
  const out = defaultSettings();
  const providers = rec["providers"];
  if (providers !== undefined) {
    if (!Array.isArray(providers)) throw new SettingsError("providers 须为数组");
    for (const entry of providers) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new SettingsError("providers 条目必须是对象");
      }
      const e = entry as Record<string, unknown>;
      const name = assertString(e["name"], "providers[].name");
      if (name === undefined) throw new SettingsError("providers[].name 缺失");
      const adapter = e["adapter"];
      if (adapter !== undefined && (typeof adapter !== "string" || !(PROVIDER_ADAPTERS as readonly string[]).includes(adapter))) {
        throw new SettingsError(`providers[].adapter 非法：${String(adapter)}（合法：${PROVIDER_ADAPTERS.join("|")}）`);
      }
      const enabled = e["enabled"];
      if (enabled !== undefined && typeof enabled !== "boolean") {
        throw new SettingsError(`providers[].enabled 须为布尔：${name}`);
      }
      // T-P3-137：自定义请求头（扁平 string→string 对象；保留键剔除——鉴权面不旁路）
      let headers: Record<string, string> | undefined;
      const rawHeaders = e["headers"];
      if (rawHeaders !== undefined) {
        if (rawHeaders === null || typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) {
          throw new SettingsError(`providers[].headers 须为对象：${name}`);
        }
        headers = {};
        for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
          if (typeof v !== "string") throw new SettingsError(`providers[].headers.${k} 须为字符串`);
          if (RESERVED_HEADER_KEYS.has(k.toLowerCase())) continue;
          headers[k] = v;
        }
      }
      // T-P3-137：多模型清单（id 必填非空；数值字段正整数；adapter 模型级枚举）
      let models: ProviderModelSpec[] | undefined;
      const rawModels = e["models"];
      if (rawModels !== undefined) {
        if (!Array.isArray(rawModels)) throw new SettingsError(`providers[].models 须为数组：${name}`);
        models = [];
        for (const m of rawModels) {
          if (m === null || typeof m !== "object" || Array.isArray(m)) {
            throw new SettingsError(`providers[].models[] 须为对象：${name}`);
          }
          const spec = m as Record<string, unknown>;
          const id = spec["id"];
          if (typeof id !== "string" || id.trim() === "") {
            throw new SettingsError(`providers[].models[].id 缺失：${name}`);
          }
          const specAdapter = spec["adapter"];
          if (specAdapter !== undefined && (typeof specAdapter !== "string" || !(PROVIDER_ADAPTERS as readonly string[]).includes(specAdapter))) {
            throw new SettingsError(`providers[].models[].adapter 非法：${name}/${id}`);
          }
          const contextWindow = spec["contextWindow"];
          const maxOutputTokens = spec["maxOutputTokens"];
          for (const [field, value] of [["contextWindow", contextWindow], ["maxOutputTokens", maxOutputTokens]] as const) {
            if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value <= 0)) {
              throw new SettingsError(`providers[].models[].${field} 须为正整数：${name}/${id}`);
            }
          }
          const ctx = typeof contextWindow === "number" ? contextWindow : undefined;
          const maxOut = typeof maxOutputTokens === "number" ? maxOutputTokens : undefined;
          const reasoning = spec["reasoning"];
          if (reasoning !== undefined && (typeof reasoning !== "string" || !(THINKING_LEVELS as readonly string[]).includes(reasoning))) {
            throw new SettingsError(`providers[].models[].reasoning 非法：${name}/${id}（合法：${THINKING_LEVELS.join("|")}）`);
          }
          const thinkingLevels = spec["thinkingLevels"];
          if (thinkingLevels !== undefined) {
            if (!Array.isArray(thinkingLevels) || thinkingLevels.some((l) => typeof l !== "string" || !(THINKING_LEVELS as readonly string[]).includes(l))) {
              throw new SettingsError(`providers[].models[].thinkingLevels 须为档位数组：${name}/${id}（合法：${THINKING_LEVELS.join("|")}）`);
            }
          }
          for (const flag of ["imageInput", "pdfInput", "forSubagents", "webSearch"] as const) {
            if (spec[flag] !== undefined && typeof spec[flag] !== "boolean") {
              throw new SettingsError(`providers[].models[].${flag} 须为布尔：${name}/${id}`);
            }
          }
          if (spec["verified"] !== undefined && typeof spec["verified"] !== "boolean") {
            throw new SettingsError(`providers[].models[].verified 须为布尔：${name}/${id}`);
          }
          models.push({
            id,
            ...(specAdapter !== undefined ? { adapter: specAdapter as ProviderAdapter } : {}),
            ...(assertString(spec["alias"], `providers[].models[].alias(${name}/${id})`) !== undefined
              ? { alias: spec["alias"] as string }
              : {}),
            ...(ctx !== undefined ? { contextWindow: ctx } : {}),
            ...(maxOut !== undefined ? { maxOutputTokens: maxOut } : {}),
            ...(reasoning !== undefined ? { reasoning: reasoning as string } : {}),
            ...(thinkingLevels !== undefined ? { thinkingLevels: thinkingLevels as string[] } : {}),
            ...(spec["imageInput"] !== undefined ? { imageInput: spec["imageInput"] as boolean } : {}),
            ...(spec["pdfInput"] !== undefined ? { pdfInput: spec["pdfInput"] as boolean } : {}),
            ...(spec["forSubagents"] !== undefined ? { forSubagents: spec["forSubagents"] as boolean } : {}),
            ...(spec["webSearch"] !== undefined ? { webSearch: spec["webSearch"] as boolean } : {}),
            ...(spec["verified"] !== undefined ? { verified: spec["verified"] as boolean } : {}),
          });
        }
      }
      out.providers.push({
        name,
        ...(adapter !== undefined ? { adapter: adapter as ProviderAdapter } : {}),
        ...(assertString(e["baseUrl"], "providers[].baseUrl") !== undefined
          ? { baseUrl: e["baseUrl"] as string }
          : {}),
        ...(assertString(e["model"], "providers[].model") !== undefined
          ? { model: e["model"] as string }
          : {}),
        ...(enabled !== undefined ? { enabled } : {}),
        ...(headers !== undefined ? { headers } : {}),
        ...(models !== undefined ? { models } : {}),
      });
    }
  }
  out.defaultProvider = assertString(rec["defaultProvider"], "defaultProvider");
  out.defaultModel = assertString(rec["defaultModel"], "defaultModel");
  const permission = rec["permission"];
  if (permission !== undefined) {
    if (permission === null || typeof permission !== "object") {
      throw new SettingsError("permission 须为对象");
    }
    const permRec = permission as Record<string, unknown>;
    const timeout = permRec["approvalTimeoutMs"];
    if (timeout !== undefined) {
      if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout <= 0) {
        throw new SettingsError("permission.approvalTimeoutMs 须为正整数");
      }
    }
    const mode = permRec["mode"];
    if (mode !== undefined && (typeof mode !== "string" || !(PERMISSION_MODES as readonly string[]).includes(mode))) {
      throw new SettingsError(`permission.mode 非法：${String(mode)}（合法：${PERMISSION_MODES.join("|")}）`);
    }
    out.permission = {
      ...(timeout !== undefined ? { approvalTimeoutMs: timeout } : {}),
      ...(mode !== undefined ? { mode: mode as PermissionMode } : {}),
    };
  }
  const sandbox = rec["sandbox"];
  if (sandbox !== undefined) {
    if (sandbox === null || typeof sandbox !== "object") throw new SettingsError("sandbox 须为对象");
    const s = sandbox as Record<string, unknown>;
    const network = s["network"];
    if (network !== undefined && network !== "allow" && network !== "deny") {
      throw new SettingsError(`sandbox.network 非法：${String(network)}（合法：allow|deny）`);
    }
    // T-P3-140 批次 A：沙箱模式闭集校验（SANDBOX_MODES 单一来源）；缺省
    // undefined = 全自动直通（装配侧语义，settings 面不设默认值）。
    const mode = s["mode"];
    if (mode !== undefined && !(SANDBOX_MODES as readonly string[]).includes(mode as string)) {
      throw new SettingsError(
        `sandbox.mode 非法：${String(mode)}（合法：${SANDBOX_MODES.join("|")}）`,
      );
    }
    // T-P3-140 批次 D：写白名单（非空字符串数组，去重保序——PathGuard
    // writeWhitelist 装配透传）。
    const whitelist = s["writeWhitelist"];
    if (whitelist !== undefined) {
      if (
        !Array.isArray(whitelist) ||
        whitelist.some((w) => typeof w !== "string" || w.trim() === "")
      ) {
        throw new SettingsError("sandbox.writeWhitelist 须为非空字符串数组");
      }
    }
    out.sandbox = {
      ...(network !== undefined ? { network: network as "allow" | "deny" } : {}),
      ...(mode !== undefined ? { mode: mode as SandboxMode } : {}),
      ...(whitelist !== undefined
        ? { writeWhitelist: [...new Set((whitelist as string[]).map((w) => w.trim()))] }
        : {}),
      ...(assertString(s["workspace"], "sandbox.workspace") !== undefined
        ? { workspace: s["workspace"] as string }
        : {}),
      ...(assertString(s["db"], "sandbox.db") !== undefined ? { db: s["db"] as string } : {}),
    };
  }
  const appearance = rec["appearance"];
  if (appearance !== undefined) {
    if (appearance === null || typeof appearance !== "object") {
      throw new SettingsError("appearance 须为对象");
    }
    const a = appearance as Record<string, unknown>;
    const theme = a["theme"];
    if (theme !== undefined && theme !== "dark" && theme !== "light") {
      throw new SettingsError(`appearance.theme 非法：${String(theme)}（合法：dark|light）`);
    }
    const language = a["language"];
    if (language !== undefined && language !== "zh-CN" && language !== "en") {
      throw new SettingsError(`appearance.language 非法：${String(language)}（合法：zh-CN|en）`);
    }
    out.appearance = {
      ...(theme !== undefined ? { theme: theme as "dark" | "light" } : {}),
      ...(language !== undefined ? { language: language as "zh-CN" | "en" } : {}),
    };
  }
  const logging = rec["logging"];
  if (logging !== undefined) {
    if (logging === null || typeof logging !== "object") {
      throw new SettingsError("logging 须为对象");
    }
    out.logging = {
      ...(assertString((logging as Record<string, unknown>)["rawLogDir"], "logging.rawLogDir") !== undefined
        ? { rawLogDir: (logging as Record<string, unknown>)["rawLogDir"] as string }
        : {}),
    };
  }
  const projects = rec["projects"];
  if (projects !== undefined) {
    if (!Array.isArray(projects)) throw new SettingsError("projects 须为数组");
    for (const entry of projects) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new SettingsError("projects 条目必须是对象");
      }
      const e = entry as Record<string, unknown>;
      const name = assertString(e["name"], "projects[].name");
      if (name === undefined) throw new SettingsError("projects[].name 缺失");
      const workspace = assertString(e["workspace"], "projects[].workspace");
      if (workspace === undefined) throw new SettingsError("projects[].workspace 缺失");
      out.projects!.push({
        name,
        workspace,
        ...(assertString(e["instructions"], "projects[].instructions") !== undefined
          ? { instructions: e["instructions"] as string }
          : {}),
      });
    }
  }
  out.activeProject = assertString(rec["activeProject"], "activeProject");
  const profiles = rec["profiles"];
  if (profiles !== undefined) {
    if (!Array.isArray(profiles)) throw new SettingsError("profiles 须为数组");
    const seen = new Set<string>();
    for (const entry of profiles) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new SettingsError("profiles 条目必须是对象");
      }
      const e = entry as Record<string, unknown>;
      const name = assertString(e["name"], "profiles[].name");
      if (name === undefined) throw new SettingsError("profiles[].name 缺失");
      if (seen.has(name)) throw new SettingsError(`profiles 档名重复：${name}`);
      seen.add(name);
      const defaultProvider = assertString(e["defaultProvider"], "profiles[].defaultProvider");
      if (defaultProvider === undefined) throw new SettingsError("profiles[].defaultProvider 缺失");
      const permission = e["permission"];
      if (permission !== undefined && (permission === null || typeof permission !== "object" || Array.isArray(permission))) {
        throw new SettingsError("profiles[].permission 须为对象");
      }
      const sandbox = e["sandbox"];
      if (sandbox !== undefined && (sandbox === null || typeof sandbox !== "object" || Array.isArray(sandbox))) {
        throw new SettingsError("profiles[].sandbox 须为对象");
      }
      // T-P3-140 批次 F：组合档沙箱段字段校验（mode 闭集 + writeWhitelist
      // 形状——与顶层 sandbox 段同一纪律；缺省字段宽容省略）。
      if (sandbox !== undefined) {
        const ps = sandbox as Record<string, unknown>;
        if (ps["mode"] !== undefined && !(SANDBOX_MODES as readonly string[]).includes(ps["mode"] as string)) {
          throw new SettingsError(
            `profiles[].sandbox.mode 非法：${String(ps["mode"])}（合法：${SANDBOX_MODES.join("|")}）`,
          );
        }
        if (
          ps["writeWhitelist"] !== undefined &&
          (!Array.isArray(ps["writeWhitelist"]) ||
            (ps["writeWhitelist"] as unknown[]).some((w) => typeof w !== "string" || w.trim() === ""))
        ) {
          throw new SettingsError("profiles[].sandbox.writeWhitelist 须为非空字符串数组");
        }
        if (ps["network"] !== undefined && ps["network"] !== "allow" && ps["network"] !== "deny") {
          throw new SettingsError(`profiles[].sandbox.network 非法：${String(ps["network"])}`);
        }
      }
      out.profiles!.push({
        name,
        defaultProvider,
        ...(assertString(e["defaultModel"], "profiles[].defaultModel") !== undefined
          ? { defaultModel: e["defaultModel"] as string }
          : {}),
        ...(permission !== undefined ? { permission: permission as ProfileEntry["permission"] } : {}),
        ...(sandbox !== undefined ? { sandbox: sandbox as ProfileEntry["sandbox"] } : {}),
      });
    }
  }
  out.activeProfile = assertString(rec["activeProfile"], "activeProfile");
  const prompts = rec["prompts"];
  if (prompts !== undefined) {
    if (!Array.isArray(prompts)) throw new SettingsError("prompts 须为数组");
    const seen = new Set<string>();
    for (const entry of prompts) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new SettingsError("prompts 条目必须是对象");
      }
      const e = entry as Record<string, unknown>;
      const name = assertString(e["name"], "prompts[].name");
      if (name === undefined) throw new SettingsError("prompts[].name 缺失");
      // 库内唯一——斜杠调用的标识面重名即坏档（fail-closed）
      if (seen.has(name)) throw new SettingsError(`prompts 模板名重复：${name}`);
      seen.add(name);
      const content = assertString(e["content"], "prompts[].content");
      if (content === undefined) throw new SettingsError("prompts[].content 缺失");
      out.prompts!.push({
        name,
        content,
        ...(assertString(e["description"], "prompts[].description") !== undefined
          ? { description: e["description"] as string }
          : {}),
      });
    }
  }
  if (rec["onboardingDone"] !== undefined && typeof rec["onboardingDone"] !== "boolean") {
    throw new SettingsError("onboardingDone 须为布尔值");
  }
  if (rec["onboardingDone"] === true) out.onboardingDone = true;
  const skills = rec["skills"];
  if (skills !== undefined) {
    if (skills === null || typeof skills !== "object" || Array.isArray(skills)) {
      throw new SettingsError("skills 须为对象");
    }
    const s = skills as Record<string, unknown>;
    const disabled = s["disabled"];
    if (disabled !== undefined && (!Array.isArray(disabled) || disabled.some((x) => typeof x !== "string" || x === ""))) {
      throw new SettingsError("skills.disabled 须为非空字符串数组");
    }
    const roots = s["roots"];
    if (roots !== undefined && (!Array.isArray(roots) || roots.some((x) => typeof x !== "string" || x === ""))) {
      throw new SettingsError("skills.roots 须为非空字符串数组");
    }
    // 空段归一（disabled/roots 全空 = 无配置——与缺省形状一致）
    const nextSkills: SkillsConfig = {
      ...(Array.isArray(disabled) && disabled.length > 0 ? { disabled: disabled as string[] } : {}),
      ...(Array.isArray(roots) && roots.length > 0 ? { roots: roots as string[] } : {}),
    };
    if (nextSkills.disabled !== undefined || nextSkills.roots !== undefined) out.skills = nextSkills;
  }
  const subagents = rec["subagents"];
  if (subagents !== undefined) {
    if (!Array.isArray(subagents)) throw new SettingsError("subagents 须为数组");
    const seen = new Set<string>();
    for (const entry of subagents) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new SettingsError("subagents 条目必须是对象");
      }
      const e = entry as Record<string, unknown>;
      const name = assertString(e["name"], "subagents[].name");
      if (name === undefined) throw new SettingsError("subagents[].name 缺失");
      // slug 规则（task subagent_type 取值面）+ 段内唯一
      if (!isValidSubagentSlug(name)) {
        throw new SettingsError(`subagents[].name 须为 slug 形状（小写字母数字开头，- _ 可内用）：${name}`);
      }
      if (seen.has(name)) throw new SettingsError(`subagents 名重复：${name}`);
      seen.add(name);
      if (e["tools"] !== undefined && (!Array.isArray(e["tools"]) || e["tools"].some((t) => typeof t !== "string" || t === ""))) {
        throw new SettingsError("subagents[].tools 须为非空字符串数组");
      }
      for (const key of ["modelProvider", "model"] as const) {
        if (e[key] !== undefined && (typeof e[key] !== "string" || (e[key] as string).trim() === "")) {
          throw new SettingsError(`subagents[].${key} 须为非空字符串`);
        }
      }
      if (e["fallbacks"] !== undefined && (!Array.isArray(e["fallbacks"]) || e["fallbacks"].some((t) => typeof t !== "string" || t === ""))) {
        throw new SettingsError("subagents[].fallbacks 须为非空字符串数组");
      }
      if (e["enabled"] !== undefined && typeof e["enabled"] !== "boolean") {
        throw new SettingsError("subagents[].enabled 须为布尔值");
      }
      // 字段必填分态：启用的条目（或覆盖内置的自定义面）必须自描述完整；
      // 纯停用覆盖记录（enabled === false）允许最简 {name, enabled}——
      // 缺失字段在 resolveSubagent 合并时引用内置值（pi-desktop enabledHandles
      // 语义：停用的内置无文档可删，最简记录是唯一开关位）。
      const enabled = e["enabled"] !== false;
      const prompt = assertString(e["prompt"], "subagents[].prompt");
      const description = assertString(e["description"], "subagents[].description");
      if (enabled) {
        if (prompt === undefined) throw new SettingsError("subagents[].prompt 缺失（子代理身份提示）");
        if (description === undefined) throw new SettingsError("subagents[].description 缺失");
      }
      out.subagents = [
        ...(out.subagents ?? []),
        {
          name,
          ...(description !== undefined ? { description } : {}),
          ...(prompt !== undefined ? { prompt } : {}),
          ...(Array.isArray(e["tools"]) && e["tools"].length > 0 ? { tools: e["tools"] as string[] } : {}),
          ...(e["modelProvider"] !== undefined ? { modelProvider: e["modelProvider"] as string } : {}),
          ...(e["model"] !== undefined ? { model: e["model"] as string } : {}),
          ...(Array.isArray(e["fallbacks"]) && e["fallbacks"].length > 0 ? { fallbacks: e["fallbacks"] as string[] } : {}),
          ...(e["enabled"] === false ? { enabled: false } : {}),
        } as SubagentDefinition,
      ];
    }
  }
  const shortcuts = rec["shortcuts"];
  if (shortcuts !== undefined) {
    if (shortcuts === null || typeof shortcuts !== "object" || Array.isArray(shortcuts)) {
      throw new SettingsError("shortcuts 须为对象（action → 组合键串）");
    }
    const outShortcuts: Record<string, string> = {};
    for (const [action, combo] of Object.entries(shortcuts as Record<string, unknown>)) {
      // 非法覆盖值（非字符串/空串）宽容忽略——坏档不炸键位面（ui/keymap
      // createKeymap 同语义）；键名（action）前向兼容不设白名单。
      if (typeof combo === "string" && combo.trim() !== "") outShortcuts[action] = combo;
    }
    if (Object.keys(outShortcuts).length > 0) out.shortcuts = outShortcuts;
  }
  const plugins = rec["plugins"];
  if (plugins !== undefined) {
    if (!Array.isArray(plugins)) throw new SettingsError("plugins 须为数组");
    const seen = new Set<string>();
    for (const entry of plugins) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new SettingsError("plugins 条目必须是对象");
      }
      const e = entry as Record<string, unknown>;
      const name = assertString(e["name"], "plugins[].name");
      if (name === undefined) throw new SettingsError("plugins[].name 缺失");
      // 命名空间分隔符规则（工具登记名 `<插件名>__<工具名>`——与 MCP
      // server 名同规则：名字本身不含分隔符，防歧义）
      if (name.includes("__")) throw new SettingsError(`plugins[].name 含命名空间分隔符 "__"：${name}`);
      if (seen.has(name)) throw new SettingsError(`plugins 插件名重复：${name}`);
      seen.add(name);
      const source = assertString(e["source"], "plugins[].source");
      if (source === undefined) throw new SettingsError("plugins[].source 缺失（目录路径或 ws URL）");
      const transport = e["transport"];
      if (transport !== undefined && transport !== "inprocess" && transport !== "ws") {
        throw new SettingsError(`plugins[].transport 非法：${String(transport)}（合法：inprocess|ws）`);
      }
      if (e["allowTools"] !== undefined && typeof e["allowTools"] !== "boolean") {
        throw new SettingsError("plugins[].allowTools 须为布尔值");
      }
      if (e["enabled"] !== undefined && typeof e["enabled"] !== "boolean") {
        throw new SettingsError("plugins[].enabled 须为布尔值");
      }
      out.plugins = [
        ...(out.plugins ?? []),
        {
          name,
          ...(transport !== undefined ? { transport } : {}),
          source,
          ...(e["allowTools"] === true ? { allowTools: true } : {}),
          ...(e["enabled"] === false ? { enabled: false } : {}),
        },
      ];
    }
  }
  const stt = rec["stt"];
  if (stt !== undefined) {
    if (stt === null || typeof stt !== "object" || Array.isArray(stt)) {
      throw new SettingsError("stt 须为对象");
    }
    const s = stt as Record<string, unknown>;
    const baseUrl = assertString(s["baseUrl"], "stt.baseUrl");
    if (baseUrl === undefined) throw new SettingsError("stt.baseUrl 缺失（OpenAI 协议端点根）");
    const model = assertString(s["model"], "stt.model");
    if (model === undefined) throw new SettingsError("stt.model 缺失（转写模型名）");
    out.stt = {
      baseUrl,
      model,
      ...(assertString(s["language"], "stt.language") !== undefined
        ? { language: s["language"] as string }
        : {}),
    };
  }
  const mcp = rec["mcp"];
  if (mcp !== undefined) {
    if (!Array.isArray(mcp)) throw new SettingsError("mcp 须为数组");
    const seen = new Set<string>();
    for (const entry of mcp) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new SettingsError("mcp 条目必须是对象");
      }
      const e = entry as Record<string, unknown>;
      const name = assertString(e["name"], "mcp[].name");
      if (name === undefined) throw new SettingsError("mcp[].name 缺失");
      // registry-bridge.validateServerName 同规则（工具名命名空间前缀防歧义）
      if (name.includes("__")) throw new SettingsError(`mcp[].name 含命名空间分隔符 "__"：${name}`);
      if (seen.has(name)) throw new SettingsError(`mcp server 名重复：${name}`);
      seen.add(name);
      const command = assertString(e["command"], "mcp[].command");
      if (command === undefined) throw new SettingsError("mcp[].command 缺失");
      if (e["args"] !== undefined && (!Array.isArray(e["args"]) || e["args"].some((a) => typeof a !== "string"))) {
        throw new SettingsError("mcp[].args 须为字符串数组");
      }
      if (e["enabled"] !== undefined && typeof e["enabled"] !== "boolean") {
        throw new SettingsError("mcp[].enabled 须为布尔值");
      }
      out.mcp!.push({
        name,
        command,
        ...(Array.isArray(e["args"]) ? { args: e["args"] as string[] } : {}),
        ...(e["enabled"] === false ? { enabled: false } : {}),
      });
    }
  }
  const enhancement = rec["enhancement"];
  if (enhancement !== undefined) {
    if (enhancement === null || typeof enhancement !== "object" || Array.isArray(enhancement)) {
      throw new SettingsError("enhancement 须为对象");
    }
    const parseTask = (v: unknown, where: string): EnhancementModelEntry | undefined => {
      if (v === undefined) return undefined;
      if (v === null || typeof v !== "object" || Array.isArray(v)) {
        throw new SettingsError(`${where} 须为对象`);
      }
      const t = v as Record<string, unknown>;
      const provider = assertString(t["provider"], `${where}.provider`);
      if (provider === undefined) throw new SettingsError(`${where}.provider 缺失`);
      const reasoning = t["reasoning"];
      if (
        reasoning !== undefined &&
        reasoning !== "minimal" &&
        reasoning !== "low" &&
        reasoning !== "medium" &&
        reasoning !== "high"
      ) {
        throw new SettingsError(`${where}.reasoning 非法（合法：minimal|low|medium|high）`);
      }
      return {
        provider,
        ...(assertString(t["model"], `${where}.model`) !== undefined
          ? { model: t["model"] as string }
          : {}),
        ...(reasoning !== undefined ? { reasoning: reasoning as EnhancementModelEntry["reasoning"] } : {}),
      };
    };
    const rec2 = enhancement as Record<string, unknown>;
    const judge = parseTask(rec2["judge"], "enhancement.judge");
    const summarizer = parseTask(rec2["summarizer"], "enhancement.summarizer");
    if (judge !== undefined || summarizer !== undefined) {
      out.enhancement = {
        ...(judge !== undefined ? { judge } : {}),
        ...(summarizer !== undefined ? { summarizer } : {}),
      };
    }
  }
  const pricing = rec["pricing"];
  if (pricing !== undefined) {
    if (!Array.isArray(pricing)) throw new SettingsError("pricing 须为数组");
    for (const entry of pricing) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new SettingsError("pricing 条目必须是对象");
      }
      const e = entry as Record<string, unknown>;
      const provider = assertString(e["provider"], "pricing[].provider");
      if (provider === undefined) throw new SettingsError("pricing[].provider 缺失");
      const modelId = assertString(e["modelId"], "pricing[].modelId");
      if (modelId === undefined) throw new SettingsError("pricing[].modelId 缺失");
      for (const key of ["inputPerMTok", "cachedInputPerMTok", "outputPerMTok"] as const) {
        if (typeof e[key] !== "number" || !Number.isFinite(e[key]) || (e[key] as number) < 0) {
          throw new SettingsError(`pricing[].${key} 须为非负数`);
        }
      }
      const cacheWrite = e["cacheWritePerMTok"];
      if (cacheWrite !== undefined && (typeof cacheWrite !== "number" || !Number.isFinite(cacheWrite) || cacheWrite < 0)) {
        throw new SettingsError("pricing[].cacheWritePerMTok 须为非负数");
      }
      out.pricing = [
        ...(out.pricing ?? []),
        {
          provider,
          modelId,
          inputPerMTok: e["inputPerMTok"] as number,
          cachedInputPerMTok: e["cachedInputPerMTok"] as number,
          outputPerMTok: e["outputPerMTok"] as number,
          ...(cacheWrite !== undefined ? { cacheWritePerMTok: cacheWrite as number } : {}),
        },
      ];
    }
  }
  return out;
}

/** 解析 settings.json 文本（损坏 → SettingsError 带 1-based 行列号）。 */
export function parseSettingsFile(text: string): SettingsShape {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const found = locateJsonError(text) ?? { offset: 0, line: 1, column: 1, reason: "未知语法错误" };
    throw new SettingsError(
      `settings.json JSON 语法错误：${found.reason}（第 ${found.line} 行，第 ${found.column} 列）`,
      { line: found.line, column: found.column },
    );
  }
  return parseSettingsShape(parsed);
}

/** 缺省配置文件路径：<home>/.aegent/settings.json。 */
export function defaultSettingsPath(): string {
  return path.join(os.homedir(), ".aegent", "settings.json");
}

/**
 * 读配置（U1 验收③默认值启动）：文件缺失 → 缺省配置；损坏 → SettingsError
 * （fail-closed 不吞错——调用方决定启动失败还是提示）。
 * settingsPath 缺省 <home>/.aegent/settings.json；--settings <path> 显式指定。
 */
export async function loadSettings(settingsPath?: string): Promise<{ settings: SettingsShape; path: string }> {
  const file = settingsPath ?? defaultSettingsPath();
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { settings: defaultSettings(), path: file };
  }
  return { settings: parseSettingsFile(text), path: file };
}

/** 写配置（U14 即改即存的底层——tmp 原子替换，oauth FileTokenStore 同纪律）。 */
export async function saveSettings(settingsPath: string, settings: SettingsShape): Promise<void> {
  await mkdir(path.dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await rename(tmp, settingsPath);
}

// ---------------------------------------------------------------------------
// 启动装配（三入口共用——CLI/host main 与桌面壳〔经 host〕同一翻译面）
// ---------------------------------------------------------------------------

/** agent-child 显式槽位的解析（翻译目标——agent-child parseArgs 消费）。 */
function parseChildArgs(childArgs: readonly string[]): {
  provider?: string;
  model?: string;
  apiKey?: string;
  db?: string;
  workspace?: string;
  network?: string;
  approvalTimeoutMs?: number;
  permissionMode?: string;
  /** T-P3-140 批次 A：沙箱模式显式槽（settings 档只在缺位时注入）。 */
  sandboxMode?: string;
  /** T-P3-140 批次 A：写白名单显式槽（逐条 --write-whitelist 收集）。 */
  writeWhitelist?: readonly string[];
  contextWindow?: number;
  rawLogDir?: string;
} {
  const out: {
    provider?: string;
    model?: string;
    apiKey?: string;
    db?: string;
    workspace?: string;
    network?: string;
    approvalTimeoutMs?: number;
    permissionMode?: string;
    sandboxMode?: string;
    writeWhitelist?: string[];
    contextWindow?: number;
    rawLogDir?: string;
  } = {};
  const pick = (flag: string): string | undefined => {
    const i = childArgs.indexOf(flag);
    return i >= 0 && i + 1 < childArgs.length ? childArgs[i + 1] : undefined;
  };
  const pickAll = (flag: string): string[] => {
    const values: string[] = [];
    for (let i = 0; i < childArgs.length; i++) {
      if (childArgs[i] === flag && i + 1 < childArgs.length) values.push(childArgs[i + 1] ?? "");
    }
    return values;
  };
  out.provider = pick("--provider");
  out.model = pick("--model");
  out.apiKey = pick("--api-key");
  out.db = pick("--db");
  out.workspace = pick("--workspace");
  out.network = pick("--network");
  out.rawLogDir = pick("--raw-log-dir");
  out.permissionMode = pick("--permission-mode");
  out.sandboxMode = pick("--sandbox-mode");
  const whitelist = pickAll("--write-whitelist").filter((w) => w !== "");
  if (whitelist.length > 0) out.writeWhitelist = whitelist;
  const timeout = pick("--approval-timeout");
  if (timeout !== undefined) out.approvalTimeoutMs = Number(timeout);
  const window = pick("--context-window");
  if (window !== undefined) out.contextWindow = Number(window);
  return out;
}

/**
 * 启动装配纯函数（U1 验收①优先级链）：childArgs 显式槽位 > env（AEGENT_*）
 * > settings 文件档 > 缺省（agent-child 自身）。返回**补齐后**的 childArgs。
 *
 * provider 槽是**适配器名空间**（openai/anthropic/echo——agent-child 的分支
 * 面），settings 条目名（defaultProvider）是供应商别名——两个面不同，无法
 * 按槽组合。定形：文件档**整体生效或整体不生效**（cc-switch 配置切换的同
 * 款语义）——显式/env 都未占用 provider 槽时，defaultProvider 选中条目并整
 * 体注入（adapter/baseUrl/model）；provider 槽被占用时条目不参与（env 三件
 * 套 AEGENT_PROVIDER+BASE_URL+MODEL 由 agent-child 既有 env 回退消化）。
 * 其余槽位（db/network/workspace/approvalTimeout）与 provider 无耦合，照常
 * 按显式 > env > file 回退（env 同值注入 argv 无害——agent-child 内 argv
 * 覆盖 env 的顺序不变）。
 */
export function resolveChildLaunchArgv(
  childArgs: readonly string[],
  env: NodeJS.ProcessEnv,
  settings: SettingsShape,
  /** U2/T-P3-102：defaultProvider 条目的凭据材料（调用方提前 decrypt——
   * DPAPI 是异步子进程面；优先级位于显式参数与环境变量之后）。 */
  options?: { credentialKey?: string },
): { args: string[] } {
  const explicit = parseChildArgs(childArgs);
  const envProvider = env["AEGENT_PROVIDER"];
  const providerOccupied =
    explicit.provider !== undefined || (envProvider !== undefined && envProvider !== "");
  const args = [...childArgs];
  const inject = (flag: string, value: string | undefined): void => {
    if (value === undefined || value === "") return;
    if (!childArgs.includes(flag)) args.push(flag, value);
  };
  let entrySelected = false;
  if (!providerOccupied && settings.defaultProvider !== undefined) {
    const entry = settings.providers.find((p) => p.name === settings.defaultProvider);
    if (entry !== undefined) {
      entrySelected = true;
      inject("--provider", entry.adapter ?? "openai");
      inject("--model", entry.model ?? settings.defaultModel);
      inject("--base-url", entry.baseUrl);
    }
  }
  // apiKey 槽（U2：凭据跟条目走——只在文件档条目被选中时参与，且优先级位于
  // 显式参数与环境变量之后）。其余非模型槽位（与 provider 无耦合）：显式 >
  // env > file。env 有值时注入 env 同值（agent-child 内 argv 覆盖 env 的结果
  // 不变）；无值时文件档补位。
  inject(
    "--api-key",
    explicit.apiKey ?? env["AEGENT_API_KEY"] ?? (entrySelected ? options?.credentialKey : undefined),
  );
  inject("--db", explicit.db ?? env["AEGENT_DB"] ?? settings.sandbox?.db);
  inject("--workspace", explicit.workspace ?? settings.sandbox?.workspace);
  inject("--network", explicit.network ?? settings.sandbox?.network);
  // T-P3-140 批次 A：沙箱三档 + 写白名单的 argv 注入（显式参数优先——
  // 沙箱是安全面，settings 档只在显式槽缺位时生效；白名单逐条重复注入）
  if (explicit.sandboxMode === undefined && settings.sandbox?.mode !== undefined) {
    inject("--sandbox-mode", settings.sandbox.mode);
  }
  if (explicit.writeWhitelist === undefined && (settings.sandbox?.writeWhitelist?.length ?? 0) > 0) {
    for (const w of settings.sandbox?.writeWhitelist ?? []) {
      inject("--write-whitelist", w);
    }
  }
  // U14/T-P3-132（#28）：日志分节的装配消费——E14 原始分片日志目录随配置档
  // 注入（agent-child 既有 --raw-log-dir / AEGENT_RAW_LOG_DIR 面零改动）。
  inject("--raw-log-dir", explicit.rawLogDir ?? env["AEGENT_RAW_LOG_DIR"] ?? settings.logging?.rawLogDir);
  if (explicit.approvalTimeoutMs === undefined && settings.permission?.approvalTimeoutMs !== undefined) {
    inject("--approval-timeout", String(settings.permission.approvalTimeoutMs));
  }
  // T-P3-137 八轮 A：权限模式五档随配置档注入（子进程 configStore 初始——
  // 会话内切换另经 config/refresh 通道，不改本注入）。
  inject("--permission-mode", explicit.permissionMode ?? settings.permission?.mode);
  return { args };
}

/**
 * 辅助任务模型的回退链解析（U18/T-P3-120 纯函数面——"缺省回退主模型"）：
 * enhancement.model（任务级显式）→ 被引用条目的 model → defaultModel
 * （主模型链）。返回被引用条目与最终 modelId；条目不存在 = undefined
 * （装配面零行为——无辅助模型可建，不虚构）。
 */
export function resolveEnhancementTarget(
  task: EnhancementModelEntry | undefined,
  providers: readonly ProviderEntry[],
  defaultModel: string | undefined,
): { entry: ProviderEntry; modelId: string } | undefined {
  if (task === undefined) return undefined;
  const entry = providers.find((p) => p.name === task.provider);
  if (entry === undefined) return undefined;
  const modelId = task.model ?? entry.model ?? defaultModel;
  if (modelId === undefined) return undefined;
  return { entry, modelId };
}

/**
 * Profile 切换的 patch 生成（U19/T-P3-121 纯函数——"切换 = 批量改 settings
 * 生效值"，providers 清单不动；UI 发此 patch 走既有 settings update 通道）。
 */
export function applyProfile(profile: ProfileEntry): Record<string, unknown> {
  return {
    defaultProvider: profile.defaultProvider,
    ...(profile.defaultModel !== undefined ? { defaultModel: profile.defaultModel } : {}),
    ...(profile.permission !== undefined ? { permission: profile.permission } : {}),
    ...(profile.sandbox !== undefined ? { sandbox: profile.sandbox } : {}),
  };
}

/**
 * 故障转移优先级序（U19/T-P3-121——J15"队列非开关 + sort_index 序"的
 * settings 消费面：providers 数组序 = failover 队列序；无 model 条目跳过
 * ——与多注册表装配跳过规则同源，无法成 identity 的条目不进队列）。
 * 装配方按此序构造 J15 backends（failover 装配随真实多供应商需求——记档）。
 */
export function failoverOrderFromProviders(
  providers: readonly ProviderEntry[],
  defaultModel: string | undefined,
): { name: string; provider: string; modelId: string }[] {
  const order: { name: string; provider: string; modelId: string }[] = [];
  for (const entry of providers) {
    if (entry.enabled === false) continue; // T-P3-137：停用条目不进队列
    const modelId = entry.model ?? defaultModel;
    if (modelId === undefined) continue;
    const adapter = adapterForAssembly(entry.adapter ?? "openai");
    if (adapter === null) continue; // google——会话装配暂缓（记档），不进队列
    order.push({ name: entry.name, provider: adapter, modelId });
  }
  return order;
}
