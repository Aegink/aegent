/**
 * 项目域编排层（T-P3-150 A3/A4/B1/A5 数据面）——Git clone 添加、其他工具
 * 会话扫描（发现级）、项目任务清单、分支徽标读取。fs 三 op 的纯函数面在
 * fs-gateway.ts（边界与配额纪律在那里）。
 *
 * 导入契约（pi-desktop importers 对齐）：发现级扫描 = 只读各工具会话记录
 * 的 cwd/标题/时间，按 cwd 归组为候选项目；会话内容转换记档 A4b。扫描全
 * fail-soft（单文件坏行跳过；单源不可达 = 0 条 + note 说明）。
 */

import { existsSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { gitCloneSource } from "./plugins-marketplace-git.js";
import { FsBoundaryError } from "./fs-gateway.js";

// ---------------------------------------------------------------------------
// A4 扫描导入（发现级）
// ---------------------------------------------------------------------------

export type ImportSource = "claude" | "codex" | "opencode";

export interface ImportedProjectCandidate {
  source: ImportSource;
  /** 项目目录（归组键——会话记录里的 cwd）。 */
  cwd: string;
  /** 样例标题（该组最新会话的首条用户消息截断）。 */
  title: string;
  sessionCount: number;
  lastActiveTs: number;
}

export interface ImportScanResult {
  candidates: ImportedProjectCandidate[];
  sources: { source: ImportSource; scanned: number; note?: string }[];
}

/** codex 大档案采样上限（pi-desktop CODEX_SCAN_MAX_FILES 对齐）。 */
const CODEX_MAX_FILES = 250;
/** 单文件头部采样字节（找 cwd/首条消息——不整读大档案）。 */
const HEAD_SAMPLE_BYTES = 64 * 1024;
/** 每源候选 cwd 上限（防失控目录树）。 */
const MAX_CWDS_PER_SOURCE = 200;

interface SessionSample {
  cwd?: string;
  title?: string;
  updatedAt: number;
}

function headSample(file: string, bytes = HEAD_SAMPLE_BYTES): string {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const read = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, read).toString("utf-8");
  } catch {
    return "";
  } finally {
    closeSync(fd);
  }
}

/** JSONL 逐行安全解析（坏行跳过——半写行/注入行不炸扫描）。 */
function* jsonlLines(text: string): Generator<Record<string, unknown>> {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || !trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed !== null && typeof parsed === "object") {
        yield parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
}

/** 提取用户消息文本（claude/codex 共通形状探测——message.content 字符串或数组）。 */
function userTextOf(row: Record<string, unknown>): string | undefined {
  if (row["type"] !== "user" && row["role"] !== "user") return undefined;
  const message = row["message"];
  const content =
    typeof message === "object" && message !== null
      ? (message as Record<string, unknown>)["content"]
      : row["content"];
  if (typeof content === "string") {
    const text = content.trim();
    // 合成前缀黑名单（pi-desktop claude.ts:62 语义——命令 caveat/system-
    // reminder 类 `<` 开头非真实用户话语）
    return text.startsWith("<") ? undefined : text;
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === "object" && part !== null && (part as Record<string, unknown>)["type"] === "text") {
        const text = String((part as Record<string, unknown>)["text"] ?? "").trim();
        if (text !== "" && !text.startsWith("<")) return text;
      }
    }
  }
  return undefined;
}

function truncateTitle(text: string, limit = 48): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
}

/** Claude Code：~/.claude/projects/<编码目录>/*.jsonl（cwd 在每行）。 */
function scanClaude(home: string): { samples: SessionSample[]; scanned: number; note?: string } {
  const root = path.join(home, ".claude", "projects");
  if (!existsSync(root)) return { samples: [], scanned: 0, note: "~/.claude/projects 不存在" };
  const samples: SessionSample[] = [];
  let scanned = 0;
  for (const dir of listDirs(root)) {
    for (const file of jsonlFiles(path.join(root, dir))) {
      scanned += 1;
      const sample = sampleClaudeSession(path.join(root, dir, file));
      if (sample !== undefined) samples.push(sample);
    }
  }
  return { samples, scanned };
}

