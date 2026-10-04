/**
 * token 统计（L3，T-8-03）——usage 的分列聚合（cc-switch·usage_rollup.rs 的
 * 分列形状：input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens；
 * 我方按行聚合到会话/轮两粒度）。
 *
 * L1（事件即轨迹）的实现纪律是**否定性**的：本模块只对 events 表做 SELECT
 * ——usage 事实已在 assistant/message.usage 落盘（E12 整值面），不写任何第二
 * 份轨迹存储、不落任何文件；日志目录里出现平行轨迹文件即为违反 L1。
 *
 * 列名映射：词汇表 cacheWriteTokens ↔ cc-switch 的 cache_creation_tokens
 * （缓存写入 = cache creation，同一语义两个叫法）。total_cost_usd 不建列
 * ——P0 无定价输入（成本核算 J21 是 P2），列留给届时同批。
 *
 * 视图按 (session_id, turn) 聚合：usage 缺失的 assistant/message 不进聚合
 * （无计量即无事实，绝不算 0——与 F10"无 usage 本地估算兜底"分属两层，
 * 本视图只报告 provider 送达的计量）。total_tokens 缺失时按 input+output
 * 折算（compaction.ts tokensBeforeOf 同款折算规则）。
 */

import type { Database } from "better-sqlite3";

export const USAGE_VIEW_SQL = `
CREATE VIEW IF NOT EXISTS usage_rollup AS
SELECT
  session_id AS session_id,
  json_extract(payload, '$.turn') AS turn,
  COUNT(*) AS requests,
  SUM(COALESCE(json_extract(payload, '$.usage.inputTokens'), 0)) AS input_tokens,
  SUM(COALESCE(json_extract(payload, '$.usage.outputTokens'), 0)) AS output_tokens,
  SUM(COALESCE(json_extract(payload, '$.usage.cacheReadTokens'), 0)) AS cache_read_tokens,
  SUM(COALESCE(json_extract(payload, '$.usage.cacheWriteTokens'), 0)) AS cache_creation_tokens,
  SUM(COALESCE(
    json_extract(payload, '$.usage.totalTokens'),
    COALESCE(json_extract(payload, '$.usage.inputTokens'), 0)
      + COALESCE(json_extract(payload, '$.usage.outputTokens'), 0)
  )) AS total_tokens
FROM events
WHERE type = 'assistant/message'
  AND json_extract(payload, '$.usage') IS NOT NULL
GROUP BY session_id, json_extract(payload, '$.turn')
`;

/** 幂等建视图（打开库后调一次；视图不占 schema 版本——SELECT 语义面，无迁移问题）。 */
export function ensureUsageView(db: Database): void {
  db.exec(USAGE_VIEW_SQL);
}

/** 一行聚合（分列形状 = cc-switch usage_rollup 同构；金额列留 P2）。 */
export interface UsageRow {
  sessionId: string;
  turn: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  /**
   * 缓存命中率（F6/T-P1-19）：cacheReadTokens / inputTokens——OpenAI 语义
   * cached_tokens ⊆ prompt_tokens（toTokenUsage 的映射关系），命中率按
   * input 口径。inputTokens 为 0 时缺席（"无计量不算 0"的同款纪律）。
   * 按会话行可查（J2 实测 Σinput 64.5k 的优化观测面）。
   */
  cacheHitRate?: number;
}

function toRow(raw: Record<string, unknown>): UsageRow {
  const inputTokens = raw["input_tokens"] as number;
  const cacheReadTokens = raw["cache_read_tokens"] as number;
  return {
    sessionId: raw["session_id"] as string,
    turn: raw["turn"] as number,
    requests: raw["requests"] as number,
    inputTokens,
    outputTokens: raw["output_tokens"] as number,
    cacheReadTokens,
    cacheCreationTokens: raw["cache_creation_tokens"] as number,
    totalTokens: raw["total_tokens"] as number,
    ...(inputTokens > 0 ? { cacheHitRate: cacheReadTokens / inputTokens } : {}),
  };
}

