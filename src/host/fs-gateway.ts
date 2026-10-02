/**
 * 项目文件面（T-P3-150 C1/C5/C6 数据面）——文件树单层列举 / 文件读取 /
 * shell 集成三类只读 op 的 host 实现。
 *
 * 边界纪律（pideck isPathInsideProject 模式——不信任 UI 自报路径）：所有
 * path 必须落在**已添加项目的根集合**内，realpath 归一后前缀校验（防
 * `../` 逃逸与 symlink 换轨）；根自身不存在 = 类型化 PROJECT_DIR_MISSING。
 * 配额（dsh workspaceFiles 三重 cap 同构）：单层 2000 条、文本 256KB 截断
 * （zcode 策略——truncated 整体返回不拼块）、图片 8MB。shell 集成沿
 * revealSkillDir 先例（spawn detached——explorer/open/xdg-open）。
 */

import { openSync, readSync, closeSync, statSync, existsSync, readdirSync, fstatSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

/** 单层条目上限（pideck fileTree 契约同量级）。 */
const MAX_DIR_ENTRIES = 2000;
/** 文本读取字节上限（zcode FILE_VIEWER_MAX_TEXT_BYTES 同值——truncated
 * 整体放弃，绝不拼接分块防 UTF-8 断字）。 */
const MAX_TEXT_BYTES = 256 * 1024;
/** 图片预览字节上限（zcode media 8MB 对齐）。 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** 目录黑名单（pideck FileSystemService 表——列举层滤噪，不滤 dotfiles）。 */
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "target", ".next", "coverage", ".venv", "__pycache__"]);

/** 图片扩展名 → mediaType（白名单闭集——与附件域 IMAGE_TYPES 同集+svg）。 */
const IMAGE_EXT_BY_MEDIA: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export class FsBoundaryError extends Error {
  constructor(
    readonly code: "FS_PATH_OUTSIDE" | "PROJECT_DIR_MISSING" | "FS_NOT_FOUND" | "FS_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "FsBoundaryError";
  }
}

/**
 * 路径边界校验：目标必须落在某个项目根内。realpath 归一两侧（根与目标——
 * 根不存在即 PROJECT_DIR_MISSING；目标 realpath 失败按存在性分别处理）。
 * 返回命中的项目根（absolute）。
 */
export function resolveProjectRootFor(target: string, projectRoots: readonly string[]): string {
  if (projectRoots.length === 0) {
    throw new FsBoundaryError("FS_PATH_OUTSIDE", "尚无已添加项目——先在项目页添加目录");
  }
  const targetAbs = path.resolve(target);
  if (!existsSync(targetAbs)) {
    throw new FsBoundaryError("FS_NOT_FOUND", `路径不存在：${path.basename(targetAbs)}`);
  }
  let targetReal = targetAbs;
  try {
    targetReal = realpathSync(targetAbs);
  } catch {
    throw new FsBoundaryError("FS_NOT_FOUND", `路径不可解析：${path.basename(targetAbs)}`);
  }
  for (const root of projectRoots) {
    if (!existsSync(root)) continue; // missing 项目跳过（不误删语义）
    let rootReal: string;
    try {
      rootReal = realpathSync(root);
    } catch {
      continue;
    }
    const rel = path.relative(rootReal, targetReal);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      return rootReal;
    }
  }
  throw new FsBoundaryError("FS_PATH_OUTSIDE", "路径在所有项目根之外——已拒绝");
}

export interface FsEntry {
  /** 绝对路径（UI 右键/预览直接用——边界已在服务端校验）。 */
  name: string;
  path: string;
  dir: boolean;
  /** 目录是否含可见子项（懒加载箭头位——空目录不渲染展开箭头）。 */
  hasChildren?: boolean;
  size?: number;
  mtimeMs?: number;
}

export interface FsListResult {
  path: string;
  entries: FsEntry[];
  truncated: boolean;
}

/**
 * 单层目录列举（懒加载契约——maxDepth=0 + hasChildren 箭头位；pideck
 * FileSystemService 同构）。目录优先 + 名称排序；黑名单目录跳过。
 */
