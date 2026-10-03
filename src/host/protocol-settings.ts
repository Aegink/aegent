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
  // T-P3-153 数据中心族（配置包导出/备份中心/会话导出/体检）
  "export-settings",
  "settings-backup-list",
  "settings-backup-create",
  "settings-backup-restore",
  "settings-backup-delete",
  "session-export",
  "session-import",
  "settings-checkup",
  // T-P3-154 日志中心族
  "log-report",
  "log-query",
  "log-open-dir",
  "log-export",
  // T-P3-155 关于中心族
  "about-info",
  "check-update",
  "open-path",
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
  // T-P3-153 数据中心载荷：index=备份序号 format/redact=会话导出 domains=导出域
  index?: number;
  format?: string;
  redact?: boolean;
  domains?: string[];
  entries?: { ts?: string; level?: string; message?: string; stack?: string; source?: string }[]; // op=log-report：UI 错误批（T-P3-154）
  log?: import("./log-query.js").LogQueryFilter; // op=log-query 查询载荷（闭集在 log-query）
  /** op=provider-models / provider-test：端点自足载荷（T-P3-137——UI 草稿直传；apiKey 缺省走 credentials）。 */
  baseUrl?: string;
  adapter?: string;
  modelId?: string;
  apiKey?: string;
  headers?: Record<string, string>;
};
const SKILL_SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export { INSTRUCTION_TARGETS, type InstructionTarget } from "./settings-call-domains.js";


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
    "index", "format", "redact", "domains", // T-P3-153 数据中心族（漏一个即整信封被拒）
    "entries", "log", // T-P3-154 日志中心族（漏一个即整信封被拒）
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
  // U20/T-P3-122 → T-P3-153：import 载荷校验在 settings-call-domains（数据中心族）。
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
  // T-P3-147 D 辅助任务校验在 settings-call-domains（域族收敛）。
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
    // T-P3-153 数据中心族载荷（漏拷即字段永远 undefined——反复踩的坑）
    ...(typeof record["index"] === "number" ? { index: record["index"] } : {}),
    ...(typeof record["format"] === "string" ? { format: record["format"] } : {}),
    // redact 显式布尔——只拷 true 会吞 false（T-P3-153 走查实抓：脱敏关不掉）
    ...(typeof record["redact"] === "boolean" ? { redact: record["redact"] } : {}),
    ...(Array.isArray(record["domains"]) ? { domains: record["domains"] as string[] } : {}),
    // T-P3-154 日志中心族载荷（漏拷即字段永远 undefined）
    ...(Array.isArray(record["entries"]) ? { entries: record["entries"] as import("./protocol-settings.js").SettingsCall["entries"] } : {}),
    ...(record["log"] !== undefined && typeof record["log"] === "object" && !Array.isArray(record["log"]) ? { log: record["log"] as import("./protocol-settings.js").SettingsCall["log"] } : {}),
  };
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return `未知属性 "${key}"`;
  }
  return null;
}