/** 按会话汇总（单库单会话传 sessionId；全库传 undefined）。 */
export function usageBySession(db: Database, sessionId?: string): UsageRow[] {
  const sql = `
    SELECT session_id, -1 AS turn, SUM(requests) AS requests,
           SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
           SUM(cache_read_tokens) AS cache_read_tokens,
           SUM(cache_creation_tokens) AS cache_creation_tokens,
           SUM(total_tokens) AS total_tokens
    FROM usage_rollup ${sessionId !== undefined ? "WHERE session_id = ?" : ""}
    GROUP BY session_id ORDER BY session_id`;
  const stmt = db.prepare(sql);
  const rows = (sessionId !== undefined ? stmt.all(sessionId) : stmt.all()) as Record<string, unknown>[];
  return rows.map(toRow);
}

/** 按轮查询（会话内每 turn 一行，按轮号升序）。 */
export function usageByTurn(db: Database, sessionId: string): UsageRow[] {
  const rows = db
    .prepare("SELECT * FROM usage_rollup WHERE session_id = ? ORDER BY turn")
    .all(sessionId) as Record<string, unknown>[];
  return rows.map(toRow);
}

/** 镜像流折叠的轮次行（T-P3-165 需求 5——write-behind 库滞后的补面：turn
 *  进行中 events 表还没有本会话数据，usage 页/pill 只能读到上一轮；从镜像
 *  store 的事件流按 assistant/message.usage 折叠出**全部**轮次（与视图同
 *  口径），调用方按 turn 号去重合并（镜像覆盖库行——内存更新）。 */
