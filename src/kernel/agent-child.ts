/**
 * 子进程入口（T9）——被父进程以 `node dist/src/kernel/agent-child.js` 启动。
 * 本文件只做装配：协议循环与调度在 agent-process.ts。
 *
 * 装配来源（T-8-01，按优先级）：
 * - 命令行参数（CLI 透传）：--provider echo|openai|anthropic、--db <path>（SQLite 事件
 *   库）、--workspace <dir>、--context-window <n>、--approval-timeout <ms>、
 *   --base-url/--api-key/--model（U1/T-P3-101 settings 档注入面）；
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
import { loadSettings, type SettingsShape } from "../session/settings.js";
import { createCredentialStore } from "../session/credentials.js";
import { parseProviderConfig } from "../models/config.js";
import { createOpenAiCompatProvider } from "../models/openai-compat.js";
import { createAnthropicMessagesProvider } from "../models/anthropic-messages.js";
import { withRetry, type RetryObservation } from "../models/retry.js";
import type { RegisteredModel } from "./model-switch.js";
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
  /** I8 人格预设（T-P2-305）：--persona <id>——装配期解析（未知 id 启动即败）。 */
  persona?: string;
  approvalTimeoutMs?: number;
  network?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** U5/T-P3-104：settings.json 显式路径（多注册表装配面；缺省 <home>/.aegent）。 */
  settingsPath?: string;
}

/** A5/T-P1-51 重试留痕观察者（late-binding——装配在 store 创建前，闭包桥接）。 */
let retryObserver: ((o: RetryObservation) => void) | undefined;

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
    else if (a === "--persona" && i + 1 < argv.length) args.persona = argv[++i];
    // U1/T-P3-101：settings 档经父进程翻译注入的模型面槽位（此前只有 env
    // 回退——settings.json 的 providers 条目需要 argv 面才能在 env 缺位时
    // 生效；优先级链仍为 argv > env > file > 缺省）。
    else if (a === "--base-url" && i + 1 < argv.length) args.baseUrl = argv[++i];
    else if (a === "--api-key" && i + 1 < argv.length) args.apiKey = argv[++i];
    else if (a === "--model" && i + 1 < argv.length) args.model = argv[++i];
    else if (a === "--settings" && i + 1 < argv.length) args.settingsPath = argv[++i];
  }
  return args;
}

/**
 * settings 多注册表装配（U5/T-P3-104）——未显式给 --provider 且
 * settings.json 有 providers 条目时：全部条目实例化进 models 注册表
 * （J6 会话期换模的可选面——model/switch 请求在注册表内切换，新 turn
 * 生效）。凭据按条目名从 credentials.bin 解密（同用户 DPAPI 可解）。
 * identity = {provider: adapter, modelId}——同 identity 重复条目去重
 * （后到先到同键，取先注册——记档）；无 model 的条目无法成 identity，
 * 跳过。返回 initial（defaultProvider 选中条目）与注册表。
 */
