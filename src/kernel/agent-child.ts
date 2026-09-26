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
import { parseProviderConfig } from "../models/config.js";
import { createOpenAiCompatProvider } from "../models/openai-compat.js";
import { withRetry } from "../models/retry.js";

interface ChildCliArgs {
  provider?: string;
  db?: string;
  workspace?: string;
  contextWindow?: number;
  approvalTimeoutMs?: number;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/** 子进程自己的参数解析（父进程 spawn 时透传；环境变量作回退）。 */
function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv): ChildCliArgs {
  const args: ChildCliArgs = {
    provider: env["AEGENT_PROVIDER"],
    db: env["AEGENT_DB"],
    apiKey: env["AEGENT_API_KEY"],
    baseUrl: env["AEGENT_BASE_URL"],
    model: env["AEGENT_MODEL"],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--provider" && i + 1 < argv.length) args.provider = argv[++i];
    else if (a === "--db" && i + 1 < argv.length) args.db = argv[++i];
    else if (a === "--workspace" && i + 1 < argv.length) args.workspace = argv[++i];
    else if (a === "--context-window" && i + 1 < argv.length)
      args.contextWindow = Number(argv[++i]);
    else if (a === "--approval-timeout" && i + 1 < argv.length)
      args.approvalTimeoutMs = Number(argv[++i]);
  }
  return args;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2), process.env);

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
    provider = withRetry(createOpenAiCompatProvider(config));
    identity = { provider: "openai", modelId: cli.model ?? "gpt-4o-mini" };
  }

  const options: AgentChildOptions = {
    sessionId: process.env["AEGENT_SESSION"] ?? "s0",
    ...(storage ? { storage } : {}),
    ...(provider ? { provider, identity } : {}),
    ...(cli.provider === "openai" || cli.db || cli.workspace || cli.contextWindow !== undefined
      ? {
          assembly: {
            workspaceRoot: cli.workspace ?? process.cwd(),
            // E11：工作区即 git 仓时启用代码检查点（非 git 目录由
            // GitCheckpointService 首次打点时拒绝并提示，不中断轮）
            checkpointRepoRoot: cli.workspace ?? process.cwd(),
            contextWindow: cli.contextWindow ?? 200_000,
            approvalTimeoutMs: cli.approvalTimeoutMs ?? 120_000,
            // G1/G7 plan 模式（测试/实测开关：AEGENT_PLAN=1）——G4 计划
            // artifact 落工作区自留目录 .aegent/sessions/<sessionId>（untracked
            // 新文件不入 git stash，与 E11 互不干扰）
            ...(process.env["AEGENT_PLAN"] === "1"
              ? {
                  planMode: true,
                  planArtifactDir: path.join(
                    cli.workspace ?? process.cwd(),
                    ".aegent",
                    "sessions",
                    process.env["AEGENT_SESSION"] ?? "s0",
                  ),
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
  await runAgentChildStdio(options);
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
