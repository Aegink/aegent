/**
 * 附件契约（T1-1 自 src/attachments/{types,store}.ts 下沉——内核骨架对附件
 * 的引用面改为依赖本契约，src/attachments 反向实现，依赖倒置清 type 边）。
 *
 * 纪律：**流存引用不存字节**——事件流只落 AttachmentRef（流轻量），
 * 字节只进 AttachmentStore；重建路径 = ref → store.read（恢复/回放时注入）。
 * mediaType 闭集（attachments/limits.ts 白名单）即类型化协议——kimi 的
 * AttachmentSource 联合（url/file/session_media）无消费方不落（字节入口已在
 * 端侧解析，YAGNI——完成记录记档）。
 */

/** 落流引用面（user/message.attachments 的成员——无字节）。 */
export type AttachmentRef = {
  readonly attachmentId: string;
  readonly mediaType: string;
  readonly name?: string;
  /** 字节数（save 时由 store 记录——限额与占位文本用）。 */
  readonly size: number;
  /** P4/T-P2-406：语音转写文本（音频附件可选——投影文本面）。 */
  readonly transcription?: string;
};

/** wire/入口面：带字节（base64）的待保存附件。 */
export type IncomingAttachment = {
  readonly mediaType: string;
  /** base64 编码的原始字节。 */
  readonly data: string;
  readonly name?: string;
  /** P4/T-P2-406：语音转写文本（音频附件可选——端侧经 attachments/stt.ts
   * 转写后上送；流存音频引用 + 转写文本，字节仍只在 store）。 */
  readonly transcription?: string;
};

/** 附件存储接口（可插：本地 / 内存 / 远端随部署）。 */
export interface AttachmentStore {
  /** 保存字节，返回落流引用面（attachmentId 由 store 分配——全局唯一）。 */
  save(input: IncomingAttachment): AttachmentRef;
  /** 按 id 取回原始字节与元数据；未知 id 返回 null（不抛——读面容错）。 */
  read(attachmentId: string): { mediaType: string; name?: string; size: number; data: string } | null;
}
