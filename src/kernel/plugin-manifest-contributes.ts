/**
 * 插件 contributes 贡献声明（T-P3-148 A——pi-desktop contributes 15 类与
 * zcode 六组件的对齐裁剪；manifest v2 的贡献形状闭集）。
 *
 * 设计裁定（参考仓先例 + 我方纪律）：
 *   - 闭集：contributes 子键闭集 {commands, skills, views, mcpServers,
 *     settings, subscriptions}，闭集外子键拒绝（我方 I9 纪律——zcode 是
 *     warn 不拒，我方沿用自身安装期全量拒绝先例，记档差异）；
 *   - 数量上限（pi-desktop 同值或近似）：commands 32 / skills 目录 8 /
 *     views 8 / mcpServers 8 / settings 32 / subscriptions 16；
 *   - 路径字段（file/skills/entry）一律相对名：禁绝对路径与 `..` 上跳
 *     （pi relativePathError 同款；运行时 resolveInside 二道防线在消费点）；
 *   - v2 判定 = manifest 带 contributes 键：v2 清单的 name 收紧为 slug 形状
 *     （zcode PLUGIN_NAME_PATTERN 同族——命令/技能命名空间 `<插件名>/<名>`
 *     依赖它；旧清单无名形状校验，向后兼容零破坏）；
 *   - 命令条目 file|template 严格二选一（zcode source/content 同规则）；
 *   - settings 引用是结构化 `{setting: 键名}`（pi-desktop mcp-config 同构，
 *     非字符串模板占位符——无注入面）；sensitive 设置值只在 env 解析点
 *     消费，宿主协议面掩码（zcode sensitive 纪律）。
 *
 * 本模块纯形状校验（无 fs）；引用文件的存在性校验在安装期 gateway（零代码
 * 执行面）与装载期 loader 双防线完成。
 */

import { EVENT_TYPES, type SessionEventType } from "./events.js";

/** 插件名 slug 形状（v2 清单强制；64 字节——命令/技能命名空间段同规则）。 */
export const PLUGIN_NAME_SHAPE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** 名称段形状（命令名/设置键/视图 id/server 名——每段独立校验）。 */
const SEGMENT_SHAPE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** 贡献数量上限（pi-desktop 常量对齐：MAX_MCP_SERVERS_PER_PLUGIN=8 等）。 */
export const MAX_PLUGIN_COMMANDS = 32;
export const MAX_PLUGIN_SKILL_DIRS = 8;
export const MAX_PLUGIN_VIEWS = 8;
export const MAX_PLUGIN_MCP_SERVERS = 8;
export const MAX_PLUGIN_SETTINGS = 32;
export const MAX_PLUGIN_SUBSCRIPTIONS = 16;

/** 相对路径形状（禁绝对与 `..` 上跳——与 plugin-manifest 的 theme.css 同防线）。 */
export function relativePathError(value: string): string | undefined {
  if (value.trim() === "") return "路径不能为空";
  if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || value.startsWith("/")) {
    return `路径须为插件目录内的相对名，收到绝对路径：${value}`;
  }
  if (value.split(/[\\/]/).includes("..")) {
    return `路径不得含 ".." 上跳段：${value}`;
  }
  return undefined;
}

/** 命令贡献（zcode 对象映射形式裁剪：file|template 二选一）。 */
export interface PluginCommandContrib {
  /** 命令名段（缺省 = file 的文件名主干）；最终名 = `<插件名>/<名>`。 */
  readonly name?: string;
  /** 相对插件根的 .md 文件（frontmatter 携带 description/argument-hint）。 */
  readonly file?: string;
  /** 内联模板正文（与 file 二选一）。 */
  readonly template?: string;
  readonly description?: string;
  /** 参数提示（如 "<env> [focus]"——/ 补全行内展示）。 */
  readonly argumentHint?: string;
  /** 命令级模型覆盖（提示词模板域 H 面同语义）。 */
  readonly model?: string;
  /** 命令级子代理执行语义（提示词模板域 H 面同语义）。 */
  readonly agent?: string;
}

