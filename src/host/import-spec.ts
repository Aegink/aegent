/**
 * 会话导入 spec 层（T-P3-150 A1/A4——声明式来源的类型、纯数据校验器与
 * 提取原语；pi-desktop session-import 插件的架构移植）。三驱动的扫描/转换
 * 实现见 import-drivers.ts 与 import-driver-sqlite.ts。
 *
 * 安全边界（照抄该插件校验器）：spec 只允许纯数据——eval/require/script/
 * transform/__proto__ 等键**任意层级**拒绝；嵌套 ≤12；数据根不许 `/` 或
 * 整个 home；配置 ≤512KB、来源 ≤25。
 */

import { homedir } from "node:os";
import path from "node:path";


// ---------------------------------------------------------------------------
// spec 类型（纯数据——声明式来源的全部表达能力）
// ---------------------------------------------------------------------------

export type ImportDriver = "jsonl-transcript" | "sqlite-session" | "json-tree";

/** 内容提取规则（四种写法：字段路径 / 块数组 / first 依次尝试 / literal）。 */
export type ContentRule =
  | string
  | { path: string }
  | {
      blocks: {
        path: string;
        typeField: string;
        types: string[];
        textField?: string;
      };
    }
  | { first: ContentRule[] }
  | { literal: string };

export interface JsonlSpec {
  id: string;
  label: string;
  driver: "jsonl-transcript";
  root: string;
  extension?: string;
  recursive?: boolean;
  maxFiles?: number;
  maxBytes?: number;
  maxLines?: number;
  session?: {
    idFrom?: string | { path: string };
    idFromEntry?: { path: string; in: string[] };
    titleFrom?: string | "firstUser";
    projectFrom?: string | "parentDir";
    fallbackProject?: string;
  };
  entry?: {
    rolePath?: string;
    roleMap?: Record<string, string>;
    content?: ContentRule;
    tsPath?: string;
    match?: { path: string; in: string[] };
    skipTypePath?: string;
    skipTypes?: string[];
    unwrapPath?: string;
    drop?: { startsWith: string[]; roles?: string[] };
    toolCall?: {
      call?: { typePath: string; types: string[]; idPath: string; namePath: string; argsPath: string; argsJson?: boolean };
      result?: { typePath: string; types: string[]; idPath: string; resultPath: string; statusPath?: string; errorValues?: string[] };
      callBlocks?: { path: string; typeField: string; type: string; idPath: string; namePath: string; argsPath: string; argsJson?: boolean; roles?: string[] };
      resultBlocks?: { path: string; typeField: string; type: string; idPath: string; resultPath: string; statusPath?: string; errorValues?: string[]; roles?: string[] };
      emitUnpaired?: boolean;
    };
  };
}

export interface JsonTreeSpec {
  id: string;
  label: string;
  driver: "json-tree";
  root: string;
  extension?: string;
  recursive?: boolean;
  maxFiles?: number;
  maxBytes?: number;
  session?: {
    idPath?: string;
    titlePath?: string;
    tsPath?: string;
    pathPath?: string;
    messagesPath?: string;
  };
  message?: {
    rolePath?: string;
    roleMap?: Record<string, string>;
    content?: ContentRule;
    tsPath?: string;
    tool?: { typeField: string; toolType?: string; namePath: string; argsPath: string; resultPath: string };
  };
}

/** sqlite-session spec 形状见 import-driver-sqlite.ts（表/列全映射）。 */
export interface SqliteSpec {
  id: string;
  label: string;
  driver: "sqlite-session";
  db: string;
  maxFiles?: number;
  session: Record<string, unknown>;
  message?: Record<string, unknown>;
  part?: Record<string, unknown>;
}

export type ImportSpec = (JsonlSpec | JsonTreeSpec | SqliteSpec) & { custom?: boolean };

export interface ImportedSessionSummary {
  source: string;
  externalId: string;
  title: string;
  projectPath: string | null;
  createdAt: string | null;
  updatedAt: string;
  /** 消息数；超大文件（>1MB 采样）诚实降级为 null——pideck 同款"未计数"。 */
  messageCount: number | null;
  /** 超大文件标记（UI 显示"超大文件未计数"）。 */
  truncated?: boolean;
  /** jsonl/json-tree 驱动的源文件（convert 复读 + isInside 边界复验）。 */
  filePath?: string;
  /** sqlite 驱动的库路径（convert 复读 + resolveDbPath 复验）。 */
  dbPath?: string;
}

export interface ImportedMessage {
  role: "user" | "assistant" | "tool";
  text?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: string;
  toolError?: boolean;
  createdAt?: string | null;
}

// ---------------------------------------------------------------------------
// 资源上限（A5——对齐该插件默认值；spec 可覆盖 maxFiles/maxBytes/maxLines）
// ---------------------------------------------------------------------------

export const BUILTIN_SOURCE_IDS = ["claude", "codex", "opencode", "workbuddy", "pi", "gemini", "zcode"];

export const LIMITS = {
  maxFiles: 2000,
  maxBytes: 32 * 1024 * 1024,
  maxLines: 20000,
  maxDepth: 12,
  maxSpecs: 25,
  maxSpecBytes: 512 * 1024,
} as const;