function sampleClaudeSession(file: string): SessionSample | undefined {
  let cwd: string | undefined;
  let title: string | undefined;
  for (const row of jsonlLines(headSample(file))) {
    if (cwd === undefined && typeof row["cwd"] === "string") cwd = row["cwd"] as string;
    if (title === undefined) {
      const text = userTextOf(row);
      if (text !== undefined) title = truncateTitle(text);
    }
    if (cwd !== undefined && title !== undefined) break;
  }
  if (cwd === undefined) return undefined;
  return { cwd, title, updatedAt: safeMtime(file) };
}

/** Codex：~/.codex/sessions/YYYY/MM/DD/roll-*.jsonl（采样上限 + head 采样）。 */
function scanCodex(home: string): { samples: SessionSample[]; scanned: number; note?: string } {
  const root = path.join(home, ".codex", "sessions");
  if (!existsSync(root)) return { samples: [], scanned: 0, note: "~/.codex/sessions 不存在" };
  const files: string[] = [];
  collectFiles(root, files, CODEX_MAX_FILES);
  files.sort((a, b) => safeMtime(b) - safeMtime(a)); // 最新优先（截断丢最旧）
  const samples: SessionSample[] = [];
  for (const file of files) {
    const sample = sampleCodexSession(file);
    if (sample !== undefined) samples.push(sample);
  }
  const note = files.length >= CODEX_MAX_FILES ? `扫描上限 ${String(CODEX_MAX_FILES)} 文件（仅最新段）` : undefined;
  return { samples, scanned: files.length, ...(note !== undefined ? { note } : {}) };
}

function sampleCodexSession(file: string): SessionSample | undefined {
  let cwd: string | undefined;
  let title: string | undefined;
  for (const row of jsonlLines(headSample(file))) {
    // codex session_meta / turn_context 行带 cwd；用户消息在 response_item
    if (cwd === undefined) {
      const payload = row["payload"];
      if (typeof payload === "object" && payload !== null) {
        const cwdInPayload = (payload as Record<string, unknown>)["cwd"];
        if (typeof cwdInPayload === "string") cwd = cwdInPayload;
      }
    }
    if (typeof row["cwd"] === "string" && cwd === undefined) cwd = row["cwd"] as string;
    if (title === undefined) {
      const payload = row["payload"];
      if (typeof payload === "object" && payload !== null) {
        const text = userTextOf(payload as Record<string, unknown>);
        if (text !== undefined) title = truncateTitle(text);
      }
    }
    if (cwd !== undefined && title !== undefined) break;
  }
  if (cwd === undefined) return undefined;
  return { cwd, title, updatedAt: safeMtime(file) };
}

/** OpenCode：~/.local/share/opencode/storage/session/<hash>/<id>.json（XDG
 * 路径——Windows 常见缺省不存在 = 0 条诚实降级）。 */
function scanOpencode(home: string): { samples: SessionSample[]; scanned: number; note?: string } {
  const root = path.join(home, ".local", "share", "opencode", "storage", "session");
  if (!existsSync(root)) return { samples: [], scanned: 0, note: "opencode 存储目录不存在（本机未安装或非 XDG 布局）" };
  const samples: SessionSample[] = [];
  let scanned = 0;
  for (const dir of listDirs(root)) {
    for (const file of jsonFiles(path.join(root, dir))) {
      scanned += 1;
      try {
        const parsed = JSON.parse(readFileSync(path.join(root, dir, file), "utf-8")) as Record<string, unknown>;
        const directory = parsed["directory"];
        if (typeof directory !== "string" || directory === "") continue;
        const titleRaw = parsed["title"];
        const time = parsed["time"];
        const updated =
          typeof time === "object" && time !== null && typeof (time as Record<string, unknown>)["updated"] === "number"
            ? ((time as Record<string, unknown>)["updated"] as number)
            : safeMtime(path.join(root, dir, file));
        samples.push({
          cwd: directory,
          title: typeof titleRaw === "string" && titleRaw !== "" ? truncateTitle(titleRaw) : undefined,
          updatedAt: updated,
        });
      } catch {
        continue;
      }
    }
  }
  return { samples, scanned };
}

function listDirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

function jsonlFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
}

function jsonFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

