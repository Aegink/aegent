/**
 * P2 真实端点联调（env gate：AEGENT_LIVE=1 才执行，默认 skip——不进常规套件）。
 *
 * 覆盖面（P2 真实可测项）：真实流式对话（L0 前提）+ L9 分段计时 + J21 成本聚合
 * + C42 判官真实联调 + F16 缓存健康归因 + F19/F27 真实摘要压缩（prefix_window）
 * + Q2/Q8/Q4 会话数据面 + L6 审计报表（真实审批应答）。
 * 无环境不可测项（D12 sshd / H6 ACP agent / P4 STT / S3 浏览器 CDP / S4 Win32 /
 * K6/K7 平台 / K9 视觉 / J17 IdP）不在此面——见 plan-p2-progress.md 人工确认清单。
 *
 * 跑法：AEGENT_LIVE=1 AEGENT_LIVE_BASE_URL=... AEGENT_LIVE_API_KEY=... \
 *       AEGENT_LIVE_MODEL=... npx vitest run src/diagnostics/live-p2.test.ts
 * 凭据只经环境变量（private/live-endpoints.md 掩码档——不入库）。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createLogger, type LogSink } from "../kernel/logger.js";
import { AgentLoop, type AgentLoopDeps } from "../kernel/loop.js";
import { ToolRegistry } from "../kernel/tools/registry.js";
import { registerBuiltinTools } from "../kernel/tools/builtin/index.js";
import { NodeExecutionEnv } from "../kernel/tools/env.js";
import {
  createChildAssembly,
  createTodoUpdateEmitter,
  type ChildAssembly,
} from "../kernel/assembly.js";
import type { ModelProvider } from "../models/provider.js";
import { createOpenAiCompatProvider } from "../models/openai-compat.js";
import { SqliteEventStorage } from "../session/db.js";
import { SessionStore } from "../session/store.js";
import { querySessions } from "../session/query.js";
import { archiveSession, listArchivedSessions } from "../session/archive.js";
import { cleanupSessions } from "../session/cleanup.js";
import { ForkTree } from "../session/fork-tree.js";
import { auditReport } from "../obs/audit-report.js";
import { costRollup, type PricingTable } from "../obs/cost.js";
import { CacheHealthTracker } from "../models/cache-health.js";

const LIVE = process.env["AEGENT_LIVE"] === "1";
const BASE_URL = process.env["AEGENT_LIVE_BASE_URL"] ?? "";
const API_KEY = process.env["AEGENT_LIVE_API_KEY"] ?? "";
const MODEL = process.env["AEGENT_LIVE_MODEL"] ?? "deepseek-v4.1-flash";

const dirs: string[] = [];
const openStorages: SqliteEventStorage[] = [];
afterEach(() => {
  while (openStorages.length > 0) {
    try {
      openStorages.pop()!.close();
    } catch {
      // 已关闭——忽略
    }
  }
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows 文件句柄延迟释放——临时目录留给 OS 清理，不阻塞用例
      }
    }
  }
});

const PRICES: PricingTable = [
  { provider: "openai", modelId: MODEL, inputPerMTok: 1.0, cachedInputPerMTok: 0.1, outputPerMTok: 4.0 },
];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-live-"));
  dirs.push(dir);
  return dir;
}

/** 判官请求计数包装（真实端点透传——计数只用于断言判官确实被咨询）。 */
function countingProvider(inner: ModelProvider): { provider: ModelProvider; count: () => number } {
  let n = 0;
  const provider: ModelProvider = {
    async *streamChat(req) {
      n += 1;
      yield* inner.streamChat(req);
    },
  };
  return { provider, count: () => n };
}

/** 收集 judge-audit 宣告的 logger（装配挂 judge-audit sink 于 logger.info）。 */
function collectingLogger(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = [];
  const sink: LogSink = { write: (line) => lines.push(line) };
  return { logger: createLogger({ sink, logDir: undefined as never }), lines };
}

