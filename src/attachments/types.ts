/**
 * 附件类型化协议（P1/T-P1-124，kimi·transcript attachment.ts 同构）。
 *
 * 纪律：**流存引用不存字节**——事件流只落 AttachmentRef（流轻量），
 * 字节只进 AttachmentStore；重建路径 = ref → store.read（恢复/回放时注入）。
 * mediaType 闭集（limits.ts 白名单）即类型化协议——kimi 的 AttachmentSource
 * 联合（url/file/session_media）无消费方不落（字节入口已在端侧解析，
 * YAGNI——完成记录记档）。
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
  /** P4/T-P2-406：语音转写文本（音频附件可选——端侧经 stt.ts 转写后
   * 上送；流存音频引用 + 转写文本，字节仍只在 store）。 */
  readonly transcription?: string;
};