export function turnsFromStream(sessionId: string, events: readonly { type: string; turn?: number; usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; totalTokens?: number } | null }[]): UsageRow[] {
  const acc = new Map<number, { requests: number; input: number; output: number; cacheRead: number; cacheWrite: number; total: number }>();
  for (const e of events) {
    if (e.type !== "assistant/message" || e.usage === undefined || e.usage === null) continue;
    const turn = typeof e.turn === "number" && e.turn > 0 ? e.turn : 0;
    const row = acc.get(turn) ?? { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    row.requests += 1;
    row.input += e.usage.inputTokens ?? 0;
    row.output += e.usage.outputTokens ?? 0;
    row.cacheRead += e.usage.cacheReadTokens ?? 0;
    row.cacheWrite += e.usage.cacheWriteTokens ?? 0;
    row.total += e.usage.totalTokens ?? (e.usage.inputTokens ?? 0) + (e.usage.outputTokens ?? 0);
    acc.set(turn, row);
  }
  return [...acc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([turn, row]) => ({
      sessionId,
      turn,
      requests: row.requests,
      inputTokens: row.input,
      outputTokens: row.output,
      cacheReadTokens: row.cacheRead,
      cacheCreationTokens: row.cacheWrite,
      totalTokens: row.total,
      ...(row.input > 0 ? { cacheHitRate: row.cacheRead / row.input } : {}),
    }));
}

// ---------------------------------------------------------------------------
// 统计页聚合（T-P3-135 批 B⑩——byDay 单点定形取 host 路线：方案 §1.2 唯一
// 数据缺口，前端现算不可行〔sessions 汇总无日期、turns 仅本会话——跨会话
// 每日趋势/热力图必须按天聚合全库〕；须过 settings/server e2e）。同 L1
// 否定性纪律：只对 events 表 SELECT，无第二份轨迹存储。
// ---------------------------------------------------------------------------

/** 一日聚合（day 为本地日 YYYY-MM-DD——date(ts,'unixepoch','localtime')，
 * 热力图/趋势线按用户本地日对齐更有意义，记档）。 */
export interface DayUsageRow {
  day: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

/** 按本地日聚合全库 usage（ts 缺失/0 的事件不进聚合——无时间即无日可归）。 */
export function usageByDay(db: Database): DayUsageRow[] {
  const rows = db
    .prepare(
      `
      SELECT date(ts / 1000, 'unixepoch', 'localtime') AS day,
        COUNT(*) AS requests,
        SUM(COALESCE(json_extract(payload, '$.usage.inputTokens'), 0)) AS input_tokens,
        SUM(COALESCE(json_extract(payload, '$.usage.outputTokens'), 0)) AS output_tokens,
        SUM(COALESCE(json_extract(payload, '$.usage.cacheReadTokens'), 0)) AS cache_read_tokens,
        SUM(COALESCE(json_extract(payload, '$.usage.cacheWriteTokens'), 0)) AS cache_creation_tokens,
        SUM(COALESCE(
          json_extract(payload, '$.usage.totalTokens'),
          COALESCE(json_extract(payload, '$.usage.inputTokens'), 0)
            + COALESCE(json_extract(payload, '$.usage.outputTokens'), 0)
        )) AS total_tokens
      FROM events
      WHERE type = 'assistant/message'
        AND json_extract(payload, '$.usage') IS NOT NULL
        AND ts IS NOT NULL AND ts > 0
      GROUP BY day ORDER BY day
      `,
    )
    .all() as Record<string, unknown>[];
  return rows.map((raw) => ({
    day: raw["day"] as string,
    requests: raw["requests"] as number,
    inputTokens: raw["input_tokens"] as number,
    outputTokens: raw["output_tokens"] as number,
    cacheReadTokens: raw["cache_read_tokens"] as number,
    cacheCreationTokens: raw["cache_creation_tokens"] as number,
    totalTokens: raw["total_tokens"] as number,
  }));
}

/** 一模型的 token 占比行（甜甜圈数据——token 计量不需要价格，未配价模型同样入列）。 */
export interface ModelUsageRow {
  modelId: string;
  requests: number;
  totalTokens: number;
}

/** 按模型聚合全库 usage（turn → modelId 归因同 costRollup：末次 request/header）。 */
export function usageByModel(db: Database): ModelUsageRow[] {
  const rows = db
    .prepare(
      `
      SELECT COALESCE((
        SELECT json_extract(h.payload, '$.config.modelId')
        FROM events h
        WHERE h.session_id = e.session_id
          AND h.type = 'request/header'
          AND json_extract(h.payload, '$.turn') = json_extract(e.payload, '$.turn')
        ORDER BY h.seq DESC
        LIMIT 1
      ), '（未知）') AS model_id,
        COUNT(*) AS requests,
        SUM(COALESCE(json_extract(e.payload, '$.usage.totalTokens'),
          COALESCE(json_extract(e.payload, '$.usage.inputTokens'), 0)
            + COALESCE(json_extract(e.payload, '$.usage.outputTokens'), 0))) AS total_tokens
      FROM events e
      WHERE e.type = 'assistant/message'
        AND json_extract(e.payload, '$.usage') IS NOT NULL
      GROUP BY model_id ORDER BY total_tokens DESC
      `,
    )
    .all() as Array<{ model_id: string; requests: number; total_tokens: number }>;
  return rows.map((raw) => ({
    modelId: raw.model_id,
    requests: raw.requests,
    totalTokens: raw.total_tokens,
  }));
}

// ---------------------------------------------------------------------------
// T-P3-147 F：副调用按任务分账（request/header 的 aux 载荷聚合——polish/
// title/enhancement-test 的 usage 归因面；compaction 走 assistant/message
// 主链不在此列）。L1 纪律同上：只 SELECT，不建第二份轨迹存储。
// ---------------------------------------------------------------------------

export interface TaskUsageRow {
  purpose: string;
  provider: string;
  modelId: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function usageByTask(db: Database): TaskUsageRow[] {
  const rows = db
    .prepare(
      `
      SELECT json_extract(payload, '$.reason') AS purpose,
             json_extract(payload, '$.config.provider') AS provider,
             json_extract(payload, '$.config.modelId') AS model_id,
             COUNT(*) AS requests,
             SUM(COALESCE(json_extract(payload, '$.aux.usage.inputTokens'), 0)) AS input_tokens,
             SUM(COALESCE(json_extract(payload, '$.aux.usage.outputTokens'), 0)) AS output_tokens,
             SUM(COALESCE(json_extract(payload, '$.aux.usage.totalTokens'),
               COALESCE(json_extract(payload, '$.aux.usage.inputTokens'), 0)
                 + COALESCE(json_extract(payload, '$.aux.usage.outputTokens'), 0))) AS total_tokens
      FROM events
      WHERE type = 'request/header'
        AND json_extract(payload, '$.aux') IS NOT NULL
      GROUP BY purpose, provider, model_id
      ORDER BY total_tokens DESC
      `,
    )
    .all() as Array<{
    purpose: string;
    provider: string;
    model_id: string;
    requests: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  }>;
  return rows.map((raw) => ({
    purpose: raw.purpose,
    provider: raw.provider,
    modelId: raw.model_id,
    requests: raw.requests,
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    totalTokens: raw.total_tokens,
  }));
}
