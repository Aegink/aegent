/**
 * settings 域族载荷校验（T-P3-148/149/150——从 protocol-settings 拆分的
 * 行数纪律位）：插件/市场族 + 语音族 + 项目域的 op 载荷形状校验收敛一处；
 * 报错串与原实现逐字一致（protocol-settings.test 的信封回归继续覆盖）。
 * parse 层只管信封形状——业务规则仍在 gateway 层。
 */

import { THINKING_LEVELS } from "../session/settings.js";
import { validatePluginSettingsCall } from "./settings-plugin-ops.js";

// T-P3-151：指令中心 target 闭集（自 protocol-settings 移入——域词汇归域文件；
// protocol-settings 经 re-export 保持旧引用路径）。
export const INSTRUCTION_TARGETS = [
  "project-agents",
  "global-agents",
  "user-rules",
  "project-rules",
  "memory",
] as const;
export type InstructionTarget = (typeof INSTRUCTION_TARGETS)[number];

/** 域族 op 闭集（与 OPS 同源子集——命中才进域校验）。 */
const DOMAIN_OPS = new Set([
  "plugin-check",
  "plugin-pack",
  "plugin-view-html",
  "market",
  "plugin-scaffold",
  "plugin-theme-css",
  "stt-transcribe",
  "tts-synthesize",
  "fs-tree",
  "fs-read",
  "fs-shell",
  "git-clone",
  "import-scan",
  "project-tasks",
  "session-attach",
  "session-rename",
  "task-create",
  "project-branch",
  "import-preview",
  "import-sessions",
  "provider-models",
  "provider-test",
  "instruction-save",
  "instruction-append",
  "instruction-test-rule",
  "enhancement-test",
  "mcp-check",
  // T-P3-153 数据中心族（配置包/备份/会话导出/体检）
  "import",
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
  // C1 补口：定时任务管理族（调度域装配——scheduler-ops）
  "cron-list",
  "cron-add",
  "cron-remove",
  // C10：会话协作发起/取消（协作域装配——collab-runtime）
  "collab-dispatch",
  "collab-cancel",
  "log-open-dir",
  "log-export",
  // T-P3-155 关于中心族
  "about-info",
  "check-update",
  "open-path",
  // T-P3-156 面板域族（Git 管理/终端/辅助对话历史——T-P3-157 补注册）
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
]);

