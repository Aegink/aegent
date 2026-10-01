/**
 * 子智能体配置（U23/T-P3-126）——内置预设 + 用户自定义的解析面。
 *
 * 行为锚（pi-desktop·AgentSubagentsPage/subagent-settings.ts，🔴 只学行为）：
 *   - 内置预设与用户自定义两分区；用户同名条目覆盖内置（enabledHandles
 *     语义——停用的内置保留在清单里，开关是唯一"开回来"的路径）；
 *   - 每个子代理可独立声明工具集与模型（SubagentModelPicker/SubagentFallbackModels
 *     ——模型回退链与 U18 resolveEnhancementTarget 同构）。
 *
 * 存储定形（卡内自由度记档）：用户自定义存 settings `subagents` 段（与
 * prompts/mcp/profiles 同模式——结构化文档存储，pi-desktop 同为文档存储
 * 而非 markdown 文件；复用 settings 既有 parse/patch/UI 分节链，不为单卡
 * 引第二套文件 CRUD 面）。卡面预判的 "~/.aegent/subagents" 目录不取。
 *
 * 内置五预设按我方工具名映射（上游 Task(explorer)·Read/Glob/Grep/Bash
 * 等截图形态）：工具集是声明面（C25 activation 的 session 层消费——
 * H3/H5 降级面之上再收窄），prompt 是身份面（子装配系统提示追加段）。
 */

import type { ProviderEntry } from "./settings.js";
import { THINKING_LEVELS } from "./settings.js";

/** 子代理定义（内置预设与 settings subagents 段条目共用形状）。 */
export interface SubagentDefinition {
  /** slug（task 的 subagent_type 取值——小写字母数字与 - _）。 */
  name: string;
  description: string;
  /** 身份提示（子装配系统提示的追加段——"这个子代理是谁、怎么干活"）。 */
  prompt: string;
  /** 声明工具集（缺省 undefined = 不限——全套可用）。 */
  tools?: string[];
  /**
   * 独立模型（U23 per-subagent——与 U18 EnhancementModelEntry 同构）：
   * modelProvider = providers 条目名（凭据/adapter 按条目走），model =
   * 模型 id 覆盖（缺省回退条目 model → defaultModel 主模型链）。
   */
  modelProvider?: string;
  model?: string;
  /**
   * 推理强度覆盖（T-P3-145——pi-desktop thinkingLevel 收敛为我方档位）：
   * "omit" 哨兵 = 不传递；其余档位经 resolveSubagentModel 产物进
   * reasoningEffort 请求面（T-P3-137 四轮已通）；缺省 = 与会话一致。
   */
  reasoning?: "omit" | (typeof THINKING_LEVELS)[number];
  /** 单次响应输出上限 token（pi-desktop maxTokens 语义——1..200000）。 */
  maxTokens?: number;
  /** 故障转移候选（providers 条目名序——J15 消费面；真实装配随 J15 记档）。 */
  fallbacks?: string[];
  /** 启用开关（缺省 true；停用的内置保留清单——开关是开回的路径）。 */
  enabled?: boolean;
}

/** 内置五预设（2026-09-28 用户截图实证形态——探索者/代码审查员/测试执行者/修复者/UI 设计师）。 */
export const BUILTIN_SUBAGENTS: readonly SubagentDefinition[] = [
  {
    name: "explorer",
    description: "探索者：只读探索代码库，定位实现与结构",
    prompt:
      "你是探索者子代理：只读探索工作区，定位代码、文件与模式，" +
      "汇报结构与事实（含路径与行号），不做任何修改。",
    tools: ["read", "glob", "grep", "bash"],
  },
  {
    name: "code-reviewer",
    description: "代码审查员：只读审查改动与实现的正确性、边界与风格",
    prompt:
      "你是代码审查员子代理：只读审查指定代码与改动，关注正确性、边界条件、" +
      "错误处理与项目风格约定，输出按严重度分级的问题清单与依据。",
    tools: ["read", "glob", "grep"],
  },
  {
    name: "test-runner",
    description: "测试执行者：运行测试、读取输出、定位失败原因",
    prompt:
      "你是测试执行者子代理：按指令运行测试命令，读取完整输出，" +
      "定位失败用例与原因，汇报可复现的最小事实（命令、退出码、关键日志）。",
    tools: ["read", "glob", "grep", "bash"],
  },
  {
    name: "fixer",
    description: "修复者：定位并实施最小修复（可写文件）",
    prompt:
      "你是修复者子代理：定位问题根因并实施最小修复——只改与修复直接相关的" +
      "代码，不顺手重构，修复后说明改了什么、为什么。",
    tools: ["read", "edit", "write", "glob", "grep", "bash"],
  },
  {
    name: "ui-designer",
    description: "UI 设计师：界面代码的设计与实现（前端文件编辑）",
    prompt:
      "你是 UI 设计师子代理：负责界面代码的设计与实现（布局、组件、样式），" +
      "遵循项目现有前端约定，改动保持最小且自洽。",
    // 记档：上游 Task(ui-designer) 带 BrowserPreview——我方无对应工具面，
    // 预设收敛为前端文件编辑工具集（S3/S4 屏幕操作域面不相干）。
    tools: ["read", "edit", "write", "glob", "grep"],
  },
];

