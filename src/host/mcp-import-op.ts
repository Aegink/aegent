/**
 * MCP 外部配置扫描（T-P3-143 批次 A）——扫外部 Agent 工具落盘的 MCP
 * server 配置，产出可导入候选（UI 勾选后并入 settings.mcp 段）。
 *
 * 行为锚：
 *   - 源表与字段映射取 zcode settingsSyncService.SUPPORTED_MCP_AGENT_SOURCES
 *     （settingsSyncService.ts:339-412）+ qwen claudeMcpImport（Claude Desktop
 *     平台分支路径）+ pi-desktop agent-mcp-scan（Cursor 源）；
 *   - 每源一行报告、读/解析失败变 sources[].error 不静默（pi-desktop
 *     McpSourceReport 形态）；
 *   - Codex config.toml 用手写最小 TOML 解析器只解 [mcp_servers.<name>] 段
 *     （pi-desktop 零依赖先例 agent-mcp-scan.ts:395-523；容错历史错误格式
 *     [mcp.servers.*]——cc-switch codex.rs:258-274 同构）；
 *   - OpenCode mcp 键 local/remote 归一化（command 数组拆 command+args、
 *     environment→env——zcode normalizeOpenCodeMcpConfig 同构）；
 *   - 远程（url 型）条目不产候选（内核仅 stdio——I3 LIMITATIONS），计入
 *     skipped；enabled:false 条目跳过（别处显式停用的导入即启用属意外）。
 *
 * 只读面：本 op 只扫不写——导入写回在 UI 侧并入 settings patch（与
 * "保存"闸一致，不搞第二落盘通道）。
 */

import { existsSync, readFileSync } from "node:fs";
import { parseCodexTomlMcpServers, type CodexTomlMcpServers } from "./mcp-toml.js";
import path from "node:path";

/** 一个可导入候选（stdio 形状——与 McpServerEntry 的落档字段对齐）。 */
export interface McpImportCandidate {
  name: string;
  config: { command: string; args?: string[]; env?: Record<string, string> };
  /** 来源展示名（如 "Codex CLI"——导入后行内来源徽章的取值）。 */
  sourceLabel: string;
  /** 来源文件绝对路径（溯源面）。 */
  sourcePath: string;
  /** 归一化警告（如 command 数组拆分——非阻断）。 */
  warning?: string;
}

/** 每源一行报告（读失败变 error 不静默——pi-desktop 形态）。 */
export interface McpImportSourceReport {
  label: string;
  path: string;
  exists: boolean;
  /** 产出候选数。 */
  count?: number;
  /** 跳过数（远程/停用/重名/坏条目）。 */
  skipped?: number;
  error?: string;
}

export interface McpImportScanResult {
  sources: McpImportSourceReport[];
  candidates: McpImportCandidate[];
}

export interface McpImportScanDeps {
  homeDir: string;
  /** 工作区根（<ws>/.mcp.json 源——缺省不扫该源）。 */
  workspaceRoot?: string;
  /** Windows %APPDATA%（Claude Desktop 路径——测试注入临时目录）。 */
  appDataDir?: string;
}

// ---------------------------------------------------------------------------
// 源扫描
// ---------------------------------------------------------------------------

