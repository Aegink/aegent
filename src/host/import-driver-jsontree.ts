/**
 * json-tree 驱动（T-P3-150 A1 落地、T-P3-151 从 import-drivers.ts 拆出的
 * 行数纪律位）——一个 JSON 文件即一个会话（Gemini CLI 形状）；spec 语义
 * 与原实现逐字一致。
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  extractText,
  getPath,
  LIMITS,
  toIso,
  truncateTitle,
  expandHome,
  normalizeRole,
  type ImportedMessage,
  type ImportedSessionSummary,
  type JsonTreeSpec,
} from "./import-spec.js";
import { isSafeRoot, listSessionFiles, safeMtime } from "./import-driver-util.js";

export function scanJsonTree(spec: JsonTreeSpec, home: string = homedir()): ImportedSessionSummary[] {
  const root = expandHome(spec.root, home);
  if (!isSafeRoot(root, home) || !existsSync(root)) return [];
  const files = listSessionFiles(root, spec.extension ?? ".json", spec.recursive !== false, spec.maxFiles ?? LIMITS.maxFiles);
  const maxBytes = spec.maxBytes ?? LIMITS.maxBytes;
  const summaries: ImportedSessionSummary[] = [];
  for (const file of files) {
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      continue;
    }
    if (size > maxBytes) continue;
    let doc: Record<string, unknown>;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
      if (parsed === null || typeof parsed !== "object") continue;
      doc = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const sessionSpec = spec.session ?? {};
    const messagesRaw = getPath(doc, sessionSpec.messagesPath ?? "messages");
    if (!Array.isArray(messagesRaw) || messagesRaw.length === 0) continue;
    const externalId = String(getPath(doc, sessionSpec.idPath ?? "id") ?? path.basename(file, path.extname(file)));
    const title = truncateTitle(String(getPath(doc, sessionSpec.titlePath ?? "") ?? "") || path.basename(file, path.extname(file)));
    const projectRaw = sessionSpec.pathPath !== undefined ? getPath(doc, sessionSpec.pathPath) : undefined;
    const updatedAt = toIso(sessionSpec.tsPath !== undefined ? getPath(doc, sessionSpec.tsPath) : undefined) ?? toIso(safeMtime(file)) ?? "";
    summaries.push({
      source: spec.id,
      externalId,
      title,
      projectPath: typeof projectRaw === "string" && projectRaw !== "" ? projectRaw : null,
      createdAt: toIso(safeMtime(file)),
      updatedAt,
      messageCount: (statSync(file).size > 1024 * 1024 ? null : messagesRaw.length),
      ...(statSync(file).size > 1024 * 1024 ? { truncated: true } : {}),
      filePath: file,
    });
  }
  return summaries;
}

/** json-tree 单会话消息还原（B1 预览/A6 导入共用）。 */
export function jsonTreeMessages(spec: JsonTreeSpec, doc: Record<string, unknown>): ImportedMessage[] {
  const messageSpec = spec.message ?? {};
  const messagesRaw = getPath(doc, spec.session?.messagesPath ?? "messages");
  if (!Array.isArray(messagesRaw)) return [];
  const messages: ImportedMessage[] = [];
  for (const raw of messagesRaw) {
    if (raw === null || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const role = normalizeRole(getPath(entry, messageSpec.rolePath ?? "role"), messageSpec.roleMap);
    if (role === null) continue;
    messages.push({
      role,
      text: extractText(messageSpec.content, entry),
      createdAt: toIso(getPath(entry, messageSpec.tsPath ?? "")),
    });
  }
  return messages;
}

/** json-tree 单文件 convert（B1 预览/A6 导入——filePath 边界复验同 jsonl）。 */
export function convertJsonTree(spec: JsonTreeSpec, filePath: string, home: string = homedir()): ImportedMessage[] | null {
  const root = expandHome(spec.root, home);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(root) || !existsSync(resolved)) return null;
  try {
    const doc = JSON.parse(readFileSync(resolved, "utf-8")) as Record<string, unknown>;
    return jsonTreeMessages(spec, doc);
  } catch {
    return null;
  }
}