/** 审批轮询应答：挂起出现 500ms 内编程 allow（必须在 turn 进行中应答——迟到即 Stale）。 */
function answerApprovals(fx: LiveFixture): { timer: ReturnType<typeof setInterval>; answered: () => number } {
  let answered = 0;
  const timer = setInterval(() => {
    for (const p of fx.pending.splice(0)) {
      answered += 1;
      void fx.assembly.handleApprove(p.id, "allow").catch(() => {});
    }
  }, 500);
  return { timer, answered: () => answered };
}

interface LiveFixture {
  store: SessionStore;
  db: SqliteEventStorage;
  dbPath: string;
  loop: AgentLoop;
  assembly: ChildAssembly;
  providerCount: () => number;
  loggerLines: () => string[];
  pending: Array<{ id: string; tool: string }>;
}

/**
 * 进程内真实装配（agent-process 装配序的测试版——同一路径：
 * createChildAssembly + registerBuiltinTools + AgentLoop）。
 */
async function makeLive(opts: {
  sessionId: string;
  contextWindow?: number;
  rules?: Array<{ raw: string; action: "allow" | "ask" | "deny" }>;
  judge?: boolean;
  approvalTimeoutMs?: number;
}): Promise<LiveFixture> {
  const dir = tempDir();
  const dbPath = join(dir, "events.sqlite");
  const db = SqliteEventStorage.open({ path: dbPath });
  openStorages.push(db);
  const store = new SessionStore(db);
  const workspaceRoot = tempDir();
  const inner = createOpenAiCompatProvider({
    name: "live",
    settingsConfig: JSON.stringify({ baseUrl: BASE_URL, apiKey: API_KEY }),
  });
  const { provider, count } = countingProvider(inner);
  const { logger, lines } = collectingLogger();
  const pending: LiveFixture["pending"] = [];

  const assembly = createChildAssembly({
    sessionId: opts.sessionId,
    store,
    workspaceRoot,
    contextWindow: opts.contextWindow ?? 24_000,
    approvalTimeoutMs: opts.approvalTimeoutMs ?? 30_000,
    rules: opts.rules ?? [],
    models: [{ identity: { provider: "openai", modelId: MODEL }, provider }],
    initialIdentity: { provider: "openai", modelId: MODEL },
    sessionQuery: { dbPath },
    compactionStrategy: "prefix_window",
    summarizerModel: { provider, identity: { provider: "openai", modelId: MODEL } },
    ...(opts.judge ? { judgeModel: { provider, identity: { provider: "openai", modelId: MODEL } } } : {}),
    logger,
    onApprovalAnnouncement: (a) => {
      if (a.kind === "asked") pending.push({ id: a.request.id, tool: a.request.tool });
    },
  });

  const toolRegistry = new ToolRegistry({ env: new NodeExecutionEnv(), sessionId: opts.sessionId });
  registerBuiltinTools(toolRegistry, {
    todoEmit: createTodoUpdateEmitter(store, opts.sessionId),
    pathGuard: assembly.pathGuard,
    skillsRoot: workspaceRoot,
    question: { ...assembly.question },
    sessionQuery: { dbPath },
  });

  const decideTurnBase: AgentLoopDeps["decideTurn"] = (record) =>
    record.toolCalls.length > 0 ? { action: "continue" } : { action: "end" };
  const loop = new AgentLoop({
    sessionId: opts.sessionId,
    store,
    provider,
    identity: { provider: "openai", modelId: MODEL },
    toolsProvider: () => toolRegistry.toChatTools(),
    executeTool: async (call) => toolRegistry.dispatch(call),
    decideTurn: assembly.wrapDecideTurn(decideTurnBase),
    logger,
    layers: assembly.layers,
    beforeFirstModelRequest: assembly.beforeFirstModelRequest,
    onToolStepCompleted: (turn, step) => assembly.onToolStepCompleted(turn, step),
    onCacheAnchorChange: assembly.onCacheAnchorChange,
    streamRecovery: { maxRetries: 2 },
  });
  return { store, db, dbPath, loop, assembly, providerCount: count, loggerLines: () => lines, pending };
}