/** 视图贡献（pi-desktop PluginViewContrib 裁剪：id/title/entry 三必填）。 */
export interface PluginViewContrib {
  /** 视图 id（插件内唯一；全局地址 `<插件名>/<id>`）。 */
  readonly id: string;
  readonly title: string;
  /** 相对插件根的 HTML 入口（受控 iframe 渲染——波 5 消费）。 */
  readonly entry: string;
  /** 排序权重（缺省 0——详情/容器排序面）。 */
  readonly order?: number;
}

/**
 * MCP server 贡献（我方 MCP 域现仅 stdio——http/sse 随 MCP 域扩展面记档）。
 * env 值 = 字面字符串或 `{setting: 键}` 引用（pi-desktop 结构化引用同构——
 * 展开时只查插件自身设置表，宿主进程环境变量永不参与）。
 */
export interface PluginMcpServerContrib {
  /** server 名段（运行时名 = `plugin:<插件名>:<serverName>`——zcode 三段式）。 */
  readonly serverName: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string | { readonly setting: string }>>;
  /** 连接探针/启动超时（毫秒——settings mcp 条目同语义透传）。 */
  readonly timeoutMs?: number;
}

/** 设置贡献（zcode userConfig + pi-desktop settings 对齐裁剪四类型）。 */
export interface PluginSettingContrib {
  /** 设置键（插件内唯一；插件经 caps.pluginSettings 读取）。 */
  readonly name: string;
  readonly type: "string" | "number" | "boolean" | "select";
  /** 未配置时的回显/回退值（类型须与 type 一致）。 */
  readonly default?: string | number | boolean;
  readonly description?: string;
  /** true = 详情面掩码显示、协议清单不回传明文（zcode sensitive 纪律）。 */
  readonly sensitive?: boolean;
  /** true = 详情面标注必填（装配不强制——缺省回退 default，记档）。 */
  readonly required?: boolean;
  /** select 专属选项表（2~24 项）。 */
  readonly choices?: readonly (string | number | boolean)[];
}

/** contributes 贡献声明闭集（T-P3-148 A）。 */
export interface PluginContributes {
  readonly commands?: readonly PluginCommandContrib[];
  /** 技能目录（相对插件根；目录递归发现 SKILL.md——skills 域同规则）。 */
  readonly skills?: readonly string[];
  readonly views?: readonly PluginViewContrib[];
  readonly mcpServers?: readonly PluginMcpServerContrib[];
  readonly settings?: readonly PluginSettingContrib[];
  /** 事件订阅声明（G——SDK subscribe 的运行时白名单；⊆ EVENT_TYPES）。 */
  readonly subscriptions?: readonly SessionEventType[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** 字符串字段校验（trim 非空即收——返回 undefined 表示通过）。 */
function strError(value: unknown, label: string): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return `${label} 须为非空字符串`;
  }
  return undefined;
}

