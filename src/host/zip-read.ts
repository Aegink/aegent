/**
 * ZIP 读取器（T-P3-174 批次 4——技能 ZIP 导入的解析底座；零新依赖：
 * central directory 自解析 + zlib.inflateRaw 解压）。
 *
 * 安全检查（fail-closed，全部在 extract 内强制）：
 *  - 路径穿越拒绝：条目名含 ".." 段 / 绝对路径 / 盘符 / 反斜杠归一后逃逸
 *    解包根的候选全部拒绝（zip-slip 教科书面）；
 *  - 单条解压上限 / 总解压上限 / 条目数上限（防 zip bomb——解压后大小才
 *    是真实成本，central directory 声明的 uncompressedSize 不可信，解压后
 *    实测字节复检）；
 *  - CRC32 逐条校验（zlib.inflateRaw 不查 CRC——完整性自己闭环；
 *    stored 条目同样校验）。
 * 只支持常规两压缩方法（0 stored / 8 deflate）；加密条目（flag bit0）明确
 * 拒绝——不尝试任何解密。
 */

import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  /** 归一后的相对路径（posix 分隔——穿越检查后的安全形态）。 */
  safeName: string;
  isDirectory: boolean;
  data: Buffer;
}

export class ZipFormatError extends Error {}
export class ZipUnsafeError extends Error {}

// CRC32（IEEE 0xEDB88320 查表——zip 规范的多项式）
const CRC_TABLE: number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipExtractLimits {
  maxEntries?: number; // 条目数上限（缺省 2000）
  maxEntryBytes?: number; // 单条解压上限（缺省 10MB）
  maxTotalBytes?: number; // 总解压上限（缺省 50MB）
}

const U16 = (b: Buffer, off: number): number => b.readUInt16LE(off);
const U32 = (b: Buffer, off: number): number => b.readUInt32LE(off);

/** 条目名安全归一：反斜杠→斜杠、去盘符/根；穿越候选返回 null（拒绝）。 */
function normalizeEntryName(raw: string): string | null {
  let name = raw.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(name) || name.startsWith("/")) return null; // 盘符 / 绝对路径
  const segs: string[] = [];
  for (const seg of name.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return null; // 穿越
    segs.push(seg);
  }
  if (segs.length === 0) return null;
  return segs.join("/");
}

/** 解析 zip Buffer → 安全条目数组（全部检查通过才返回；任一违规整包拒绝）。 */
export function extractZip(buf: Buffer, limits: ZipExtractLimits = {}): ZipEntry[] {
  const maxEntries = limits.maxEntries ?? 2000;
  const maxEntryBytes = limits.maxEntryBytes ?? 10 * 1024 * 1024;
  const maxTotalBytes = limits.maxTotalBytes ?? 50 * 1024 * 1024;
  // End of Central Directory（EOCD 签名 0x06054b50）从尾部向前找（注释区最长 64KB）
  let eocd = -1;
  const searchFloor = Math.max(0, buf.length - 65_536 - 22);
  for (let i = buf.length - 22; i >= searchFloor; i--) {
    if (U32(buf, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError("不是合法 ZIP（找不到 central directory 结尾标记）");
  const entryCount = U16(buf, eocd + 10);
  if (entryCount > maxEntries) {
    throw new ZipUnsafeError(`条目数超上限（${entryCount} > ${maxEntries}）`);
  }
  let cdOffset = U32(buf, eocd + 16);
  const entries: ZipEntry[] = [];
  let totalBytes = 0;
  for (let i = 0; i < entryCount; i++) {
    if (cdOffset + 46 > buf.length || U32(buf, cdOffset) !== 0x02014b50) {
      throw new ZipFormatError("central directory 损坏（签名不符）");
    }
    const flags = U16(buf, cdOffset + 8);
    const method = U16(buf, cdOffset + 10);
    const crcExpected = U32(buf, cdOffset + 16);
    const compressedSize = U32(buf, cdOffset + 20);
    const uncompressedSize = U32(buf, cdOffset + 24);
    const localOffset = U32(buf, cdOffset + 42);
    const nameLen = U16(buf, cdOffset + 28);
    const extraLen = U16(buf, cdOffset + 30);
    const commentLen = U16(buf, cdOffset + 32);
    const rawName = buf.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString("utf8");
    cdOffset += 46 + nameLen + extraLen + commentLen;

    const safeName = normalizeEntryName(rawName);
    if (safeName === null) {
      throw new ZipUnsafeError(`条目路径非法（穿越/绝对路径）：${rawName}——整包拒绝`);
    }
    if ((flags & 0x1) !== 0) {
      throw new ZipUnsafeError(`条目已加密（不支持）：${rawName}`);
    }
    const isDirectory = rawName.endsWith("/");
    if (isDirectory) continue;
    if (method !== 0 && method !== 8) {
      throw new ZipFormatError(`不支持的压缩方法 ${method}：${rawName}（仅 stored/deflate）`);
    }
    if (uncompressedSize > maxEntryBytes || compressedSize > maxEntryBytes) {
      throw new ZipUnsafeError(`条目超大小上限（${uncompressedSize} > ${maxEntryBytes}）：${rawName}`);
    }
    totalBytes += uncompressedSize;
    if (totalBytes > maxTotalBytes) {
      throw new ZipUnsafeError(`解压总量超上限（${totalBytes} > ${maxTotalBytes}）——疑似 zip bomb`);
    }
    // 本地文件头（签名 0x04034b50）——真实数据起点（local 头字段可能与 central 不一致，以实际读到的为准）
    if (localOffset + 30 > buf.length || U32(buf, localOffset) !== 0x04034b50) {
      throw new ZipFormatError(`本地文件头损坏：${rawName}`);
    }
    const lNameLen = U16(buf, localOffset + 26);
    const lExtraLen = U16(buf, localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(compressed); // stored——拷出（源 subarray 生命周期独立）
    } else {
      try {
        data = inflateRawSync(compressed);
      } catch {
        throw new ZipFormatError(`解压失败（deflate 数据损坏）：${rawName}`);
      }
    }
    // 解压后实测大小复检（声明值不可信——zip bomb 第二道闸）
    if (data.length !== uncompressedSize) {
      throw new ZipFormatError(`条目大小不符（声明 ${uncompressedSize} 实际 ${data.length}）：${rawName}`);
    }
    if (data.length > maxEntryBytes) {
      throw new ZipUnsafeError(`条目解压后超上限：${rawName}`);
    }
    if (crc32(data) !== crcExpected) {
      throw new ZipFormatError(`CRC 校验失败（数据损坏）：${rawName}`);
    }
    entries.push({ name: rawName, safeName, isDirectory: false, data });
  }
  return entries;
}
