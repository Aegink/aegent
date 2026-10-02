/**
 * 会话导入驱动（T-P3-150 A1——jsonl-transcript 驱动；每家 app 的差异全部表达在
 * spec（import-spec.ts 类型）里——新接一家 agent 是写配置不是写代码。
 * json-tree 驱动在 import-driver-jsontree.ts、sqlite 在 import-driver-sqlite.ts。）
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
  type ContentRule,
  type ImportedMessage,
  type ImportedSessionSummary,
  type JsonlSpec,
} from "./import-spec.js";
import { isSafeRoot, listSessionFiles, safeMtime } from "./import-driver-util.js";

// ---------------------------------------------------------------------------
// jsonl-transcript 驱动（Claude Code / Codex / WorkBuddy / Pi 形状）
// ---------------------------------------------------------------------------

export function scanJsonl(spec: JsonlSpec, home: string = homedir()): ImportedSessionSummary[] {
  const root = expandHome(spec.root, home);
  if (!isSafeRoot(root, home) || !existsSync(root)) return [];
  const files = listSessionFiles(root, spec.extension ?? ".jsonl", spec.recursive !== false, spec.maxFiles ?? LIMITS.maxFiles);
  const summaries: ImportedSessionSummary[] = [];
  const maxLines = spec.maxLines ?? LIMITS.maxLines;
  const maxBytes = spec.maxBytes ?? LIMITS.maxBytes;
  for (const file of files) {
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      continue;
    }
    if (size > maxBytes) continue; // 超限整跳（不读进内存——有意取舍）
    let entries: Record<string, unknown>[];
    try {
      const lines = readFileSync(file, "utf-8").split("\n");
      entries = [];
      for (const line of lines.slice(0, maxLines)) {
        const trimmed = line.trim();
        if (trimmed === "" || !trimmed.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (parsed !== null && typeof parsed === "object") entries.push(parsed as Record<string, unknown>);
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
    // unwrap 视图（idFrom/projectFrom 的取值相对内层；idFromEntry 的类别
    // 过滤相对外层信封——两阶段语义对齐该插件）
    const unwrapView = (rawEntry: Record<string, unknown>): Record<string, unknown> => {
      const unwrapPath0 = spec.entry?.unwrapPath;
      if (unwrapPath0 === undefined) return rawEntry;
      const inner = getPath(rawEntry, unwrapPath0);
      return inner !== null && typeof inner === "object" ? (inner as Record<string, unknown>) : rawEntry;
    };
    const messages = jsonlMessages(spec, entries);
    if (messages.length === 0) continue;
    const sessionSpec = spec.session ?? {};
    let externalId = path.basename(file, path.extname(file));
    if (sessionSpec.idFrom !== undefined && sessionSpec.idFrom !== "filename") {
      const rule = typeof sessionSpec.idFrom === "string" ? { path: sessionSpec.idFrom } : sessionSpec.idFrom;
      const want = sessionSpec.idFromEntry;
      let picked = "";
      const pickFrom = (list: Record<string, unknown>[]) => {
        for (const e of list) {
          const v = extractText(rule, e);
          if (v !== "") return v;
        }
        return "";
      };
      if (want !== undefined) {
        // 类别过滤在外层信封、取值在 unwrap 内层（两阶段——按索引对齐）
        picked = pickFrom(
          entries
            .map((e, i) => ({ raw: e, view: unwrapView(e) }))
            .filter(({ raw }) => want.in.includes(String(getPath(raw, want.path))))
            .map(({ view }) => view),
        );
      }
      if (picked === "") picked = pickFrom(entries.map(unwrapView));
      if (picked !== "") externalId = picked;
    }
    const firstUser = messages.find((m) => m.role === "user" && m.text !== undefined && m.text !== "")?.text ?? "";
    const title =
      sessionSpec.titleFrom === "firstUser" || sessionSpec.titleFrom === undefined
        ? truncateTitle(firstUser) || path.basename(file, path.extname(file))
        : truncateTitle(firstUser) || path.basename(file, path.extname(file));
    let projectPath: string | null = path.dirname(file);
    if (sessionSpec.projectFrom !== undefined && sessionSpec.projectFrom !== "parentDir") {
      // 项目目录规则：遍历条目取首个非空（cwd 不总在首行——claude 的 summary
      // 行无 cwd；与 pi-desktop claude.ts"取首条带 cwd 的行"同语义）
      let raw = "";
      for (const entry of entries) {
        raw = String(getPath(unwrapView(entry), sessionSpec.projectFrom) ?? "");
        if (raw !== "") break;
      }
      projectPath = raw !== "" ? raw : (sessionSpec.fallbackProject ?? null);
    } else if (sessionSpec.projectFrom === undefined && sessionSpec.fallbackProject !== undefined) {
      projectPath = sessionSpec.fallbackProject;
    }
    let mtimeIso: string | null = null;
    try {
      mtimeIso = toIso(statSync(file).mtimeMs);
    } catch {
      mtimeIso = null;
    }
    summaries.push({
      source: spec.id,
      externalId,
      title,
      projectPath,
      createdAt: messages[0]?.createdAt ?? mtimeIso,
      updatedAt: messages[messages.length - 1]?.createdAt ?? mtimeIso ?? "",
      messageCount: messages.length,
      filePath: file,
    });
  }
  return summaries;
}

/** JSONL 条目 → ImportedMessage（role 映射/content/match/skip/drop/工具配对
 * 三形状——声明式表达全部 app 差异）。 */
