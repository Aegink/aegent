/**
 * 模型上下文快照（O1/O5）——主断言面是"模型实际看到的东西"，不是内部状态。
 * 取 kimi `GenerateInputSnapshot{input, previous}` 的形状：快照自带 previous，
 * 差分在比较时现算；稳定标签跨事件保留 id 身份。
 * tools 必须带完整 schema（name/description/parameters）——
 * 不抄 kimi "只打名字"的做法（需求 §4 O 层负面发现）。
 */

import type { JsonValue } from "../kernel/events.js";
import {
  normalizeValue,
  stableStringify,
  truncateLines,
  tagKnownDirectives,
  StableLabels,
  type NormalizeOptions,
} from "./normalize.js";

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

/**
 * 快照窗口头（O10，T-3-07）：记录"窗口为何在此结束"——settings 变了 /
 * 输入在第 N 条分叉 / 轮终态。缺省值会大声提醒作者补写（O10 是"必须记录"）。
 * O21（T-P1-37）：`scenario` 一句自然语言场景描述——快照本身即规格，读
 * 快照第一行即知测试意图；可选项 + 缺省提醒（既有快照零改动，新快照全带）。
 */
export interface SnapshotHeader {
  whyEnded: string;
  /** 一句自然语言场景（O21）——缺省提醒文案进渲染输出。 */
  scenario?: string;
  /** 切点位置（最后保留事件的 seq / step 等，可 JSON 化）。 */
  cutAt?: JsonValue;
}

export interface GenerateInputSnapshot {
  header: SnapshotHeader;
  input: GenerateCallSnapshot;
  /** 上一次模型调用；差分 = 逐字段比较 input 与 previous（序列化时现算，不预存 diff）。 */
  previous: GenerateCallSnapshot | null;
}

export interface Snapshotter {
  (
    input: GenerateCallSnapshot,
    previous?: GenerateCallSnapshot | null,
    header?: Partial<SnapshotHeader>,
  ): GenerateInputSnapshot;
  /** 本快照器的稳定标签表：同一 UUID 在 input/previous 里拿到同一标签。 */
  labels: StableLabels;
}

export function createSnapshotter(options: NormalizeOptions = {}): Snapshotter {
  const labels = options.labels ?? new StableLabels();
  const snapshotter = (
    input: GenerateCallSnapshot,
    previous: GenerateCallSnapshot | null = null,
    header?: Partial<SnapshotHeader>,
  ): GenerateInputSnapshot => {
    const opts: NormalizeOptions = { ...options, labels };
    return {
      header: {
        whyEnded: header?.whyEnded ?? "（快照作者未说明窗口为何在此结束——O10 要求写明）",
        scenario: header?.scenario ?? "（快照作者未写场景——O21：一句话说明该快照钉死什么行为）",
        ...(header?.cutAt !== undefined ? { cutAt: header.cutAt } : {}),
      },
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
  // O21：Scenario 头行先行——读快照第一行即知测试意图（场景在场景字段缺席
  // 时输出缺省提醒，与 whyEnded 同款大声提醒纪律）
  const scenarioLine = `Scenario: ${snapshot.header.scenario ?? "（未写场景——O21 要求一句自然语言）"}`;
  // O27：system 字段的已知长指引先标签化（值域匹配——JSON 转义后的整行
  // 无法按原文段匹配），再整体截断超长行——diff 只反映真实差异
  const tagged: GenerateInputSnapshot = {
    ...snapshot,
    input: { ...snapshot.input, system: tagKnownDirectives(snapshot.input.system) },
  };
  return truncateLines(`${scenarioLine}\n${stableStringify(tagged)}`);
}
