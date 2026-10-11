/**
 * §4/T9-7 信封分区（store.ts 行数纪律拆分位）：闭集内保留、闭集外
 * ignorable 跳过（返回槽位号——restore 的 seq 槽位纪律据以豁免）、
 * 闭集外无标记 → fail-closed 拒读（EventEnvelopeError，不设 lenient
 * 例外——未知语义数据的静默丢弃即事故）。
 */

import { EventEnvelopeError, validateEventEnvelope, type SessionEvent } from "../core/index.js";

export function partitionByEnvelope(raw: readonly SessionEvent[]): {
  rows: SessionEvent[];
  skippedIdx: Set<number>;
} {
  const rows: SessionEvent[] = [];
  const skippedIdx = new Set<number>();
  for (let i = 0; i < raw.length; i++) {
    const verdict = validateEventEnvelope(raw[i]!);
    if (verdict === "skip") {
      skippedIdx.add(i);
      continue;
    }
    if (verdict === "reject") {
      throw new EventEnvelopeError(raw[i]!.type);
    }
    rows.push(raw[i]!);
  }
  return { rows, skippedIdx };
}
