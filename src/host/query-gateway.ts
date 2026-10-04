/**
 * host 查询直答网关（行数纪律拆分自 bridge.ts——onQuery 的 op 分流实现）。
 * 只读直答面：不落流、不经 agent、不需要租约。各 op 的语义：
 * - events：恢复视图（本会话内存序；跨会话回源 SQLite 库——U3 放宽）
 * - sessions：会话历史清单（U3/T-P3-105）
 * - search：跨会话检索（U9/T-P3-108——Q2 消费面，只回摘要行）
 * - files：workspace 只读文件列举（U10/T-P3-109——@ 补全数据面）
 * - meta：注册表清单（U10——ready 捕获的工具/技能名单，/ 补全来源）
 * - usage：用量与上下文聚合（U12/T-P3-111——usage_rollup/成本/压缩统计）
 * - review：工作面板聚合面（U15/T-P3-117——变更评审 + 子代理委派一览，
 *   纯函数从流算不建状态；本会话内存序、跨会话回源库——恢复视图同享）
 * - file：workspace 单文件只读预览（U15 文件树 Tab——workspace 内断言）
 */

import type { SessionStore } from "../session/store.js";
import type { SqliteEventStorage } from "../session/db.js";
import type { PricingEntry } from "../session/settings.js";
import { querySessionsDb } from "../session/query.js";
import { reviewChangesFromEvents } from "../session/review-changes.js";
import { listWorkspaceFiles, readWorkspaceFile } from "./files-list.js";
import { ensureUsageView, usageBySession, usageByTurn, usageByDay, usageByModel, usageByTask, turnsFromStream } from "../obs/usage.js";
import { costRollup } from "../obs/cost.js";
import { compactionStats } from "../obs/compaction-stats.js";

/** onQuery 的载荷形状（protocol.ts ServerOptions.onQuery 的参数——信封去
 * type/requestId 后的查询本体）。 */
export interface HostQuery {
  sessionId: string;
  op: "events" | "sessions" | "search" | "files" | "meta" | "usage" | "review" | "file";
  afterSeq?: number;
  criteria?: { contentLike: string; limit?: number; offset?: number };
  path?: string;
}

/** U10/T-P3-109：ready 消息捕获的注册表清单（工具/技能——/ 补全来源）。 */
export interface AgentCapabilities {
  tools: string[];
  skills: { name: string; description: string }[];
  /** T-P3-146：提示词模板目录（文件 + 内置 + MCP——ready 快照）。 */
  prompts?: {
    name: string;
    description?: string;
    argumentHint?: string;
    source: "project" | "user" | "extra" | "builtin" | "mcp";
  }[];
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
    return {
      tools: caps?.tools ?? [],
      skills: caps?.skills ?? [],
      // T-P3-146：模板目录随 meta 暴露（/ 补全与设置页 MCP 只读区共用）
      prompts: caps?.prompts ?? [],
    };
  }
  // U15/T-P3-117：工作面板聚合面——变更提取纯函数从流算（不建状态）。
  // 读面与 events op 同款：本会话内存序（最新无 write-behind 滞后）、
  // 跨会话回源库（历史会话的恢复视图同享工作面板）。
  if (query.op === "review") {
    const stream =
      query.sessionId === deps.hostSessionId()
        ? (store.load(query.sessionId) ?? [])
        : (deps.sessionsLibrary?.readAll(query.sessionId) ?? []);
    return { review: reviewChangesFromEvents(stream) };
  }
  if (query.op === "file") {
    return {
      file: readWorkspaceFile(deps.workspaceRoot ?? process.cwd(), query.path!),
    };
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
    const stream = deps.store?.load(sessionId) ?? [];
    // 镜像折叠覆盖库行（T-P3-165 需求 5：write-behind turn 末才落库——
    // turn 进行中库视图读不到本轮 usage；镜像内存序无滞后，turn 号去重
    // 后以镜像为准）
    const mirrored = turnsFromStream(sessionId, stream);
    const turns = [...usageByTurn(library.db, sessionId).filter((r) => !mirrored.some((m) => m.turn === r.turn)), ...mirrored].sort((a, b) => a.turn - b.turn);
    const lastUsage = turns.length > 0 ? turns[turns.length - 1] : undefined;
    const pricing =
      deps.settingsGateway !== undefined ? ((await deps.settingsGateway.get()).pricing ?? []) : [];
    return {
      contextWindow: deps.contextWindow,
      currentSession: {
        turns,
        contextTokens: lastUsage?.totalTokens,
        compaction: compactionStats(stream),
      },
      sessions: usageBySession(library.db),
      costs: costRollup(library.db, pricing),
      // T-P3-135 批 B⑩：统计页可视化数据面——每日聚合（趋势线/热力图）与
      // 模型占比（甜甜圈）。byDay 单点定形取 host 路线（方案 §1.2 记档）。
      byDay: usageByDay(library.db),
      byModel: usageByModel(library.db),
      // T-P3-147 F：副调用按任务分账（polish/title header aux 聚合）
      byTask: usageByTask(library.db),
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