/** JSON 源读 mcpServers/mcp 键产候选（一条失败只计数不中断）。 */
function scanJsonServersFile(
  filePath: string,
  label: string,
  key: "mcpServers" | "mcp",
): { report: McpImportSourceReport; candidates: McpImportCandidate[] } {
  const report: McpImportSourceReport = { label, path: filePath, exists: existsSync(filePath) };
  const candidates: McpImportCandidate[] = [];
  if (!report.exists) return { report, candidates };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch (e) {
    report.error = `解析失败：${e instanceof Error ? e.message : String(e)}`;
    return { report, candidates };
  }
  const section = parsed[key];
  if (section === undefined || section === null || typeof section !== "object" || Array.isArray(section)) {
    report.count = 0;
    return { report, candidates };
  }
  let skipped = 0;
  for (const [name, raw] of Object.entries(section as Record<string, unknown>)) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      skipped++;
      continue;
    }
    const entry = raw as Record<string, unknown>;
    if (entry.enabled === false) {
      skipped++; // 别处显式停用——导入即启用属意外，跳过
      continue;
    }
    if (typeof entry.command === "string" && entry.command.trim() !== "") {
      candidates.push({
        name,
        config: {
          command: entry.command,
          ...(Array.isArray(entry.args) && entry.args.every((a) => typeof a === "string")
            ? { args: entry.args as string[] }
            : {}),
          ...(entry.env !== undefined && typeof entry.env === "object" && !Array.isArray(entry.env)
            ? { env: pickStringValues(entry.env as Record<string, unknown>) }
            : {}),
        },
        sourceLabel: label,
        sourcePath: filePath,
      });
    } else if (typeof entry.url === "string" && entry.url !== "") {
      skipped++; // 远程 server——内核仅 stdio，不产候选
    } else {
      skipped++; // 既无 command 也无 url——坏条目
    }
  }
  report.count = candidates.length;
  report.skipped = skipped;
  return { report, candidates };
}

function pickStringValues(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** OpenCode 源（mcp 键——local 的 command 数组拆 command+args，environment→env）。 */
function scanOpenCodeFile(
  filePath: string,
  label: string,
): { report: McpImportSourceReport; candidates: McpImportCandidate[] } {
  const report: McpImportSourceReport = { label, path: filePath, exists: existsSync(filePath) };
  const candidates: McpImportCandidate[] = [];
  if (!report.exists) return { report, candidates };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch (e) {
    report.error = `解析失败：${e instanceof Error ? e.message : String(e)}`;
    return { report, candidates };
  }
  const section = parsed["mcp"];
  if (section === undefined || section === null || typeof section !== "object" || Array.isArray(section)) {
    report.count = 0;
    return { report, candidates };
  }
  let skipped = 0;
  for (const [name, raw] of Object.entries(section as Record<string, unknown>)) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      skipped++;
      continue;
    }
    const entry = raw as Record<string, unknown>;
    if (entry.enabled === false) {
      skipped++; // 别处显式停用——导入即启用属意外，跳过
      continue;
    }
    if (typeof entry.url === "string" && entry.url !== "") {
      skipped++; // remote——内核仅 stdio
      continue;
    }
    // local 归一化：command 数组 → command + args；environment → env
    if (Array.isArray(entry.command) && entry.command.every((c) => typeof c === "string")) {
      const arr = entry.command as string[];
      if (arr.length === 0 || arr[0] === undefined) {
        skipped++;
        continue;
      }
      candidates.push({
        name,
        config: {
          command: arr[0],
          ...(arr.length > 1 ? { args: arr.slice(1) } : {}),
          ...(entry.environment !== undefined && typeof entry.environment === "object" && !Array.isArray(entry.environment)
            ? { env: pickStringValues(entry.environment as Record<string, unknown>) }
            : {}),
        },
        sourceLabel: label,
        sourcePath: filePath,
        warning: "command 数组已拆为命令 + 参数",
      });
    } else if (typeof entry.command === "string" && entry.command.trim() !== "") {
      candidates.push({
        name,
        config: {
          command: entry.command,
          ...(Array.isArray(entry.args) && entry.args.every((a) => typeof a === "string")
            ? { args: entry.args as string[] }
            : {}),
          ...(entry.environment !== undefined && typeof entry.environment === "object" && !Array.isArray(entry.environment)
            ? { env: pickStringValues(entry.environment as Record<string, unknown>) }
            : {}),
        },
        sourceLabel: label,
        sourcePath: filePath,
      });
    } else {
      skipped++; // 既无 command 也无 url——坏条目
    }
  }
  report.count = candidates.length;
  report.skipped = skipped;
  return { report, candidates };
}

