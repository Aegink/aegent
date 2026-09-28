/**
 * S5 用户反馈提交面（T-P2-404）——对消息/命令的 up/down 反馈，落流为
 * `feedback/note`（log-only 会话级元事件——反馈是会话事实，词汇表 29 案
 * #24）；doctor 健康摘要可随附（codex·feedback_doctor_report 同构——
 * "反馈提交永不依赖 doctor 成功"，摘要由调用方生成传入，本面零 doctor
 * 依赖）。锚点 codex·feedback_processor 的结构化面（classification+reason
 * +附件）；其遥测外发不取（本地落流——无上报，红线）。
 */

import type { FeedbackNoteEvent } from "../kernel/events.js";
import type { SessionStore } from "../session/store.js";

/** 评语/摘要长度防呆（自由文本非判据——超长拒绝，防 payloads 撑流）。 */
export const MAX_FEEDBACK_TEXT_LENGTH = 2000;

export type FeedbackKind = "up" | "down";

export interface FeedbackRecord {
  /** 评价方向闭集。 */
  kind: FeedbackKind;
  /** 关联的流内事件序号（与 commandId 二选一）。 */
  targetSeq?: number;
  /** 关联的命令 id（command/run 的 commandId——与 targetSeq 二选一）。 */
  commandId?: string;
  /** 评语（可缺省）。 */
  comment?: string;
  /** doctor 健康摘要随附（可缺省——调用方经 runRuntimeDoctorChecks 生成）。 */
  doctorSummary?: string;
}

export class FeedbackValidationError extends Error {
  readonly code = "FEEDBACK_INVALID";
  constructor(reason: string) {
    super(`反馈不合法：${reason}`);
    this.name = "FeedbackValidationError";
  }
}

function assertTextLength(value: string | undefined, field: string): void {
  if (value !== undefined && value.length > MAX_FEEDBACK_TEXT_LENGTH) {
    throw new FeedbackValidationError(
      `${field} 超长（${value.length} > ${MAX_FEEDBACK_TEXT_LENGTH}）`,
    );
  }
}

/**
 * 提交反馈：校验（方向闭集 / 二选一 / seq 存在 / 文本长度）后落流。
 * 返回落流的 feedback/note 事件（seq/ts 由 store 分配）。
 */
export function submitFeedback(
  store: SessionStore,
  sessionId: string,
  record: FeedbackRecord,
): FeedbackNoteEvent {
  if (record.kind !== "up" && record.kind !== "down") {
    throw new FeedbackValidationError(`kind 须为 up|down，收到 ${String(record.kind)}`);
  }
  const hasSeq = record.targetSeq !== undefined;
  const hasCommand = record.commandId !== undefined;
  if (hasSeq === hasCommand) {
    throw new FeedbackValidationError("targetSeq 与 commandId 必须二选一");
  }
  if (hasSeq && (!Number.isInteger(record.targetSeq) || record.targetSeq! < 0)) {
    throw new FeedbackValidationError(`targetSeq 须为非负整数，收到 ${String(record.targetSeq)}`);
  }
  // 关联校验（验收点）：targetSeq 必须是流内已存在的事件序号——反馈挂空
  // 引用会让"在哪条消息上"不可信（流是唯一真相，序号以流为准）。
  if (hasSeq) {
    const exists = store.load(sessionId).some((e) => e.seq === record.targetSeq);
    if (!exists) {
      throw new FeedbackValidationError(`targetSeq ${String(record.targetSeq)} 不在会话流内`);
    }
  }
  if (hasCommand && record.commandId === "") {
    throw new FeedbackValidationError("commandId 须为非空字符串");
  }
  assertTextLength(record.comment, "comment");
  assertTextLength(record.doctorSummary, "doctorSummary");
  const [event] = store.append(sessionId, [
    {
      type: "feedback/note",
      turn: 0,
      kind: record.kind,
      ...(record.targetSeq !== undefined ? { targetSeq: record.targetSeq } : {}),
      ...(record.commandId !== undefined ? { commandId: record.commandId } : {}),
      ...(record.comment !== undefined ? { comment: record.comment } : {}),
      ...(record.doctorSummary !== undefined ? { doctorSummary: record.doctorSummary } : {}),
    },
  ]);
  return event as FeedbackNoteEvent;
}