export function validateDomainSettingsCall(op: string, record: Record<string, unknown>): void {
  if (!DOMAIN_OPS.has(op)) return;
  // 插件/市场族（settings-plugin-ops——报错串同源）
  validatePluginSettingsCall(op, record);
  // 语音族
  if (op === "stt-transcribe") {
    if (typeof record["mediaType"] !== "string" || record["mediaType"] === "") {
      throw new Error("settings op=stt-transcribe 需要 mediaType 非空字符串");
    }
    if (typeof record["content"] !== "string" || record["content"] === "") {
      throw new Error("settings op=stt-transcribe 需要 content（音频 base64）非空字符串");
    }
  }
  if (op === "tts-synthesize" && (typeof record["text"] !== "string" || record["text"].trim() === "")) {
    throw new Error("settings op=tts-synthesize 需要 text（合成文本）非空字符串");
  }
  // 项目域（path 统一绝对路径；动作闭集）
  if (
    (op === "fs-tree" || op === "fs-read" || op === "fs-shell" || op === "project-branch") &&
    (typeof record["path"] !== "string" || record["path"].trim() === "")
  ) {
    throw new Error(`settings op=${op} 需要 path（绝对路径）非空字符串`);
  }
  if (op === "fs-shell") {
    const FS_ACTIONS = ["reveal", "open"];
    if (typeof record["action"] !== "string" || !(FS_ACTIONS as readonly string[]).includes(record["action"])) {
      throw new Error("settings op=fs-shell 的 action 非法（合法：reveal|open）");
    }
  }
  if (op === "git-clone" && (typeof record["url"] !== "string" || record["url"].trim() === "")) {
    throw new Error("settings op=git-clone 需要 url（仓库地址）非空字符串");
  }
  if (
    (op === "project-tasks" || op === "session-attach" || op === "task-create") &&
    (typeof record["projectId"] !== "string" || record["projectId"].trim() === "")
  ) {
    throw new Error(`settings op=${op} 需要 projectId（项目 id）非空字符串`);
  }
  if (op === "session-attach" && (typeof record["sessionId"] !== "string" || record["sessionId"].trim() === "")) {
    throw new Error("settings op=session-attach 需要 sessionId 非空字符串");
  }
  if (op === "session-rename") {
    if (typeof record["sessionId"] !== "string" || record["sessionId"].trim() === "") {
      throw new Error("settings op=session-rename 需要 sessionId 非空字符串");
    }
    if (typeof record["text"] !== "string" || record["text"].trim() === "") {
      throw new Error("settings op=session-rename 需要 text（新标题）非空字符串");
    }
  }
  // T-P3-150 A6：导入预览/内容导入载荷（source+externalId 对数组）。
  if (op === "import-preview" &&
      (typeof record["source"] !== "string" || record["source"].trim() === "" ||
       typeof record["path"] !== "string" || record["path"].trim() === "")) {
    throw new Error("settings op=import-preview 需要 source 与 path（外部会话 id）非空字符串");
  }
  if (op === "import-sessions") {
    if (!Array.isArray(record["importItems"]) || (record["importItems"] as unknown[]).length === 0) {
      throw new Error("settings op=import-sessions 需要 importItems 非空数组");
    }
    for (const item of record["importItems"] as unknown[]) {
      if (item === null || typeof item !== "object") {
        throw new Error("settings op=import-sessions 的 importItems[] 须为对象");
      }
      const it = item as Record<string, unknown>;
      if (typeof it["source"] !== "string" || it["source"] === "") throw new Error("settings op=import-sessions 的 importItems[].source 缺失");
      if (typeof it["externalId"] !== "string" || it["externalId"] === "") throw new Error("settings op=import-sessions 的 importItems[].externalId 缺失");
    }
  }
  // provider 族（端点自足载荷——凭据键/adapter 闭集/reasoning 闭集）
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
  // 指令域（T-P3-151——save 扩五 target；append/test-rule 新 op）
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
  if (op === "instruction-append") {
    if (record["kind"] !== "rule" && record["kind"] !== "text") {
      throw new Error("settings op=instruction-append 需要 kind（合法：rule|text）");
    }
    // rule 形态只落规则两层；text 形态可追加到任意指令位（C1 存为规矩）。
    if (record["kind"] === "rule" && record["target"] !== "user-rules" && record["target"] !== "project-rules") {
      throw new Error("settings op=instruction-append 的 kind=rule 需要 target（合法：user-rules|project-rules）");
    }
    if (typeof record["target"] !== "string" || record["target"] === "") {
      throw new Error("settings op=instruction-append 需要 target 非空字符串");
    }
    if (typeof record["content"] !== "string" || record["content"].trim() === "") {
      throw new Error("settings op=instruction-append 需要 content 非空字符串");
    }
  }
  if (op === "instruction-test-rule") {
    if (typeof record["tool"] !== "string" || record["tool"].trim() === "") {
      throw new Error("settings op=instruction-test-rule 需要 tool 非空字符串");
    }
    if (
      record["ruleArgs"] !== undefined &&
      (record["ruleArgs"] === null || typeof record["ruleArgs"] !== "object" || Array.isArray(record["ruleArgs"]))
    ) {
      throw new Error("settings op=instruction-test-rule 的 ruleArgs 须为对象（缺省 {}）");
    }
  }
  // T-P3-147 D：辅助任务闭集（自 protocol-settings 下放——域族校验归域文件）
  if (op === "enhancement-test" &&
      (typeof record["task"] !== "string" ||
        !["judge", "summarizer", "polish", "title", "fastModel"].includes(record["task"]))) {
    throw new Error("settings op=enhancement-test 需要 task（judge|summarizer|polish|title|fastModel）");
  }
  // T-P3-153 数据中心族（配置包 v2/备份中心/会话导出/体检）
  // U20/T-P3-122 → T-P3-153：import 载荷 = 整个配置包（kind/版本/域合并解析在 host）。
  if (op === "import") {
    const st = record["settings"];
    if (st === null || typeof st !== "object" || Array.isArray(st)) {
      throw new Error("settings op=import 需要 settings 对象（配置包内的 settings 段）");
    }
  }
  if (op === "export-settings") {
    if (
      record["domains"] !== undefined &&
      (!Array.isArray(record["domains"]) ||
        (record["domains"] as unknown[]).some((d) => typeof d !== "string" || d === ""))
    ) {
      throw new Error("settings op=export-settings 的 domains 须为非空字符串数组（缺省 = 全域整包）");
    }
  }
  if (op === "settings-backup-restore" || op === "settings-backup-delete") {
    const idx = record["index"];
    if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0) {
      throw new Error(`settings op=${op} 需要 index（备份序号，非负整数）`);
    }
  }
  if (op === "session-export") {
    if (typeof record["sessionId"] !== "string" || record["sessionId"] === "") {
      throw new Error("settings op=session-export 需要 sessionId 非空字符串");
    }
    if (record["format"] !== "md" && record["format"] !== "html" && record["format"] !== "json") {
      throw new Error("settings op=session-export 需要 format（合法：md|html|json）");
    }
  }
  if (op === "session-import") {
    if (typeof record["content"] !== "string" || record["content"].trim() === "") {
      throw new Error("settings op=session-import 需要 content（会话 JSON 包文本）非空字符串");
    }
  }

  // U17/T-P3-119：mcp-check（自 protocol-settings 下放——域族校验归域文件）
  if (op === "mcp-check") {
    if (typeof record["name"] !== "string" || record["name"] === "" || record["name"].includes("__")) {
      throw new Error('settings op=mcp-check 需要 name（非空且不含 "__"）');
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
  // T-P3-154 日志中心族（log-report 批上限/log-query 载荷闭集）
  if (op === "log-report") {
    if (!Array.isArray(record["entries"]) || (record["entries"] as unknown[]).length === 0) {
      throw new Error("settings op=log-report 需要 entries 非空数组");
    }
    if ((record["entries"] as unknown[]).length > 50) {
      throw new Error("settings op=log-report 的 entries 上限 50 条（UI 侧节流批量）");
    }
    for (const item of record["entries"] as unknown[]) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("settings op=log-report 的 entries[] 须为对象");
      }
    }
  }
  if (op === "log-query" &&
      (record["log"] === undefined || record["log"] === null || typeof record["log"] !== "object" || Array.isArray(record["log"]))) {
    throw new Error("settings op=log-query 需要 log 对象（查询载荷）");
  }
  // T-P3-155：open-path 需要 path 非空（about-info/check-update 无载荷）
  if (op === "open-path" && (typeof record["path"] !== "string" || record["path"].trim() === "")) {
    throw new Error("settings op=open-path 需要 path 非空字符串");
  }
  // T-P3-156/157 面板域族（cwd=活动项目根，host 侧再过项目根白名单边界）
  if (
    (op === "git-status" || op === "git-diff" || op === "git-stage" || op === "git-commit" || op === "git-log" || op === "terminal-create") &&
    (typeof record["cwd"] !== "string" || record["cwd"].trim() === "")
  ) {
    throw new Error(`settings op=${op} 需要 cwd（活动项目根）非空字符串`);
  }
  if (op === "git-diff" && (typeof record["file"] !== "string" || record["file"] === "")) {
    throw new Error("settings op=git-diff 需要 file（目标文件）非空字符串");
  }
  if (op === "git-stage" &&
      (!Array.isArray(record["files"]) ||
        (record["files"] as unknown[]).length === 0 ||
        (record["files"] as unknown[]).some((f) => typeof f !== "string" || f === ""))) {
    throw new Error("settings op=git-stage 需要 files 非空字符串数组");
  }
  if (op === "git-commit" && (typeof record["message"] !== "string" || record["message"].trim() === "")) {
    throw new Error("settings op=git-commit 需要 message（提交信息）非空字符串");
  }
  if (op === "assistant-log-append") {
    if (record["role"] !== "user" && record["role"] !== "assistant") {
      throw new Error("settings op=assistant-log-append 需要 role（合法：user|assistant）");
    }
    if (typeof record["text"] !== "string") {
      throw new Error("settings op=assistant-log-append 需要 text 字符串");
    }
  }
  if (op === "assistant-log-read" &&
      record["limit"] !== undefined &&
      (typeof record["limit"] !== "number" || !Number.isInteger(record["limit"]) || record["limit"] <= 0 || record["limit"] > 500)) {
    throw new Error("settings op=assistant-log-read 的 limit 须为 1~500 整数（缺省 = host 默认条数）");
  }
  if ((op === "terminal-create" || op === "terminal-input" || op === "terminal-resize") &&
      (typeof record["id"] !== "string" || record["id"] === "")) {
    throw new Error(`settings op=${op} 需要 id（终端实例 id）非空字符串`);
  }
  if (op === "terminal-input" && typeof record["data"] !== "string") {
    throw new Error("settings op=terminal-input 需要 data 字符串（键入内容）");
  }
  if (op === "terminal-resize") {
    const { cols, rows } = record as { cols?: unknown; rows?: unknown };
    if (typeof cols !== "number" || !Number.isInteger(cols) || cols <= 0 || cols > 500 ||
        typeof rows !== "number" || !Number.isInteger(rows) || rows <= 0 || rows > 300) {
      throw new Error("settings op=terminal-resize 需要 cols（1~500）/rows（1~300）正整数");
    }
  }
  // C1 定时任务族（表达式合法性在 CronStore.add 入库面——此处只校验形状）
  if (op === "cron-add") {
    if (typeof record["expr"] !== "string" || record["expr"].trim() === "") {
      throw new Error("settings op=cron-add 需要 expr（cron 表达式）非空字符串");
    }
    if (typeof record["prompt"] !== "string" || record["prompt"].trim() === "") {
      throw new Error("settings op=cron-add 需要 prompt（触发时投递的提示词）非空字符串");
    }
  }
  if (op === "cron-remove" && (typeof record["id"] !== "string" || record["id"] === "")) {
    throw new Error("settings op=cron-remove 需要 id（任务 id）非空字符串");
  }
  // C10 协作族（kind 三值闭集 + 双会话 id + 内容非空）
  if (op === "collab-dispatch") {
    for (const key of ["sourceSessionId", "targetSessionId", "content"] as const) {
      if (typeof record[key] !== "string" || (record[key] as string).trim() === "") {
        throw new Error(`settings op=collab-dispatch 需要 ${key} 非空字符串`);
      }
    }
    const kind = record["kind"];
    if (kind !== "task" && kind !== "message" && kind !== "completion") {
      throw new Error("settings op=collab-dispatch 需要 kind ∈ task|message|completion");
    }
  }
  if (op === "collab-cancel" && (typeof record["collabId"] !== "string" || record["collabId"] === "")) {
    throw new Error("settings op=collab-cancel 需要 collabId 非空字符串");
  }
}