/** slug 规则（task subagent_type 的取值面——与技能名同款防呆）。 */
export const SUBAGENT_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** settings subagents 段的解析（settings.ts 引用的校验谓词——单点）。 */
export function isValidSubagentSlug(name: string): boolean {
  return SUBAGENT_SLUG_RE.test(name);
}

/** 解析结果（内置或用户自定义；enabled 已折叠）。 */
export interface ResolvedSubagent extends SubagentDefinition {
  /** 来源标记（UI 卡片与审计面——内置预设 vs 用户自定义）。 */
  readonly source: "builtin" | "user";
}

/**
 * 预设解析（task subagent_type 的入口）：用户自定义同名覆盖内置（字段级
 * 合并——覆盖记录的缺失字段引用内置值，纯停用记录 {name, enabled:false}
 * 即可）；条目 enabled === false 时返回 undefined——调用方把"停用"与
 * "未知"同为类型化拒绝（停用名单不进可用清单）。
 */
export function resolveSubagent(
  name: string,
  userDefs: readonly SubagentDefinition[] | undefined,
): ResolvedSubagent | undefined {
  const user = userDefs?.find((d) => d.name === name);
  if (user !== undefined) {
    if (user.enabled === false) return undefined;
    const builtin = BUILTIN_SUBAGENTS.find((d) => d.name === name);
    if (builtin === undefined) return { ...user, source: "user" };
    return { ...builtin, ...user, source: "user" };
  }
  const builtin = BUILTIN_SUBAGENTS.find((d) => d.name === name);
  if (builtin === undefined) return undefined;
  // 内置无同名用户条目 = 启用（停用靠用户写同名覆盖记录——无文档可删）
  return { ...builtin, source: "builtin" };
}

/**
 * 独立模型回退链（U23——SubagentModelPicker/SubagentFallbackModels 的解析面，
 * 与 U18 resolveEnhancementTarget 完全同构）：model（定义级显式 id）→
 * modelProvider 引用条目的 model → defaultModel（主模型链）。条目不存在或
 * 无 modelId 可用 = undefined（调用方回退父会话模型——"独立配置缺省回退
 * 主模型"；modelProvider/model 都未配 = 不走独立模型面）。
 */
export function resolveSubagentModel(
  subagent: SubagentDefinition,
  providers: readonly ProviderEntry[],
  defaultModel: string | undefined,
): { entry: ProviderEntry; modelId: string } | undefined {
  if (subagent.modelProvider === undefined && subagent.model === undefined) return undefined;
  const entry = providers.find((p) => p.name === subagent.modelProvider);
  if (entry === undefined) return undefined;
  const modelId = subagent.model ?? entry.model ?? defaultModel;
  if (modelId === undefined) return undefined;
  return { entry, modelId };
}

/** 管理页清单数据面（pi-desktop fetchSubagentPageData 同构）：内置行带
 * enabled 状态（用户覆盖记录折叠进内置行）+ 用户自定义分区。 */
export function subagentCatalog(userDefs: readonly SubagentDefinition[] | undefined): {
  builtins: (SubagentDefinition & { enabled: boolean; overridden: boolean })[];
  custom: SubagentDefinition[];
} {
  const builtins = BUILTIN_SUBAGENTS.map((b) => {
    const user = userDefs?.find((d) => d.name === b.name);
    return {
      ...b,
      ...(user?.tools !== undefined ? { tools: user.tools } : {}),
      ...(user?.modelProvider !== undefined ? { modelProvider: user.modelProvider } : {}),
      ...(user?.model !== undefined ? { model: user.model } : {}),
      ...(user?.fallbacks !== undefined ? { fallbacks: user.fallbacks } : {}),
      ...(user?.prompt !== undefined ? { prompt: user.prompt } : {}),
      enabled: user?.enabled !== false,
      overridden: user !== undefined,
    };
  });
  const builtinNames = new Set(builtins.map((b) => b.name));
  return {
    builtins,
    custom: (userDefs ?? []).filter((d) => !builtinNames.has(d.name)),
  };
}
