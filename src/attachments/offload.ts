/**
 * 图片卸载选择（P2/T-P1-125，dsh·image-offload-events 锚点纪律）：
 * **最老优先、决策持久化、重放同流同选**。
 *
 * 选择从事件流现算（当前投影下的 retained 出现），产出 image/offload 事件
 * 载荷（targets）；决策一经落流即持久事实（只进不退），后续请求的模型可见
 * 集由投影从流重建——绝不重算（dsh 归档版教训：重算随预算/路由/压缩漂移
 * 振荡、前缀不可重建）。
 */

import type { ImageOffloadTarget, SessionEvent } from "../core/index.js";

/**
 * 选出最老的 N 个未卸载图片出现（dsh "oldest retained in current surface
 * order"——按流内 user/message 顺序，即消息出现顺序）。
 *
 * @param events 会话事件流（**调用方先做有效视窗截断**——effectiveEvents
 *          属 session 域；本函数只做选择，保持 attachments 域不依赖 session
 *          ——模块依赖无环，architecture:check 机内化）
 * @param count 要卸载的出现数（须 ≥1）
 * @returns image/offload 事件的 targets 载荷；无可卸载出现时返回 null
 *          （调用方类型化报错——dsh "exhausted delegates" 语义）
 */
export function offloadOldestImages(
  events: readonly SessionEvent[],
  count: number,
): { targets: ImageOffloadTarget[] } | null {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`offload count 需要正整数，得到 ${String(count)}`);
  }
  // 已卸载集合（流内事实——只进不退）与各 user/message 的附件清单
  const offloaded = new Set<string>();
  const attachmentsBySeq = new Map<number, number>(); // seq -> 附件数
  for (const e of events) {
    if (e.type === "image/offload") {
      for (const t of e.targets) {
        for (const idx of t.imageIndexes) offloaded.add(`${t.seq}:${idx}`);
      }
    } else if (e.type === "user/message" && e.attachments?.length) {
      attachmentsBySeq.set(e.seq, e.attachments.length);
    }
  }
  const targets: ImageOffloadTarget[] = [];
  let remaining = count;
  // 最老优先：seq 升序遍历（Map 按插入序即流序——但显式排序防实现漂移）
  const seqs = [...attachmentsBySeq.keys()].sort((a, b) => a - b);
  for (const seq of seqs) {
    if (remaining <= 0) break;
    const total = attachmentsBySeq.get(seq)!;
    const picked: number[] = [];
    for (let idx = 0; idx < total && remaining > 0; idx++) {
      if (offloaded.has(`${seq}:${idx}`)) continue;
      picked.push(idx);
      remaining--;
    }
    if (picked.length > 0) targets.push({ seq, imageIndexes: picked });
  }
  if (targets.length === 0) return null;
  return { targets };
}
