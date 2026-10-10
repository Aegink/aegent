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
import { LOG_LEVELS } from "../core/index.js";
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
/** 项目档（T-P3-150 A1 升级——逻辑项目组：多文件夹 + primary 根 + 稳定 id；
 * pi-desktop ProjectGroupRecord 形状投影）。 */
export interface ProjectEntry {
  /** 项目 id（稳定标识——任务归属 session_projects.project_id 指它；
   * 旧数据缺省 = name，activeProject 旧值自然兼容）。 */
  id: string;
  /** 项目名（人读标识）。 */
  name: string;
  /** 工作区目录集合（首位 = primary 根——文件树边界/新会话 cwd 的取值）。 */
  folders: string[];
  /** 项目级指令（随会话的提示面；运行时注入随 U24 指令中心对齐）。 */
  instructions?: string;
  createdAt?: number;
  lastOpenedAt?: number;
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
  /**
   * 插件设置值（T-P3-148 F——manifest.contributes.settings 声明 schema 的
   * 用户值；值闭集 string|number|boolean，详情表单的读写面。装载期经
   * coerceSettingValues 合并 default 后注入 caps.pluginSettings 与 MCP env
   * 的 {setting} 引用）。
   */
  options?: Record<string, string | number | boolean>;
  /**
   * 市场来源（T-P3-148 L——market install 的 host 落盘标记：uninstall/update
   * 按此定位权威记录与缓存；手工安装的条目无此字段）。
   */
  marketplace?: string;
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

/** 提示词模板条目（U16——settings 内联库旧形态；T-P3-146 C 迁移到文件域后仅作回读兼容）。 */
export interface PromptEntry {
  /** 模板名（斜杠调用与库列表的标识——库内唯一）。 */
  name: string;
  /** 模板正文（`{{var}}` 占位符单一约定——变量面见 session/prompt-library.ts）。 */
  content: string;
  description?: string;
}

/**
 * 提示词文件域管理配置（T-P3-146 C——settings prompts 段新形态）：
 * disabled = 停用名单（展开查找与 / 补全共同消费——"启用开关"不改正文）；
 * roots = 附加来源目录（多根扫描——skills.roots 同构，遮蔽序项目级 > 附加根
 * > 用户级）；allowShellExpansion = `!`cmd`` 前置展开开关（缺省 false——
 * 任意命令执行面，显式开启才生效，fail-closed）。
 */
export interface PromptsConfig {
  disabled?: string[];
  roots?: string[];
  allowShellExpansion?: boolean;
}

/** MCP server 条目（U17/T-P3-119——向导落档；装配消费在 agent-child）。 */
export interface McpServerEntry {
  /** server 名（工具名命名空间前缀——须非空且不含 "__"，registry-bridge 同规则）。 */
  name: string;
  /** stdio 启动命令与参数（HTTP/SSE transport 随 mcp 域扩展——I3 LIMITATIONS）。 */
  command: string;
  args?: string[];
  /**
   * server 进程环境变量覆盖（T-P3-143——API key 型 server 必需； spawn 时
   * 叠加在宿主环境之上，同名字段以条目为准——opencode environment 同构）。
   */
  env?: Record<string, string>;
  /** 连接/列工具/调用的单请求超时 ms（缺省 10s——慢启动 server 可放宽）。 */
  timeoutMs?: number;
  /** 启停开关（false = 装配跳过；缺省 true）。 */
  enabled?: boolean;
}

/**
 * 辅助任务模型条目（U18/T-P3-120——判官/摘要等增强任务与主对话模型分离，
 * pi-desktop·EnhancementModelCard / ADR 0121 行为锚）。provider 引用
 * providers 条目名（不裸写 baseUrl——凭据按条目名走 credentials 面）。
 */
export interface EnhancementModelEntry {
  /**
   * providers 条目名（该条目的 adapter/baseUrl/凭据构造辅助模型面）。
   * T-P3-147 B 放宽：可缺省——缺省 = 跳过本任务显式面，继续回退链
   * （fastModel → fallbacks → 主模型链；parse 层不再强制必填）。
   */
  provider?: string;
  /** 辅助任务模型 id（缺省回退 = 条目 model → defaultModel——主模型链）。 */
  model?: string;
  /** reasoning 档位（配置面记录——适配层 reasoning 请求面扩展后消费，记档）。 */
  reasoning?: "minimal" | "low" | "medium" | "high";
  /**
   * 有序备选模型（T-P3-147 B——pi SubagentFallbackModels 同构）：显式面
   * 解析失败（条目不存在/停用）时顺链下落；全部失败 = 主模型链。
   */
  fallbacks?: { provider?: string; model?: string }[];
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

/**
 * 子代理后端选择（C4）：backend 闭集两值——"in-process"（进程内 fork，
 * 缺省）与 "acp"（外部 ACP agent 进程，经 spawnAcpTransport stdio）。
 * acp.command 是启动命令行（argv 数组——不经 shell，无注入面）；
 * timeoutMs 为单次派发预算（createAcpBackend 缺省 10 分钟）。
 */
export interface SubagentBackendSettings {
  backend: "in-process" | "acp";
  acp?: { command: readonly string[]; timeoutMs?: number };
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
   * 对话与输入（T-P3-165 需求 4——zcode 常规/全局 AI 页我们缺失项的真实
   * 可用子集）：enterToSend（关 = Ctrl+Enter 发送）、pasteThreshold（大段
   * 文本粘贴转附件的字符阈值）、ctxReadout（上下文 pill 读数口径）、
   * reasoningDisplay（思考卡默认展开/收起）。
   */
  chat?: {
    enterToSend?: boolean;
    pasteThreshold?: number;
    ctxReadout?: "used" | "remaining";
    reasoningDisplay?: "detailed" | "concise";
    /** T-P3-166 需求 4：无尽重试（流恢复重试上限解除——loop recovery）。 */
    retryUnlimited?: boolean;
    /** 平滑流式显示（缺省开=打字机匀速；关=瞬时整段渲染）。 */
    smoothStream?: boolean;
    /** 终端命令 Shell（terminal-create 的 PTY 程序；缺省系统 ComSpec）。 */
    shell?: "cmd" | "powershell" | "pwsh" | "bash";
  };
  /** 网络代理（T-P3-166 需求 4——pi networkProxy 同构；模型请求在 Node
   *  侧 undici dispatcher 生效，custom 模式重启 agent-child 后生效）。 */
  network?: {
    mode?: "system" | "direct" | "custom";
    url?: string;
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
  /**
   * 外观（U14 主题暗/亮 → T-P3-141 批次全面扩展：主题模式（含跟随系统/
   * 按时间表）+ 皮肤/强调色/插件主题 + 字号字体 + 消息流外观 + 背景图 +
   * 界面语言/回复语言——qwen outputLanguage 与 zcode localePreference 同构）。
   * `theme` 兼容保留 = 解析后的显式档（mode 为 dark/light 时与其同步落盘；
   * system/schedule 档不动它——旧 UI/旧档零破坏）。
   */
  appearance?: {
    theme?: "dark" | "light";
    themeMode?: "system" | "dark" | "light" | "schedule";
    /** 按时间表档的两个边界（"HH:MM"——跨午夜区间合法，如 22:00→06:00）。 */
    scheduleLightStart?: string;
    scheduleDarkStart?: string;
    /** 内置皮肤 id（空/缺省 = 默认色板——ui/views/settings/basic.js 闭集同源）。 */
    skin?: string;
    /** 强调色 id（空/缺省 = 默认 sky——闭集同源）。 */
    accent?: string;
    /** 插件主题（插件名——plugin.json theme 贡献；缺省 = 不使用）。 */
    pluginTheme?: string;
    /** UI 字号（px 基准，12/14/16/18——theme.css calc 刻度全站联动）。 */
    uiFontSize?: number;
    /** 界面/等宽字体首选族（自定义 font-family 首值；空 = 默认栈）。 */
    fontBase?: string;
    fontMono?: string;
    /** 消息流外观（zcode messageStreamShowReasoning / grok show_timestamps 同位）。 */
    chatShowReasoning?: boolean;
    showTimestamps?: boolean;
    chatContentWidth?: "default" | "wide" | "full";
    animations?: boolean;
    colorBlindFriendly?: boolean;
    /** 背景图（dataURL——base64 上限 3MB 二进制；空 = 不使用）。 */
    backgroundImage?: string;
    backgroundImageOpacity?: number;
    /** 界面语言（zcode localePreference 同构：system 跟随系统）。 */
    language?: "system" | "zh-CN" | "en";
    /** 回复语言（qwen outputLanguage 同构——内核输出语言，与界面语言分离；auto = 跟随输入）。 */
    outputLanguage?: "auto" | "zh-CN" | "en";
  };
  /** 日志（U14/T-P3-132 #28 补落——E14 原始分片日志目录的持久化位；空 = 缺省不写）。 */
  /**
   * 日志中心（T-P3-154——rawLogDir 旧键保留；level/retentionDays/logDir 为
   * 日志中心三键：级别热更缺省 info、保留天数 0=永久、目录缺省 <dataDir>/logs）。
   */
  logging?: {
    rawLogDir?: string;
    level?: import("../kernel/logger.js").LogLevel;
    retentionDays?: number;
    logDir?: string;
  };
  /**
   * 备份中心（T-P3-174 批次 4）：周期自动备份配置——手动备份面（立即备份/
   * 恢复/删除）不受本段影响。auto=false（缺省）= 只手动；intervalHours 是
   * 两次自动备份的最小间隔（tick 判据 = bak.0 的 mtime 距今 ≥ interval）；
   * keep = 保留份数（滚动挤出最老——与导入 safety 备份共用 bak 序号体系）。
   */
  backup?: {
    auto?: boolean;
    intervalHours?: number;
    keep?: number;
  };
  /**
   * WebDAV 云同步（T-P3-174 批次 4——cc-switch·WebdavSyncSection 行为锚）：
   * 配置快照 + 技能目录 zip 两 artifact 的手动同步。密码不落本段——进凭据
   * 库（credentials.bin DPAPI，provider="webdav"）；lastSyncAt/lastError 是
   * 同步状态持久面（UI 上次同步时间与失败横幅的数据源）。
   */
  webdav?: {
    url?: string;
    username?: string;
    remoteRoot?: string;
    lastSyncAt?: number;
    lastError?: string;
  };
  /** 项目档（U11——多项目列表；activeProject 生效语义 = 新会话启动）。 */
  projects?: ProjectEntry[];
  activeProject?: string;
  /** 价格表（U12——成本统计的计价来源；缺省无 = 成本如实缺席不虚构）。 */
  pricing?: PricingEntry[];
  /**
   * 提示词域（T-P3-146 C 文件化——双形态过渡段）：
   *  - 旧形态 `PromptEntry[]`（U16 settings 内联库）——首次读取时由 host
   *    一次性迁移到 `~/.aegent/prompts/*.md`（迁移标记在用户根），此后只读
   *    不消费（保留段位为旧版本回读兼容）；
   *  - 新形态 `PromptsConfig`（文件域管理配置——停用名单 + 附加来源根 +
   *    shell 前置展开开关；模板本体在文件系统，见 kernel/prompts.ts）。
   */
  prompts?: PromptEntry[] | PromptsConfig;
  /** 技能管理（U22——停用名单 + 附加来源目录；装配消费见 kernel/skills.ts）。 */
  skills?: SkillsConfig;
  /** 子代理自定义（U23——同名覆盖内置预设；解析面见 session/subagents-config.ts）。 */
  subagents?: SubagentDefinition[];
  /**
   * 子代理后端选择（C4——task 工具的派发出闸；装配消费见 kernel/
   * agent-child.ts）。缺省 undefined = 进程内 fork（既有行为零变化）。
   */
  subagentBackend?: SubagentBackendSettings;
  /**
   * 计算机使用开关（S4——屏幕/输入控制四工具的注册门控；**缺省关**，
   * 高危面注册即模型可见，必须显式开启）。审批/审计/无人值守恒拒三层
   * 在 scheduler/computer.ts 工具面纵深。
   */
  computerUse?: { enabled?: boolean };
  /** 快捷键覆盖（U25——action → 组合键规范串；部分覆盖语义，解析面见 ui/keymap.js）。 */
  shortcuts?: Record<string, string>;
  /**
   * 插件管理（T-P3-133——I4/I5/I9 的管理面延伸）：装载清单 + 启停。
   * inprocess 条目 = 插件目录（plugin.json 清单 + index.js 入口）；
   * ws 条目 = 进程外插件 URL（I4——trust 恒 untrusted）。
   */
  plugins?: PluginEntry[];
  /**
   * 语音转文字（U26/T-P3-129 实验性——OpenAI 协议端点复用，P4 消费端；
   * T-P3-149 扩 maxSeconds/refineTranscript/protocol——录音上限/转写润色/
   * 协议通道）。
   * key 零明文：凭据在 credentials 库以 provider 名 "stt" 录入（U2 面复用）。
   */
  stt?: {
    /** 转写引擎（T-P3-174 批次 6 G1）："cloud"（缺省——OpenAI 协议端点）|
     *  "local"（SenseVoice 本地推理——模型经下载器落 ~/.aegent/models）。 */
    engine?: "cloud" | "local";
    /** OpenAI 协议兼容端点根（如 https://api.openai.com/v1）；engine=local 可缺省。 */
    baseUrl?: string;
    /** 转写模型名（如 whisper-1——provider 侧语义）；engine=local 可缺省。 */
    model?: string;
    /** 语言提示（BCP-47 可选，如 zh）。 */
    language?: string;
    /** 录音时长上限秒数（缺省 120——dsh maxDurationSeconds 同款语义）。 */
    maxSeconds?: number;
    /** 转写后辅助模型润色（qwen voice-refine 语义——缺省关）。 */
    refineTranscript?: boolean;
    /** 静音自动停止（G3 VAD——连续 2s 低于阈值即停，缺省关）。 */
    silenceStop?: boolean;
    /**
     * 转写协议通道（T-P3-149 C1——缺省 "transcriptions"）：
     * transcriptions = POST {baseUrl}/audio/transcriptions multipart；
     * chat = POST {baseUrl}/chat/completions 带 input_audio base64 消息
     * （qwen voice-transcriber 通道——DashScope 类端点唯一入口）。
     */
    protocol?: "transcriptions" | "chat";
  };
  /**
   * 语音合成（T-P3-149 D 域——OpenAI 协议 /audio/speech 端点复用）。
   * key 零明文：凭据在 credentials 库以 provider 名 "tts" 录入。
   */
  tts?: {
    /** 回复自动朗读（T-P3-174 批次 6 G2——turn 内新 assistant 文本按句
     *  分段合成入播放队列；新回复/手动停止/录音开始即抢占）。 */
    autoSpeak?: boolean;
    /** OpenAI 协议兼容端点根（如 https://api.openai.com/v1）。 */
    baseUrl: string;
    /** 合成模型名（如 tts-1——provider 侧语义）。 */
    model: string;
    /** 音色（可选，如 alloy——provider 侧语义）。 */
    voice?: string;
  };
  /** MCP server 清单（U17——向导式添加落档；装配期连接注册，单 server 失败不炸启动）。 */
  mcp?: McpServerEntry[];
  /**
   * 辅助任务模型（U18 + T-P3-147 全面扩容——judge/summarizer/polish/title
   * 任务级模型路由 + 全局轻模型单点 + 总闸；缺省回退主模型链）。
   */
  enhancement?: {
    /**
     * 辅助流量总闸（T-P3-147 G——claude DISABLE_NONESSENTIAL_TRAFFIC 同构）：
     * false = 标题不跑、润色类型化拒绝、判官落回人、摘要回退主模型；
     * 缺省 true = 全部照常。
     */
    enabled?: boolean;
    /**
     * 全局轻模型单点（T-P3-147 B——claude SMALL_FAST_MODEL / opencode
     * small_model / qwen fastModel 语义）：任务未显式配置时的缺省辅助模型
     * （命名/分类类轻任务的自然落点；摘要质量任务建议显式配主模型档）。
     */
    fastModel?: EnhancementModelEntry;
    judge?: EnhancementModelEntry;
    summarizer?: EnhancementModelEntry;
    /**
     * 一键润色（T-P3-146 I——pi-desktop prompt-enhancement 同构）：
     * 独立模型三元组（均可缺省——缺省回退 fastModel → 主模型链）+ 用户
     * 润色模板（{{draft}} 占位；customTemplate 关闭或缺占位符 = 内置默认
     * 模板；template 上限 8000 字符——pi 同值）。
     */
    polish?: Partial<EnhancementModelEntry> & {
      customTemplate?: boolean;
      template?: string;
    };
    /**
     * 会话标题生成（T-P3-147 E——五仓标配任务）：首轮后异步生成会话标题；
     * 字段缺省 = fastModel → 主模型；prompt 覆写可选。
     */
    title?: EnhancementModelEntry & {
      prompt?: string;
    };
    /**
     * 压缩摘要指令覆写（T-P3-147 H——codex compact_prompt 同构；缺省 =
     * 内置 SUMMARY_SYSTEM_PROMPT，UI 可整段覆盖）。
     */
    summaryPrompt?: string;
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
  /**
   * T-P3-142 批次 A：权限面捆绑补全（mode 五档——此前只有超时，"写代码
   * 场景 = Claude + 全自动"做不到的概念半残根源）。mode 缺省 = 不捆绑
   * （切换不动权限模式——三态语义）。
   */
  permission?: { approvalTimeoutMs?: number; mode?: PermissionMode };
  /** T-P3-140 批次 F：组合档带沙箱 mode（切换 = 批量写生效段，含 mode）。 */
  sandbox?: {
    network?: "allow" | "deny";
    mode?: import("../sandbox/backend.js").SandboxMode;
    writeWhitelist?: readonly string[];
    workspace?: string;
    db?: string;
  };
  /**
   * T-P3-142 批次 C：资源捆绑三态快照（cc-switch ProfilePayload 同构——
   * **undefined = 未拍过（切换时不动）/ 数组（含空）= 拍到即目标**）。
   * mcpEnabled = MCP 服务器名启用集；skillsDisabled = 技能停用名单；
   * pluginsEnabled = 插件名启用集。资源是装配面（新会话生效）。
   */
  mcpEnabled?: readonly string[];
  skillsDisabled?: readonly string[];
  pluginsEnabled?: readonly string[];
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
    // T-P3-146 C：缺省维持旧数组形态（零配置 = 空内联库——迁移面 no-op）
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
    // T-P3-141 批次：外观全字段校验（枚举闭集 fail-closed + 形状/上限——
    // 与 sandbox/permission 段同一纪律）。
    const themeMode = a["themeMode"];
    if (
      themeMode !== undefined &&
      themeMode !== "system" &&
      themeMode !== "dark" &&
      themeMode !== "light" &&
      themeMode !== "schedule"
    ) {
      throw new SettingsError(
        `appearance.themeMode 非法：${String(themeMode)}（合法：system|dark|light|schedule）`,
      );
    }
    const assertHhmm = (value: unknown, field: string): void => {
      if (value !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) {
        throw new SettingsError(`appearance.${field} 须为 "HH:MM" 形状，收到：${String(value)}`);
      }
    };
    assertHhmm(a["scheduleLightStart"], "scheduleLightStart");
    assertHhmm(a["scheduleDarkStart"], "scheduleDarkStart");
    for (const field of ["skin", "accent", "pluginTheme", "fontBase", "fontMono"] as const) {
      if (a[field] !== undefined && (typeof a[field] !== "string" || a[field].length > 120)) {
        throw new SettingsError(`appearance.${field} 须为非空短字符串（≤120 字符）`);
      }
    }
    const uiFontSize = a["uiFontSize"];
    if (uiFontSize !== undefined && ![12, 14, 16, 18].includes(uiFontSize as number)) {
      throw new SettingsError(`appearance.uiFontSize 非法：${String(uiFontSize)}（合法：12|14|16|18）`);
    }
    const chatContentWidth = a["chatContentWidth"];
    if (
      chatContentWidth !== undefined &&
      chatContentWidth !== "default" &&
      chatContentWidth !== "wide" &&
      chatContentWidth !== "full"
    ) {
      throw new SettingsError(
        `appearance.chatContentWidth 非法：${String(chatContentWidth)}（合法：default|wide|full）`,
      );
    }
    for (const field of [
      "chatShowReasoning",
      "showTimestamps",
      "animations",
      "colorBlindFriendly",
    ] as const) {
      if (a[field] !== undefined && typeof a[field] !== "boolean") {
        throw new SettingsError(`appearance.${field} 须为布尔`);
      }
    }
    const backgroundImage = a["backgroundImage"];
    if (backgroundImage !== undefined) {
      if (
        typeof backgroundImage !== "string" ||
        (backgroundImage !== "" && !/^data:image\/(png|jpeg|webp);base64,/.test(backgroundImage))
      ) {
        throw new SettingsError("appearance.backgroundImage 须为 png/jpeg/webp 的 dataURL（或空串清除）");
      }
      if (backgroundImage.length > 4_200_000) {
        throw new SettingsError("appearance.backgroundImage 超过 3MB 上限（base64 形状）");
      }
    }
    const bgOpacity = a["backgroundImageOpacity"];
    if (
      bgOpacity !== undefined &&
      (typeof bgOpacity !== "number" || !Number.isFinite(bgOpacity) || bgOpacity < 0 || bgOpacity > 100)
    ) {
      throw new SettingsError("appearance.backgroundImageOpacity 须为 0-100 数字");
    }
    const language = a["language"];
    if (language !== undefined && language !== "system" && language !== "zh-CN" && language !== "en") {
      throw new SettingsError(`appearance.language 非法：${String(language)}（合法：system|zh-CN|en）`);
    }
    const outputLanguage = a["outputLanguage"];
    if (outputLanguage !== undefined && outputLanguage !== "auto" && outputLanguage !== "zh-CN" && outputLanguage !== "en") {
      throw new SettingsError(`appearance.outputLanguage 非法：${String(outputLanguage)}（合法：auto|zh-CN|en）`);
    }
    const boolOrUndef = (field: string): boolean | undefined =>
      a[field] === undefined ? undefined : (a[field] as boolean);
    const strOrUndef = (field: string): string | undefined => {
      const value = a[field];
      return value === undefined || value === "" ? undefined : (value as string);
    };
    out.appearance = {
      ...(theme !== undefined ? { theme: theme as "dark" | "light" } : {}),
      ...(themeMode !== undefined ? { themeMode: themeMode as "system" | "dark" | "light" | "schedule" } : {}),
      ...(strOrUndef("scheduleLightStart") !== undefined
        ? { scheduleLightStart: a["scheduleLightStart"] as string }
        : {}),
      ...(strOrUndef("scheduleDarkStart") !== undefined
        ? { scheduleDarkStart: a["scheduleDarkStart"] as string }
        : {}),
      ...(strOrUndef("skin") !== undefined ? { skin: a["skin"] as string } : {}),
      ...(strOrUndef("accent") !== undefined ? { accent: a["accent"] as string } : {}),
      ...(strOrUndef("pluginTheme") !== undefined ? { pluginTheme: a["pluginTheme"] as string } : {}),
      ...(uiFontSize !== undefined ? { uiFontSize: uiFontSize as number } : {}),
      ...(strOrUndef("fontBase") !== undefined ? { fontBase: a["fontBase"] as string } : {}),
      ...(strOrUndef("fontMono") !== undefined ? { fontMono: a["fontMono"] as string } : {}),
      ...(boolOrUndef("chatShowReasoning") !== undefined
        ? { chatShowReasoning: a["chatShowReasoning"] as boolean }
        : {}),
      ...(boolOrUndef("showTimestamps") !== undefined
        ? { showTimestamps: a["showTimestamps"] as boolean }
        : {}),
      ...(chatContentWidth !== undefined
        ? { chatContentWidth: chatContentWidth as "default" | "wide" | "full" }
        : {}),
      ...(boolOrUndef("animations") !== undefined ? { animations: a["animations"] as boolean } : {}),
      ...(boolOrUndef("colorBlindFriendly") !== undefined
        ? { colorBlindFriendly: a["colorBlindFriendly"] as boolean }
        : {}),
      ...(a["backgroundImage"] !== undefined
        ? { backgroundImage: backgroundImage as string }
        : {}),
      ...(bgOpacity !== undefined ? { backgroundImageOpacity: bgOpacity as number } : {}),
      ...(language !== undefined ? { language: language as "system" | "zh-CN" | "en" } : {}),
      ...(outputLanguage !== undefined
        ? { outputLanguage: outputLanguage as "auto" | "zh-CN" | "en" }
        : {}),
    };
  }
  const chat = rec["chat"];
  if (chat !== undefined) {
    if (chat === null || typeof chat !== "object" || Array.isArray(chat)) {
      throw new SettingsError("chat 段需要对象");
    }
    const c = chat as Record<string, unknown>;
    const boolOrUndef = (field: string): boolean | undefined => {
      const value = c[field];
      return value === undefined ? undefined : (value as boolean);
    };
    const chatWidth = c["ctxReadout"];
    const reasoning = c["reasoningDisplay"];
    const threshold = c["pasteThreshold"];
    const shell = c["shell"];
    out.chat = {
      ...(boolOrUndef("enterToSend") !== undefined ? { enterToSend: boolOrUndef("enterToSend") } : {}),
      ...(typeof threshold === "number" && Number.isFinite(threshold) && threshold >= 200
        ? { pasteThreshold: Math.floor(threshold) }
        : {}),
      ...(chatWidth === "used" || chatWidth === "remaining" ? { ctxReadout: chatWidth } : {}),
      ...(reasoning === "detailed" || reasoning === "concise" ? { reasoningDisplay: reasoning } : {}),
      ...(boolOrUndef("retryUnlimited") !== undefined ? { retryUnlimited: boolOrUndef("retryUnlimited") } : {}),
      ...(boolOrUndef("smoothStream") !== undefined ? { smoothStream: boolOrUndef("smoothStream") } : {}),
      ...(shell === "cmd" || shell === "powershell" || shell === "pwsh" || shell === "bash"
        ? { shell }
        : {}),
    };
  }
  const network = rec["network"];
  if (network !== undefined) {
    if (network === null || typeof network !== "object" || Array.isArray(network)) {
      throw new SettingsError("network 段需要对象");
    }
    const n = network as Record<string, unknown>;
    const mode = n["mode"];
    const url = n["url"];
    out.network = {
      ...(mode === "system" || mode === "direct" || mode === "custom" ? { mode } : {}),
      ...(typeof url === "string" && url !== "" ? { url } : {}),
    };
  }
  const backup = rec["backup"];
  if (backup !== undefined) {
    if (backup === null || typeof backup !== "object" || Array.isArray(backup)) {
      throw new SettingsError("backup 段需要对象");
    }
    const b = backup as Record<string, unknown>;
    const auto = b["auto"];
    const intervalHours = b["intervalHours"];
    const keep = b["keep"];
    if (auto !== undefined && typeof auto !== "boolean") {
      throw new SettingsError("backup.auto 须为布尔");
    }
    if (intervalHours !== undefined && (typeof intervalHours !== "number" || !Number.isFinite(intervalHours) || intervalHours < 1 || intervalHours > 24 * 30)) {
      throw new SettingsError("backup.intervalHours 须为 1..720 的数值（小时）");
    }
    if (keep !== undefined && (typeof keep !== "number" || !Number.isInteger(keep) || keep < 1 || keep > 50)) {
      throw new SettingsError("backup.keep 须为 1..50 的整数（保留份数）");
    }
    out.backup = {
      ...(auto === true ? { auto: true } : {}),
      ...(typeof intervalHours === "number" && Number.isFinite(intervalHours) ? { intervalHours } : {}),
      ...(typeof keep === "number" && Number.isInteger(keep) ? { keep } : {}),
    };
  }
  const webdav = rec["webdav"];
  if (webdav !== undefined) {
    if (webdav === null || typeof webdav !== "object" || Array.isArray(webdav)) {
      throw new SettingsError("webdav 段需要对象");
    }
    const w = webdav as Record<string, unknown>;
    const url = w["url"];
    const username = w["username"];
    const remoteRoot = w["remoteRoot"];
    const lastSyncAt = w["lastSyncAt"];
    const lastError = w["lastError"];
    if (url !== undefined && (typeof url !== "string" || !/^https?:\/\//i.test(url))) {
      throw new SettingsError("webdav.url 须为 http(s) 地址");
    }
    for (const key of ["username", "remoteRoot"] as const) {
      if (w[key] !== undefined && typeof w[key] !== "string") {
        throw new SettingsError(`webdav.${key} 须为字符串`);
      }
    }
    if (lastSyncAt !== undefined && (typeof lastSyncAt !== "number" || !Number.isFinite(lastSyncAt))) {
      throw new SettingsError("webdav.lastSyncAt 须为数值（epoch 毫秒）");
    }
    if (lastError !== undefined && typeof lastError !== "string") {
      throw new SettingsError("webdav.lastError 须为字符串");
    }
    out.webdav = {
      ...(typeof url === "string" && url !== "" ? { url } : {}),
      ...(typeof username === "string" && username !== "" ? { username } : {}),
      ...(typeof remoteRoot === "string" && remoteRoot !== "" ? { remoteRoot } : {}),
      ...(typeof lastSyncAt === "number" && Number.isFinite(lastSyncAt) ? { lastSyncAt } : {}),
      ...(typeof lastError === "string" && lastError !== "" ? { lastError } : {}),
    };
  }
  const logging = rec["logging"];
  if (logging !== undefined) {
    if (logging === null || typeof logging !== "object") {
      throw new SettingsError("logging 须为对象");
    }
    const logLevel = (logging as Record<string, unknown>)["level"];
    // T-P3-154：日志中心三键——level（热更级别，缺省 info 常驻）/retentionDays
    // （保留天数，0=永久）/logDir（缺省 <dataDir>/logs）；rawLogDir 旧键兼容。
    if (logLevel !== undefined && !(LOG_LEVELS as readonly string[]).includes(logLevel as string)) {
      throw new SettingsError(`logging.level 非法：${String(logLevel)}（合法：${LOG_LEVELS.join("|")}）`);
    }
    const retentionDays = (logging as Record<string, unknown>)["retentionDays"];
    if (retentionDays !== undefined && (typeof retentionDays !== "number" || !Number.isInteger(retentionDays) || retentionDays < 0)) {
      throw new SettingsError("logging.retentionDays 须为非负整数（0=永久保留）");
    }
    const rawLogDir = assertString((logging as Record<string, unknown>)["rawLogDir"], "logging.rawLogDir");
    const logDir = assertString((logging as Record<string, unknown>)["logDir"], "logging.logDir");
    out.logging = {
      ...(rawLogDir !== undefined ? { rawLogDir } : {}),
      ...(logLevel !== undefined ? { level: logLevel as import("../kernel/logger.js").LogLevel } : {}),
      ...(retentionDays !== undefined ? { retentionDays } : {}),
      ...(logDir !== undefined ? { logDir } : {}),
    } as typeof out.logging;
  }
  const projects = rec["projects"];
  if (projects !== undefined) {
    if (!Array.isArray(projects)) throw new SettingsError("projects 须为数组");
    const seenIds = new Set<string>();
    for (const entry of projects) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new SettingsError("projects 条目必须是对象");
      }
      const e = entry as Record<string, unknown>;
      const name = assertString(e["name"], "projects[].name");
      if (name === undefined) throw new SettingsError("projects[].name 缺失");
      // T-P3-150 A1：folders[]（首位=primary 根）+ 稳定 id；旧单 workspace
      // 形状读取面归一（workspace → folders[0]、id 缺省 = name——activeProject
      // 旧值指向 name 自然兼容，零迁移写回）
      const rawFolders = e["folders"];
      const legacyWorkspace = assertString(e["workspace"], "projects[].workspace");
      let folders: string[];
      if (Array.isArray(rawFolders)) {
        folders = rawFolders.filter((f): f is string => typeof f === "string" && f.trim() !== "");
      } else if (legacyWorkspace !== undefined) {
        folders = [legacyWorkspace];
      } else {
        throw new SettingsError("projects[].folders 缺失（至少一个工作区目录）");
      }
      if (folders.length === 0) throw new SettingsError("projects[].folders 至少一个目录");
      const id = assertString(e["id"], "projects[].id") ?? name;
      if (seenIds.has(id)) throw new SettingsError(`projects id 重复：${id}`);
      seenIds.add(id);
      const createdAt = e["createdAt"];
      const lastOpenedAt = e["lastOpenedAt"];
      for (const [field, value] of [["createdAt", createdAt], ["lastOpenedAt", lastOpenedAt]] as const) {
        if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
          throw new SettingsError(`projects[].${field} 须为正整数时间戳`);
        }
      }
      out.projects!.push({
        id,
        name,
        folders,
        ...(assertString(e["instructions"], "projects[].instructions") !== undefined
          ? { instructions: e["instructions"] as string }
          : {}),
        ...(typeof createdAt === "number" ? { createdAt } : {}),
        ...(typeof lastOpenedAt === "number" ? { lastOpenedAt } : {}),
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
      // T-P3-142 批次 A：权限模式捆绑校验（五档闭集——与顶层 permission.mode
      // 同一纪律；缺省 = 不捆绑，切换不动权限模式）。
      if (permission !== undefined) {
        const pm = (permission as Record<string, unknown>)["mode"];
        if (pm !== undefined && !(PERMISSION_MODES as readonly string[]).includes(pm as string)) {
          throw new SettingsError(
            `profiles[].permission.mode 非法：${String(pm)}（合法：${PERMISSION_MODES.join("|")}）`,
          );
        }
      }
      // T-P3-142 批次 C：资源捆绑三态快照校验（数组形状 + 非空字符串 +
      // 条目上限——undefined = 未拍过，数组（含空）= 目标集）。
      for (const field of ["mcpEnabled", "skillsDisabled", "pluginsEnabled"] as const) {
        const value = e[field];
        if (value !== undefined) {
          if (
            !Array.isArray(value) ||
            value.some((v) => typeof v !== "string" || v.trim() === "") ||
            value.length > 100
          ) {
            throw new SettingsError(
              `profiles[].${field} 须为非空字符串数组（≤100 条；缺省 undefined = 不捆绑）`,
            );
          }
        }
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
        ...(e["mcpEnabled"] !== undefined ? { mcpEnabled: e["mcpEnabled"] as readonly string[] } : {}),
        ...(e["skillsDisabled"] !== undefined
          ? { skillsDisabled: e["skillsDisabled"] as readonly string[] }
          : {}),
        ...(e["pluginsEnabled"] !== undefined
          ? { pluginsEnabled: e["pluginsEnabled"] as readonly string[] }
          : {}),
      });
    }
  }
  out.activeProfile = assertString(rec["activeProfile"], "activeProfile");
  const prompts = rec["prompts"];
  if (prompts !== undefined) {
    // T-P3-146 C：双形态——数组 = 旧内联库（回读兼容 + 迁移源）；对象 =
    // 文件域管理配置（disabled/roots/allowShellExpansion）。
    if (Array.isArray(prompts)) {
      const seen = new Set<string>();
      const entries: PromptEntry[] = [];
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
        entries.push({
          name,
          content,
          ...(assertString(e["description"], "prompts[].description") !== undefined
            ? { description: e["description"] as string }
            : {}),
        });
      }
      out.prompts = entries;
    } else if (prompts !== null && typeof prompts === "object") {
      const cfg = prompts as Record<string, unknown>;
      const next: PromptsConfig = {};
      const disabled = cfg["disabled"];
      if (
        disabled !== undefined &&
        (!Array.isArray(disabled) || disabled.some((d) => typeof d !== "string" || d.trim() === ""))
      ) {
        throw new SettingsError("prompts.disabled 须为非空字符串数组");
      }
      const roots = cfg["roots"];
      if (
        roots !== undefined &&
        (!Array.isArray(roots) || roots.some((r) => typeof r !== "string" || r.trim() === ""))
      ) {
        throw new SettingsError("prompts.roots 须为非空字符串数组");
      }
      if (cfg["allowShellExpansion"] !== undefined && typeof cfg["allowShellExpansion"] !== "boolean") {
        throw new SettingsError("prompts.allowShellExpansion 须为布尔值");
      }
      if (disabled !== undefined) next.disabled = disabled as string[];
      if (roots !== undefined) next.roots = roots as string[];
      if (cfg["allowShellExpansion"] !== undefined) {
        next.allowShellExpansion = cfg["allowShellExpansion"] as boolean;
      }
      if (next.disabled !== undefined || next.roots !== undefined || next.allowShellExpansion !== undefined) {
        out.prompts = next;
      }
    } else {
      throw new SettingsError("prompts 须为数组（旧内联库）或对象（文件域配置）");
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
        // T-P3-145：指令 32KB 上限（pi-desktop MAX_SUBAGENT_BYTES 同值——prompt
        // 进子装配系统提示，超大会炸子上下文，fail-closed）
        if (Buffer.byteLength(prompt, "utf8") > 32 * 1024) {
          throw new SettingsError("subagents[].prompt 超限（上限 32KB）");
        }
      }
      // T-P3-145：推理强度（"omit" 哨兵 = 不传递；其余走 THINKING_LEVELS 白名单）
      if (
        e["reasoning"] !== undefined &&
        e["reasoning"] !== "omit" &&
        !(THINKING_LEVELS as readonly string[]).includes(e["reasoning"] as string)
      ) {
        throw new Error(`subagents[].reasoning 非法（合法：omit|${THINKING_LEVELS.join("|")}）`);
      }
      // T-P3-145：输出上限（单次响应 output cap——pi-desktop maxTokens 语义）
      if (
        e["maxTokens"] !== undefined &&
        (typeof e["maxTokens"] !== "number" || !Number.isInteger(e["maxTokens"]) || e["maxTokens"] < 1 || e["maxTokens"] > 200_000)
      ) {
        throw new SettingsError("subagents[].maxTokens 须为 1..200000 的整数");
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
          ...(e["reasoning"] !== undefined ? { reasoning: e["reasoning"] as "omit" | (typeof THINKING_LEVELS)[number] } : {}),
          ...(e["maxTokens"] !== undefined ? { maxTokens: e["maxTokens"] as number } : {}),
          ...(Array.isArray(e["fallbacks"]) && e["fallbacks"].length > 0 ? { fallbacks: e["fallbacks"] as string[] } : {}),
          ...(e["enabled"] === false ? { enabled: false } : {}),
        } as SubagentDefinition,
      ];
    }
  }
  // C4：子代理后端选择段（backend 闭集两值；acp 命令行非空字符串数组——
  // argv 形态不经 shell，无注入面）
  const subagentBackend = rec["subagentBackend"];
  if (subagentBackend !== undefined) {
    if (subagentBackend === null || typeof subagentBackend !== "object" || Array.isArray(subagentBackend)) {
      throw new SettingsError("subagentBackend 须为对象");
    }
    const sb = subagentBackend as Record<string, unknown>;
    if (sb["backend"] !== "in-process" && sb["backend"] !== "acp") {
      throw new SettingsError('subagentBackend.backend 非法（合法：in-process|acp）');
    }
    const acp = sb["acp"];
    if (acp !== undefined) {
      if (acp === null || typeof acp !== "object" || Array.isArray(acp)) {
        throw new SettingsError("subagentBackend.acp 须为对象");
      }
      const a = acp as Record<string, unknown>;
      if (
        !Array.isArray(a["command"]) ||
        a["command"].length === 0 ||
        a["command"].some((c) => typeof c !== "string" || (c as string).trim() === "")
      ) {
        throw new SettingsError("subagentBackend.acp.command 须为非空字符串数组（启动命令行 argv）");
      }
      if (
        a["timeoutMs"] !== undefined &&
        (typeof a["timeoutMs"] !== "number" || !Number.isInteger(a["timeoutMs"]) || a["timeoutMs"] < 1_000)
      ) {
        throw new SettingsError("subagentBackend.acp.timeoutMs 须为 ≥1000 的整数");
      }
      if (sb["backend"] !== "acp") {
        throw new SettingsError('subagentBackend.acp 仅在 backend="acp" 时合法');
      }
    } else if (sb["backend"] === "acp") {
      throw new SettingsError('backend="acp" 需要 subagentBackend.acp.command（启动命令行 argv）');
    }
    out.subagentBackend = {
      backend: sb["backend"] as "in-process" | "acp",
      ...(acp !== undefined
        ? {
            acp: {
              command: (acp as Record<string, unknown>)["command"] as string[],
              ...((acp as Record<string, unknown>)["timeoutMs"] !== undefined
                ? { timeoutMs: (acp as Record<string, unknown>)["timeoutMs"] as number }
                : {}),
            },
          }
        : {}),
    };
  }
  // S4：计算机使用开关段（enabled 布尔——缺省关）
  const computerUse = rec["computerUse"];
  if (computerUse !== undefined) {
    if (computerUse === null || typeof computerUse !== "object" || Array.isArray(computerUse)) {
      throw new SettingsError("computerUse 须为对象");
    }
    const cu = computerUse as Record<string, unknown>;
    if (cu["enabled"] !== undefined && typeof cu["enabled"] !== "boolean") {
      throw new SettingsError("computerUse.enabled 须为布尔");
    }
    out.computerUse = { ...(cu["enabled"] !== undefined ? { enabled: cu["enabled"] as boolean } : {}) };
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
      // T-P3-148 F：插件设置值（contributes.settings 声明 schema 的用户值——
      // 值闭集 string|number|boolean，zcode normalizePluginOptions 同规则；
      // schema 一致性在装载期 coerceSettingValues 校验）
      let options: Record<string, string | number | boolean> | undefined;
      if (e["options"] !== undefined) {
        const raw = e["options"];
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
          throw new SettingsError("plugins[].options 须为对象");
        }
        options = {};
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (k.trim() === "") throw new SettingsError("plugins[].options 键不能为空");
          if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
            throw new SettingsError(`plugins[].options[${k}] 值须为 string|number|boolean`);
          }
          options[k] = v;
        }
      }
      if (e["marketplace"] !== undefined && typeof e["marketplace"] !== "string") {
        throw new SettingsError("plugins[].marketplace 须为字符串");
      }
      out.plugins = [
        ...(out.plugins ?? []),
        {
          name,
          ...(transport !== undefined ? { transport } : {}),
          source,
          ...(e["allowTools"] === true ? { allowTools: true } : {}),
          ...(e["enabled"] === false ? { enabled: false } : {}),
          ...(options !== undefined ? { options } : {}),
          ...(typeof e["marketplace"] === "string" && e["marketplace"] !== "" ? { marketplace: e["marketplace"] } : {}),
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
    // engine（T-P3-174 批次 6 G1）："cloud"（缺省——baseUrl/model 必填）|
    // "local"（SenseVoice 本地推理——baseUrl/model 可缺省）
    const rawEngine = s["engine"];
    if (rawEngine !== undefined && rawEngine !== "cloud" && rawEngine !== "local") {
      throw new SettingsError('stt.engine 只接受 "cloud" | "local"');
    }
    const engine = rawEngine === "local" ? "local" : undefined;
    const baseUrl = assertString(s["baseUrl"], "stt.baseUrl");
    if (engine !== "local" && baseUrl === undefined) {
      throw new SettingsError("stt.baseUrl 缺失（OpenAI 协议端点根）");
    }
    const model = assertString(s["model"], "stt.model");
    if (engine !== "local" && model === undefined) {
      throw new SettingsError("stt.model 缺失（转写模型名）");
    }
    // maxSeconds：undefined/空缺省；非法（非正整数或超 600）fail-closed throw
    // （对齐 mcp timeoutMs 惯例；上界 600 = 10 分钟）
    let maxSeconds: number | undefined;
    const rawMax = s["maxSeconds"];
    if (rawMax !== undefined && rawMax !== null && rawMax !== "") {
      const n = Number(rawMax);
      if (!Number.isInteger(n) || n <= 0 || n > 600) {
        throw new SettingsError("stt.maxSeconds 须为 1~600 的整数秒");
      }
      maxSeconds = n;
    }
    let protocol: "transcriptions" | "chat" | undefined;
    const rawProtocol = s["protocol"];
    if (rawProtocol !== undefined && rawProtocol !== null && rawProtocol !== "") {
      if (rawProtocol !== "transcriptions" && rawProtocol !== "chat") {
        throw new SettingsError('stt.protocol 只接受 "transcriptions" | "chat"');
      }
      protocol = rawProtocol;
    }
    out.stt = {
      ...(engine !== undefined ? { engine } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(assertString(s["language"], "stt.language") !== undefined
        ? { language: s["language"] as string }
        : {}),
      ...(maxSeconds !== undefined ? { maxSeconds } : {}),
      ...(s["refineTranscript"] === true ? { refineTranscript: true } : {}),
      ...(s["silenceStop"] === true ? { silenceStop: true } : {}),
      ...(protocol !== undefined ? { protocol } : {}),
    };
  }
  const tts = rec["tts"];
  if (tts !== undefined) {
    if (tts === null || typeof tts !== "object" || Array.isArray(tts)) {
      throw new SettingsError("tts 须为对象");
    }
    const s = tts as Record<string, unknown>;
    const baseUrl = assertString(s["baseUrl"], "tts.baseUrl");
    if (baseUrl === undefined) throw new SettingsError("tts.baseUrl 缺失（OpenAI 协议端点根）");
    const model = assertString(s["model"], "tts.model");
    if (model === undefined) throw new SettingsError("tts.model 缺失（合成模型名）");
    const autoSpeak = s["autoSpeak"];
    if (autoSpeak !== undefined && typeof autoSpeak !== "boolean") {
      throw new SettingsError("tts.autoSpeak 须为布尔");
    }
    out.tts = {
      ...(autoSpeak === true ? { autoSpeak: true } : {}),
      baseUrl,
      model,
      ...(assertString(s["voice"], "tts.voice") !== undefined ? { voice: s["voice"] as string } : {}),
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
      // T-P3-143：env（string:string 平面对象——值非字符串直接拒绝，防凭据
      // 类对象被静默转写）与 timeoutMs（正有限数）。
      let env: Record<string, string> | undefined;
      if (e["env"] !== undefined) {
        if (e["env"] === null || typeof e["env"] !== "object" || Array.isArray(e["env"])) {
          throw new SettingsError("mcp[].env 须为对象（键值均为字符串）");
        }
        env = {};
        for (const [k, v] of Object.entries(e["env"] as Record<string, unknown>)) {
          if (typeof v !== "string") throw new SettingsError(`mcp[].env.${k} 须为字符串`);
          env[k] = v;
        }
      }
      if (
        e["timeoutMs"] !== undefined &&
        (typeof e["timeoutMs"] !== "number" || !Number.isFinite(e["timeoutMs"]) || e["timeoutMs"] <= 0)
      ) {
        throw new SettingsError("mcp[].timeoutMs 须为正数");
      }
      out.mcp!.push({
        name,
        command,
        ...(Array.isArray(e["args"]) ? { args: e["args"] as string[] } : {}),
        ...(env !== undefined ? { env } : {}),
        ...(e["timeoutMs"] !== undefined ? { timeoutMs: e["timeoutMs"] as number } : {}),
        ...(e["enabled"] === false ? { enabled: false } : {}),
      });
    }
  }
  const enhancement = rec["enhancement"];
  if (enhancement !== undefined) {
    if (enhancement === null || typeof enhancement !== "object" || Array.isArray(enhancement)) {
      throw new SettingsError("enhancement 须为对象");
    }
    // T-P3-147 B：provider 放宽可选（缺省 = 跳过显式面走回退链——fastModel/
    // 主模型；原"缺失即抛"语义只保留给显式给了 provider 键但为非空串校验）
    const parseTask = (v: unknown, where: string): EnhancementModelEntry | undefined => {
      if (v === undefined) return undefined;
      if (v === null || typeof v !== "object" || Array.isArray(v)) {
        throw new SettingsError(`${where} 须为对象`);
      }
      const t = v as Record<string, unknown>;
      const provider = assertString(t["provider"], `${where}.provider`);
      if (t["provider"] !== undefined && provider === undefined) {
        throw new SettingsError(`${where}.provider 须为非空字符串`);
      }
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
      // T-P3-147 B：fallbacks 有序备选（每项 {provider?, model?}——至少一项有值）
      const rawFallbacks = t["fallbacks"];
      let fallbacks: { provider?: string; model?: string }[] | undefined;
      if (rawFallbacks !== undefined) {
        if (!Array.isArray(rawFallbacks)) throw new SettingsError(`${where}.fallbacks 须为数组`);
        fallbacks = [];
        for (const f of rawFallbacks) {
          if (f === null || typeof f !== "object" || Array.isArray(f)) {
            throw new SettingsError(`${where}.fallbacks[] 须为对象`);
          }
          const fo = f as Record<string, unknown>;
          const fp = assertString(fo["provider"], `${where}.fallbacks[].provider`);
          const fm = assertString(fo["model"], `${where}.fallbacks[].model`);
          if (fp === undefined && fm === undefined) {
            throw new SettingsError(`${where}.fallbacks[] 需要 provider 或 model 至少一项`);
          }
          fallbacks.push({
            ...(fp !== undefined ? { provider: fp } : {}),
            ...(fm !== undefined ? { model: fm } : {}),
          });
        }
        if (fallbacks.length === 0) fallbacks = undefined;
      }
      return {
        ...(provider !== undefined ? { provider } : {}),
        ...(assertString(t["model"], `${where}.model`) !== undefined
          ? { model: t["model"] as string }
          : {}),
        ...(reasoning !== undefined ? { reasoning: reasoning as EnhancementModelEntry["reasoning"] } : {}),
        ...(fallbacks !== undefined ? { fallbacks } : {}),
      };
    };
    const rec2 = enhancement as Record<string, unknown>;
    // T-P3-147 G：总闸（缺省 true——只有显式 false 才关）
    let enabled: boolean | undefined;
    if (rec2["enabled"] !== undefined) {
      if (typeof rec2["enabled"] !== "boolean") throw new SettingsError("enhancement.enabled 须为布尔值");
      enabled = rec2["enabled"];
    }
    // T-P3-147 B：fastModel 全局轻模型单点
    const fastModel = parseTask(rec2["fastModel"], "enhancement.fastModel");
    const judge = parseTask(rec2["judge"], "enhancement.judge");
    const summarizer = parseTask(rec2["summarizer"], "enhancement.summarizer");
    // T-P3-146 I：润色任务（provider 可缺省——缺省回退 fastModel → 主模型链）
    let polish: NonNullable<SettingsShape["enhancement"]>["polish"] | undefined;
    if (rec2["polish"] !== undefined) {
      const p = rec2["polish"];
      if (p === null || typeof p !== "object" || Array.isArray(p)) {
        throw new SettingsError("enhancement.polish 须为对象");
      }
      const pr = p as Record<string, unknown>;
      const base = pr["provider"] !== undefined || pr["model"] !== undefined || pr["reasoning"] !== undefined
        ? parseTask(pr, "enhancement.polish")
        : undefined;
      const customTemplate = pr["customTemplate"];
      if (customTemplate !== undefined && typeof customTemplate !== "boolean") {
        throw new SettingsError("enhancement.polish.customTemplate 须为布尔值");
      }
      const template = assertString(pr["template"], "enhancement.polish.template");
      if (template !== undefined && Buffer.byteLength(template, "utf8") > 8000) {
        throw new SettingsError("enhancement.polish.template 超限（上限 8000 字符）");
      }
      if (template !== undefined && !template.includes("{{draft}}")) {
        throw new SettingsError("enhancement.polish.template 缺少 {{draft}} 占位符");
      }
      polish = {
        ...(base !== undefined ? base : {}),
        ...(customTemplate !== undefined ? { customTemplate } : {}),
        ...(template !== undefined ? { template } : {}),
      };
    }
    // T-P3-147 E：标题任务（prompt 覆写 ≤2000 字符）
    let title: NonNullable<SettingsShape["enhancement"]>["title"] | undefined;
    if (rec2["title"] !== undefined) {
      const tv = rec2["title"];
      if (tv === null || typeof tv !== "object" || Array.isArray(tv)) {
        throw new SettingsError("enhancement.title 须为对象");
      }
      const tr = tv as Record<string, unknown>;
      const base = parseTask(tr, "enhancement.title");
      const prompt = assertString(tr["prompt"], "enhancement.title.prompt");
      if (prompt !== undefined && Buffer.byteLength(prompt, "utf8") > 2000) {
        throw new SettingsError("enhancement.title.prompt 超限（上限 2000 字符）");
      }
      title = {
        ...(base ?? {}),
        ...(prompt !== undefined ? { prompt } : {}),
      };
    }
    // T-P3-147 H：压缩摘要指令覆写（≤8000 字符——润色模板同档）
    const summaryPrompt = assertString(rec2["summaryPrompt"], "enhancement.summaryPrompt");
    if (summaryPrompt !== undefined && Buffer.byteLength(summaryPrompt, "utf8") > 8000) {
      throw new SettingsError("enhancement.summaryPrompt 超限（上限 8000 字符）");
    }
    if (
      enabled !== undefined ||
      fastModel !== undefined ||
      judge !== undefined ||
      summarizer !== undefined ||
      polish !== undefined ||
      title !== undefined ||
      summaryPrompt !== undefined
    ) {
      out.enhancement = {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(fastModel !== undefined ? { fastModel } : {}),
        ...(judge !== undefined ? { judge } : {}),
        ...(summarizer !== undefined ? { summarizer } : {}),
        ...(polish !== undefined ? { polish } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(summaryPrompt !== undefined ? { summaryPrompt } : {}),
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
  /** T-P3-141：回复语言显式槽（auto 不注入）。 */
  outputLanguage?: string;
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
    outputLanguage?: string;
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
  out.outputLanguage = pick("--output-language");
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
  // T-P3-141：回复语言（qwen outputLanguage 同构——内核输出语言注入系统
  // 提示；auto = 跟随输入不注入，装配零变化）
  if (explicit.outputLanguage === undefined && settings.appearance?.outputLanguage !== undefined && settings.appearance.outputLanguage !== "auto") {
    inject("--output-language", settings.appearance.outputLanguage);
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
  // T-P3-147 B：provider 可缺省（缺省 = 本条目不命中，调用方继续回退链）
  if (task.provider === undefined) return undefined;
  const entry = providers.find((p) => p.name === task.provider);
  if (entry === undefined || entry.enabled === false) return undefined;
  const modelId = task.model ?? entry.model ?? defaultModel;
  if (modelId === undefined) return undefined;
  return { entry, modelId };
}

/**
 * 任务级模型候选链（T-P3-147 B——pi fallbacks / hermes fallback_chain 同构）：
 * 任务显式面 → fallbacks 顺链，逐项解析（条目不存在/停用/无模型 = 跳过不炸）。
 * 调用方在其后再接 fastModel → 主模型链（回退次序单一来源在消费方装配处）。
 */
export function resolveEnhancementChain(
  task: EnhancementModelEntry | undefined,
  providers: readonly ProviderEntry[],
  defaultModel: string | undefined,
): { entry: ProviderEntry; modelId: string }[] {
  if (task === undefined) return [];
  const chain: { entry: ProviderEntry; modelId: string }[] = [];
  const primary = resolveEnhancementTarget(task, providers, defaultModel);
  if (primary !== undefined) chain.push(primary);
  for (const f of task.fallbacks ?? []) {
    const hit = resolveEnhancementTarget(f, providers, defaultModel);
    if (hit !== undefined && !chain.some((c) => c.entry.name === hit.entry.name && c.modelId === hit.modelId)) {
      chain.push(hit);
    }
  }
  return chain;
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
