/**
 * settings 信封域（U14/T-P3-103；U22/T-P3-125 拆分）——端 → host settings
 * 直答信封的形状与严格校验。独立成域文件是行数纪律的拆分位：settings op
 * 闭集持续扩张（U17 mcp-check / U20 import / U22 技能管理），集中在一处
 * 收拢类型与 parse，protocol.ts 只留回调签名、protocol-parse.ts 只留分派。
 *
 * 分层分工不变：本文件（parse 层）只管信封形状（op 闭集 + 载荷类型）；
 * 业务规则（段白名单、名称冲突、技能字节上限）在 gateway 层。
 */

// 本文件不 import bounded：错误消息的有界转写统一在 protocol.ts 的
// catch 层（parse 层抛原文，转写面单点）。

import { THINKING_LEVELS } from "../session/settings.js";

/** settings 直答 op 闭集（与 bridge 分流一一对应）。 */
export type SettingsOp =
  | "get"
  | "update"
  | "credentials-set"
  | "credentials-delete"
  | "credentials-list"
  | "probe"
  | "session-delete"
  | "mcp-check"
  | "import"
  /** U22/T-P3-125：技能清单（多根扫描 + 停用过滤——管理页数据面）。 */
  | "skills-list"
  /** U22/T-P3-125：技能编辑器写回（新建/编辑——写 workspace 技能目录）。 */
  | "skill-save"
  /** U23/T-P3-126：子代理管理页清单（内置五预设 + 用户自定义分区）。 */
  | "subagents-list"
  /** U24/T-P3-127：指令中心数据面（三文件位 + 规则 lint issues）。 */
  | "instructions-list"
  /** U24/T-P3-127：指令文件写回（target 白名单三位）。 */
  | "instruction-save"
  /** U26/T-P3-129：语音转写代理（UI 录音上送——P4 消费端）。 */
  | "stt-transcribe"
  /** T-P3-133：插件装载清单（安装期校验诊断——管理页数据面）。 */
  | "plugins-list"
  /**
   * T-P3-137：供应商模型清单拉取（host 代理 GET /models——WebView CSP
   * 不放外网，拉取面在 host；自足载荷 = UI 草稿直传，key 缺省走凭据）。
   */
  | "provider-models"
  /**
   * T-P3-137：供应商真实对话测试（host 代理发"你好"单轮——用户裁决
   * "成功才算可以使用"；成功回执含模型回复摘要与延迟）。
   */
  | "provider-test"
  /** T-P3-137 八轮 E：审批历史（策略拒绝/审批记录——bridge 扫当前会话流）。 */
  | "policy-audit"
  /** T-P3-140 批次 B：沙箱自检（doctor 四项检查 + 生效面一览——无载荷）。 */
  | "sandbox-doctor"
  /** T-P3-141：插件主题 CSS 读取（UI 注入 <style>——pi-desktop 主题即插件）。 */
  | "plugin-theme-css";

/** 技能编辑器写回载荷（op=skill-save；frontmatter + 正文的一次性形状）。 */
export interface SkillSavePayload {
  /** 技能名 = 目录名（slug：小写字母数字开头，`. - _` 可内用；防路径穿越）。 */
  readonly name: string;
  readonly description: string;
  /** SKILL.md 正文（frontmatter 之后的部分）。 */
  readonly body: string;
  /** 技能声明的工作工具集（可选——frontmatter `tools:` 行）。 */
  readonly tools?: readonly string[];
}

