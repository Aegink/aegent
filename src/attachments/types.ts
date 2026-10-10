/**
 * 附件类型化协议（P1/T-P1-124，kimi·transcript attachment.ts 同构）。
 * T1-1 依赖倒置：AttachmentRef / IncomingAttachment 契约本体下沉
 * `core/contracts/attachments.ts`（经 core/index.ts 公开入口）——本文件
 * 只留 re-export 兼容垫片，attachments 域反向实现 core 契约。
 */
export type { AttachmentRef, IncomingAttachment } from "../core/index.js";
