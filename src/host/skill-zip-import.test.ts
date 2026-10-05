// T-P3-174 批次 4：ZIP 读取器安全检查 + 技能 ZIP 导入（自构造 zip buffer）。
import { mkdtempSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { extractZip, ZipFormatError, ZipUnsafeError } from "./zip-read.js";
import { skillZipImportOp } from "./skill-zip-import.js";

// —— 最小 zip 构造器（测试专用：stored/deflate + central directory + EOCD）——

function u16(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
}
function u32(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface TestEntry {
  name: string;
  data: Buffer;
  method?: number;
  flag?: number;
  crcOverride?: number;
  declaredSize?: number;
}

function buildZip(entries: TestEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const method = e.method ?? 0;
    const flag = e.flag ?? 0;
    let payload: Buffer;
    if (method === 8) payload = deflateRawSync(e.data);
    else payload = e.data;
    const crc = e.crcOverride ?? crc32(e.data);
    const compSize = e.declaredSize ?? payload.length;
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flag), u16(method), u16(0), u16(0), u32(crc),
      u32(compSize), u32(e.data.length), u16(nameBuf.length), u16(0), nameBuf,
      method === 8 ? payload.subarray(0, compSize) : payload.subarray(0, compSize),
    ]);
    locals.push(local);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(flag), u16(method), u16(0), u16(0), u32(crc),
      u32(compSize), u32(e.data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf,
    ]);
    centrals.push(central);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  return Buffer.concat([...locals, cd, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(offset), u16(0)]);
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});
function tempWorkspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-skillzip-"));
  dirs.push(dir);
  return dir;
}

describe("extractZip", () => {
  it("stored 与 deflate 解压、目录条目跳过、内容逐条还原", () => {
    const zip = buildZip([
      { name: "docs/", data: Buffer.alloc(0) },
      { name: "docs/readme.txt", data: Buffer.from("hello stored") },
      { name: "big.bin", data: Buffer.from("deflate-me-".repeat(50)), method: 8 },
    ]);
    const entries = extractZip(zip);
    expect(entries).toHaveLength(2); // 目录条目不入集
    expect(entries[0]!.safeName).toBe("docs/readme.txt");
    expect(entries[0]!.data.toString()).toBe("hello stored");
    expect(entries[1]!.data.toString()).toContain("deflate-me-");
  });
  it("路径穿越拒绝（../ 与盘符与绝对路径）", () => {
    for (const name of ["../evil.txt", "a/../../evil.txt", "C:/evil.txt", "/abs.txt"]) {
      expect(() => extractZip(buildZip([{ name, data: Buffer.from("x") }]))).toThrow(ZipUnsafeError);
    }
  });
  it("CRC 不符拒绝；大小声明不符拒绝；加密位拒绝", () => {
    expect(() => extractZip(buildZip([{ name: "a.txt", data: Buffer.from("x"), crcOverride: 0xdeadbeef }]))).toThrow(ZipFormatError);
    expect(() => extractZip(buildZip([{ name: "a.txt", data: Buffer.from("x"), declaredSize: 99 }]))).toThrow(ZipFormatError);
    expect(() => extractZip(buildZip([{ name: "a.txt", data: Buffer.from("x"), flag: 1 }]))).toThrow(ZipUnsafeError);
  });
  it("zip bomb 防线：单条超上限拒绝（声明面 + 解压实测双闸）", () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 0x41);
    expect(() => extractZip(buildZip([{ name: "big.bin", data: big }]), { maxEntryBytes: 10 * 1024 * 1024 })).toThrow(ZipUnsafeError);
    // deflate 高压缩比——声明 1 字节但解压 11MB（实测复检）
    const huge = Buffer.alloc(11 * 1024 * 1024, 0x42);
    const zipped = buildZip([{ name: "bomb.bin", data: huge, method: 8, declaredSize: 1 }]);
    expect(() => extractZip(zipped, { maxEntryBytes: 10 * 1024 * 1024 })).toThrow();
  });
});

describe("skillZipImportOp", () => {
  const SKILL = "---\nname: my-skill\ndescription: 演示技能\n---\n\n# 用法\n";
  it("zip 根直下 SKILL.md（单技能）导入落盘", async () => {
    const ws = tempWorkspace();
    const zip = buildZip([{ name: "SKILL.md", data: Buffer.from(SKILL) }, { name: "ref.txt", data: Buffer.from("r") }]);
    const r = await skillZipImportOp({ workspaceRoot: ws }, zip.toString("base64"));
    expect(r.imported).toHaveLength(1);
    expect(r.imported[0]!.name).toBe("my-skill");
    expect(readFileSync(path.join(ws, ".zcode", "skills", "my-skill", "SKILL.md"), "utf8")).toContain("用法");
    expect(existsSync(path.join(ws, ".zcode", "skills", "my-skill", "ref.txt"))).toBe(true);
  });
  it("多技能 zip（单层目录集合）逐个导入；同名绝不覆盖（二次导入 skip）", async () => {
    const ws = tempWorkspace();
    const zip = buildZip([
      { name: "alpha/SKILL.md", data: Buffer.from(SKILL.replace("my-skill", "alpha")) },
      { name: "beta/SKILL.md", data: Buffer.from(SKILL.replace("my-skill", "beta")) },
    ]);
    const r1 = await skillZipImportOp({ workspaceRoot: ws }, zip.toString("base64"));
    expect(r1.imported.map((i) => i.name).sort()).toEqual(["alpha", "beta"]);
    const r2 = await skillZipImportOp({ workspaceRoot: ws }, zip.toString("base64"));
    expect(r2.imported).toHaveLength(0);
    expect(r2.skipped.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
  });
  it("非 slug 名 fail 不静默改写；空正文 skip；无 SKILL.md 整包拒绝", async () => {
    const ws = tempWorkspace();
    const badName = await skillZipImportOp(
      { workspaceRoot: ws },
      buildZip([{ name: "My Skill/SKILL.md", data: Buffer.from("---\ndescription: x\n---\n\nbody") }]).toString("base64"),
    );
    expect(badName.failed[0]!.error).toContain("slug");
    const empty = await skillZipImportOp(
      { workspaceRoot: ws },
      buildZip([{ name: "empty-skill/SKILL.md", data: Buffer.from("---\nname: empty-skill\n---\n\n   ") }]).toString("base64"),
    );
    expect(empty.skipped[0]!.reason).toContain("正文为空");
    const none = await skillZipImportOp({ workspaceRoot: ws }, buildZip([{ name: "loose.txt", data: Buffer.from("x") }]).toString("base64"));
    expect(none.failed[0]!.error).toContain("未识别到技能");
  });
  it("非 zip 内容 fail-closed（base64 垃圾不炸进程）", async () => {
    const ws = tempWorkspace();
    const r = await skillZipImportOp({ workspaceRoot: ws }, Buffer.from("definitely not a zip").toString("base64"));
    expect(r.failed[0]!.error).toContain("ZIP");
  });
});