export function fsListDir(
  dirAbs: string,
  projectRoots: readonly string[],
): FsListResult {
  resolveProjectRootFor(dirAbs, projectRoots);
  let stats;
  try {
    stats = statSync(dirAbs);
  } catch {
    throw new FsBoundaryError("FS_NOT_FOUND", `目录不存在：${path.basename(dirAbs)}`);
  }
  if (!stats.isDirectory()) {
    throw new FsBoundaryError("FS_NOT_FOUND", `目标不是目录：${path.basename(dirAbs)}`);
  }
  let names: string[];
  try {
    names = readdirSync(dirAbs);
  } catch {
    throw new FsBoundaryError("FS_NOT_FOUND", `目录不可读：${path.basename(dirAbs)}`);
  }
  const entries: FsEntry[] = [];
  let truncated = false;
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    if (entries.length >= MAX_DIR_ENTRIES) {
      truncated = true;
      break;
    }
    const abs = path.join(dirAbs, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue; // 竞态删除/权限——单条跳过不炸列举
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      entries.push({ name, path: abs, dir: true, hasChildren: dirHasVisibleChildren(abs) });
    } else {
      entries.push({ name, path: abs, dir: false, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  // 目录优先排序（名称序内目录提前——zcode/pideck 同款树序）
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { path: dirAbs, entries, truncated };
}

/** 目录可见子项探测（黑名单外任一条目即 true——readdir 一次，不递归）。 */
function dirHasVisibleChildren(dirAbs: string): boolean {
  try {
    for (const name of readdirSync(dirAbs)) {
      if (!SKIP_DIRS.has(name)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export interface FsReadResult {
  path: string;
  kind: "text" | "image" | "binary";
  /** 文本内容（kind=text；truncated 时为截断前 256KB——整体放弃语义下
   * 仍给已读部分并标 truncated，UI 明示"文件过大仅显示前段"）。 */
  content?: string;
  /** 图片 base64（kind=image）。 */
  base64?: string;
  mediaType?: string;
  truncated?: boolean;
  size?: number;
}

/**
 * 文件读取：图片扩展名走 base64（8MB 上限）；其余按文本读 256KB 截断 +
 * 二进制检测（含 NUL 或控制字符 >30% 判二进制——zcode fileService 同阈值）。
 */
export function fsReadFile(fileAbs: string, projectRoots: readonly string[]): FsReadResult {
  resolveProjectRootFor(fileAbs, projectRoots);
  let st;
  try {
    st = statSync(fileAbs);
  } catch {
    throw new FsBoundaryError("FS_NOT_FOUND", `文件不存在：${path.basename(fileAbs)}`);
  }
  if (!st.isFile()) {
    throw new FsBoundaryError("FS_NOT_FOUND", `目标不是文件：${path.basename(fileAbs)}`);
  }
  const ext = path.extname(fileAbs).toLowerCase();
  const imageType = IMAGE_EXT_BY_MEDIA[ext];
  if (imageType !== undefined) {
    if (st.size > MAX_IMAGE_BYTES) {
      throw new FsBoundaryError("FS_TOO_LARGE", `图片超过 8MB 预览上限`);
    }
    return { path: fileAbs, kind: "image", base64: readBytesBase64(fileAbs, st.size), mediaType: imageType, size: st.size };
  }
  const bytes = readHeadBytes(fileAbs, MAX_TEXT_BYTES);
  const isBinary = bytes.includes(0) || controlCharRatio(bytes) > 0.3;
  if (isBinary) {
    return { path: fileAbs, kind: "binary", size: st.size };
  }
  return {
    path: fileAbs,
    kind: "text",
    content: Buffer.from(bytes).toString("utf-8"),
    truncated: st.size > bytes.length,
    size: st.size,
  };
}

function readHeadBytes(fileAbs: string, max: number): Buffer {
  const fd = openSync(fileAbs, "r");
  try {
    const buf = Buffer.alloc(max);
    const read = readSync(fd, buf, 0, max, 0);
    return buf.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

function readBytesBase64(fileAbs: string, size: number): string {
  const fd = openSync(fileAbs, "r");
  try {
    const buf = Buffer.alloc(size);
    fstatSync(fd);
    const read = readSync(fd, buf, 0, size, 0);
    return buf.subarray(0, read).toString("base64");
  } finally {
    closeSync(fd);
  }
}

function controlCharRatio(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let control = 0;
  for (const b of bytes) {
    if (b < 9 || (b > 13 && b < 32)) control += 1;
  }
  return control / bytes.length;
}

/**
 * shell 集成（revealSkillDir 先例——spawn detached）：reveal = 资源管理器
 * 选中该文件（win explorer /select；mac open -R；linux 打开所在目录），
 * open = 系统默认应用打开。路径边界同 fs-read。
 */
export function fsShellAction(
  target: string,
  action: "reveal" | "open",
  projectRoots: readonly string[],
): { done: true } {
  resolveProjectRootFor(target, projectRoots);
  if (!existsSync(target)) {
    throw new FsBoundaryError("FS_NOT_FOUND", `路径不存在：${path.basename(target)}`);
  }
  const abs = path.resolve(target);
  if (process.platform === "win32") {
    if (action === "reveal" && statSync(abs).isFile()) {
      // explorer /select 选中文件（zcode 语义：文件 reveal = 打开所在目录并选中）
      spawn("explorer", [`/select,${abs}`], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("explorer", [statSync(abs).isDirectory() ? abs : path.dirname(abs)], { detached: true, stdio: "ignore" }).unref();
    }
  } else if (process.platform === "darwin") {
    spawn("open", action === "reveal" && statSync(abs).isFile() ? ["-R", abs] : [abs], { detached: true, stdio: "ignore" }).unref();
  } else {
    const dir = statSync(abs).isDirectory() ? abs : path.dirname(abs);
    spawn("xdg-open", [dir], { detached: true, stdio: "ignore" }).unref();
  }
  return { done: true };
}
