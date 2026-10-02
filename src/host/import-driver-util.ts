/**
 * 会话导入驱动共享工具（T-P3-151 从 import-drivers.ts 拆出的行数纪律位）：
 * 目录遍历/mtime/数据根安全——jsonl 与 json-tree 两驱动共用。
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const SKIP_SCAN_DIRS = new Set(["node_modules", ".git"]);

export function listSessionFiles(root: string, extension: string, recursive: boolean, cap: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= cap || depth > 16) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= cap) return;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_SCAN_DIRS.has(entry.name)) continue;
        if (recursive) walk(abs, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        out.push(abs);
      }
    }
  };
  walk(root, 0);
  return out;
}

export function safeMtime(file: string): number | null {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/** 数据根安全：拒绝 `/` 与整个 home（该插件同款——防整盘扫描）。 */
export function isSafeRoot(root: string, home: string): boolean {
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root) return false;
  if (path.resolve(home) === resolved) return false;
  return true;
}
