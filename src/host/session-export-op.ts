/**
 * 会话数据域 op（T-P3-153 C——会话导出 md/html/json + JSON 回导 + 删除）：
 * 事件库 → 消息抽取（user/assistant/tool 配对）→ 三格式序列化；脱敏默认
 * 开（hermes /save redact + opencode --sanitize 行为锚）。JSON 包与扫描导
 * 入同构——回导复用 importedMessagesToEvents + import_registry 幂等账。
 */

import { createHash, randomUUID } from "node:crypto";
import type { SessionEvent } from "../kernel/events.js";
import type { SqliteEventStorage } from "../session/db.js";
import type { ImportedMessage } from "./import-spec.js";
import { importedMessagesToEvents } from "./settings-project-ops.js";

function typedError(code: string, message: string): Error {
  const error = new Error(message);
  (error as unknown as { code: string }).code = code;
  return error;
}

function requireDb(db: SqliteEventStorage | undefined, facet: string): SqliteEventStorage {
  if (db === undefined) {
    throw typedError("SESSION_DB_UNAVAILABLE", `host 未配置 SQLite 事件库，${facet}不可用`);
  }
  return db;
}

// ---------------------------------------------------------------------------
// 消息抽取（events → ImportedMessage——与扫描导入同形状，C3 回导零转换）
// ---------------------------------------------------------------------------

/** 事件流 → 消息序列（tool/call+result 按 callId 配对；未配对调用降级为
 * 空结果；其它事件类型不进导出）。上限 5000 条——超出截断（防整包失控）。 */
export const SESSION_EXPORT_MAX_MESSAGES = 5000;

