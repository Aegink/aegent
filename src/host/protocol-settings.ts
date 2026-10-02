/**
 * settings 信封域（U14）——settings 直答信封形状与严格校验（op 闭集 +
 * 载荷类型；业务规则在 gateway 层）。本文件不 import bounded：错误消息的
 * 有界转写统一在 protocol.ts 的 catch 层（parse 层抛原文，转写面单点）。
 */
import { THINKING_LEVELS } from "../session/settings.js";
import type { JsonRecord } from "../kernel/events.js";
import type { SkillImportItem } from "./skill-import-op.js";
import { validateDomainSettingsCall } from "./settings-call-domains.js";

/** settings 直答 op 闭集（与 bridge 分流一一对应；报错串同源）。 */
const OPS = [
  "get",
  "update",
  "credentials-set",
  "credentials-delete",
  "credentials-list",
  "probe",
  "session-delete",
  "mcp-check",
  "import",
  "skills-list",
  "skill-save",
  "subagents-list",
  "instructions-list",
  "instruction-save",
  "stt-transcribe",
  "tts-synthesize",
  "fs-tree",
  "fs-read",
  "fs-shell",
  "git-clone",
  "import-scan",
  "project-tasks",
  "session-attach",
  "project-branch",
  "session-rename",
  "import-preview",
  "import-sessions",
  "plugins-list",
  "plugin-check",
  "plugin-scaffold",
  "plugin-view-html",
  "plugin-pack",
  "market",
  "provider-models",
  "provider-test",
  "policy-audit",
  "sandbox-doctor",
  "plugin-theme-css",
  "mcp-import-scan",
  "skill-import-scan",
  "skill-import-apply",
  "skill-delete",
  "skill-reveal",
  "prompts-list",
  "prompt-save",
  "prompt-delete",
  "prompt-reveal",
  "prompt-import-scan",
  "prompt-import-apply",
  "enhancement-test",
  "instruction-append",
  "instruction-test-rule",
] as const;

export type SettingsOp = (typeof OPS)[number];