/** settings 信封 call 形状（HostServerOptions.onSettings 的入参类型）。 */
export type SettingsCall = {
  op: SettingsOp;
  patch?: Record<string, unknown>;
  /** op=import：配置包内的 settings 段（U20——形状校验在 gateway）。 */
  settings?: Record<string, unknown>;
  provider?: string;
  key?: string;
  /** op=session-delete：目标会话 id（U3 删除入口的 wire 面）。 */
  sessionId?: string;
  /** op=mcp-check：连接校验目标（U17——McpServerEntry 形状）。 */
  name?: string;
  command?: string;
  args?: string[];
  /** op=skill-save：技能编辑器写回载荷（U22）。 */
  skill?: SkillSavePayload;
  /** op=instruction-save：指令写回目标（U24——白名单三值之一）。 */
  target?: string;
  /** op=instruction-save / stt-transcribe：内容或音频 base64（U24/U26）。 */
  content?: string;
  /** op=stt-transcribe：音频 mediaType（U26——AUDIO_MEDIA_TYPES 白名单在 gateway）。 */
  mediaType?: string;
  /** op=provider-models / provider-test：端点自足载荷（T-P3-137——UI 草稿
   * 直传 baseUrl/adapter/headers；apiKey 缺省走 credentials 凭据面）。 */
  baseUrl?: string;
  adapter?: string;
  modelId?: string;
  apiKey?: string;
  /** op=provider-models / provider-test：自定义请求头（保留键在 gateway 剔除）。 */
  headers?: Record<string, string>;
};

/** 技能名 slug 规则（U22——目录名安全面：小写字母数字开头，禁 `..`）。 */
const SKILL_SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** U24/T-P3-127 指令写回目标白名单（host 侧路径收敛——防任意文件写）。 */
export const INSTRUCTION_TARGETS = ["project-agents", "global-agents", "user-rules"] as const;
export type InstructionTarget = (typeof INSTRUCTION_TARGETS)[number];

