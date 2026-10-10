/**
 * 编辑前必须先读（C12）+ 可整体丢弃的策略层（C13，T-P1-71）。
 *
 * 语义取 dsh·file-context-as-event-gate.md：观察态记账（"这个会话上次
 * 观察到该目标是什么版本"）+ 编辑前必须已观察（未读先编辑拒）+ 基于
 * 已读版本写入（读后版本失配拒）。dsh 的关键架构决策在本卡的对应物：
 *   - **策略层不做 I/O**：ReadGateService 是纯内存记账（path → 内容哈希），
 *     哈希由调用方（工具在真实读写时顺带算）传入——本文件不 import fs，
 *     与沙箱/工具层无耦合；
 *   - **"基于最新读"的保证由既有机制实现**：edit 的 oldText 精确匹配天然
 *     拒"基于旧版本写入"（版本失配 = OLD_TEXT_NOT_FOUND），本服务补
 *     "已读记账"半边 + 读后外部修改的显式检测（哈希比对）。
 *
 * C13：本策略是**可选装配模块**——readGate 缺省 undefined = 不启用，
 * 工具照常用（不装 = 整体丢弃，不是降级）。这保证策略是 opt-in 的
 * 收紧面，不是工具运行的承重墙（dsh 的核心教训：in-path 强制让部署
 * 无法整体丢弃策略）。
 */

// T2-2 依赖倒置：错误码/错误类/端口契约下沉 core/contracts/policy.ts——
// 本文件是 policy 域实现（内存记账），工具层经 core 公开入口消费契约。
export type { ReadGateErrorCode, ReadGatePort } from "../core/index.js";
export { ReadGateError } from "../core/index.js";
import { ReadGateError, type ReadGatePort } from "../core/index.js";

/** 会话内观察态记账（path → 最近一次观察到的内容哈希）——ReadGatePort 实现。 */
export class ReadGateService implements ReadGatePort {
  private readonly observed = new Map<string, string>();

  /**
   * 记录一次观察（读成功 = 读到的内容哈希；写/编辑成功 = 写后的内容
   * 哈希——dsh 同款：edit-then-edit 无需中间读，写后的新版本就是
   * 下一次编辑的合法基线）。
   */
  recordRead(path: string, contentHash: string): void {
    this.observed.set(path, contentHash);
  }

  /** 目标已删除：移除记账（后续对该路径的编辑由文件层 NOT_FOUND 拒）。 */
  forget(path: string): void {
    this.observed.delete(path);
  }

  /**
   * 编辑/覆盖前校验：未读 → EDIT_WITHOUT_READ；读过但 currentHash ≠
   * 记账哈希 → EDIT_STALE_READ（读后文件被外部修改，须重读）；通过 →
   * 返回。currentHash 缺省只查"已读"不校验新鲜度。
   */
  requireRead(path: string, currentHash?: string): void {
    const observed = this.observed.get(path);
    if (observed === undefined) {
      throw new ReadGateError(
        "EDIT_WITHOUT_READ",
        `${path} 本次会话未读过——编辑前必须先 read（C12：写入必须基于已读版本）`,
      );
    }
    if (currentHash !== undefined && currentHash !== observed) {
      throw new ReadGateError(
        "EDIT_STALE_READ",
        `${path} 在读取后被外部修改——请重新 read 再编辑（C12：读到的版本已过期）`,
      );
    }
  }
}