// 载荷接口体在 settings-gateway-types.ts——re-export 保 protocol-settings 引用路径
export type { SkillSavePayload, PromptSavePayload } from "./settings-gateway-types.js";
import type { SkillSavePayload, PromptSavePayload } from "./settings-gateway-types.js";
export type SettingsCall = {
  op: SettingsOp;
  patch?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  provider?: string;
  key?: string;
  sessionId?: string;
  name?: string;
  command?: string;
  args?: string[];
  /**
   * op=mcp-check：server 环境变量覆盖与单请求超时（T-P3-143——行级测试
   * 与向导共用载荷，形状与 mcp[] 条目一致）。
   */
  env?: Record<string, string>;
  timeoutMs?: number;
  skill?: SkillSavePayload;
  prompt?: PromptSavePayload; // op=prompt-save：模板写回载荷（T-P3-146 C）
  items?: SkillImportItem[];
  path?: string;
  target?: string;
  content?: string;
  task?: string; // op=enhancement-test：辅助任务名（T-P3-147 D 闭集）
  // T-P3-148 载荷：dir/action/template/source/marketplace/pluginDescription/view/base
  dir?: string;
  action?: string;
  template?: string;
  source?: string;
  marketplace?: string;
  pluginDescription?: string;
  view?: string;
  base?: string;
  displayName?: string; // op=plugin-scaffold：人读显示名（缺省 = slug）
  mediaType?: string;
  text?: string; // op=tts-synthesize：合成文本（T-P3-149 D 域）
  // T-P3-151 指令中心载荷：kind=追加形态（rule|text）dryRun=只推导不落盘
  // tool/ruleArgs=规则测试器的 PolicyCall 输入。
  kind?: string;
  dryRun?: boolean;
  tool?: string;
  ruleArgs?: JsonRecord;
  // T-P3-150 项目域载荷：url=仓库地址 projectId=项目 id overwrite=归属覆盖
  url?: string;
  projectId?: string;
  overwrite?: boolean;
  importItems?: { source: string; externalId: string; projectPath?: string }[];
  /** op=provider-models / provider-test：端点自足载荷（T-P3-137——UI 草稿直传；apiKey 缺省走 credentials）。 */
  baseUrl?: string;
  adapter?: string;
  modelId?: string;
  apiKey?: string;
  headers?: Record<string, string>;
};
const SKILL_SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
// T-P3-151：指令中心 target 扩两档——project-rules（项目层规则文件）与
// memory（记忆索引 ~/.aegent/memory/MEMORY.md）。
export const INSTRUCTION_TARGETS = [
  "project-agents",
  "global-agents",
  "user-rules",
  "project-rules",
  "memory",
] as const;
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
    "env",
    "timeoutMs",
    "settings",
    "skill",
    "prompt",
    "items",
    "path",
    "target",
    "content",
    "mediaType",
    "text",
    "url",
    "kind",
    "dryRun",
    "tool",
    "ruleArgs",
    "projectId",
    "overwrite",
    "source",
    "importItems",
    "baseUrl",
    "adapter",
    "modelId",
    "apiKey",
    "headers",
    "reasoning",
    "task",
    // T-P3-148 插件/市场族载荷（与 SettingsCall 字段一一对应——漏一个即整信封被拒）
    "dir", "action", "template", "source", "marketplace",
    "pluginDescription", "view", "base", "displayName",
  ]);
  if (unknownKey) throw new Error(`settings 信封${unknownKey}`);
  if (typeof record["requestId"] !== "string" || record["requestId"] === "") {
    throw new Error("settings 需要 requestId 非空字符串");
  }
  const op = record["op"];
  if (typeof op !== "string" || !(OPS as readonly string[]).includes(op)) {
    throw new Error(`settings 的 op 非法：${String(op)}（合法：${OPS.join("|")}）`);
  }
  // 域族（插件/语音/项目）载荷校验——settings-call-domains 收敛（行数纪律；
  // 报错串同源，信封回归用例继续覆盖）
  validateDomainSettingsCall(op, record);
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
    // T-P3-143：env/timeoutMs（行级测试带条目级覆盖——形状同 mcp[] 校验）
    if (
      record["env"] !== undefined &&
      (record["env"] === null || typeof record["env"] !== "object" || Array.isArray(record["env"]) ||
        Object.values(record["env"] as Record<string, unknown>).some((v) => typeof v !== "string"))
    ) {
      throw new Error("settings op=mcp-check 的 env 须为对象（键值均为字符串）");
    }
    if (
      record["timeoutMs"] !== undefined &&
      (typeof record["timeoutMs"] !== "number" || !Number.isFinite(record["timeoutMs"]) || record["timeoutMs"] <= 0)
    ) {
      throw new Error("settings op=mcp-check 的 timeoutMs 须为正数");
    }
  }
  // T-P3-144：skill-import-apply = items（护栏在 op 层）。
  if (op === "skill-import-apply") {
    if (!Array.isArray(record["items"]) || (record["items"] as unknown[]).length === 0) {
      throw new Error("settings op=skill-import-apply 需要 items 非空数组");
    }
    for (const item of record["items"] as unknown[]) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("settings op=skill-import-apply 的 items[] 须为对象");
      }
      const it = item as Record<string, unknown>;
      if (typeof it["name"] !== "string" || it["name"] === "") throw new Error("settings op=skill-import-apply 的 items[].name 缺失");
      if (typeof it["sourcePath"] !== "string" || it["sourcePath"] === "") throw new Error("settings op=skill-import-apply 的 items[].sourcePath 缺失");
      if (it["kind"] !== "dir" && it["kind"] !== "file") throw new Error("settings op=skill-import-apply 的 items[].kind 非法（合法：dir|file）");
    }
  }
  if (op === "skill-delete" || op === "skill-reveal") {
    if (typeof record["path"] !== "string" || record["path"] === "") {
      throw new Error(`settings op=${op} 需要 path（SKILL.md 绝对路径）非空字符串`);
    }
  }
  if (op === "prompt-save") {
    const pp = record["prompt"];
    if (pp === null || typeof pp !== "object" || Array.isArray(pp)) {
      throw new Error("settings op=prompt-save 需要 prompt 对象");
    }
    const p = pp as Record<string, unknown>;
    if (typeof p["name"] !== "string" || p["name"] === "") {
      throw new Error("settings op=prompt-save 的 prompt.name 缺失");
    }
    if (typeof p["content"] !== "string" || p["content"].trim() === "") {
      throw new Error("settings op=prompt-save 的 prompt.content 须为非空字符串");
    }
    for (const key of ["description", "argumentHint", "agent", "model", "scope"] as const) {
      if (p[key] !== undefined && typeof p[key] !== "string") {
        throw new Error(`settings op=prompt-save 的 prompt.${key} 须为字符串`);
      }
    }
  }
  if (op === "prompt-delete" || op === "prompt-reveal") {
    if (typeof record["path"] !== "string" || record["path"] === "") {
      throw new Error(`settings op=${op} 需要 path（模板 .md 绝对路径）非空字符串`);
    }
  }
  if (op === "prompt-import-apply") {
    if (!Array.isArray(record["items"]) || (record["items"] as unknown[]).length === 0) {
      throw new Error("settings op=prompt-import-apply 需要 items 非空数组");
    }
    for (const item of record["items"] as unknown[]) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("settings op=prompt-import-apply 的 items[] 须为对象");
      }
      const it = item as Record<string, unknown>;
      if (typeof it["name"] !== "string" || it["name"] === "") throw new Error("settings op=prompt-import-apply 的 items[].name 缺失");
      if (typeof it["sourcePath"] !== "string" || it["sourcePath"] === "") throw new Error("settings op=prompt-import-apply 的 items[].sourcePath 缺失");
    }
  }
  // U20/T-P3-122：import 载荷 = 配置包内 settings 对象（parse 只管"是对象"）。
  if (op === "import") {
    const st = record["settings"];
    if (st === null || typeof st !== "object" || Array.isArray(st)) {
      throw new Error("settings op=import 需要 settings 对象（配置包内的 settings 段）");
    }
  }
  // U22/T-P3-125：skill-save 载荷 = skill 对象（业务校验在 gateway 层）。
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
  if (op === "enhancement-test" &&
      (typeof record["task"] !== "string" ||
        !["judge", "summarizer", "polish", "title", "fastModel"].includes(record["task"]))) {
    throw new Error("settings op=enhancement-test 需要 task（judge|summarizer|polish|title|fastModel）");
  }
  return {
    op: op as SettingsOp,
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
    ...(Array.isArray(record["items"]) ? { items: record["items"] as SkillImportItem[] } : {}),
    ...(typeof record["path"] === "string" ? { path: record["path"] } : {}),
    ...(record["env"] !== undefined && typeof record["env"] === "object" && !Array.isArray(record["env"])
      ? { env: record["env"] as Record<string, string> }
      : {}),
    ...(typeof record["timeoutMs"] === "number" ? { timeoutMs: record["timeoutMs"] } : {}),
    ...(record["skill"] !== undefined && typeof record["skill"] === "object" && !Array.isArray(record["skill"])
      ? { skill: record["skill"] as unknown as SkillSavePayload }
      : {}),
    ...(record["prompt"] !== undefined && typeof record["prompt"] === "object" && !Array.isArray(record["prompt"])
      ? { prompt: record["prompt"] as unknown as PromptSavePayload }
      : {}),
    ...(typeof record["target"] === "string" ? { target: record["target"] } : {}),
    ...(typeof record["content"] === "string" ? { content: record["content"] } : {}),
    ...(typeof record["mediaType"] === "string" ? { mediaType: record["mediaType"] } : {}),
    ...(typeof record["text"] === "string" ? { text: record["text"] } : {}),
    ...(typeof record["url"] === "string" ? { url: record["url"] } : {}),
    ...(typeof record["projectId"] === "string" ? { projectId: record["projectId"] } : {}),
    ...(record["overwrite"] === true ? { overwrite: true } : {}),
    ...(typeof record["source"] === "string" ? { source: record["source"] } : {}),
    ...(Array.isArray(record["importItems"]) ? { importItems: record["importItems"] as { source: string; externalId: string; projectPath?: string }[] } : {}),
    ...(record["headers"] !== undefined && typeof record["headers"] === "object" && !Array.isArray(record["headers"])
      ? { headers: record["headers"] as Record<string, string> }
      : {}),
    ...(typeof record["baseUrl"] === "string" ? { baseUrl: record["baseUrl"] } : {}),
    ...(typeof record["adapter"] === "string" ? { adapter: record["adapter"] } : {}),
    ...(typeof record["modelId"] === "string" ? { modelId: record["modelId"] } : {}),
    ...(typeof record["apiKey"] === "string" ? { apiKey: record["apiKey"] } : {}),
    ...(typeof record["reasoning"] === "string" ? { reasoning: record["reasoning"] } : {}),
    ...(typeof record["task"] === "string" ? { task: record["task"] } : {}),
    // T-P3-151 指令域载荷（kind/dryRun/tool/ruleArgs——返回构造漏拷即 undefined）
    ...(typeof record["tool"] === "string" ? { tool: record["tool"] } : {}),
    ...(typeof record["kind"] === "string" ? { kind: record["kind"] } : {}),
    ...(record["dryRun"] === true ? { dryRun: true } : {}),
    ...(record["ruleArgs"] !== undefined && typeof record["ruleArgs"] === "object" && !Array.isArray(record["ruleArgs"])
      ? { ruleArgs: record["ruleArgs"] as import("../kernel/events.js").JsonRecord }
      : {}),
    // T-P3-148 插件/市场族载荷（键表与白名单同源——漏拷即字段永远 undefined）
    ...Object.fromEntries((["dir", "action", "template", "source", "marketplace", "pluginDescription", "view", "base", "displayName"] as const).filter((k) => typeof record[k] === "string").map((k) => [k, record[k]])),
  };
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return `未知属性 "${key}"`;
  }
  return null;
}