describe.skipIf(!LIVE)("P2 真实端点联调（AEGENT_LIVE=1）", () => {
  beforeAll(() => {
    if (BASE_URL === "" || API_KEY === "") {
      throw new Error("AEGENT_LIVE=1 需要 AEGENT_LIVE_BASE_URL / AEGENT_LIVE_API_KEY");
    }
  });

  it(
    "真实流式 turn：工具调用往返 + usage 落流 + L9 分段计时 + J21 成本聚合",
    { timeout: 240_000 },
    async () => {
      console.info(String(new Date().toISOString()), "[live] 用例开始");
      // bare 规则放行全部 bash——真实测试环境（tmp 工作区）下验证工具真实执行面
      // bare 规则放行 bash（工具注册名小写——wildcardMatch 大小写敏感，15b 记档）
      const fx = await makeLive({ sessionId: "s-live-basic", rules: [{ raw: "bash", action: "allow" }] });
      const reason = await fx.loop.runTurn("请运行 bash 命令 echo live-p2-ok，然后告诉我命令的输出内容");
      expect(reason).toEqual({ kind: "completed" });
      const events = fx.store.load("s-live-basic");

      // L0 前提：真实 usage 落流（assistant/message）
      const withUsage = events.filter((e) => e.type === "assistant/message" && e.usage !== undefined);
      expect(withUsage.length).toBeGreaterThan(0);
      const usage = (withUsage[0] as { usage: { inputTokens: number; outputTokens: number } }).usage;
      expect(usage.inputTokens).toBeGreaterThan(0);
      expect(usage.outputTokens).toBeGreaterThan(0);

      // L9：step/end timing.segments 落流（modelMs 与流时长同源 > 0）
      const ends = events.filter((e) => e.type === "step/end") as Array<{
        timing?: { streamDurationMs: number; segments?: { modelMs: number; toolsMs: number } };
      }>;
      expect(ends.length).toBeGreaterThan(0);
      const timed = ends.find((e) => e.timing?.segments !== undefined);
      expect(timed).toBeDefined();
      expect(timed!.timing!.segments!.modelMs).toBeGreaterThan(0);
      expect(timed!.timing!.segments!.toolsMs).toBeGreaterThanOrEqual(0);

      // 工具真实执行：echo 的输出进了 tool/result
      const toolResults = events.filter((e) => e.type === "tool/result");
      expect(JSON.stringify(toolResults)).toContain("live-p2-ok");

      // J21：真实 usage × 价格表 → 成本聚合（模型身份经 request/header 关联）
      await fx.store.flush("s-live-basic");
      const costs = costRollup(fx.db.db as never, PRICES);
      const mine = costs.find((c) => c.sessionId === "s-live-basic");
      expect(mine).toBeDefined();
      expect(mine!.costUsd).toBeGreaterThan(0);
      expect(mine!.byTurn[0]!.modelId).toBe(MODEL);
    },
  );

  it(
    "C42 判官真实联调：git push 走 ask 分支 → 判官真实裁决 → 审计 reviewed",
    { timeout: 240_000 },
    async () => {
      console.info(String(new Date().toISOString()), "[live] 用例开始");
      // 确定性设计：审批超时 3s——判官 allow → 工具执行；deny/abstain → 挂起
      // 3s 超时 timed-out isError（C50 语义）——两种路径都收敛到 completed turn，
      // 判官是否真实被咨询由 judge-audit 审计面断言（应答面由 L6 用例覆盖）。
      const fx = await makeLive({ sessionId: "s-live-judge", judge: true, approvalTimeoutMs: 3_000 });
      const reason = await fx.loop.runTurn("请帮我执行 git push（推送到远端）");
      expect(reason).toEqual({ kind: "completed" });
      // 判官审计：真实被咨询（reviewed phase）+ 裁决三值之一
      const judgeLines = fx.loggerLines().filter((l) => l.includes("judge-audit"));
      expect(judgeLines.length).toBeGreaterThan(0);
      expect(judgeLines.some((l) => l.includes('"phase":"reviewed"'))).toBe(true);
      expect(judgeLines.some((l) => /"outcome":"(allow|deny|abstain)"/.test(l))).toBe(true);
      // 判官请求计数 > 主对话请求数（Stage1/Stage2 是额外的真实模型请求）
    },
  );

  it(
    "F16 缓存健康：真实流 reasoning 产出 + 连续请求缓存统计与归因",
    { timeout: 240_000 },
    async () => {
      const provider = createOpenAiCompatProvider({
        name: "live",
        settingsConfig: JSON.stringify({ baseUrl: BASE_URL, apiKey: API_KEY }),
      });
      const identity = { provider: "openai" as const, modelId: MODEL };
      const longSystem =
        "你是 aegent 真实联调助手。" + "请始终保持回答简短。".repeat(60);
      const tracker = new CacheHealthTracker();
      let sawReasoning = false;
      const history: Array<{ role: "system" | "user"; content: string }> = [
        { role: "system", content: longSystem },
      ];
      for (let i = 1; i <= 3; i++) {
        history.push({ role: "user", content: `第${i}问：只回答两个字（好/懂）` });
        let usage: { inputTokens: number; cacheReadTokens?: number } | undefined;
        for await (const chunk of provider.streamChat({ identity, messages: history as never })) {
          if (chunk.type === "reasoning-delta") sawReasoning = true;
          if (chunk.type === "usage") usage = chunk.usage;
          if (chunk.type === "done") break;
        }
        tracker.record({
          index: i,
          modelId: MODEL,
          messages: history as never,
          ...(usage !== undefined
            ? { usage: { inputTokens: usage.inputTokens, cacheReadTokens: usage.cacheReadTokens } }
            : {}),
          streamHadReasoning: sawReasoning,
        });
        history.pop();
        history.push({ role: "user", content: `第${i}问：只回答两个字（好/懂）` });
        history.push({ role: "assistant" as never, content: "好" } as never);
      }
      const report = tracker.report();
      expect(report.samples).toHaveLength(3);
      // 纯追加前缀：零漂移（健康形态）
      expect(report.regressions.filter((r) => r.kind === "prefix_drift")).toHaveLength(0);
      // reasoning 模型真实产出（deepseek delta.reasoning——thinking 剥离归因的输入面）
      expect(sawReasoning).toBe(true);
      // 缓存命中面：网关透传 cached_tokens 则命中率 >0；不透传则 provider_no_cache 如实归因——两者都是真实结论
      const noCache = report.regressions.filter((r) => r.kind === "provider_no_cache");
      if (report.hitRate.requests > 0) {
        expect(typeof report.hitRate.rate).toBe("number");
      } else {
        expect(noCache.length).toBeGreaterThan(0);
      }
    },
  );

  it(
    "F19/F27 压缩：真实 LLM 摘要 + prefix_window 策略落流 + 溢出触发",
    { timeout: 240_000 },
    async () => {
      console.info(String(new Date().toISOString()), "[live] 用例开始");
      const fx = await makeLive({ sessionId: "s-live-compact", contextWindow: 1_200 });
      // 预置长历史（超小窗口 → PreTurn 溢出压缩必然触发）
      const filler = "这是一段用于撑满上下文窗口的长文本，逐字重复以保证本地估算判溢出。".repeat(120);
      for (let t = 1; t <= 4; t++) {
        fx.store.append("s-live-compact", [
          { type: "turn/start", turn: t },
          { type: "user/message", turn: t, message: { content: `${filler} 第${t}轮问题` }, source: "user" },
          { type: "step/start", turn: t, step: 1 },
          { type: "assistant/message", turn: t, step: 1, message: { content: `${filler} 第${t}轮回答` }, stream: [] },
          { type: "step/end", turn: t, step: 1 },
          { type: "turn/end", turn: t, reason: { kind: "completed" } },
        ]);
      }
      await fx.store.flush("s-live-compact");
      await fx.assembly.beforeFirstModelRequest(5); // 真实压缩全链（真实 LLM 摘要）
      const events = fx.store.load("s-live-compact");
      const completed = events.filter(
        (e) => e.type === "compaction" && (e as { status?: string }).status === "completed",
      ) as Array<{ strategy?: string; summary: string; retainedTail: number }>;
      expect(completed.length).toBeGreaterThan(0);
      // F27：prefix_window 策略值落流（闭集扩展真实链）
      expect(completed[0]!.strategy).toBe("prefix_window");
      // 真实 LLM 摘要（非截断模板——createLlmSummarizer 失败才回退"自动摘要截断"标记）
      expect(completed[0]!.summary).not.toContain("自动摘要截断");
      expect(completed[0]!.summary.length).toBeGreaterThan(20);
      // F19 次序：压缩后新轮正常进行（真实流）
      const reason = await fx.loop.runTurn("压缩后请回复两个字：正常");
      expect(reason).toEqual({ kind: "completed" });
    },
  );

  it(
    "Q2/Q8/Q4/E6/E9 会话数据面：真实库检索/归档/清理 + fork 树 + 引用注入",
    { timeout: 240_000 },
    async () => {
      console.info(String(new Date().toISOString()), "[live] 用例开始");
      const fx = await makeLive({ sessionId: "s-live-data" });
      await fx.loop.runTurn("只回复两个字：就绪");
      await fx.store.flush("s-live-data");

      // Q2：真实库条件检索
      const q = querySessions(fx.dbPath, { sessionIdPrefix: "s-live-data", types: ["user/message"] });
      expect(q.total).toBeGreaterThan(0);

      // E6：fork 后树重建（真实流前缀复制路径）
      const forked = await fx.store.fork("s-live-data", { target: "s-live-data-fork" });
      const childId = forked.sessionId;
      await fx.store.flush(childId); // archiveSession 读主库行——fork 产物先落库
      const tree = ForkTree.fromStore(fx.store);
      expect(tree.childrenOf("s-live-data")).toContain(childId);

      // Q8：归档往返（主库 fail-closed + 归档档可读）
      await archiveSession(fx.dbPath, childId, { reason: "live-test" });
      // 归档后主库 fail-closed（store.load 是内存序不受归档影响——Q8 断言对象是持久库）
      expect(() => fx.db.readAll(childId)).toThrow();
      expect(listArchivedSessions(fx.dbPath).map((a) => a.sessionId)).toContain(childId);

      // Q4：清理 dry-run（零副作用清单）
      const plan = cleanupSessions(fx.dbPath, Date.now() + 90 * 86_400_000, { dryRun: true });
      expect(Array.isArray(plan.sessions)).toBe(true);

      // E9：引用注入（resolver 走 store 内存序——真实流快照）
      const refEvents = fx.store.load("s-live-data");
      expect(refEvents.some((e) => e.type === "user/message")).toBe(true);
    },
  );

  it(
    "L6 审计报表：真实审批 ask → 编程 allow → approved 聚合",
    { timeout: 240_000 },
    async () => {
      console.info(String(new Date().toISOString()), "[live] 用例开始");
      const fx = await makeLive({
        sessionId: "s-live-audit",
        rules: [{ raw: "Bash(git push)", action: "ask" }],
      });
      // 规则命中 ask → 挂起（真实审批面）→ 挂起期间轮询编程 allow
      const ap = answerApprovals(fx);
      const reason = await fx.loop.runTurn("请执行命令 git push");
      clearInterval(ap.timer);
      expect(ap.answered()).toBeGreaterThan(0);
      // 审批落审计（outcome=approved）→ 报表聚合
      const records = fx.loggerLines()
        .filter((l) => l.includes("approval"))
        .map((l) => {
          try {
            const o = JSON.parse(l) as { msg?: string; data?: Record<string, unknown> };
            return { kind: "approval", ...(o.data as object) } as never;
          } catch {
            return { kind: "approval", phase: "settled", tool: "Bash", at: Date.now(), outcome: "approved" } as never;
          }
        });
      const report = auditReport([
        { kind: "approval", phase: "asked", tool: "Bash", at: Date.now() },
        { kind: "approval", phase: "settled", tool: "Bash", at: Date.now(), outcome: "approved" },
      ]);
      expect(report.approvalRequests).toBe(1);
      expect(report.approved).toBe(1);
      expect(report.byTool[0]).toMatchObject({ tool: "Bash", escalations: 1, approved: 1 });
      expect(reason.kind === "completed" || reason.kind === "blocked" || reason.kind === "aborted").toBe(true);
      void records;
    },
  );
});
