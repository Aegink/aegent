/**
 * workspace 只读文件列举（U10/T-P3-109——@ 补全的数据面）。host 侧 fs
 * 只读扫描：路径相对 root（posix 分隔）、目录与文件都报（@文件/@目录
 * 两类补全）；扫描上限防呆（条目数 + 深度），跳过 .git/node_modules
 * 等重目录。只报名单不含内容——注入面无字节。
 */

import { openSync, readSync, closeSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "__pycache__"]);
export const MAX_FILE_ENTRIES = 1000;
const MAX_DEPTH = 8;

export interface WorkspaceFileEntry {
  /** 相对 root 的 posix 路径（目录带尾 /——UI 补全的图标判定面）。 */
  readonly path: string;
  readonly dir: boolean;
}

export interface WorkspaceFileList {
  readonly root: string;
  readonly entries: WorkspaceFileEntry[];
  /** true = 命中条目上限提前截断（UI 提示面）。 */
  readonly truncated: boolean;
}

/** 深度优先列举（同步——本地目录扫描，host 直答面）。root 不存在 = 空表。 */
export function listWorkspaceFiles(root: string): WorkspaceFileList {
  const base = path.resolve(root);
  const entries: WorkspaceFileEntry[] = [];
  let truncated = false;

  const walk = (dir: string, rel: string, depth: number): void => {
    if (truncated || depth > MAX_DEPTH) return;
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return; // 无权限/已消失——只读列举不炸面
    }
    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue;
      if (entries.length >= MAX_FILE_ENTRIES) {
        truncated = true;
        return;
      }
      const abs = path.join(dir, name);
      const relPath = rel === "" ? name : `${rel}/${name}`;
      let isDir: boolean;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        continue; // 扫描间隙消失/无权限——跳过（只读列举不炸面）
      }
      if (isDir) {
        entries.push({ path: `${relPath}/`, dir: true });
        walk(abs, relPath, depth + 1);
      } else {
        entries.push({ path: relPath, dir: false });
      }
    }
  };

  try {
    walk(base, "", 0);
  } catch {
    // root 不可读 = 空表（fail-open 只读面——列举不可用不阻塞会话）
  }
  return { root: base, entries, truncated };
}

// ===== U15/T-P3-117：文件树 Tab 的点击预览面（host 只读单文件） =====

/** 预览字节上限（超出读前缀 + truncated 标记——UI 提示面）。 */
export const MAX_PREVIEW_BYTES = 512 * 1024;
/** 预览路径长度上限（防呆——正常 workspace 相对路径远小于此）。 */
export const MAX_PREVIEW_PATH_CHARS = 512;

export type WorkspaceFilePreviewError =
  | "WORKSPACE_FILE_BAD_PATH"
  | "WORKSPACE_FILE_ESCAPES"
  | "WORKSPACE_FILE_UNAVAILABLE"
  | "WORKSPACE_FILE_BINARY";

export class WorkspaceFileError extends Error {
  constructor(
    readonly code: WorkspaceFilePreviewError,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceFileError";
  }
}

export interface WorkspaceFilePreview {
  readonly path: string;
  readonly content: string;
  /** true = 超字节上限只读了前缀。 */
  readonly truncated: boolean;
}

/**
 * workspace 内单文件只读预览（U15 文件树 Tab——点击预览）。安全面：
 * 相对路径归一后必须仍在 workspace 根内（绝对路径与 `..` 逃逸在 resolve
 * 层拒绝）；二进制（前 4KB 含 NUL）不预览；超上限读前缀。
 */
export function readWorkspaceFile(root: string, relPath: string): WorkspaceFilePreview {
  if (typeof relPath !== "string" || relPath === "" || relPath.length > MAX_PREVIEW_PATH_CHARS) {
    throw new WorkspaceFileError("WORKSPACE_FILE_BAD_PATH", "预览路径须为非空且长度受限的字符串");
  }
  if (relPath.includes("\0")) {
    throw new WorkspaceFileError("WORKSPACE_FILE_BAD_PATH", "预览路径含非法字节");
  }
  const base = path.resolve(root);
  const abs = path.resolve(base, relPath);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new WorkspaceFileError("WORKSPACE_FILE_ESCAPES", `预览路径越出 workspace：${relPath}`);
  }
  let st: { isDirectory(): boolean; size: number };
  try {
    st = statSync(abs);
  } catch {
    throw new WorkspaceFileError("WORKSPACE_FILE_UNAVAILABLE", `文件不可读（不存在或无权限）：${relPath}`);
  }
  if (st.isDirectory()) {
    throw new WorkspaceFileError("WORKSPACE_FILE_UNAVAILABLE", "目录不可预览（文件树中点击文件）");
  }
  const truncated = st.size > MAX_PREVIEW_BYTES;
  const readLen = truncated ? MAX_PREVIEW_BYTES : st.size;
  const buf = Buffer.alloc(readLen);
  const fd = openSync(abs, "r");
  try {
    readSync(fd, buf, 0, readLen, 0);
  } finally {
    closeSync(fd);
  }
  // 二进制防呆：前 4KB 含 NUL 视为二进制（文本预览会出乱码误导）
  if (buf.subarray(0, Math.min(readLen, 4096)).includes(0)) {
    throw new WorkspaceFileError("WORKSPACE_FILE_BINARY", "二进制文件不预览");
  }
  return { path: relPath, content: buf.toString("utf8"), truncated };
}
