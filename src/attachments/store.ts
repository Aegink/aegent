/**
 * 附件存储抽象（P1/T-P1-124）——本地与远端可插的接口面。
 *
 * 远端实现不落（真实远端随部署需求，接口在位即达验收——卡面记档）；
 * 内存实现服务测试与未配置部署面，本地文件实现服务真实落盘。
 * 保存用 tmp + rename 原子写（sync/vault FileSystemRemoteStore 同款纪律）。
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
// T1-1 依赖倒置：类型契约下沉 core/contracts——实现域反向 import core 公开入口
import type { AttachmentRef, AttachmentStore } from "../core/index.js";
import type { IncomingAttachment } from "./types.js";

export type { AttachmentStore } from "../core/index.js";

/** 内存实现（测试 + 未配置部署面）。 */
export class InMemoryAttachmentStore implements AttachmentStore {
  private readonly items = new Map<string, AttachmentRef & { data: string }>();

  save(input: IncomingAttachment): AttachmentRef {
    const size = base64ByteLength(input.data);
    const attachmentId = randomUUID();
    const ref: AttachmentRef & { data: string } = {
      attachmentId,
      mediaType: input.mediaType,
      size,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.transcription !== undefined ? { transcription: input.transcription } : {}),
      data: input.data,
    };
    this.items.set(attachmentId, ref);
    const { data: _data, ...refOnly } = ref;
    return refOnly;
  }

  read(attachmentId: string) {
    const item = this.items.get(attachmentId);
    if (!item) return null;
    const { data, ...meta } = item;
    return { ...meta, data };
  }
}

/**
 * 本地文件实现：`<root>/<id>.raw`（原始字节）+ `<root>/<id>.json`（元数据）。
 * id 是 randomUUID（无路径注入面——不接受外部提供的文件名做存储键）。
 */
export class LocalFileAttachmentStore implements AttachmentStore {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  save(input: IncomingAttachment): AttachmentRef {
    const buffer = Buffer.from(input.data, "base64");
    const attachmentId = randomUUID();
    const meta: Omit<AttachmentRef, "attachmentId"> = {
      mediaType: input.mediaType,
      size: buffer.byteLength,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.transcription !== undefined ? { transcription: input.transcription } : {}),
    };
    // tmp + rename 原子写（两文件成对）
    const rawTmp = path.join(this.root, `.${attachmentId}.raw.tmp`);
    const metaTmp = path.join(this.root, `.${attachmentId}.json.tmp`);
    writeFileSync(rawTmp, buffer);
    writeFileSync(metaTmp, JSON.stringify(meta));
    renameSync(rawTmp, path.join(this.root, `${attachmentId}.raw`));
    renameSync(metaTmp, path.join(this.root, `${attachmentId}.json`));
    return { attachmentId, ...meta };
  }

  read(attachmentId: string) {
    // id 校验闭面：只接受 UUID 形状（防路径拼接注入）
    if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) return null;
    let meta: { mediaType: string; size: number; name?: string; transcription?: string };
    let raw: Buffer;
    try {
      meta = JSON.parse(readFileSync(path.join(this.root, `${attachmentId}.json`), "utf8"));
      raw = readFileSync(path.join(this.root, `${attachmentId}.raw`));
    } catch {
      return null;
    }
    return {
      mediaType: meta.mediaType,
      size: meta.size,
      ...(meta.name !== undefined ? { name: meta.name } : {}),
      ...(meta.transcription !== undefined ? { transcription: meta.transcription } : {}),
      data: raw.toString("base64"),
    };
  }
}

/** base64 字符串对应的原始字节数。 */
export function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}
