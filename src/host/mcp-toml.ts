/**
 * 最小 TOML 解析器（T-P3-143 批次 A——MCP 外部导入的 Codex config.toml 面）。
 * 只够 [mcp_servers.<name>] 段：字符串/字符串数组/内联表/数字/布尔；不支持
 * 多行字符串、日期、嵌套子表（子表忽略——如 [mcp_servers.x.auth]）。
 * 零依赖先例 = pi-desktop agent-mcp-scan.ts:395-523（本仓运行时依赖闭集
 * 不引 toml 库）；[mcp.servers.*] 历史错误格式容错取 cc-switch codex.rs。
 */


/** 内联表/数组的逻辑行跨行累积上限（防坏文件无限吞行）。 */
const MAX_LOGICAL_LINE = 512;

// ---------------------------------------------------------------------------
// 最小 TOML（只够 Codex [mcp_servers.*] 段：字符串/字符串数组/内联表/
// 数字/布尔；不支持多行字符串、日期、嵌套表——超出形状按解析失败跳过）
// ---------------------------------------------------------------------------

/** 去行注释（引号外的 #——scan 逐字符切，引号内 # 保留）。 */
function stripTomlComment(line: string): string {
  let inString = false;
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === "\\" && quote === '"') i++; // 基本字符串转义跳下一字符
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
    } else if (ch === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

/** 括号/花括号平衡计数（引号外才算——数组与内联表跨行累积用）。 */
function bracketDelta(text: string): number {
  let delta = 0;
  let inString = false;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
    } else if (ch === "[" || ch === "{") delta++;
    else if (ch === "]" || ch === "}") delta--;
  }
  return delta;
}

/** 基本字符串转义还原（最小面：\\" \\\\ \\n \\t \\r；其余原样保留）。 */
function unescapeTomlString(raw: string): string {
  return raw.replace(/\\(.)/g, (_m, ch: string) => {
    switch (ch) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      default:
        return ch;
    }
  });
}

/** 顶层逗号切分（引号/括号感知——数组与内联表元素共用）。 */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let quote = "";
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
    } else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail !== "") parts.push(tail);
  return parts;
}

/** 单值解析（字符串/数组/内联表/数字/布尔——递归面）。 */
function parseTomlValue(text: string): unknown {
  const t = text.trim();
  if (t.startsWith('"')) {
    // 基本字符串（单行——多行字符串不支持，原样失败）
    const m = /^"((?:[^"\\]|\\.)*)"/.exec(t);
    return m?.[1] !== undefined ? unescapeTomlString(m[1]) : undefined;
  }
  if (t.startsWith("'")) {
    const m = /^'([^']*)'/.exec(t);
    return m?.[1] !== undefined ? m[1] : undefined;
  }
  if (t.startsWith("[")) {
    const inner = t.slice(1, t.lastIndexOf("]"));
    return splitTopLevel(inner)
      .map((p) => parseTomlValue(p))
      .filter((v) => v !== undefined);
  }
  if (t.startsWith("{")) {
    const inner = t.slice(1, t.lastIndexOf("}"));
    const table: Record<string, unknown> = {};
    for (const pair of splitTopLevel(inner)) {
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const key = pair.slice(0, eq).trim().replace(/^"|"$/g, "");
      const value = parseTomlValue(pair.slice(eq + 1));
      if (value !== undefined) table[key] = value;
    }
    return table;
  }
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return undefined;
}

/** 键解析（裸键或引号键）。 */
function parseTomlKey(text: string): string | undefined {
  const t = text.trim();
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(t) ?? /^'([^']*)'$/.exec(t);
  if (quoted?.[1] !== undefined) return unescapeTomlString(quoted[1]);
  if (/^[A-Za-z0-9_-]+$/.test(t)) return t;
  return undefined;
}

/** 段路径解析：`[mcp_servers."a.b"]` → ["mcp_servers", "a.b"]。 */
function parseTomlSection(line: string): string[] | undefined {
  const m = /^\[(.+)\]$/.exec(line);
  if (!m || m[1] === undefined) return undefined;
  const body = m[1];
  const segments: string[] = [];
  let inString = false;
  let quote = "";
  let start = 0;
  for (let i = 0; i <= body.length; i++) {
    const ch = body[i] ?? "";
    if (inString) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "." || i === body.length) {
      const seg = parseTomlKey(body.slice(start, i));
      if (seg === undefined) return undefined;
      segments.push(seg);
      start = i + 1;
    }
  }
  return segments;
}

export interface CodexTomlMcpServers {
  servers: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; url?: string }>;
  error?: string;
}

/**
 * 解 config.toml 的 [mcp_servers.<name>] 段（容错 [mcp.servers.<name>]——
 * cc-switch 先例）；其余段忽略。语法级失败（括号不闭合/段头非法）→ error。
 */
export function parseCodexTomlMcpServers(text: string): CodexTomlMcpServers {
  const lines = text.split(/\r?\n/);
  const servers: CodexTomlMcpServers["servers"] = {};
  let current: Record<string, unknown> | undefined;
  let logical = "";
  let inValue = false;

  const commitLogical = (raw: string): "ok" | "invalid" => {
    const line = stripTomlComment(raw).trim();
    if (line === "") return "ok";
    if (line.startsWith("[")) {
      const segs = parseTomlSection(line);
      if (segs === undefined) return "invalid";
      const isMcp =
        (segs[0] === "mcp_servers" && segs.length === 2) ||
        (segs[0] === "mcp" && segs[1] === "servers" && segs.length === 3);
      const name = segs[segs.length - 1] ?? "";
      if (isMcp && name !== "") {
        current = {};
        servers[name] = current as never;
      } else {
        current = undefined; // 其他段/子表（如 auth）——键忽略
      }
      return "ok";
    }
    const eq = line.indexOf("=");
    if (eq === -1 || current === undefined) return "ok"; // 非段内键/杂项忽略
    const key = parseTomlKey(line.slice(0, eq));
    if (key === undefined) return "ok";
    const value = parseTomlValue(line.slice(eq + 1));
    if (value !== undefined) current[key] = value;
    return "ok";
  };

  for (const raw of lines) {
    if (!inValue) {
      const line = stripTomlComment(raw).trim();
      if (line === "") continue;
      const delta = bracketDelta(line);
      if (delta > 0) {
        // 值跨行（多行数组/内联表）——累积到闭合
        logical = line;
        inValue = true;
        if (lines.length > MAX_LOGICAL_LINE * 10) return { servers, error: "TOML 文件超长" };
      } else if (delta < 0) {
        return { servers, error: "TOML 括号不闭合" };
      } else {
        if (commitLogical(line) === "invalid") return { servers, error: `TOML 段头非法：${line}` };
      }
    } else {
      logical += `\n${stripTomlComment(raw).trim()}`;
      if (bracketDelta(logical) === 0) {
        inValue = false;
        if (commitLogical(logical) === "invalid") return { servers, error: "TOML 段头非法" };
        logical = "";
      } else if (logical.length > 64 * 1024) {
        return { servers, error: "TOML 值跨行过长" };
      }
    }
  }
  if (inValue) return { servers, error: "TOML 括号不闭合" };
  return { servers };
}
