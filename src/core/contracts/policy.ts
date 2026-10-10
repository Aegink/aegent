/**
 * 策略契约（T2-2 自 src/policy/read-gate.ts 下沉——工具闸端口，依赖倒置：
 * kernel/tools 依赖本契约，policy 域反向实现，可整体丢弃（C13——缺省
 * undefined = 不启用，工具照常用）。
 *
 * 语义取 dsh·file-context-as-event-gate.md：观察态记账（"这个会话上次
 * 观察到该目标是什么版本"）+ 编辑前必须已观察（未读先编辑拒）+ 基于
 * 已读版本写入（读后版本失配拒）。**端口不做 I/O**：哈希由调用方（工具在
 * 真实读写时顺带算）传入。
 */

/** 编辑前必须先读的错误码（工具层 isError 回喂，模型可自修：先 read 再改）。 */
export type ReadGateErrorCode = "EDIT_WITHOUT_READ" | "EDIT_STALE_READ";

/** 读闸错误（契约错误类——工具层按 code 分型回喂模型）。 */
export class ReadGateError extends Error {
  constructor(
    readonly code: ReadGateErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** 读闸端口（C12 编辑前必须先读）——policy 域 ReadGateService 实现本端口。 */
export interface ReadGatePort {
  /**
   * 记录一次观察（读成功 = 读到的内容哈希；写/编辑成功 = 写后的内容
   * 哈希——edit-then-edit 无需中间读，写后的新版本就是下一次编辑的合法基线）。
   */
  recordRead(path: string, contentHash: string): void;
  /** 目标已删除：移除记账（后续对该路径的编辑由文件层 NOT_FOUND 拒）。 */
  forget(path: string): void;
  /**
   * 编辑/覆盖前校验：未读 → EDIT_WITHOUT_READ；读过但 currentHash ≠
   * 记账哈希 → EDIT_STALE_READ（读后文件被外部修改，须重读）；通过 →
   * 返回。currentHash 缺省只查"已读"不校验新鲜度。
   */
  requireRead(path: string, currentHash?: string): void;
}
