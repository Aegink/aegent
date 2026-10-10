/**
 * settings 信封载荷构造（自 protocol-settings.ts 抽出——T0-3 行数纪律位；
 * arch check maxFileLines 400 触顶，return spread 主体下沉本文件）。
 * 只做"record → SettingsCall 载荷"的逐键类型化拷贝，不含业务规则；
 * 键表须与 protocol-settings 的 rejectUnknownKeys 白名单同源——漏拷即
 * dispatch 侧永远 undefined（反复踩的坑，各键注释保留原位语义）。
 */
import type { JsonRecord } from "../kernel/events.js";
import type { SkillImportItem } from "./skill-import-op.js";
import type { SkillSavePayload, PromptSavePayload } from "./settings-gateway-types.js";
import type { SettingsCall } from "./settings-call-shape.js";

export function buildSettingsPayload(record: Record<string, unknown>): Omit<SettingsCall, "op"> {
  return {
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
      ? { ruleArgs: record["ruleArgs"] as JsonRecord }
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
    ...(Array.isArray(record["entries"]) ? { entries: record["entries"] as SettingsCall["entries"] } : {}),
    ...(record["log"] !== undefined && typeof record["log"] === "object" && !Array.isArray(record["log"]) ? { log: record["log"] as SettingsCall["log"] } : {}),
    // T-P3-156 面板域族载荷（键表与白名单同源——漏拷即 dispatch 侧永远 undefined）
    ...(typeof record["cwd"] === "string" ? { cwd: record["cwd"] } : {}),
    ...(typeof record["limit"] === "number" ? { limit: record["limit"] } : {}),
    ...(typeof record["file"] === "string" ? { file: record["file"] } : {}),
    ...(typeof record["staged"] === "boolean" ? { staged: record["staged"] } : {}),
    ...(Array.isArray(record["files"]) ? { files: record["files"] as string[] } : {}),
    ...(typeof record["unstage"] === "boolean" ? { unstage: record["unstage"] } : {}),
    ...(typeof record["message"] === "string" ? { message: record["message"] } : {}),
    ...(typeof record["amend"] === "boolean" ? { amend: record["amend"] } : {}),
    ...(typeof record["role"] === "string" ? { role: record["role"] } : {}),
    ...(typeof record["id"] === "string" ? { id: record["id"] } : {}),
    ...(typeof record["data"] === "string" ? { data: record["data"] } : {}),
    ...(typeof record["cols"] === "number" ? { cols: record["cols"] } : {}),
    ...(typeof record["rows"] === "number" ? { rows: record["rows"] } : {}),
    // T-P3-174 批次 4 载荷（confirm 显式布尔——只拷 true 会吞 false 的坑；
    // seq = 检查点回退目标）
    ...(typeof record["confirm"] === "boolean" ? { confirm: record["confirm"] } : {}),
    ...(typeof record["seq"] === "number" ? { seq: record["seq"] } : {}),
    ...(typeof record["shell"] === "string" ? { shell: record["shell"] } : {}),
    // C1 cron 族载荷（expr = 表达式；prompt/id 走通用键拷贝——本行补 expr）
    ...(typeof record["expr"] === "string" ? { expr: record["expr"] } : {}),
    ...(typeof record["sourceSessionId"] === "string" ? { sourceSessionId: record["sourceSessionId"] } : {}),
    ...(typeof record["targetSessionId"] === "string" ? { targetSessionId: record["targetSessionId"] } : {}),
    ...(typeof record["collabId"] === "string" ? { collabId: record["collabId"] } : {}),
    // 多会话编排布尔（typeof 拷贝——只拷 true 吞 false 的坑同款规避）
    ...(typeof record["createNew"] === "boolean" ? { createNew: record["createNew"] as boolean } : {}),
  };
}
