/**
 * host 查询直答网关（行数纪律拆分自 bridge.ts——onQuery 的 op 分流实现）。
 * 只读直答面：不落流、不经 agent、不需要租约。各 op 的语义：
 * - events：恢复视图（本会话内存序；跨会话回源 SQLite 库——U3 放宽）
 * - sessions：会话历史清单（U3/T-P3-105）
 * - search：跨会话检索（U9/T-P3-108——Q2 消费面，只回摘要行）
 * - files：workspace 只读文件列举（U10/T-P3-109——@ 补全数据面）
 * - meta：注册表清单（U10——ready 捕获的工具/技能名单，/ 补全来源）
 * - usage：用量与上下文聚合（U12/T-P3-111——usage_rollup/成本/压缩统计）
 */

import type { SessionStore } from "../session/store.js";
import type { SqliteEventStorage } from "../session/db.js";
import type { PricingEntry } from "../session/settings.js";
import { querySessionsDb } from "../session/query.js";
import { listWorkspaceFiles } from "./files-list.js";
import { ensureUsageView, usageBySession, usageByTurn } from "../obs/usage.js";
import { costRollup } from "../obs/cost.js";
import { compactionStats } from "../obs/compaction-stats.js";

/** onQuery 的载荷形状（protocol.ts ServerOptions.onQuery 的参数——信封去
 * type/requestId 后的查询本体）。 */
export interface HostQuery {
  sessionId: string;
  op: "events" | "sessions" | "search" | "files" | "meta" | "usage";
  afterSeq?: number;
  criteria?: { contentLike: string; limit?: number; offset?: number };
}

/** U10/T-P3-109：ready 消息捕获的注册表清单（工具/技能——/ 补全来源）。 */
export interface AgentCapabilities {
  tools: string[];
  skills: { name: string; description: string }[];
}

/** 查询面的依赖注入（bridge 构造时快照——capabilities 是活查询）。 */
export interface HostQueryDeps {
  hostSessionId(): string;
  store?: SessionStore;
  sessionsLibrary?: SqliteEventStorage;
  settingsGateway?: { get(): Promise<{ pricing?: PricingEntry[] }> };
  workspaceRoot?: string;
  contextWindow?: number;
  capabilities(): AgentCapabilities | undefined;
}

function libraryOrThrow(library: SqliteEventStorage | undefined, what: string): SqliteEventStorage {
  if (library === undefined) {
    const error = new Error(`host 未配置 SQLite 事件库，${what}不可用`);
    (error as unknown as { code: string }).code = "SESSIONS_UNAVAILABLE";
    throw error;
  }
  return library;
}

/** onQuery 的实现（bridge 的 ServerOptions.onQuery 委托到此）。 */
export async function handleHostQuery(
  deps: HostQueryDeps,
  query: HostQuery,
): Promise<unknown> {
  const store = deps.store;
  if (store === undefined) {
    const error = new Error("host 未配置事件存储，查询面不可用");
    (error as unknown as { code: string }).code = "STORE_UNAVAILABLE";
    throw error;
  }
  if (query.op === "sessions") {
    const library = libraryOrThrow(deps.sessionsLibrary, "会话清单");
    return { sessions: library.listSessionSummaries() };
  }
  // U9/T-P3-108：跨会话检索（Q2 消费面）——只回命中摘要行（sessionId/
  // seq/type/ts/excerpt），不回事件整值（payload 全量不出检索面）。
  if (query.op === "search") {
    const library = libraryOrThrow(deps.sessionsLibrary, "跨会话检索");
    const criteria = query.criteria!;
    const result = querySessionsDb(library.db, {
      contentLike: criteria.contentLike,
      ...(criteria.limit !== undefined ? { limit: criteria.limit } : {}),
      ...(criteria.offset !== undefined ? { offset: criteria.offset } : {}),
    });
    return {
      rows: result.rows.map((r) => ({
        sessionId: r.sessionId,
        seq: r.seq,
        type: r.type,
        ts: r.ts,
        excerpt: r.excerpt ?? "",
      })),
      total: result.total,
      hasMore: result.hasMore,
    };
  }
  // U10/T-P3-109：workspace 只读文件列举（@ 补全数据面）+ 注册表清单
  // （ready 捕获——/ 补全来源）。都是只读直答，不经 agent 不落流。
  if (query.op === "files") {
    return listWorkspaceFiles(deps.workspaceRoot ?? process.cwd());
  }
  if (query.op === "meta") {
    const caps = deps.capabilities();
    return { tools: caps?.tools ?? [], skills: caps?.skills ?? [] };
  }
  // U12/T-P3-111：用量与上下文可视化（聚合面消费端）——数据源单源：
  // token 全部来自事件库 usage_rollup（assistant/message 的 usage 落流
  // 投影）；成本 = costRollup × settings 计价（未配置 = 如实缺席）；
  // 压缩统计 = 会话流内 compaction 事件（store 投影）。
  if (query.op === "usage") {
    const library = libraryOrThrow(deps.sessionsLibrary, "用量面");
    // 幂等建视图（本 host 是 usage_rollup 的首个生产消费方——IF NOT
    // EXISTS 语义见 obs/usage.ts，无迁移问题）
    ensureUsageView(library.db);
    const sessionId = deps.hostSessionId();
    const turns = usageByTurn(library.db, sessionId);
    const lastUsage = turns.length > 0 ? turns[turns.length - 1] : undefined;
    const pricing =
      deps.settingsGateway !== undefined ? ((await deps.settingsGateway.get()).pricing ?? []) : [];
    const stream = deps.store?.load(sessionId) ?? [];
    return {
      contextWindow: deps.contextWindow,
      currentSession: {
        turns,
        contextTokens: lastUsage?.totalTokens,
        compaction: compactionStats(stream),
      },
      sessions: usageBySession(library.db),
      costs: costRollup(library.db, pricing),
    };
  }
  // 本会话：内存序读取（同步）：镜像 append 的直接产物——最新、无
  // write-behind 缓冲滞后（restore/readAll 只见已 flush 部分——E1
  // 纪律的读面选择）。U3：跨会话（历史查看入口）直接回源 SQLite 库
  // ——历史会话不在内存镜像；库未配置 = 空流（无历史可看）。
  if (query.sessionId !== deps.hostSessionId()) {
    if (deps.sessionsLibrary === undefined) return { events: [] };
    const archived = deps.sessionsLibrary.readAll(query.sessionId);
    const events =
      query.afterSeq !== undefined
        ? archived.filter((e) => e.seq > query.afterSeq!)
        : [...archived];
    return { events };
  }
  const all = store.load(query.sessionId);
  const events =
    query.afterSeq !== undefined ? all.filter((e) => e.seq > query.afterSeq!) : [...all];
  return { events };
}
