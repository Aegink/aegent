/**
 * 模型上下文快照（O1/O5）——主断言面是"模型实际看到的东西"，不是内部状态。
 * 取 kimi `GenerateInputSnapshot{input, previous}` 的形状：快照自带 previous，
 * 差分在比较时现算；稳定标签跨事件保留 id 身份。
 * tools 必须带完整 schema（name/description/parameters）——
 * 不抄 kimi "只打名字"的做法（需求 §4 O 层负面发现）。
 */

import type { JsonValue } from "../kernel/events.js";
import { normalizeValue, stableStringify, StableLabels, type NormalizeOptions } from "./normalize.js";

export interface ToolSnapshot {
  name: string;
  description: string;
  /** 参数 schema（可 JSON 化），原样进快照——模型看到什么就记什么。 */
  parameters: JsonValue;
}

/** 一次模型调用的完整输入（模型上下文）。 */
export interface GenerateCallSnapshot {
  system: string;
  tools: ToolSnapshot[];
  messages: unknown[];
}

export interface GenerateInputSnapshot {
  input: GenerateCallSnapshot;
  /** 上一次模型调用；差分 = 逐字段比较 input 与 previous（序列化时现算，不预存 diff）。 */
  previous: GenerateCallSnapshot | null;
}

export interface Snapshotter {
  (input: GenerateCallSnapshot, previous?: GenerateCallSnapshot | null): GenerateInputSnapshot;
  /** 本快照器的稳定标签表：同一 UUID 在 input/previous 里拿到同一标签。 */
  labels: StableLabels;
}

export function createSnapshotter(options: NormalizeOptions = {}): Snapshotter {
  const labels = options.labels ?? new StableLabels();
  const snapshotter = (
    input: GenerateCallSnapshot,
    previous: GenerateCallSnapshot | null = null,
  ): GenerateInputSnapshot => {
    const opts: NormalizeOptions = { ...options, labels };
    return {
      input: normalizeValue(input, opts) as GenerateCallSnapshot,
      previous: previous ? (normalizeValue(previous, opts) as GenerateCallSnapshot) : null,
    };
  };
  snapshotter.labels = labels;
  return snapshotter;
}

export { normalizeValue, stableStringify, firstDifference } from "./normalize.js";
export { StableLabels } from "./normalize.js";

/** 快照的稳定文本（键序排序 + 归一化后逐字节比较的载体）。 */
export function snapshotToString(snapshot: GenerateInputSnapshot): string {
  return stableStringify(snapshot);
}