function optString(value: unknown, label: string, errors: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label} 须为非空字符串`);
    return undefined;
  }
  return value;
}

function segmentError(value: unknown, label: string): string | undefined {
  const s = strError(value, label);
  if (s !== undefined) return s;
  if (!SEGMENT_SHAPE.test(value as string)) {
    return `${label} 须为 slug 形状（小写字母数字开头，. - _ 可内用，≤64 字节）`;
  }
  return undefined;
}

/** 校验失败清单（同 manifest 校验风格：全量收集一次报全）。 */
export type ContributesResult =
  | { ok: true; contributes: PluginContributes }
  | { ok: false; errors: string[] };

/** contributes 全量形状校验（闭集子键 + 逐类形状 + 数量上限 + 去重）。 */
export function validateContributes(input: unknown): ContributesResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["contributes 必须是对象"] };
  }
  const allowed = ["commands", "skills", "views", "mcpServers", "settings", "subscriptions"];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      errors.push(`contributes 闭集外子键：${key}（允许：${allowed.join(", ")}）`);
    }
  }

  // —— commands ——
  let commands: PluginCommandContrib[] | undefined;
  const rawCommands = input["commands"];
  if (rawCommands !== undefined) {
    if (!Array.isArray(rawCommands)) {
      errors.push("contributes.commands 必须是数组");
    } else {
      if (rawCommands.length > MAX_PLUGIN_COMMANDS) {
        errors.push(`contributes.commands 超上限：${String(rawCommands.length)} > ${MAX_PLUGIN_COMMANDS}`);
      }
      const seen = new Set<string>();
      commands = [];
      rawCommands.forEach((entry, index) => {
        const label = `contributes.commands[${String(index)}]`;
        if (!isRecord(entry)) {
          errors.push(`${label} 必须是对象`);
          return;
        }
        const name = optString(entry["name"], `${label}.name`, errors);
        if (name !== undefined && SEGMENT_SHAPE.test(name) === false) {
          errors.push(`${label}.name 须为 slug 形状（小写字母数字开头，. - _ 可内用）`);
        }
        const hasFile = entry["file"] !== undefined;
        const hasTemplate = entry["template"] !== undefined;
        if (hasFile === hasTemplate) {
          errors.push(`${label} 的 file 与 template 必须二选一（zcode source/content 同规则）`);
        }
        let file: string | undefined;
        if (hasFile) {
          const raw = entry["file"];
          if (typeof raw !== "string" || !raw.endsWith(".md")) {
            errors.push(`${label}.file 须为 .md 相对文件名`);
          } else {
            const pathErr = relativePathError(raw);
            if (pathErr !== undefined) errors.push(`${label}.file：${pathErr}`);
            else file = raw;
          }
        }
        const template = optString(entry["template"], `${label}.template`, errors);
        const description = optString(entry["description"], `${label}.description`, errors);
        const argumentHint = optString(entry["argumentHint"], `${label}.argumentHint`, errors);
        const model = optString(entry["model"], `${label}.model`, errors);
        const agent = optString(entry["agent"], `${label}.agent`, errors);
        const finalKey = name ?? (file !== undefined ? file.replace(/\.md$/, "").split(/[\\/]/).pop() ?? "" : "");
        if (finalKey !== "") {
          if (seen.has(finalKey)) errors.push(`${label} 命令名重复：${finalKey}`);
          else seen.add(finalKey);
        }
        commands!.push({
          ...(name !== undefined ? { name } : {}),
          ...(file !== undefined ? { file } : {}),
          ...(template !== undefined ? { template } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(argumentHint !== undefined ? { argumentHint } : {}),
          ...(model !== undefined ? { model } : {}),
          ...(agent !== undefined ? { agent } : {}),
        });
      });
    }
  }

  // —— skills ——
  let skills: string[] | undefined;
  const rawSkills = input["skills"];
  if (rawSkills !== undefined) {
    const list = Array.isArray(rawSkills) ? rawSkills : [rawSkills];
    if (list.length > MAX_PLUGIN_SKILL_DIRS) {
      errors.push(`contributes.skills 超上限：${String(list.length)} > ${MAX_PLUGIN_SKILL_DIRS}`);
    }
    skills = [];
    const seen = new Set<string>();
    for (const [index, raw] of list.entries()) {
      const label = `contributes.skills[${String(index)}]`;
      if (typeof raw !== "string") {
        errors.push(`${label} 须为相对目录名（字符串）`);
        continue;
      }
      const pathErr = relativePathError(raw);
      if (pathErr !== undefined) {
        errors.push(`${label}：${pathErr}`);
        continue;
      }
      const norm = raw.replace(/\\/g, "/").replace(/\/$/, "");
      if (seen.has(norm)) errors.push(`${label} 目录重复：${norm}`);
      else seen.add(norm);
      skills.push(norm);
    }
  }

  // —— views ——
  let views: PluginViewContrib[] | undefined;
  const rawViews = input["views"];
  if (rawViews !== undefined) {
    if (!Array.isArray(rawViews)) {
      errors.push("contributes.views 必须是数组");
    } else {
      if (rawViews.length > MAX_PLUGIN_VIEWS) {
        errors.push(`contributes.views 超上限：${String(rawViews.length)} > ${MAX_PLUGIN_VIEWS}`);
      }
      const seen = new Set<string>();
      views = [];
      rawViews.forEach((entry, index) => {
        const label = `contributes.views[${String(index)}]`;
        if (!isRecord(entry)) {
          errors.push(`${label} 必须是对象`);
          return;
        }
        const idErr = segmentError(entry["id"], `${label}.id`);
        if (idErr !== undefined) errors.push(idErr);
        const titleErr = strError(entry["title"], `${label}.title`);
        if (titleErr !== undefined) errors.push(titleErr);
        let entryPath: string | undefined;
        const rawEntry = entry["entry"];
        if (typeof rawEntry !== "string" || !rawEntry.endsWith(".html")) {
          errors.push(`${label}.entry 须为 .html 相对文件名`);
        } else {
          const pathErr = relativePathError(rawEntry);
          if (pathErr !== undefined) errors.push(`${label}.entry：${pathErr}`);
          else entryPath = rawEntry;
        }
        if (typeof entry["id"] === "string" && idErr === undefined) {
          if (seen.has(entry["id"])) errors.push(`${label} 视图 id 重复：${entry["id"]}`);
          else seen.add(entry["id"]);
        }
        if (entry["order"] !== undefined && (typeof entry["order"] !== "number" || !Number.isFinite(entry["order"]))) {
          errors.push(`${label}.order 须为数字`);
        }
        if (idErr === undefined && titleErr === undefined && entryPath !== undefined) {
          views!.push({
            id: entry["id"] as string,
            title: entry["title"] as string,
            entry: entryPath,
            ...(typeof entry["order"] === "number" && Number.isFinite(entry["order"]) ? { order: entry["order"] } : {}),
          });
        }
      });
    }
  }

  // —— mcpServers ——
  let mcpServers: PluginMcpServerContrib[] | undefined;
  const rawMcp = input["mcpServers"];
  if (rawMcp !== undefined) {
    if (!Array.isArray(rawMcp)) {
      errors.push("contributes.mcpServers 必须是数组");
    } else {
      if (rawMcp.length > MAX_PLUGIN_MCP_SERVERS) {
        errors.push(`contributes.mcpServers 超上限：${String(rawMcp.length)} > ${MAX_PLUGIN_MCP_SERVERS}`);
      }
      const seen = new Set<string>();
      mcpServers = [];
      rawMcp.forEach((entry, index) => {
        const label = `contributes.mcpServers[${String(index)}]`;
        if (!isRecord(entry)) {
          errors.push(`${label} 必须是对象`);
          return;
        }
        const nameErr = segmentError(entry["serverName"], `${label}.serverName`);
        if (nameErr !== undefined) {
          errors.push(nameErr);
        } else if (seen.has(entry["serverName"] as string)) {
          errors.push(`${label} serverName 重复：${entry["serverName"]}`);
        } else {
          seen.add(entry["serverName"] as string);
        }
        const cmdErr = strError(entry["command"], `${label}.command`);
        if (cmdErr !== undefined) errors.push(cmdErr);
        let args: string[] | undefined;
        if (entry["args"] !== undefined) {
          if (!Array.isArray(entry["args"]) || (entry["args"] as unknown[]).some((a) => typeof a !== "string")) {
            errors.push(`${label}.args 须为字符串数组`);
          } else {
            args = entry["args"] as string[];
          }
        }
        let env: Record<string, string | { setting: string }> | undefined;
        if (entry["env"] !== undefined) {
          if (!isRecord(entry["env"])) {
            errors.push(`${label}.env 须为对象`);
          } else {
            env = {};
            for (const [k, v] of Object.entries(entry["env"])) {
              if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
                errors.push(`${label}.env 键「${k}」须为环境变量名形状`);
                continue;
              }
              if (typeof v === "string") {
                env[k] = v;
              } else if (isRecord(v) && typeof v["setting"] === "string" && (v["setting"] as string).trim() !== "") {
                env[k] = { setting: v["setting"] };
              } else {
                errors.push(`${label}.env[${k}] 须为字符串或 {setting: 设置键名} 引用`);
              }
            }
          }
        }
        if (entry["timeoutMs"] !== undefined && (typeof entry["timeoutMs"] !== "number" || !(entry["timeoutMs"] > 0) || !Number.isInteger(entry["timeoutMs"]))) {
          errors.push(`${label}.timeoutMs 须为正整数`);
        }
        if (nameErr === undefined && cmdErr === undefined) {
          mcpServers!.push({
            serverName: entry["serverName"] as string,
            command: entry["command"] as string,
            ...(args !== undefined ? { args } : {}),
            ...(env !== undefined ? { env } : {}),
            ...(typeof entry["timeoutMs"] === "number" ? { timeoutMs: entry["timeoutMs"] } : {}),
          });
        }
      });
    }
  }

  // —— settings ——
  let settings: PluginSettingContrib[] | undefined;
  const rawSettings = input["settings"];
  if (rawSettings !== undefined) {
    if (!Array.isArray(rawSettings)) {
      errors.push("contributes.settings 必须是数组");
    } else {
      if (rawSettings.length > MAX_PLUGIN_SETTINGS) {
        errors.push(`contributes.settings 超上限：${String(rawSettings.length)} > ${MAX_PLUGIN_SETTINGS}`);
      }
      const seen = new Set<string>();
      settings = [];
      rawSettings.forEach((entry, index) => {
        const label = `contributes.settings[${String(index)}]`;
        if (!isRecord(entry)) {
          errors.push(`${label} 必须是对象`);
          return;
        }
        const nameErr = segmentError(entry["name"], `${label}.name`);
        if (nameErr !== undefined) {
          errors.push(nameErr);
        } else if (seen.has(entry["name"] as string)) {
          errors.push(`${label} 设置键重复：${entry["name"]}`);
        } else {
          seen.add(entry["name"] as string);
        }
        const type = entry["type"];
        const typeOk = type === "string" || type === "number" || type === "boolean" || type === "select";
        if (!typeOk) {
          errors.push(`${label}.type 须为 "string" | "number" | "boolean" | "select"`);
        }
        const def = entry["default"];
        if (def !== undefined && typeOk) {
          const defOk =
            (type === "string" && typeof def === "string") ||
            (type === "number" && typeof def === "number" && Number.isFinite(def)) ||
            (type === "boolean" && typeof def === "boolean") ||
            (type === "select" && (typeof def === "string" || typeof def === "number" || typeof def === "boolean"));
          if (!defOk) errors.push(`${label}.default 类型与 type 不一致`);
        }
        let choices: (string | number | boolean)[] | undefined;
        if (type === "select") {
          if (!Array.isArray(entry["choices"]) || (entry["choices"] as unknown[]).length < 2 || (entry["choices"] as unknown[]).length > 24) {
            errors.push(`${label} select 类型必须带 choices（2~24 项）`);
          } else if ((entry["choices"] as unknown[]).some((c) => typeof c !== "string" && typeof c !== "number" && typeof c !== "boolean")) {
            errors.push(`${label}.choices 项须为 string|number|boolean`);
          } else {
            choices = entry["choices"] as (string | number | boolean)[];
            if (def !== undefined && !choices.some((c) => Object.is(c, def))) {
              errors.push(`${label}.default 不在 choices 内`);
            }
          }
        } else if (entry["choices"] !== undefined) {
          errors.push(`${label}.choices 仅 select 类型可用`);
        }
        for (const k of ["sensitive", "required"] as const) {
          if (entry[k] !== undefined && typeof entry[k] !== "boolean") {
            errors.push(`${label}.${k} 须为布尔值`);
          }
        }
        if (entry["description"] !== undefined && strError(entry["description"], `${label}.description`) !== undefined) {
          errors.push(`${label}.description 须为非空字符串`);
        }
        if (nameErr === undefined && typeOk) {
          settings!.push({
            name: entry["name"] as string,
            type,
            ...(def !== undefined && (typeof def === "string" || typeof def === "number" || typeof def === "boolean") ? { default: def } : {}),
            ...("description" in entry && typeof entry["description"] === "string" ? { description: entry["description"] } : {}),
            ...(entry["sensitive"] === true ? { sensitive: true } : {}),
            ...(entry["required"] === true ? { required: true } : {}),
            ...(choices !== undefined ? { choices } : {}),
          });
        }
      });
    }
  }

  // —— subscriptions（G）——
  let subscriptions: SessionEventType[] | undefined;
  const rawSubs = input["subscriptions"];
  if (rawSubs !== undefined) {
    if (!Array.isArray(rawSubs)) {
      errors.push("contributes.subscriptions 必须是数组");
    } else {
      if (rawSubs.length > MAX_PLUGIN_SUBSCRIPTIONS) {
        errors.push(`contributes.subscriptions 超上限：${String(rawSubs.length)} > ${MAX_PLUGIN_SUBSCRIPTIONS}`);
      }
      const seen = new Set<string>();
      subscriptions = [];
      for (const [index, raw] of rawSubs.entries()) {
        if (typeof raw !== "string" || !(EVENT_TYPES as readonly string[]).includes(raw)) {
          errors.push(
            `contributes.subscriptions[${String(index)}] 须为 EVENT_TYPES 闭集成员，收到 ${JSON.stringify(raw) ?? "undefined"}`,
          );
          continue;
        }
        if (seen.has(raw)) errors.push(`contributes.subscriptions[${String(index)}] 重复：${raw}`);
        else {
          seen.add(raw);
          subscriptions.push(raw as SessionEventType);
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    contributes: {
      ...(commands !== undefined ? { commands } : {}),
      ...(skills !== undefined ? { skills } : {}),
      ...(views !== undefined ? { views } : {}),
      ...(mcpServers !== undefined ? { mcpServers } : {}),
      ...(settings !== undefined ? { settings } : {}),
      ...(subscriptions !== undefined ? { subscriptions } : {}),
    },
  };
}

/**
 * 设置值合并（F 装配消费）：声明 schema + settings.plugins[].options 值 →
 * 合并结果 + 问题清单。类型不符/未知键 → 用 default 并记问题（宽容面——
 * 值错误不拒装载，诊断可见）；select 值须 ∈ choices。
 */
export function coerceSettingValues(
  schema: readonly PluginSettingContrib[] | undefined,
  values: Record<string, unknown> | undefined,
): { merged: Record<string, unknown>; issues: string[] } {
  const merged: Record<string, unknown> = {};
  const issues: string[] = [];
  if (schema === undefined || schema.length === 0) return { merged, issues };
  for (const item of schema) {
    const raw = values?.[item.name];
    if (raw === undefined || raw === null) {
      if (item.default !== undefined) merged[item.name] = item.default;
      continue;
    }
    const typeOk =
      (item.type === "string" && typeof raw === "string") ||
      (item.type === "number" && typeof raw === "number" && Number.isFinite(raw)) ||
      (item.type === "boolean" && typeof raw === "boolean") ||
      (item.type === "select" && (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean"));
    if (!typeOk) {
      issues.push(`设置「${item.name}」值类型与声明 ${item.type} 不符——回退缺省`);
      if (item.default !== undefined) merged[item.name] = item.default;
      continue;
    }
    if (item.type === "select" && item.choices !== undefined && !item.choices.some((c) => Object.is(c, raw))) {
      issues.push(`设置「${item.name}」值不在 choices 内——回退缺省`);
      if (item.default !== undefined) merged[item.name] = item.default;
      continue;
    }
    merged[item.name] = raw;
  }
  for (const key of Object.keys(values ?? {})) {
    if (!schema.some((s) => s.name === key)) {
      issues.push(`未知设置键「${key}」（未在 contributes.settings 声明）——忽略`);
    }
  }
  return { merged, issues };
}