const FORBIDDEN_KEYS = new Set([
  "eval", "code", "require", "transform", "script", "module", "exports",
  "constructor", "prototype", "__proto__", "import", "function", "bind", "call", "apply",
]);

/** spec 纯数据校验（A4——FORBIDDEN_KEYS 任意层级 + 嵌套深度）。返回错误
 * 列表（空 = 通过）；被拒 spec 不中断其他来源。 */
export function validateSpecShape(value: unknown, at = "spec", errors: string[] = [], depth = 0): string[] {
  if (depth > LIMITS.maxDepth) {
    errors.push(`${at}: 嵌套过深（上限 ${String(LIMITS.maxDepth)}）`);
    return errors;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) validateSpecShape(value[i], `${at}[${String(i)}]`, errors, depth + 1);
    return errors;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        errors.push(`${at}.${key}: 禁用键（spec 只允许纯数据）`);
        continue;
      }
      validateSpecShape(v, `${at}.${key}`, errors, depth + 1);
    }
    return errors;
  }
  if (typeof value === "function") {
    errors.push(`${at}: 非数据值（函数）`);
  }
  return errors;
}

/** 解析并校验自定义来源配置文件（数组或 {sources:[...]}）——返回可用
 * spec 与逐条错误（坏 spec 不中断其他）。 */
export function parseCustomSources(raw: string): { specs: ImportSpec[]; errors: string[] } {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { specs: [], errors: [`配置不是合法 JSON：${e instanceof Error ? e.message : String(e)}`] };
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { sources?: unknown }).sources)
      ? ((parsed as { sources: unknown[] }).sources)
      : null;
  if (list === null) return { specs: [], errors: ["配置形状须为数组或 {sources:[...]}"] };
  const shapeErrors = validateSpecShape(list, "sources");
  if (shapeErrors.length > 0) return { specs: [], errors: shapeErrors };
  const specs: ImportSpec[] = [];
  for (let i = 0; i < Math.min(list.length, LIMITS.maxSpecs); i += 1) {
    const entry = list[i];
    if (entry === null || typeof entry !== "object") {
      errors.push(`sources[${String(i)}]: 须为对象`);
      continue;
    }
    const spec = entry as Record<string, unknown>;
    const id = typeof spec["id"] === "string" ? spec["id"] : "";
    if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/.test(id)) {
      errors.push(`sources[${String(i)}].id 不合法（字母开头，含 ._ -，≤64 字符）`);
      continue;
    }
    if (BUILTIN_SOURCE_IDS.includes(id)) {
      errors.push(`sources[${String(i)}].id "${id}" 与内置来源冲突`);
      continue;
    }
    const driver = spec["driver"];
    if (driver !== "jsonl-transcript" && driver !== "sqlite-session" && driver !== "json-tree") {
      errors.push(`sources[${String(i)}].driver 非法（合法：jsonl-transcript|sqlite-session|json-tree）`);
      continue;
    }
    specs.push({ ...(spec as unknown as ImportSpec), custom: true });
  }
  return { specs, errors };
}


export function getPath(obj: unknown, expr: string | undefined): unknown {
  if (expr === undefined || expr === "") return undefined;
  let cur: unknown = obj;
  for (const seg of expr.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** ContentRule 求值（四种写法——blocks 挑 type 拼 text/first 依次/literal）。 */
export function extractText(rule: ContentRule | undefined, entry: Record<string, unknown>): string {
  if (rule === undefined) return "";
  if (typeof rule === "string") return String(getPath(entry, rule) ?? "");
  if ("path" in rule) return String(getPath(entry, rule.path) ?? "");
  if ("literal" in rule) return rule.literal;
  if ("first" in rule) {
    for (const sub of rule.first) {
      const text = extractText(sub, entry);
      if (text !== "") return text;
    }
    return "";
  }
  // blocks：数组里挑指定 type 的块，拼接其 textField；非数组时宽容兜底
  // 直接取字段值（不少工具同一字段 user 存字符串、assistant 存块数组）
  const blocks = rule.blocks;
  const arr = getPath(entry, blocks.path);
  if (!Array.isArray(arr)) {
    return arr === null || arr === undefined ? "" : String(arr);
  }
  const parts: string[] = [];
  for (const block of arr) {
    if (block === null || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b[blocks.typeField] !== undefined && !blocks.types.includes(String(b[blocks.typeField]))) continue;
    const text = blocks.textField !== undefined ? b[blocks.textField] : undefined;
    if (typeof text === "string") parts.push(text);
  }
  return parts.join("\n").trim();
}

export function normalizeRole(rawRole: unknown, roleMap: Record<string, string> | undefined): ImportedMessage["role"] | null {
  const role = String(rawRole ?? "");
  const mapped = roleMap?.[role] ?? role;
  if (mapped === "user") return "user";
  if (mapped === "assistant") return "assistant";
  if (mapped === "tool") return "tool";
  return null;
}

export function toIso(value: unknown): string | null {
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000; // 秒/毫秒双单位
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === "string" && value !== "") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export function truncateTitle(text: string, limit = 48): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
}

export function expandHome(p: string, home: string = homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(home, p.slice(2));
  return p;
}