export function jsonlMessages(spec: JsonlSpec, entries: Record<string, unknown>[]): ImportedMessage[] {
  const entrySpec = spec.entry ?? {};
  const rolePath = entrySpec.rolePath ?? "type";
  const roleMap = entrySpec.roleMap ?? {};
  const messages: ImportedMessage[] = [];
  const pendingCalls = new Map<string, { name: string; args: unknown }>();

  const unwrap = (entry: Record<string, unknown>): Record<string, unknown> => {
    if (entrySpec.unwrapPath === undefined) return entry;
    const inner = getPath(entry, entrySpec.unwrapPath);
    return inner !== null && typeof inner === "object" ? (inner as Record<string, unknown>) : entry;
  };

  for (const rawEntry of entries) {
    const entry = unwrap(rawEntry);
    if (entrySpec.match !== undefined && !entrySpec.match.in.includes(String(getPath(entry, entrySpec.match.path)))) continue;
    if (entrySpec.skipTypePath !== undefined) {
      const skipType = String(getPath(entry, entrySpec.skipTypePath) ?? "");
      if ((entrySpec.skipTypes ?? []).includes(skipType)) continue;
    }
    const blockCall = entrySpec.toolCall?.callBlocks;
    const blockResult = entrySpec.toolCall?.resultBlocks;
    const entryTool = entrySpec.toolCall?.call;
    const entryResult = entrySpec.toolCall?.result;
    const role = normalizeRole(getPath(entry, rolePath), roleMap);

    // 块级两阶段：call 块暂存，result 块到达时生成 tool 消息（文本抑制——
    // 与该插件内置适配器一致，防消息错位）
    if (blockCall !== undefined && role === (blockCall.roles?.[0] ?? "assistant")) {
      const blocks = getPath(entry, blockCall.path);
      if (Array.isArray(blocks)) {
        let sawCall = false;
        for (const block of blocks) {
          if (block === null || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (String(b[blockCall.typeField]) !== blockCall.type) continue;
          sawCall = true;
          const id = String(b[blockCall.idPath] ?? "");
          let args: unknown = b[blockCall.argsPath];
          if (blockCall.argsJson === true && typeof args === "string") {
            try {
              args = JSON.parse(args);
            } catch {
              /* 保持原串 */
            }
          }
          pendingCalls.set(id, { name: String(b[blockCall.namePath] ?? ""), args });
        }
        if (sawCall) {
          // 同条目先出现的 text 块仍是一条助手消息（混合内容不丢文本）
          const text = extractText(entrySpec.content, entry);
          if (text !== "") messages.push({ role: "assistant", text, createdAt: toIso(getPath(entry, entrySpec.tsPath ?? "")) });
          continue;
        }
        // 无 tool_use 块的纯文本条目——落回下方文本路径
      }
    }
    if (blockResult !== undefined) {
      const blocks = getPath(entry, blockResult.path);
      if (Array.isArray(blocks)) {
        let hasResult = false;
        for (const block of blocks) {
          if (block === null || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (String(b[blockResult.typeField]) !== blockResult.type) continue;
          hasResult = true;
          const id = String(b[blockResult.idPath] ?? "");
          const pending = pendingCalls.get(id);
          const resultText = extractResultText(b[blockResult.resultPath]);
          const statusText = blockResult.statusPath !== undefined ? String(b[blockResult.statusPath] ?? "") : "";
          const isError = blockResult.errorValues !== undefined
            ? blockResult.errorValues.includes(statusText)
            : (blockResult.statusPath !== undefined && b[blockResult.statusPath] === true);
          messages.push({
            role: "tool",
            toolName: pending?.name,
            toolArgs: pending?.args,
            toolResult: resultText,
            toolError: isError === true,
            createdAt: toIso(getPath(entry, entrySpec.tsPath ?? "")),
          });
        }
        if (hasResult) continue; // 结果块条目抑制文本
      }
    }

    // 条目级两阶段（Codex/WorkBuddy function_call → function_call_output）
    if (entryTool !== undefined) {
      const type = String(getPath(entry, entryTool.typePath) ?? "");
      if (entryTool.types.includes(type)) {
        const id = String(getPath(entry, entryTool.idPath) ?? "");
        let args: unknown = getPath(entry, entryTool.argsPath);
        if (entryTool.argsJson === true && typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch {
            /* 保持原串 */
          }
        }
        pendingCalls.set(id, { name: String(getPath(entry, entryTool.namePath) ?? ""), args });
        continue;
      }
    }
    if (entryResult !== undefined) {
      const type = String(getPath(entry, entryResult.typePath) ?? "");
      if (entryResult.types.includes(type)) {
        const id = String(getPath(entry, entryResult.idPath) ?? "");
        const pending = pendingCalls.get(id);
        const rawResult = getPath(entry, entryResult.resultPath);
        const status = String(getPath(entry, entryResult.statusPath ?? "") ?? "");
        const isError = entryResult.errorValues !== undefined
          ? entryResult.errorValues.includes(status)
          : status === "error";
        messages.push({
          role: "tool",
          toolName: pending?.name,
          toolArgs: pending?.args,
          toolResult: typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult ?? ""),
          toolError: isError,
          createdAt: toIso(getPath(entry, entrySpec.tsPath ?? "")),
        });
        continue;
      }
    }

    if (role === null) continue;
    let text = extractText(entrySpec.content, entry);
    // drop.startsWith（注入文本——roles 限定可只作用 user）
    if (entrySpec.drop !== undefined && text !== "") {
      const roles = entrySpec.drop.roles;
      if (roles === undefined || roles.includes(role)) {
        if (entrySpec.drop.startsWith.some((prefix) => text.startsWith(prefix))) continue;
      }
    }
    if (role === "tool") {
      // 单条目自带结果（entry.tool 形状留给 sqlite/json 驱动——jsonl 的 tool
      // 都走上面三种配对形状）
      continue;
    }
    messages.push({ role, text, createdAt: toIso(getPath(entry, entrySpec.tsPath ?? "")) });
  }
  return messages;
}

/** 结果字段取可读文本（字符串原样；数组块挑 text；其余 JSON 串化）。 */
function extractResultText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const parts: string[] = [];
    for (const block of raw) {
      if (block !== null && typeof block === "object") {
        const text = (block as Record<string, unknown>)["text"];
        if (typeof text === "string") parts.push(text);
      } else if (typeof block === "string") {
        parts.push(block);
      }
    }
    return parts.join("\n");
  }
  return JSON.stringify(raw ?? "");
}


const BUILTIN_SOURCE_IDS = ["claude", "codex", "opencode", "workbuddy", "pi", "gemini"];