async function buildModelsRegistry(
  settings: SettingsShape,
  settingsPath: string | undefined,
): Promise<{
  models: RegisteredModel[];
  initial: RegisteredModel;
  resolveTarget: (entryName: string, modelOverride: string | undefined) => Promise<RegisteredModel | undefined>;
} | undefined> {
  if (settings.defaultProvider === undefined || settings.providers.length === 0) return undefined;
  const credStore = createCredentialStore();
  const models: RegisteredModel[] = [];
  let initial: RegisteredModel | undefined;
  for (const entry of settings.providers) {
    const adapter = entry.adapter ?? "openai";
    const modelId = entry.model ?? settings.defaultModel;
    if (modelId === undefined) continue;
    const identity = { provider: adapter, modelId };
    const existing = models.find(
      (m) => m.identity.provider === identity.provider && m.identity.modelId === identity.modelId,
    );
    if (existing !== undefined) continue;
    const config = parseProviderConfig({
      name: entry.name,
      settingsConfig: JSON.stringify({
        baseUrl: entry.baseUrl,
        apiKey: await credStore.getKey(entry.name),
        model: modelId,
      }),
    });
    const provider =
      adapter === "anthropic"
        ? createAnthropicMessagesProvider(config)
        : createOpenAiCompatProvider(config);
    const registered: RegisteredModel = {
      identity,
      provider: withRetry(provider, {
        onRetry: (o) => {
          retryWarnLogger.warn("模型请求重试", { attempt: o.attempt, delayMs: o.delayMs, ...o.error });
          retryObserver?.(o);
        },
      }),
    };
    models.push(registered);
    if (entry.name === settings.defaultProvider) initial = registered;
  }
  if (models.length === 0 || initial === undefined) return undefined;
  void settingsPath; // --settings 显式路径已在 loadSettings 调用点消费（签名对称保留）
  // U18/T-P3-120：辅助任务模型解析（judge/summarizer 独立配置——不进
  // 会话期换模注册表）。同 identity 复用已实例化 provider；无则按条目
  // 新建（凭据走 credentials 面同款）但不注册进 models（换模面不变）。
  const resolveTarget = async (
    entryName: string,
    modelOverride: string | undefined,
  ): Promise<RegisteredModel | undefined> => {
    const entry = settings.providers.find((p) => p.name === entryName);
    if (entry === undefined) return undefined;
    const modelId = modelOverride ?? entry.model ?? settings.defaultModel;
    if (modelId === undefined) return undefined;
    const identity = { provider: entry.adapter ?? "openai", modelId };
    const existing = models.find(
      (m) => m.identity.provider === identity.provider && m.identity.modelId === identity.modelId,
    );
    if (existing !== undefined) return existing;
    const config = parseProviderConfig({
      name: `${entry.name}#enhancement`,
      settingsConfig: JSON.stringify({
        baseUrl: entry.baseUrl,
        apiKey: await credStore.getKey(entry.name),
        model: modelId,
      }),
    });
    const provider =
      identity.provider === "anthropic"
        ? createAnthropicMessagesProvider(config)
        : createOpenAiCompatProvider(config);
    return {
      identity,
      provider: withRetry(provider, {
        onRetry: (o) => {
          retryWarnLogger.warn("模型请求重试", { attempt: o.attempt, delayMs: o.delayMs, ...o.error });
          retryObserver?.(o);
        },
      }),
    };
  };
  return { models, initial, resolveTarget };
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

  // U5/T-P3-104：settings 多注册表装配——未显式给 --provider 且
  // settings.json providers 在位时，全条目实例化进 models 注册表
  // （J6 会话期换模可选面；单模型显式分支不受影响，行为零变化）。
  const settingsFile = (await loadSettings(cli.settingsPath)).settings;
  const registry =
    cli.provider === undefined ? await buildModelsRegistry(settingsFile, cli.settingsPath) : undefined;
  if (registry !== undefined) {
    provider = registry.initial.provider;
    identity = registry.initial.identity;
  }

  // U18/T-P3-120：辅助任务模型消费（judge/summarizer 与主对话分离——
  // 缺省回退主模型：judge 未配 = 无判官零行为变化（C42 既有），summarizer
  // 未配 = 主模型（F5 既有回退）；仅多注册表装配分支消费——显式单模型
  // 分支零变化，记档）。回退链（任务 model → 条目 model → defaultModel）
  // 在 resolveTarget 内实现，与 session/settings.resolveEnhancementTarget 同链。
  let judgeTarget: RegisteredModel | undefined;
  let summarizerTarget: RegisteredModel | undefined;
  if (registry !== undefined && settingsFile.enhancement !== undefined) {
    judgeTarget =
      (await registry.resolveTarget(
        settingsFile.enhancement.judge?.provider ?? "",
        settingsFile.enhancement.judge?.model,
      )) ?? undefined;
    summarizerTarget =
      (await registry.resolveTarget(
        settingsFile.enhancement.summarizer?.provider ?? "",
        settingsFile.enhancement.summarizer?.model,
      )) ?? undefined;
  }

  // J27/T-P1-61：retrying 事件落流观察者的 late-binding 槽（模块级声明）。
  const options: AgentChildOptions = {
    ...(cli.rawLogDir ? { rawLogDir: cli.rawLogDir } : {}),
    sessionId,
    // U17/T-P3-119：settings mcp 段的 enabled 条目 → 装配消费（agent-process
    // 在 ready 前连接注册；单 server 失败跳过——never-fail 装配）
    ...(settingsFile.mcp?.some((s) => s.enabled !== false)
      ? { mcpServers: settingsFile.mcp.filter((s) => s.enabled !== false) }
      : {}),
    ...(storage ? { storage } : {}),
    ...(provider ? { provider, identity } : {}),
    // F5/T-P1-18：真实 provider 时启用真摘要（LLM 生成 + 截断回退）——
    // echo 模式不给（P0 截断摘要，冷启动路径零变化）。U18：enhancement
    // summarizer 条目在位时用辅助模型（否则主模型——既有回退）。
    ...((cli.provider === "openai" || cli.provider === "anthropic" || registry !== undefined) &&
    provider &&
    identity
      ? {
          summarizerModel: summarizerTarget ?? {
            provider: provider!,
            identity: identity!,
          },
        }
      : {}),
    ...(cli.provider === "openai" || cli.db || cli.workspace || cli.contextWindow !== undefined
      ? {
          assembly: {
            workspaceRoot: cli.workspace ?? process.cwd(),
            // I8 人格预设（T-P2-305）：--persona 选预设，系统提示首落时
            // 追加人格段；未知 id 在装配期类型化拒绝（启动即败）。
            ...(cli.persona !== undefined ? { personaId: cli.persona } : {}),
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
            // U22/T-P3-125：技能管理装配消费（settings skills 段——disabled
            // 停用名单 + roots 附加来源目录；缺省 undefined = 全启用单根，
            // 既有行为零变化）
            ...(settingsFile.skills?.disabled?.length
              ? { skillsDisabled: settingsFile.skills.disabled }
              : {}),
            ...(settingsFile.skills?.roots?.length
              ? { skillsRoots: settingsFile.skills.roots }
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
            // Q2/T-P2-105：持久库在位时注册会话查询工具（session_query/
            // session_get——无 --db 的 echo 路径无历史面）
            ...(cli.db ? { sessionQuery: { dbPath: cli.db } } : {}),
            // U5/T-P3-104：多注册表（J6 会话期换模——model/switch 在表内
            // 切换，新 turn 生效；initialIdentity = defaultProvider 条目）
            ...(registry !== undefined
              ? { models: registry.models, initialIdentity: registry.initial.identity }
              : {}),
            // U18/T-P3-120：判官独立模型（C42 judgeModel 槽——enhancement
            // judge 条目在位时构造；未配 = 无判官，ask 全部落人零行为变化）
            ...(judgeTarget !== undefined
              ? { judgeModel: { provider: judgeTarget.provider, identity: judgeTarget.identity } }
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
