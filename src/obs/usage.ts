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
