/**
 * 插件打包（T-P3-148 T——pi-desktop devkit pack.ts 的最小我方位）：插件目录
 * → store-only zip（不压缩——pack.ts 同决策：安装端零解压依赖、产物可流式
 * 校验）+ sha256。写盘目标 = `<插件目录>/dist/<name>-<version>.aegentplug`。
 *
 * 打包选择（pi walk.ts 同规则裁剪）：跳过 `.git`/`node_modules`/`dist` 与
 * 凭据文件（`.env*`/`*.pem`/`*.key`/`*.npmrc`）；上限 2000 文件 / 50MB；
 * 路径按 code-unit 排序保证跨机器 sha256 稳定。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { checkPluginDir } from "./plugins-gateway.js";

const MAX_FILES = 2000;
const MAX_BYTES = 50 * 1024 * 1024;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "__pycache__"]);
const SKIP_FILE_RE = /^(?:\.env|.*\.pem|.*\.key|.*\.npmrc|Thumbs\.db|\.DS_Store)$/;

interface PackedFile {
  readonly name: string;
  readonly data: Buffer;
}

function crc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crc32Table();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** 收集打包文件（跳过规则 + 上限 + 稳定排序）。 */
export function collectPluginFiles(dir: string): { files: PackedFile[]; totalBytes: number } {
  const out: { name: string; data: Buffer }[] = [];
  let totalBytes = 0;
  const walk = (current: string, relative: string, depth: number): void => {
    if (depth > 16) throw new Error(`目录嵌套过深：${current}`);
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(current, entry.name), relative === "" ? entry.name : `${relative}/${entry.name}`, depth + 1);
        continue;
      }
      if (!entry.isFile() || SKIP_FILE_RE.test(entry.name)) continue;
      if (out.length >= MAX_FILES) throw new Error(`文件数超过 ${MAX_FILES} 上限`);
      const abs = path.join(current, entry.name);
      const data = readFileSync(abs);
      totalBytes += data.length;
      if (totalBytes > MAX_BYTES) throw new Error(`总体积超过 50MB 上限`);
      out.push({ name: relative === "" ? entry.name : `${relative}/${entry.name}`, data });
    }
  };
  walk(dir, "", 0);
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { files: out, totalBytes };
}

/** store-only zip（method 0 + UTF-8 名 + central directory + EOCD）。 */
export function buildStoreZip(files: readonly PackedFile[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = 0;
  for (const file of files) {
    const nameBytes = Buffer.from(file.name, "utf8");
    const crc = crc32(file.data);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);
    localParts.push(local, file.data);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centralParts.push(central);
    offset += local.length + file.data.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...localParts, centralBuf, eocd]);
}

export interface PackResult {
  readonly file: string;
  readonly sha256: string;
  readonly fileCount: number;
  readonly totalBytes: number;
}

/** 打包入口（安装期校验先行——checkPluginDir 预检；产物写 dist/）。 */
export function packPlugin(dir: string): PackResult {
  const checked = checkPluginDir(dir);
  if (!checked.ok) throw new Error(`打包预检失败：${checked.error ?? ""}`);
  const name = checked.name ?? "plugin";
  const version = checked.manifest?.version ?? "0.0.0";
  const { files, totalBytes } = collectPluginFiles(dir);
  const zip = buildStoreZip(files);
  const distDir = path.join(dir, "dist");
  mkdirSync(distDir, { recursive: true });
  const file = path.join(distDir, `${name}-${version}.aegentplug`);
  writeFileSync(file, zip);
  return {
    file,
    sha256: createHash("sha256").update(zip).digest("hex"),
    fileCount: files.length,
    totalBytes,
  };
}

/** 是否存在可打包目录（UI 预判面）。 */
export function packable(dir: string): boolean {
  return existsSync(dir) && statSync(dir).isDirectory();
}