/** Codex 源（TOML——手写最小解析器）。 */
function scanCodexTomlFile(
  filePath: string,
  label: string,
): { report: McpImportSourceReport; candidates: McpImportCandidate[] } {
  const report: McpImportSourceReport = { label, path: filePath, exists: existsSync(filePath) };
  const candidates: McpImportCandidate[] = [];
  if (!report.exists) return { report, candidates };
  let parsed: CodexTomlMcpServers;
  try {
    parsed = parseCodexTomlMcpServers(readFileSync(filePath, "utf8"));
  } catch (e) {
    report.error = `读取失败：${e instanceof Error ? e.message : String(e)}`;
    return { report, candidates };
  }
  if (parsed.error !== undefined) {
    report.error = parsed.error;
    return { report, candidates };
  }
  let skipped = 0;
  for (const [name, entry] of Object.entries(parsed.servers)) {
    if (typeof entry.command === "string" && entry.command !== "") {
      candidates.push({
        name,
        config: {
          command: entry.command,
          ...(entry.args !== undefined ? { args: entry.args } : {}),
          ...(entry.env !== undefined ? { env: entry.env } : {}),
        },
        sourceLabel: label,
        sourcePath: filePath,
        warning: "外部超时字段（startup_timeout_sec 等）不迁移——如需可在表单调超时",
      });
    } else {
      skipped++; // url 型（streamable http）或空条目
    }
  }
  report.count = candidates.length;
  report.skipped = skipped;
  return { report, candidates };
}

/** Claude Desktop 配置的按平台路径（qwen claudeMcpImport.ts:181-203 同构）。 */
function claudeDesktopPath(homeDir: string, appDataDir?: string): string {
  if (process.platform === "win32") {
    const base = appDataDir ?? process.env["APPDATA"] ?? path.join(homeDir, "AppData", "Roaming");
    return path.join(base, "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return path.join(homeDir, ".config", "Claude", "claude_desktop_config.json");
}

/** 扫描入口（只读——候选不落任何文件）。 */
export async function mcpImportScan(deps: McpImportScanDeps): Promise<McpImportScanResult> {
  const home = deps.homeDir;
  type Source = { label: string; path: string; kind: "mcpServers" | "mcp" | "codex" };
  const sources: Source[] = [
    { label: "Claude Code", path: path.join(home, ".claude.json"), kind: "mcpServers" },
    { label: "Claude Code", path: path.join(home, ".claude", "settings.json"), kind: "mcpServers" },
    { label: "Claude Desktop", path: claudeDesktopPath(home, deps.appDataDir), kind: "mcpServers" },
    { label: "Codex CLI", path: path.join(home, ".codex", "config.toml"), kind: "codex" },
    { label: "Cursor", path: path.join(home, ".cursor", "mcp.json"), kind: "mcpServers" },
    { label: "OpenCode", path: path.join(home, ".config", "opencode", "opencode.json"), kind: "mcp" },
    { label: "Qwen Code", path: path.join(home, ".qwen", "settings.json"), kind: "mcpServers" },
    { label: "Trae", path: path.join(home, ".trae", "settings.json"), kind: "mcpServers" },
    { label: "通用（.agents）", path: path.join(home, ".agents", "mcp.json"), kind: "mcpServers" },
    ...(deps.workspaceRoot !== undefined
      ? [{ label: "工作区", path: path.join(deps.workspaceRoot, ".mcp.json"), kind: "mcpServers" as const }]
      : []),
  ];

  const reports: McpImportSourceReport[] = [];
  const candidates: McpImportCandidate[] = [];
  const seenNames = new Set<string>();
  for (const src of sources) {
    const scanned =
      src.kind === "codex"
        ? scanCodexTomlFile(src.path, src.label)
        : src.kind === "mcp"
          ? scanOpenCodeFile(src.path, src.label)
          : scanJsonServersFile(src.path, src.label, src.kind);
    reports.push(scanned.report);
    for (const c of scanned.candidates) {
      // 跨源重名：表序即优先级（先到先得），后者计入该源 skipped
      if (seenNames.has(c.name)) {
        scanned.report.skipped = (scanned.report.skipped ?? 0) + 1;
        continue;
      }
      seenNames.add(c.name);
      candidates.push(c);
    }
  }
  return { sources: reports, candidates };
}
