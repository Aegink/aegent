/**
 * 子进程入口（T9）——被父进程以 `node dist/src/kernel/agent-child.js` 启动。
 * 本文件只做装配：协议循环与调度在 agent-process.ts。
 *
 * 装配来源（T-8-01，按优先级）：
 * - 命令行参数（CLI 透传）：--provider echo|openai、--db <path>（SQLite 事件
 *   库）、--workspace <dir>、--context-window <n>、--approval-timeout <ms>；
 * - 环境变量回退：AEGENT_PROVIDER / AEGENT_DB / AEGENT_API_KEY /
 *   AEGENT_BASE_URL / AEGENT_MODEL。
 *
 * 缺省（无参数无环境）= T-3-06 最小装配：echo provider + InMemory store +
 * 无权限层——冷启动路径不含 better-sqlite3（动态 import 保证），Q16 <500ms
 * 的结构性前提不因生产装配而破坏；SQLite 模式的冷启动实测在 T-8-05 收口。
 *
 * openai 装配消费 J3 的不透明配置 + J1 的 openai-compat 适配 + J26 的
 * withRetry（loop 外包重试——loop 不设第二条重试路径）。
 */

import path from "node:path";

import { runAgentChildStdio, type AgentChildOptions } from "./agent-process.js";
import { InvalidSessionIdError, isValidSessionId } from "../session/session-id.js";
import { parseProviderConfig } from "../models/config.js";
import { createOpenAiCompatProvider } from "../models/openai-compat.js";
import { createAnthropicMessagesProvider } from "../models/anthropic-messages.js";
import { withRetry, type RetryObservation } from "../models/retry.js";
import { createLogger } from "./logger.js";

/** A5/T-P1-51 重试留痕 logger（openai 装配专用，模块级单例避免句柄膨胀）。 */
const retryWarnLogger = createLogger();