export function extractSessionMessages(events: readonly SessionEvent[]): ImportedMessage[] {
  const out: ImportedMessage[] = [];
  const pending = new Map<string, { name: string; args: unknown }>();
  for (const ev of events) {
    if (out.length >= SESSION_EXPORT_MAX_MESSAGES) break;
    const e = ev as unknown as Record<string, unknown>;
    const ts = typeof e["ts"] === "number" ? new Date(e["ts"]).toISOString() : undefined;
    const msg = e["message"] as { content?: unknown } | undefined;
    if (ev.type === "user/message") {
      out.push({ role: "user", text: typeof msg?.content === "string" ? msg.content : "", ...(ts !== undefined ? { createdAt: ts } : {}) });
    } else if (ev.type === "assistant/message") {
      out.push({ role: "assistant", text: typeof msg?.content === "string" ? msg.content : "", ...(ts !== undefined ? { createdAt: ts } : {}) });
    } else if (ev.type === "tool/call") {
      let args: unknown = {};
      if (typeof e["arguments"] === "string") {
        try {
          args = JSON.parse(e["arguments"]);
        } catch {
          args = e["arguments"];
        }
      }
      pending.set(String(e["callId"] ?? ""), { name: typeof e["name"] === "string" ? e["name"] : "tool", args });
    } else if (ev.type === "tool/result") {
      const call = pending.get(String(e["callId"] ?? ""));
      pending.delete(String(e["callId"] ?? ""));
      out.push({
        role: "tool",
        toolName: call?.name ?? "tool",
        toolArgs: call?.args ?? {},
        toolResult: typeof msg?.content === "string" ? msg.content : "",
        ...(e["isError"] === true ? { toolError: true } : {}),
        ...(ts !== undefined ? { createdAt: ts } : {}),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 脱敏（C2——默认开；正则清单覆盖常见密钥形态）
// ---------------------------------------------------------------------------

const REDACT_PATTERNS: { re: RegExp; to: string }[] = [
  { re: /\bsk-[A-Za-z0-9_-]{8,}/g, to: "[redacted]" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, to: "[redacted]" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{16,}/g, to: "[redacted]" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, to: "[redacted]" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, to: "[redacted]" },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, to: "Bearer [redacted]" },
  { re: /"(api[-_]?key|token|secret|password|authorization)"\s*:\s*"[^"]{4,}"/gi, to: '"$1": "[redacted]"' },
];

/** 密钥形态打码（hermes redact 锚——文本/参数/结果统一过一遍）。 */
export function redactText(s: string): string {
  let out = s;
  for (const p of REDACT_PATTERNS) out = out.replace(p.re, p.to);
  return out;
}

function redactMessage(m: ImportedMessage): ImportedMessage {
  return {
    ...m,
    ...(m.text !== undefined ? { text: redactText(m.text) } : {}),
    ...(m.toolResult !== undefined ? { toolResult: redactText(m.toolResult) } : {}),
    ...(m.toolArgs !== undefined ? { toolArgs: JSON.parse(redactText(JSON.stringify(m.toolArgs))) } : {}),
  };
}

// ---------------------------------------------------------------------------
// 三格式序列化（qwen /export SSOT 锚：md 人类读 / html 自包含 / json 可回导）
// ---------------------------------------------------------------------------

function fmtTs(iso: string | null | undefined): string {
  if (iso === undefined || iso === null || Number.isNaN(Date.parse(iso))) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function sessionToMarkdown(title: string, sessionId: string, messages: readonly ImportedMessage[], redacted: boolean): string {
  const lines: string[] = [
    `# aegent 会话导出：${title}`,
    "",
    `- 会话 id：${sessionId}`,
    `- 导出时间：${fmtTs(new Date().toISOString())}`,
    `- 消息数：${messages.length}`,
    `- 脱敏：${redacted ? "开" : "关"}`,
    "",
    "---",
    "",
  ];
  for (const m of messages) {
    const at = fmtTs(m.createdAt);
    if (m.role === "user") {
      lines.push(`### 🧑 用户${at !== "" ? ` · ${at}` : ""}`, "", m.text ?? "", "");
    } else if (m.role === "assistant") {
      lines.push(`### 🤖 助手${at !== "" ? ` · ${at}` : ""}`, "", m.text ?? "", "");
    } else {
      lines.push(
        `### 🔧 工具 ${m.toolName ?? "tool"}${at !== "" ? ` · ${at}` : ""}`,
        "",
        "**参数**",
        "",
        "```json",
        JSON.stringify(m.toolArgs ?? {}, null, 2),
        "```",
        "",
        `**结果**${m.toolError === true ? "（✘ 错误）" : ""}`,
        "",
        "```text",
        m.toolResult ?? "",
        "```",
        "",
      );
    }
  }
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function sessionToHtml(title: string, sessionId: string, messages: readonly ImportedMessage[], redacted: boolean): string {
  const roleLabel: Record<ImportedMessage["role"], string> = { user: "🧑 用户", assistant: "🤖 助手", tool: "🔧 工具" };
  const blocks = messages.map((m) => {
    const head = `${roleLabel[m.role]}${m.role === "tool" ? ` ${escapeHtml(m.toolName ?? "tool")}` : ""}${m.createdAt !== undefined && m.createdAt !== null ? ` · ${escapeHtml(fmtTs(m.createdAt))}` : ""}`;
    const err = m.toolError === true ? ' <span class="err">✘ 错误</span>' : "";
    const body =
      m.role === "tool"
        ? `<pre class="args">${escapeHtml(JSON.stringify(m.toolArgs ?? {}, null, 2))}</pre><pre>${escapeHtml(m.toolResult ?? "")}</pre>`
        : `<p>${escapeHtml(m.text ?? "").replace(/\n/g, "<br>")}</p>`;
    return `<section class="msg ${m.role}"><h3>${head}${err}</h3>${body}</section>`;
  });
  return [
    "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">",
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    ":root{color-scheme:light dark}body{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;line-height:1.6}",
    "h1{font-size:1.3rem}h3{font-size:.85rem;margin:.2rem 0;color:#666}",
    ".msg{border-left:3px solid #ddd;padding-left:1rem;margin:1.2rem 0}.msg.user{border-color:#4a90d9}.msg.tool{border-color:#d9a44a}",
    "pre{background:rgba(127,127,127,.12);padding:.6rem;border-radius:6px;overflow:auto;white-space:pre-wrap}",
    ".err{color:#c0392b}@media (prefers-color-scheme:dark){h3{color:#999}.msg{border-color:#333}}",
    "</style></head><body>",
    `<h1>${escapeHtml(title)}</h1>`,
    `<p class="meta">会话 id：${escapeHtml(sessionId)} · 导出时间：${escapeHtml(fmtTs(new Date().toISOString()))} · 消息数：${messages.length} · 脱敏：${redacted ? "开" : "关"}</p>`,
    ...blocks,
    "</body></html>",
  ].join("\n");
}

export interface SessionExportPackage {
  readonly version: 1;
  readonly kind: "aegent-session-export";
  readonly exportedAt: string;
  readonly session: { readonly id: string; readonly title: string };
  readonly messages: readonly ImportedMessage[];
}

export function sessionToJson(title: string, sessionId: string, messages: readonly ImportedMessage[]): string {
  const pkg: SessionExportPackage = {
    version: 1,
    kind: "aegent-session-export",
    exportedAt: new Date().toISOString(),
    session: { id: sessionId, title },
    messages,
  };
  return JSON.stringify(pkg, null, 2);
}

// ---------------------------------------------------------------------------
// op 面
// ---------------------------------------------------------------------------

export interface SessionExportPayload {
  sessionId: string;
  format: "md" | "html" | "json";
  /** 脱敏开关（默认开——待澄清 2 裁决）。 */
  redact?: boolean;
}

/** 会话导出（codex transcript_export 锚：空对话报错不做空文件）。数据源
 * 由调用方给事件序列（bridge 面与 query events 同读面：本会话内存序无
 * write-behind 滞后，跨会话回源库——U3 放宽）；db 形态保留给直读库场景。 */
export function sessionExportFromEvents(
  events: readonly SessionEvent[],
  payload: SessionExportPayload,
  title?: string,
): { text: string; filename: string; messageCount: number } {
  const messages = extractSessionMessages(events);
  if (messages.length === 0) {
    throw typedError("SESSION_EXPORT_EMPTY", "会话没有可导出的对话内容");
  }
  const redacted = payload.redact !== false;
  const applied = redacted ? messages.map(redactMessage) : messages;
  const stamp = new Date().toISOString().slice(0, 19).replaceAll("-", "").replace("T", "-").replaceAll(":", "");
  const filename = `aegent-session-${stamp}.${payload.format}`;
  const text =
    payload.format === "md"
      ? sessionToMarkdown(title ?? "未命名会话", payload.sessionId, applied, redacted)
      : payload.format === "html"
        ? sessionToHtml(title ?? "未命名会话", payload.sessionId, applied, redacted)
        : sessionToJson(title ?? "未命名会话", payload.sessionId, applied);
  return { text, filename, messageCount: applied.length };
}

export function sessionExportOp(
  db: SqliteEventStorage | undefined,
  payload: SessionExportPayload,
): { text: string; filename: string; messageCount: number } {
  const store = requireDb(db, "会话导出");
  return sessionExportFromEvents(store.readAll(payload.sessionId), payload, store.getTitle(payload.sessionId)?.title);
}

const SESSION_IMPORT_MAX_MESSAGES = 5000;

/** 会话 JSON 包回导（C3——import_registry 幂等账：同包重导 skipped）。 */
export function sessionImportOp(
  db: SqliteEventStorage | undefined,
  content: string,
): { imported: true; sessionId: string; messageCount: number } | { skipped: true; sessionId: string } {
  const store = requireDb(db, "会话回导");
  let packageRaw: unknown;
  try {
    packageRaw = JSON.parse(content);
  } catch {
    throw typedError("SESSION_IMPORT_BAD_PACKAGE", "会话导入包不是合法 JSON");
  }
  if (packageRaw === null || typeof packageRaw !== "object" || Array.isArray(packageRaw)) {
    throw typedError("SESSION_IMPORT_BAD_PACKAGE", "会话导入包须为 JSON 对象");
  }
  const pkg = packageRaw as Record<string, unknown>;
  if (pkg["kind"] !== "aegent-session-export") {
    throw typedError("SESSION_IMPORT_BAD_KIND", `导入包 kind 不符：${String(pkg["kind"])}（须为 aegent-session-export）`);
  }
  const rawMessages = pkg["messages"];
  if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > SESSION_IMPORT_MAX_MESSAGES) {
    throw typedError("SESSION_IMPORT_BAD_MESSAGES", `会话导入包 messages 须为 1~${SESSION_IMPORT_MAX_MESSAGES} 条`);
  }
  const messages: ImportedMessage[] = [];
  for (const m of rawMessages) {
    if (m === null || typeof m !== "object" || Array.isArray(m)) {
      throw typedError("SESSION_IMPORT_BAD_MESSAGES", "会话导入包 messages[] 须为对象");
    }
    const msg = m as Record<string, unknown>;
    if (msg["role"] !== "user" && msg["role"] !== "assistant" && msg["role"] !== "tool") {
      throw typedError("SESSION_IMPORT_BAD_MESSAGES", "会话导入包 messages[].role 非法（合法：user|assistant|tool）");
    }
    messages.push(msg as unknown as ImportedMessage);
  }
  const session = (pkg["session"] ?? {}) as Record<string, unknown>;
  const title = typeof session["title"] === "string" && session["title"].trim() !== "" ? session["title"].slice(0, 60) : "导入的会话";
  // 幂等键：包内 session.id 优先，缺省退回消息体指纹（同文件重导必 skipped）
  const sessionIdGuess = typeof session["id"] === "string" && session["id"] !== "" ? session["id"] : "";
  const fingerprint = createHash("sha256").update(JSON.stringify(messages)).digest("hex").slice(0, 16);
  const externalKey = `aegent-json:${sessionIdGuess !== "" ? sessionIdGuess : fingerprint}`;
  const existing = store.lookupImportedSession(externalKey);
  if (existing !== undefined) {
    return { skipped: true, sessionId: existing };
  }
  const sessionId = randomUUID();
  const baseTs = Date.now() - messages.length * 1000;
  const events = importedMessagesToEvents(messages, baseTs);
  store.appendBatch(sessionId, events);
  store.registerImportedSession(externalKey, sessionId);
  store.setTitle(sessionId, title, "generated");
  return { imported: true, sessionId, messageCount: messages.length };
}

/** 单会话删除（自 gateway 下沉——会话数据域归拢；行数纪律位）。 */
export function deleteSessionOp(db: SqliteEventStorage | undefined, sessionId: string): { deleted: boolean } {
  return { deleted: requireDb(db, "会话删除").deleteSession(sessionId) };
}
