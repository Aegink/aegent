/**
 * settings 信封域（U14）——settings 直答信封形状与严格校验（op 闭集 +
 * 载荷类型；业务规则在 gateway 层）。本文件不 import bounded：错误消息的
 * 有界转写统一在 protocol.ts 的 catch 层（parse 层抛原文，转写面单点）。
 */
import { THINKING_LEVELS } from "../session/settings.js";
import { validateDomainSettingsCall } from "./settings-call-domains.js";
import { buildSettingsPayload } from "./settings-envelope-payload.js";

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
  "stt-local-status",
  "stt-local-download",
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
  "task-create",
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
  "skill-import-zip",
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
  // T-P3-156 面板域族（Git 管理/终端/辅助对话历史——分发在 settings-panel-ops；
  // T-P3-157 P-030/P-031 根因：op 注册与载荷键漏进本闭集，整信封 parse 层被拒）
  "git-status",
  "git-diff",
  "git-stage",
  "git-commit",
  "git-log",
  "assistant-log-append",
  "assistant-log-read",
  "terminal-create",
  "terminal-input",
  "terminal-resize",
  // T-P3-174 批次 4 数据中心扩展（整库导出/WebDAV 云同步/检查点时间线）
  "db-export",
  "webdav-test",
  "webdav-sync",
  "checkpoint-timeline",
  "checkpoint-restore",
  // C1 补口：定时任务管理面（调度域装配——scheduler-ops）
  "cron-list",
  "cron-add",
  "cron-remove",
  "collab-dispatch", // C10 协作（collab-runtime 模块级句柄）
  "collab-cancel",
] as const;

export type SettingsOp = (typeof OPS)[number];

// 载荷接口体在 settings-gateway-types.ts——re-export 保 protocol-settings 引用路径
export type { SkillSavePayload, PromptSavePayload } from "./settings-gateway-types.js";
// SettingsCall 类型已搬 settings-call-shape.ts（行数纪律拆分——re-export 兼容消费面）
export type { SettingsCall } from "./settings-call-shape.js";
import type { SettingsCall } from "./settings-call-shape.js";
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
    // T-P3-156 面板域族载荷（cwd/limit/file/staged/files/unstage/message/amend/
    // role/id/data/cols/rows——漏键即整信封被拒且回执 requestId "(unparsed)"，
    // UI 侧表现为请求永久挂起——T-P3-157 P-030/P-031 实抓根因）
    "cwd", "limit", "file", "staged", "files", "unstage", "message", "amend",
    "role", "id", "data", "cols", "rows",
    // T-P3-174 批次 4 载荷（confirm/seq——漏键即整信封被拒）
    "confirm", "seq",
    // T-P3-174 批次 5 走查实抓：terminal-create 的 shell 键（T-P3-165
    // 遗留——真机终端创建恒被信封拒绝）
    "shell",
    // C1 补口：cron 族载荷（expr=表达式/prompt=任务提示/id=任务 id）
    "expr",
    "sourceSessionId", "targetSessionId", "collabId", // C10 协作族（kind/content 走通用键）
    "createNew", // 多会话编排（collab-dispatch——新建子会话派发）
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
  // T-P3-174 批次 4：skill-import-zip = content（zip 字节 base64——上限在 op 层）。
  if (op === "skill-import-zip") {
    if (typeof record["content"] !== "string" || record["content"] === "") {
      throw new Error("settings op=skill-import-zip 需要 content（zip 字节 base64）非空字符串");
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
  // 载荷构造下沉 settings-envelope-payload（T0-3 行数纪律位——arch 400 触顶）。
  return {
    op: op as SettingsOp,
    ...buildSettingsPayload(record),
  };
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return `未知属性 "${key}"`;
  }
  return null;
}
