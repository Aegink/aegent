/**
 * 成本核算（J21/T-P2-516）——token → 成本可算；按会话/按轮可查。
 * （hermes·billing_usage.py 的"价格表驱动 + 两级聚合"行为；计费账户面不取
 * ——我方本地库面，known-diffs.md 记档。）
 *
 * **核对结论（卡面先核对项）**：L3/T-8-03 已落 usage 分列聚合（usage_rollup
 * 视图：input/output/cache_read/cache_creation/total 五列，会话/轮两粒度），
 * 但 **total_cost_usd 未建列**（usage.ts 头注释明记"P0 无定价输入，列留给
 * 届时同批"）——本卡补：价格表是配置输入（不硬编码厂商价格——价格随时间
 * 漂移，硬编码会成为流内谎言），成本是 usage 的派生投影（只 SELECT 不写第
 * 二份轨迹——L1 否定性纪律与 usage.ts 同源）。
 *
 * **计价语义（显式声明）**：按 OpenAI 语义——prompt_tokens（inputTokens）
 * **含** cached_tokens（cacheReadTokens，toTokenUsage.ts:83 映射），故非缓存
 * 输入 = max(0, inputTokens − cacheReadTokens)；J25 加权（输出与非缓存输入
 * 不同价）在价格表四单价上兑现。Anthropic 语义（input_tokens 不含 cache_read）
 * 的差异记档——anthropic 面成本精确性随真实联调。
 */

import type { Database } from "better-sqlite3";

/** 单模型价格（$/百万 token——行业惯例单位）。 */
export interface ModelPricing {
  provider: string;
  /** modelId 精确匹配（前缀匹配不取——误配对即错误计价）。 */
  modelId: string;
  /** 非缓存输入价（usage 里扣掉缓存读部分）。 */
  inputPerMTok: number;
  /** 缓存读输入价（通常为输入价的 1/10 量级——厂商定价各 异，表驱动）。 */
  cachedInputPerMTok: number;
  /** 输出价（J25：与非缓存输入不同价）。 */
  outputPerMTok: number;
  /** 缓存写价（OpenAI 语义无该列——缺席视为 0 计入；Anthropic 面 cache_creation 用）。 */
  cacheWritePerMTok?: number;
}

/** 价格表：构造注入（配置面——表驱动计价，无内置厂商价格）。 */
export type PricingTable = readonly ModelPricing[];

/** 无缓存分列时的退化计价（cacheRead/cacheWrite 视为 0）。 */
export interface UsageLike {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface CostBreakdown {
  inputCostUsd: number;
  cachedInputCostUsd: number;
  cacheWriteCostUsd: number;
  outputCostUsd: number;
  /** 合计（美元）。 */
  costUsd: number;
}

/**
 * usage × 单价 → 成本（纯函数）。J25 加权：四 token 类各自按单价计——
 * 预算不按裸 token 数算的对应面。无缓存分列时非缓存输入 = inputTokens
 * 全额（inputTokens 含缓存读的语义下，cacheRead 缺席 = 无缓存可扣）。
 */
export function costOfUsage(usage: UsageLike, pricing: ModelPricing): CostBreakdown {
  const cachedRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  // inputTokens 含缓存读（OpenAI 语义）——非缓存部分扣除；max(0) 防御
  // provider 送来 cached > input 的病态数据（负成本即流内谎言）
  const nonCachedInput = Math.max(0, usage.inputTokens - cachedRead);
  const m = 1_000_000;
  const inputCostUsd = (nonCachedInput / m) * pricing.inputPerMTok;
  const cachedInputCostUsd = (cachedRead / m) * pricing.cachedInputPerMTok;
  const cacheWriteCostUsd = (cacheWrite / m) * (pricing.cacheWritePerMTok ?? 0);
  const outputCostUsd = (usage.outputTokens / m) * pricing.outputPerMTok;
  return {
    inputCostUsd,
    cachedInputCostUsd,
    cacheWriteCostUsd,
    outputCostUsd,
    costUsd: inputCostUsd + cachedInputCostUsd + cacheWriteCostUsd + outputCostUsd,
  };
}

/** 价格表查找（provider+modelId 精确匹配）；未配置价格的模型返回 null（不虚构单价）。 */
export function findPricing(table: PricingTable, provider: string, modelId: string): ModelPricing | null {
  return table.find((p) => p.provider === provider && p.modelId === modelId) ?? null;
}

/** 逐行原料（events 表 SELECT——L1 否定性纪律：只读，无第二份轨迹存储）。 */
export interface UsageRow {
  sessionId: string;
  turn: number;
  /** 该 turn 的模型身份（turn 内最后一次 request/header——换模按末次请求归因，记档）。 */
  provider: string | null;
  modelId: string | null;
  usage: UsageLike;
}

export interface SessionCost {
  sessionId: string;
  costUsd: number;
  /** 按轮细分（turn 升序——两级聚合的内层）。 */
  byTurn: Array<{ turn: number; costUsd: number; modelId: string | null }>;
}

/** 事件库 → 成本聚合（会话/轮两级；未配置价格的模型的 token 数不进成本——如实缺省）。 */
export function costRollup(db: Database, table: PricingTable): SessionCost[] {
  const rows = db
    .prepare(
      `
      SELECT
        e.session_id AS sessionId,
        json_extract(e.payload, '$.turn') AS turn,
        json_extract(e.payload, '$.usage') AS usageJson,
        (
          SELECT json_extract(h.payload, '$.config.modelId')
          FROM events h
          WHERE h.session_id = e.session_id
            AND h.type = 'request/header'
            AND json_extract(h.payload, '$.turn') = json_extract(e.payload, '$.turn')
          ORDER BY h.seq DESC
          LIMIT 1
        ) AS modelId,
        (
          SELECT json_extract(h.payload, '$.config.provider')
          FROM events h
          WHERE h.session_id = e.session_id
            AND h.type = 'request/header'
            AND json_extract(h.payload, '$.turn') = json_extract(e.payload, '$.turn')
          ORDER BY h.seq DESC
          LIMIT 1
        ) AS provider
      FROM events e
      WHERE e.type = 'assistant/message'
        AND json_extract(e.payload, '$.usage') IS NOT NULL
      ORDER BY e.session_id, json_extract(e.payload, '$.turn')
      `,
    )
    .all() as Array<{ sessionId: string; turn: number; usageJson: string; provider: string | null; modelId: string | null }>;

  const sessions = new Map<string, Map<number, { costUsd: number; modelId: string | null }>>();
  for (const row of rows) {
    const pricing = row.provider !== null && row.modelId !== null ? findPricing(table, row.provider, row.modelId) : null;
    if (pricing === null) continue; // 无价格配置的模型不虚构成本——该轮成本如实缺席
    const usage = JSON.parse(row.usageJson) as UsageLike;
    const { costUsd } = costOfUsage(usage, pricing);
    let turns = sessions.get(row.sessionId);
    if (!turns) {
      turns = new Map();
      sessions.set(row.sessionId, turns);
    }
    const existing = turns.get(row.turn);
    if (existing) {
      existing.costUsd += costUsd;
    } else {
      turns.set(row.turn, { costUsd, modelId: row.modelId });
    }
  }

  return [...sessions.entries()]
    .map(([sessionId, turns]) => ({
      sessionId,
      costUsd: [...turns.values()].reduce((sum, t) => sum + t.costUsd, 0),
      byTurn: [...turns.entries()]
        .map(([turn, t]) => ({ turn, costUsd: t.costUsd, modelId: t.modelId }))
        .sort((a, b) => a.turn - b.turn),
    }))
    .sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1));
}
