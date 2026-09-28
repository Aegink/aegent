/**
 * 附件域测试（P1+P3/T-P1-124）：存储往返、限额四路、投影展开。
 */

import { mkdtempSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryAttachmentStore, LocalFileAttachmentStore, base64ByteLength } from "./store.js";
import {
  ALLOWED_MEDIA_TYPES,
  AttachmentLimitError,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  validateAttachments,
} from "./limits.js";

// PNG 1x1 像素的最小 base64（真实可解码图片字节）
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("附件存储（AttachmentStore）", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "attachments-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("内存实现：save/read 往返（ref 不含字节、read 返回原字节）", () => {
    const store = new InMemoryAttachmentStore();
    const ref = store.save({ mediaType: "image/png", data: TINY_PNG.toString("base64"), name: "dot.png" });
    expect(ref.attachmentId).toMatch(/[0-9a-f-]{36}/);
    expect(ref.mediaType).toBe("image/png");
    expect(ref.size).toBe(TINY_PNG.byteLength);
    expect(ref.name).toBe("dot.png");
    expect("data" in ref).toBe(false); // ref 不含字节
    const loaded = store.read(ref.attachmentId)!;
    expect(loaded.data).toBe(TINY_PNG.toString("base64"));
    expect(loaded.mediaType).toBe("image/png");
    expect(loaded.size).toBe(TINY_PNG.byteLength);
  });

  it("本地实现：真落盘 tmp+rename 原子写（raw + meta 两文件），read 返回原字节", () => {
    const store = new LocalFileAttachmentStore(root);
    const ref = store.save({ mediaType: "image/png", data: TINY_PNG.toString("base64") });
    expect(existsSync(path.join(root, `${ref.attachmentId}.raw`))).toBe(true);
    expect(existsSync(path.join(root, `${ref.attachmentId}.json`))).toBe(true);
    // 无 tmp 残留（rename 收尾干净）
    expect(readdirSync(root).filter((f) => f.includes(".tmp"))).toHaveLength(0);
    const loaded = store.read(ref.attachmentId)!;
    expect(Buffer.from(loaded.data, "base64").equals(TINY_PNG)).toBe(true);
    expect(loaded.size).toBe(TINY_PNG.byteLength);
  });

  it("本地实现：未知 id / 非法 id 形状（路径注入面）返回 null 不抛", () => {
    const store = new LocalFileAttachmentStore(root);
    expect(store.read("deadbeef")).toBe(null);
    // 路径注入形状被闭面拦截
    expect(store.read("../etc/passwd\u0000")).toBe(null);
    expect(store.read("../../package.json")).toBe(null);
    // 合法形状但不存在
    expect(store.read("00000000-0000-4000-8000-000000000000")).toBe(null);
  });

  it("两次 save 分配不同 id（唯一性）", () => {
    const store = new InMemoryAttachmentStore();
    const a = store.save({ mediaType: "image/png", data: TINY_PNG.toString("base64") });
    const b = store.save({ mediaType: "image/png", data: TINY_PNG.toString("base64") });
    expect(a.attachmentId).not.toBe(b.attachmentId);
  });
});

describe("附件限额（P3——超限明确报错）", () => {
  const ok = { mediaType: "image/png", byteLength: 100 };

  it("合法附件通过（静默）", () => {
    expect(() => validateAttachments([ok, { mediaType: "image/jpeg", byteLength: 1 }])).not.toThrow();
  });

  it("类型白名单外拒绝（错误带白名单）", () => {
    try {
      validateAttachments([{ mediaType: "application/pdf", byteLength: 1 }]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AttachmentLimitError);
      expect((e as AttachmentLimitError).kind).toBe("type");
      expect((e as AttachmentLimitError).message).toContain("application/pdf");
      expect((e as AttachmentLimitError).message).toContain("image/png");
    }
  });

  it("单件超限拒绝（错误带上限值）", () => {
    try {
      validateAttachments([{ mediaType: "image/png", byteLength: MAX_ATTACHMENT_BYTES + 1 }]);
      expect.unreachable();
    } catch (e) {
      expect((e as AttachmentLimitError).kind).toBe("size");
      expect((e as AttachmentLimitError).message).toContain(String(MAX_ATTACHMENT_BYTES));
    }
  });

  it("数量超限拒绝（错误带上限值）", () => {
    const many = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 1 }, () => ok);
    try {
      validateAttachments(many);
      expect.unreachable();
    } catch (e) {
      expect((e as AttachmentLimitError).kind).toBe("count");
      expect((e as AttachmentLimitError).message).toContain(String(MAX_ATTACHMENTS_PER_MESSAGE));
    }
  });

  it("上限边界值恰好通过（余量验证）", () => {
    expect(() =>
      validateAttachments(
        Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE }, () => ({ mediaType: "image/webp", byteLength: MAX_ATTACHMENT_BYTES })),
      ),
    ).not.toThrow();
    // P4/T-P2-406：白名单 4→7（音频三类入册——存储面契约扩展）
    expect(ALLOWED_MEDIA_TYPES).toHaveLength(7);
  });
});

describe("base64ByteLength", () => {
  it("与 Buffer 换算一致（含 padding 边界）", () => {
    for (const raw of [Buffer.from(""), Buffer.from("a"), Buffer.from("ab"), Buffer.from("abc"), TINY_PNG]) {
      expect(base64ByteLength(raw.toString("base64"))).toBe(raw.byteLength);
    }
  });
});