/** 解析 settings 信封（op 闭集 + 各 op 载荷形状——坏形状整信封拒绝）。 */
export function parseSettingsEnvelope(record: Record<string, unknown>): SettingsCall {
  const unknownKey = rejectUnknownKeys(record, [
    "type",
    "requestId",
    "op",
    "patch",
    "provider",
    "key",
    "sessionId",
    "name",
    "command",
    "args",
    "settings",
    "skill",
    "target",
    "content",
    "mediaType",
    "baseUrl",
    "adapter",
    "modelId",
    "apiKey",
    "headers",
    "reasoning",
  ]);
  if (unknownKey) throw new Error(`settings 信封${unknownKey}`);
  if (typeof record["requestId"] !== "string" || record["requestId"] === "") {
    throw new Error("settings 需要 requestId 非空字符串");
  }
  const op = record["op"];
  if (
    op !== "get" &&
    op !== "update" &&
    op !== "credentials-set" &&
    op !== "credentials-delete" &&
    op !== "credentials-list" &&
    op !== "probe" &&
    op !== "session-delete" &&
    op !== "mcp-check" &&
    op !== "import" &&
    op !== "skills-list" &&
    op !== "skill-save" &&
    op !== "subagents-list" &&
    op !== "instructions-list" &&
    op !== "instruction-save" &&
    op !== "stt-transcribe" &&
    op !== "plugins-list" &&
    op !== "provider-models" &&
    op !== "provider-test" &&
    op !== "policy-audit" &&
    op !== "sandbox-doctor" &&
    op !== "plugin-theme-css"
  ) {
    throw new Error(
      `settings 的 op 非法：${String(op)}（合法：get|update|credentials-set|credentials-delete|credentials-list|probe|session-delete|import|skills-list|skill-save|subagents-list|instructions-list|instruction-save|stt-transcribe|plugins-list|provider-models|provider-test|policy-audit|sandbox-doctor|plugin-theme-css）`,
    );
  }
  if (op === "plugin-theme-css") {
    if (typeof record["name"] !== "string" || record["name"] === "") {
      throw new Error("settings op=plugin-theme-css 需要 name（插件名）非空字符串");
    }
  }
  if (op === "update") {
    if (record["patch"] === null || typeof record["patch"] !== "object" || Array.isArray(record["patch"])) {
      throw new Error("settings op=update 需要 patch 对象");
    }
    // 段白名单在 gateway 层（applySettingsPatch——业务规则回类型化
    // SETTINGS_PATCH_SECTION_UNKNOWN；parse 层只管信封形状）
  }
  if (op === "credentials-set") {
    if (typeof record["provider"] !== "string" || record["provider"] === "") {
      throw new Error("settings op=credentials-set 需要 provider 非空字符串");
    }
    if (typeof record["key"] !== "string" || record["key"] === "") {
      throw new Error("settings op=credentials-set 需要 key 非空字符串");
    }
  }
  if (op === "credentials-delete" || op === "probe") {
    if (typeof record["provider"] !== "string" || record["provider"] === "") {
      throw new Error(`settings op=${op} 需要 provider 非空字符串`);
    }
  }
  if (op === "session-delete") {
    if (typeof record["sessionId"] !== "string" || record["sessionId"] === "") {
      throw new Error("settings op=session-delete 需要 sessionId 非空字符串");
    }
  }
  // U17/T-P3-119：mcp-check 的载荷 = name/command/args（McpServerEntry 形状
  // ——名字规则与 args 类型在 parse 层即校验，连接失败在 gateway 层转回执）
  if (op === "mcp-check") {
    if (typeof record["name"] !== "string" || record["name"] === "" || record["name"].includes("__")) {
      throw new Error("settings op=mcp-check 需要 name（非空且不含 \"__\"）");
    }
    if (typeof record["command"] !== "string" || record["command"] === "") {
      throw new Error("settings op=mcp-check 需要 command 非空字符串");
    }
    if (
      record["args"] !== undefined &&
      (!Array.isArray(record["args"]) || record["args"].some((a) => typeof a !== "string"))
    ) {
      throw new Error("settings op=mcp-check 的 args 须为字符串数组");
    }
  }
  // U20/T-P3-122：import 的载荷 = 配置包内 settings 对象（形状校验在
  // gateway 落盘前——parse 层只管"必须是对象"）
  if (op === "import") {
    const st = record["settings"];
    if (st === null || typeof st !== "object" || Array.isArray(st)) {
      throw new Error("settings op=import 需要 settings 对象（配置包内的 settings 段）");
    }
  }
  // U22/T-P3-125：skill-save 的载荷 = skill 对象（编辑器四字段——slug 与
  // 字节上限的业务校验在 gateway 层，parse 层只管形状）
  if (op === "skill-save") {
    const sk = record["skill"];
    if (sk === null || typeof sk !== "object" || Array.isArray(sk)) {
      throw new Error("settings op=skill-save 需要 skill 对象");
    }
    const s = sk as Record<string, unknown>;
    if (typeof s["name"] !== "string" || !SKILL_SLUG_RE.test(s["name"]) || s["name"].includes("..")) {
      throw new Error("settings op=skill-save 的 skill.name 须为 slug 形状（小写字母数字开头，. - _ 可内用）");
    }
    if (typeof s["description"] !== "string" || s["description"].trim() === "") {
      throw new Error("settings op=skill-save 的 skill.description 须为非空字符串");
    }
    if (typeof s["body"] !== "string" || s["body"].trim() === "") {
      throw new Error("settings op=skill-save 的 skill.body 须为非空字符串");
    }
    if (
      s["tools"] !== undefined &&
      (!Array.isArray(s["tools"]) || s["tools"].some((t) => typeof t !== "string" || t === ""))
    ) {
      throw new Error("settings op=skill-save 的 skill.tools 须为非空字符串数组");
    }
  }
  // U24/T-P3-127：instruction-save 的载荷 = target（白名单三值）+ content
  // （字符串——内容校验在 gateway 的规则 lint 面，save 不阻断）
  if (op === "instruction-save") {
    if (typeof record["target"] !== "string" || !(INSTRUCTION_TARGETS as readonly string[]).includes(record["target"])) {
      throw new Error(
        `settings op=instruction-save 需要 target（合法：${INSTRUCTION_TARGETS.join("|")}）`,
      );
    }
    if (typeof record["content"] !== "string" || record["content"] === "") {
      throw new Error("settings op=instruction-save 需要 content 非空字符串");
    }
  }
  // U26/T-P3-129：stt-transcribe 的载荷 = mediaType（白名单校验在 gateway
  // 的 AUDIO_MEDIA_TYPES 闭集）+ base64 音频体（content 字段承载）
  if (op === "stt-transcribe") {
    if (typeof record["mediaType"] !== "string" || record["mediaType"] === "") {
      throw new Error("settings op=stt-transcribe 需要 mediaType 非空字符串");
    }
    if (typeof record["content"] !== "string" || record["content"] === "") {
      throw new Error("settings op=stt-transcribe 需要 content（音频 base64）非空字符串");
    }
  }
  // T-P3-137：provider-models / provider-test 的自足端点载荷（baseUrl 合法
  // http(s) 地址；adapter 二枚举；test 须有 modelId——真实发"你好"的目标）。
  if (op === "provider-models" || op === "provider-test") {
    if (typeof record["provider"] !== "string" || record["provider"] === "") {
      throw new Error(`settings op=${op} 需要 provider 非空字符串（凭据键）`);
    }
    if (typeof record["baseUrl"] !== "string" || !/^https?:\/\//.test(record["baseUrl"])) {
      throw new Error(`settings op=${op} 需要 baseUrl（http/https 地址）`);
    }
    if (record["adapter"] !== "openai" && record["adapter"] !== "openai-responses" && record["adapter"] !== "anthropic" && record["adapter"] !== "google") {
      throw new Error(`settings op=${op} 的 adapter 非法（合法：openai|openai-responses|anthropic|google）`);
    }
    if (op === "provider-test" && (typeof record["modelId"] !== "string" || record["modelId"] === "")) {
      throw new Error("settings op=provider-test 需要 modelId（真实对话的目标模型）");
    }
    // T-P3-137 三轮：默认思考档（可选——传入即测试请求真实消费该档）
    if (record["reasoning"] !== undefined && (typeof record["reasoning"] !== "string" || !(THINKING_LEVELS as readonly string[]).includes(record["reasoning"]))) {
      throw new Error(`settings op=${op} 的 reasoning 非法（合法：${THINKING_LEVELS.join("|")}）`);
    }
    if (
      record["headers"] !== undefined &&
      (record["headers"] === null || typeof record["headers"] !== "object" || Array.isArray(record["headers"]))
    ) {
      throw new Error(`settings op=${op} 的 headers 须为对象`);
    }
  }
  return {
    op,
    ...(record["patch"] !== undefined ? { patch: record["patch"] as Record<string, unknown> } : {}),
    ...(record["settings"] !== undefined && typeof record["settings"] === "object" && !Array.isArray(record["settings"])
      ? { settings: record["settings"] as Record<string, unknown> }
      : {}),
    ...(typeof record["provider"] === "string" ? { provider: record["provider"] } : {}),
    ...(typeof record["key"] === "string" ? { key: record["key"] } : {}),
    ...(typeof record["sessionId"] === "string" ? { sessionId: record["sessionId"] } : {}),
    ...(typeof record["name"] === "string" ? { name: record["name"] } : {}),
    ...(typeof record["command"] === "string" ? { command: record["command"] } : {}),
    ...(Array.isArray(record["args"]) ? { args: record["args"] as string[] } : {}),
    ...(record["skill"] !== undefined && typeof record["skill"] === "object" && !Array.isArray(record["skill"])
      ? { skill: record["skill"] as unknown as SkillSavePayload }
      : {}),
    ...(typeof record["target"] === "string" ? { target: record["target"] } : {}),
    ...(typeof record["content"] === "string" ? { content: record["content"] } : {}),
    ...(typeof record["mediaType"] === "string" ? { mediaType: record["mediaType"] } : {}),
    ...(record["headers"] !== undefined && typeof record["headers"] === "object" && !Array.isArray(record["headers"])
      ? { headers: record["headers"] as Record<string, string> }
      : {}),
    ...(typeof record["baseUrl"] === "string" ? { baseUrl: record["baseUrl"] } : {}),
    ...(typeof record["adapter"] === "string" ? { adapter: record["adapter"] } : {}),
    ...(typeof record["modelId"] === "string" ? { modelId: record["modelId"] } : {}),
    ...(typeof record["apiKey"] === "string" ? { apiKey: record["apiKey"] } : {}),
    ...(typeof record["reasoning"] === "string" ? { reasoning: record["reasoning"] } : {}),
  };
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return `未知属性 "${key}"`;
  }
  return null;
}