interface ChildCliArgs {
  provider?: string;
  /** N1/T-P1-110 会话 id（wire 通道；env AEGENT_SESSION 是兼容回退）。 */
  session?: string;
  db?: string;
  /** E14/T-P1-90 原始分片日志目录（缺省不写——旁路通道按需开启）。 */
  rawLogDir?: string;
  workspace?: string;
  contextWindow?: number;
  approvalTimeoutMs?: number;
  network?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/** 子进程自己的参数解析（父进程 spawn 时透传；环境变量作回退）。 */
function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv): ChildCliArgs {
  const args: ChildCliArgs = {
    provider: env["AEGENT_PROVIDER"],
    session: env["AEGENT_SESSION"],
    db: env["AEGENT_DB"],
    rawLogDir: env["AEGENT_RAW_LOG_DIR"],
    apiKey: env["AEGENT_API_KEY"],
    baseUrl: env["AEGENT_BASE_URL"],
    model: env["AEGENT_MODEL"],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--provider" && i + 1 < argv.length) args.provider = argv[++i];
    else if (a === "--session" && i + 1 < argv.length) args.session = argv[++i];
    else if (a === "--db" && i + 1 < argv.length) args.db = argv[++i];
    else if (a === "--raw-log-dir" && i + 1 < argv.length) args.rawLogDir = argv[++i];
    else if (a === "--workspace" && i + 1 < argv.length) args.workspace = argv[++i];
    else if (a === "--context-window" && i + 1 < argv.length)
      args.contextWindow = Number(argv[++i]);
    else if (a === "--approval-timeout" && i + 1 < argv.length)
      args.approvalTimeoutMs = Number(argv[++i]);
    else if (a === "--network" && i + 1 < argv.length) args.network = argv[++i];
  }
  return args;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2), process.env);
  if (cli.network !== undefined && cli.network !== "allow" && cli.network !== "deny") {
    throw new Error(`--network 只接受 allow|deny，收到：${cli.network}`);
  }
  // N1/T-P1-110：wire 通道（--session / env AEGENT_SESSION）提供的会话 id
  // 过形状校验（防御性——CLI 侧已生成/校验，子进程不信 wire）；缺省 "s0"
  // 是 mock/测试脚手架值（进程内构造面与脚手架路径不校验，记档）。
  const sessionId = cli.session ?? "s0";
  if (!isValidSessionId(sessionId)) {
    throw new InvalidSessionIdError(sessionId);
  }

  // 存储：指定 --db 时动态 import SQLite（原生模块不进缺省冷启动路径）
  let storage;
  if (cli.db) {
    const { SqliteEventStorage } = await import("../session/db.js");
    storage = SqliteEventStorage.open({ path: cli.db });
  }

  // provider：openai 兼容（配置不透明只校验语法，J3）或缺省 echo
  let provider;
  let identity;
  if (cli.provider === "openai") {
    const config = parseProviderConfig({
      name: "openai",
      settingsConfig: JSON.stringify({
        baseUrl: cli.baseUrl,
        apiKey: cli.apiKey,
        model: cli.model,
      }),
    });
    provider = withRetry(createOpenAiCompatProvider(config), {
      // A5/T-P1-51：重试尝试留痕（结构化 warn——attempt/delayMs/错误字段，
      // kimi retryErrorFields 同构；"事件留记录"落日志不落流——provider
      // 内部重试不进模型历史自洽，卡序头词汇表预判②）。echo 模式无重试面。
      onRetry: (o) => {
        retryWarnLogger.warn("模型请求重试", {
          attempt: o.attempt,
          delayMs: o.delayMs,
          ...o.error,
        });
        // J27/T-P1-61：retrying 一等事件的落流观察者（runAgentChildStdio
        // 构造 loop 后注册——provider 装配在先、store 在后，late binding）。
        retryObserver?.(o);
      },
    });
    identity = { provider: "openai", modelId: cli.model ?? "gpt-4o-mini" };
  } else if (cli.provider === "anthropic") {
    // J5/T-P1-108：Anthropic Messages 适配（#16 追认的第二厂商——与
    // openai 分支同构：配置不透明只校验语法 + withRetry 留痕）。
    const config = parseProviderConfig({
      name: "anthropic",
      settingsConfig: JSON.stringify({
        baseUrl: cli.baseUrl,
        apiKey: cli.apiKey,
        model: cli.model,
      }),
    });
    provider = withRetry(createAnthropicMessagesProvider(config), {
      onRetry: (o) => {
        retryWarnLogger.warn("模型请求重试", {
          attempt: o.attempt,
          delayMs: o.delayMs,
          ...o.error,
        });
        retryObserver?.(o);
      },
    });
    identity = { provider: "anthropic", modelId: cli.model ?? "claude-sonnet-4-5" };
  }

  // J27/T-P1-61：retrying 事件落流观察者的 late-binding 槽——runAgentChildStdio
  // 构造 loop 后回填（provider 装配在 store 创建之前，只能经闭包桥接）。
  let retryObserver: ((o: RetryObservation) => void) | undefined;
  const options: AgentChildOptions = {
    ...(cli.rawLogDir ? { rawLogDir: cli.rawLogDir } : {}),
    sessionId,
    ...(storage ? { storage } : {}),
    ...(provider ? { provider, identity } : {}),
    // F5/T-P1-18：真实 provider 时启用真摘要（LLM 生成 + 截断回退）——
    // echo 模式不给（P0 截断摘要，冷启动路径零变化）
    ...((cli.provider === "openai" || cli.provider === "anthropic") && provider && identity
      ? { summarizerModel: { provider, identity } }
      : {}),
    ...(cli.provider === "openai" || cli.db || cli.workspace || cli.contextWindow !== undefined
      ? {
          assembly: {
            workspaceRoot: cli.workspace ?? process.cwd(),
            // E11：工作区即 git 仓时启用代码检查点（非 git 目录由
            // GitCheckpointService 首次打点时拒绝并提示，不中断轮）
            checkpointRepoRoot: cli.workspace ?? process.cwd(),
            contextWindow: cli.contextWindow ?? 200_000,
            approvalTimeoutMs: cli.approvalTimeoutMs ?? 120_000,
            // B8a/T-P1-20：网络档（--network allow|deny）——提供时装配创建
            // NetworkGuard 并注册 webfetch；缺省无网络工具（fail-closed；
            // 非法值已在 main 入口拒绝）
            ...(cli.network === "allow" || cli.network === "deny"
              ? { networkPolicy: cli.network }
              : {}),
            // G1/G7 plan 模式（测试/实测开关：AEGENT_PLAN=1）——G4 计划
            // artifact 父目录 .aegent/sessions（savePlanArtifact 内部按
            // <dir>/<sessionId>/plan.md 落盘；untracked 不入 git stash，
            // 与 E11 互不干扰）
            ...(process.env["AEGENT_PLAN"] === "1"
              ? {
                  planMode: true,
                  planArtifactDir: path.join(cli.workspace ?? process.cwd(), ".aegent", "sessions"),
                }
              : {}),
            // G3/G6 goal（测试/实测开关：AEGENT_GOAL=<目标文本>；到期动作
            // 缺省 report——每轮催办）
            ...(process.env["AEGENT_GOAL"]
              ? { goal: { text: process.env["AEGENT_GOAL"] } }
              : {}),
          },
        }
      : {}),
  };
  await runAgentChildStdio(options, {
    registerRetryObserver: (fn) => {
      retryObserver = fn;
    },
  });
}

void main().catch((e: unknown) => {
  // 装配期失败（配置坏 / 库打不开）：子进程无法服务，协议错误行 + 退出
  process.stdout.write(
    `${JSON.stringify({
      type: "error",
      code: "CHILD_ASSEMBLY_FAILED",
      message: e instanceof Error ? e.message : String(e),
    })}\n`,
  );
  process.exit(1);
});