function collectFiles(root: string, out: string[], cap: number): void {
  if (out.length >= cap) return;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= cap) return;
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) collectFiles(abs, out, cap);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(abs);
  }
}

function safeMtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** 三源并发语义收敛为同步顺序扫（本地小目录——无需真并发）；cwd 归组 +
 * lastActive 降序。 */
export function scanImportableProjects(home: string = homedir()): ImportScanResult {
  const sources: ImportScanResult["sources"] = [];
  const byCwd = new Map<string, ImportedProjectCandidate>();
  const run = (source: ImportSource, result: { samples: SessionSample[]; scanned: number; note?: string }) => {
    sources.push({
      source,
      scanned: result.scanned,
      ...(result.note !== undefined ? { note: result.note } : {}),
    });
    for (const sample of result.samples) {
      if (sample.cwd === undefined) continue;
      const key = path.resolve(sample.cwd);
      const existing = byCwd.get(key);
      if (existing === undefined) {
        if (byCwd.size >= MAX_CWDS_PER_SOURCE) continue;
        byCwd.set(key, {
          source,
          cwd: key,
          title: sample.title ?? path.basename(key),
          sessionCount: 1,
          lastActiveTs: sample.updatedAt,
        });
        continue;
      }
      existing.sessionCount += 1;
      if (sample.updatedAt > existing.lastActiveTs) existing.lastActiveTs = sample.updatedAt;
      if (sample.title !== undefined && existing.title === path.basename(existing.cwd)) existing.title = sample.title;
    }
  };
  run("claude", scanClaude(home));
  run("codex", scanCodex(home));
  run("opencode", scanOpencode(home));
  const candidates = [...byCwd.values()].sort((a, b) => b.lastActiveTs - a.lastActiveTs);
  return { candidates, sources };
}

// ---------------------------------------------------------------------------
// A3 Git clone 添加
// ---------------------------------------------------------------------------

export interface ProjectCloneResult {
  /** clone 完成后的仓库根（UI 以此建项目）。 */
  path: string;
}

/**
 * clone 仓库到父目录下（复用插件市场 runGit 基建——净化 env/超时/参数
 * 白名单）；目标重名 = 类型化冲突（pi-desktop git-clone.ts 语义）。
 */
export async function projectGitClone(payload: {
  url: string;
  parentDir: string;
  name?: string;
}): Promise<ProjectCloneResult> {
  const urlErr = payload.url.trim() === "" ? "URL 不能为空" : undefined;
  if (urlErr !== undefined) throw new Error(urlErr);
  if (!existsSync(payload.parentDir)) {
    throw new FsBoundaryError("PROJECT_DIR_MISSING", `父目录不存在：${payload.parentDir}`);
  }
  const inferred = inferRepoName(payload.url);
  const name = (payload.name ?? inferred).trim();
  if (name === "" || name.includes("/") || name.includes("\\")) {
    throw new Error("仓库名不合法（不能含路径分隔符）");
  }
  const dest = path.join(payload.parentDir, name);
  if (existsSync(dest)) {
    const error = new Error(`目标目录已存在：${dest}`);
    (error as unknown as { code: string }).code = "PROJECT_CLONE_CONFLICT";
    throw error;
  }
  await gitCloneSource({ url: payload.url.trim(), dest });
  return { path: dest };
}

/** 仓库 URL → 目标目录名（https/git/scp 形态的末段去 .git）。 */
function inferRepoName(url: string): string {
  const trimmed = url.trim().replace(/\.git$/, "");
  const last = trimmed.split(/[/:]/).filter((p) => p !== "").pop();
  return last ?? "repo";
}

// ---------------------------------------------------------------------------
// A5 分支徽标（.git/HEAD 读取——pi-desktop withGitBranch 方案，无 libgit2）
// ---------------------------------------------------------------------------

export function readGitBranch(workspace: string): string | undefined {
  const head = path.join(workspace, ".git", "HEAD");
  try {
    const content = readFileSync(head, "utf-8").trim();
    const match = /^ref: refs\/heads\/(.+)$/.exec(content);
    return match?.[1];
  } catch {
    return undefined; // 非 git 目录/裸 HEAD——静默无徽标
  }
}
