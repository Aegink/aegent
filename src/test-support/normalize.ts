/**
 * 易变值归一化（O3）+ 稳定标签（O5）。
 * 具名占位符取 DSH normalize.ts 的形状（`{{sessionId}}` / `{{cwd}}` / `{{eventTime}}`…）；
 * UUID 不做通用占位符而是**稳定标签**（`{{uuid:N}}`，kimi snapshots.ts 的 uuidLabels）：
 * 占位符抹掉身份，稳定标签保留身份——可断言"同一 id 出现在事件 1、5、9"。
 *
 * 工具快照纪律（需求 §4 O 层负面发现）：tools 归一化必须带 schema
 * （name + description + parameters），不做 kimi 那种"只打名字"。
 */

export const PLACEHOLDERS = {
  cwd: "{{cwd}}",
  tmp: "{{tmp}}",
  eventTime: "{{eventTime}}",
} as const;

/** UUID v4 全串（randomUUID() 的形状）。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ISO 8601 时间串。 */
const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** 这些键下的数值视为时间戳（epoch 毫秒），不再当普通数字。 */
const TIME_KEYS = new Set(["ts", "time", "time0", "createdAt", "timestamp", "created_ts"]);
/** epoch 下界（≈2001-09 的秒值）：滤掉计数器类小数字，避免误伤。 */
const TIME_NUM_MIN = 1_000_000_000;

/** 稳定标签表：同一原始值映射到同一 `{{uuid:N}}`，身份跨事件保留。 */
export class StableLabels {
  private readonly labels = new Map<string, string>();
  private nextId = 1;

  label(raw: string): string {
    let label = this.labels.get(raw);
    if (!label) {
      label = `{{uuid:${String(this.nextId).padStart(2, "0")}}}`;
      this.labels.set(raw, label);
      this.nextId += 1;
    }
    return label;
  }

  /** 标签表内容（测试断言身份映射用），按首次出现顺序。 */
  entries(): Array<[string, string]> {
    return [...this.labels.entries()];
  }
}

export interface NormalizeOptions {
  /** 会话工作目录；字符串里出现的该路径前缀整体替换为 {{cwd}}。 */
  cwd?: string;
  /** 临时目录根；替换为 {{tmp}}。 */
  tmpRoot?: string;
  /** 共享稳定标签表（同一会话的多次归一化要复用同一个，身份才跨事件一致）。 */
  labels?: StableLabels;
}

/** 递归归一化：字符串（UUID/ISO 时间/路径）+ 时间键数值。其余原样保留。 */
export function normalizeValue(value: unknown, options: NormalizeOptions = {}, key?: string): unknown {
  if (typeof value === "string") {
    let text = value;
    if (options.tmpRoot) text = text.replaceAll(options.tmpRoot, PLACEHOLDERS.tmp);
    if (options.cwd) text = text.replaceAll(options.cwd, PLACEHOLDERS.cwd);
    if (UUID_RE.test(text)) return (options.labels ?? new StableLabels()).label(text);
    if (ISO_TIME_RE.test(text)) return PLACEHOLDERS.eventTime;
    return text;
  }
  if (typeof value === "number" && key !== undefined && TIME_KEYS.has(key)) {
    if (value >= TIME_NUM_MIN) return PLACEHOLDERS.eventTime;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, options));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeValue(v, options, k);
    }
    return out;
  }
  return value;
}

/** 稳定序列化：键按字典序排序 + 两空格缩进——同一逻辑形状必然逐字节相等。 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_, v: unknown) => {
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(v as Record<string, unknown>).sort()) {
          out[k] = (v as Record<string, unknown>)[k];
        }
        return out;
      }
      return v;
    },
    2,
  );
}

/** 找出两个稳定序列化文本的第一处差异（人话失败信息用，O9 的配套）。 */
export function firstDifference(a: string, b: string): string | null {
  if (a === b) return null;
  let i = 0;
  const end = Math.min(a.length, b.length);
  while (i < end && a[i] === b[i]) i++;
  const from = Math.max(0, i - 40);
  return `第一处差异在偏移 ${i}：\n  A: …${a.slice(from, i + 60)}…\n  B: …${b.slice(from, i + 60)}…`;
}
