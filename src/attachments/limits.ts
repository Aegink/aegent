/**
 * 附件限额独立模块（P3/T-P1-124，pi-desktop·attachment-limits.ts 纪律）。
 *
 * "只学行为"：超限**明确报错**（类型化异常带超限维度与上限值），
 * 不静默截断、不降级放行。常量集中单一来源（校验点唯一入口）——
 * pi-desktop 注释纪律："a replay cannot take a different transport path
 * from a fresh prompt"——任何入口共用本模块，不存在旁路限额。
 */

/** 单件大小上限（pi-desktop MAX_INLINE_IMAGE_BYTES 同值——10MB 十进制）。 */
export const MAX_ATTACHMENT_BYTES = 10_000_000;

/** 每消息附件数量上限（卡内定形——宽松但有限，防无界构造）。 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 8;

/**
 * 允许的 mediaType 白名单闭集（图片四类——OpenAI/Anthropic 视觉面的公共支持集）。
 * 非图片附件（pdf/文本等）P1 不进模型请求面——白名单即请求面契约。
 */
export const ALLOWED_MEDIA_TYPES: readonly string[] = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export class AttachmentLimitError extends Error {
  readonly code = "ATTACHMENT_LIMIT";

  constructor(
    /** 超限维度：type（白名单外）/ size（单件超限）/ count（数量超限）。 */
    readonly kind: "type" | "size" | "count",
    readonly limit: number | readonly string[],
    readonly detail: string,
  ) {
    super(`附件超限（${kind}）：${detail}`);
    this.name = "AttachmentLimitError";
  }
}

/** 限额校验的最小输入面（mediaType + 字节数）。 */
export interface AttachmentLimitInput {
  readonly mediaType: string;
  readonly byteLength: number;
}

/**
 * 附件限额校验（P3 唯一入口）：数量 → 类型 → 单件大小。
 * 抛 AttachmentLimitError（明确报错）——通过即静默返回。
 */
export function validateAttachments(items: readonly AttachmentLimitInput[]): void {
  if (items.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new AttachmentLimitError(
      "count",
      MAX_ATTACHMENTS_PER_MESSAGE,
      `${items.length} 个超过每消息上限 ${MAX_ATTACHMENTS_PER_MESSAGE}`,
    );
  }
  for (const item of items) {
    if (!ALLOWED_MEDIA_TYPES.includes(item.mediaType)) {
      throw new AttachmentLimitError(
        "type",
        ALLOWED_MEDIA_TYPES,
        `mediaType "${item.mediaType}" 不在白名单（${ALLOWED_MEDIA_TYPES.join(", ")}）`,
      );
    }
    if (item.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new AttachmentLimitError(
        "size",
        MAX_ATTACHMENT_BYTES,
        `${item.byteLength} 字节超过单件上限 ${MAX_ATTACHMENT_BYTES}`,
      );
    }
  }
}
