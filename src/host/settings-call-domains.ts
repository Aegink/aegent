/**
 * settings 域族载荷校验（T-P3-148/149/150——从 protocol-settings 拆分的
 * 行数纪律位）：插件/市场族 + 语音族 + 项目域的 op 载荷形状校验收敛一处；
 * 报错串与原实现逐字一致（protocol-settings.test 的信封回归继续覆盖）。
 * parse 层只管信封形状——业务规则仍在 gateway 层。
 */

import { validatePluginSettingsCall } from "./settings-plugin-ops.js";

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
  "project-branch",
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
    (op === "project-tasks" || op === "session-attach") &&
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
}
