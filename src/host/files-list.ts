/**
 * workspace 只读文件列举（U10/T-P3-109——@ 补全的数据面）。host 侧 fs
 * 只读扫描：路径相对 root（posix 分隔）、目录与文件都报（@文件/@目录
 * 两类补全）；扫描上限防呆（条目数 + 深度），跳过 .git/node_modules
 * 等重目录。只报名单不含内容——注入面无字节。
 */

import { readdirSync, statSync } from "node:fs";
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
