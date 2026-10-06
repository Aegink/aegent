/**
 * host 进程 argv 解析（行数纪律拆分自 server.ts）——生产入口的旗表面：
 * host 自有旗（--session/--port/--ui/--host-db/--settings/--agent-entry）
 * 与透传子进程的 childArgs 分流（agent-child parseArgs 消费）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createSessionId, isValidSessionId } from "../session/session-id.js";

export interface HostServerArgv {
  sessionId: string;
  port: number;
  uiDir: string;
  hostDbPath?: string;
  /** U1/T-P3-101：settings.json 显式路径（缺省 <home>/.aegent/settings.json）。 */
  settingsPath?: string;
  /** U6/T-P3-113：子进程入口覆盖（便携/壳布局——bundle 相邻 agent-child.cjs）。 */
  agentEntryPath?: string;
  childArgs: string[];
}

export function parseHostServerArgv(
  argv: readonly string[],
  defaults: { uiDir: string },
): HostServerArgv {
  let sessionId = createSessionId();
  let port = 8787;
  let uiDir = defaults.uiDir;
  let hostDbPath: string | undefined;
  let settingsPath: string | undefined;
  // U6/T-P3-113：便携/壳布局的子进程入口覆盖（bundle 里 dist 树不在位——
  // agent-child 打包成相邻 agent-child.cjs，由壳/便携运行器显式传入）。
  let agentEntryPath: string | undefined;
  const childArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--session" && i + 1 < argv.length) {
      sessionId = argv[++i] ?? sessionId;
    } else if (a === "--port" && i + 1 < argv.length) {
      port = Number(argv[++i]);
    } else if (a === "--ui" && i + 1 < argv.length) {
      uiDir = argv[++i] ?? uiDir;
    } else if (a === "--host-db" && i + 1 < argv.length) {
      hostDbPath = argv[++i];
    } else if (a === "--settings" && i + 1 < argv.length) {
      settingsPath = argv[++i];
    } else if (a === "--agent-entry" && i + 1 < argv.length) {
      agentEntryPath = argv[++i];
    } else {
      childArgs.push(a);
    }
  }
  if (!isValidSessionId(sessionId)) {
    throw new Error(`--session 不合法：${sessionId}`);
  }
  return {
    sessionId,
    port,
    uiDir,
    ...(hostDbPath !== undefined ? { hostDbPath } : {}),
    ...(settingsPath !== undefined ? { settingsPath } : {}),
    ...(agentEntryPath !== undefined ? { agentEntryPath } : {}),
    childArgs,
  };
}

/** U12/T-P3-111 上下文窗口解析（自 server.ts 搬入——行数纪律位）：
 * launchArgs 里的 --context-window > 200_000 缺省（与子进程同源）。 */
export function resolveContextWindow(launchArgs: readonly string[]): number {
  const i = launchArgs.indexOf("--context-window");
  return i >= 0 && i + 1 < launchArgs.length ? Number(launchArgs[i + 1]) || 200_000 : 200_000;
}

/** 仓库根的 ui/ 缺省位（自 server.ts 搬入——行数纪律位；dist/src/host 上溯
 * 三级，与本文件同目录故 import.meta.url 定位不变）。 */
export function defaultUiDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // 便携 bundle 运行（host.cjs 旁的 ui/——build-host-bundle 布局）优先；
  // 源码/dist 运行 = dist/src/host 上跳三级到仓库根 ui。裸 host.cjs 是
  // 合法运行形态（无壳 --ui 旗标时的静态面——批次 6 走查实抓 404）。
  const portableUi = path.resolve(here, "ui");
  if (fs.existsSync(portableUi)) return portableUi;
  return path.resolve(here, "..", "..", "..", "ui");
}

/** 仓库根的 agent-child 编译产物位（dist/src/host 旁：../kernel）。 */
export function defaultAgentChildEntry(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "kernel",
    "agent-child.js",
  );
}

/** workspace 根解析（自 server.ts main 下沉）：launchArgs 的 --workspace >
 * 进程 cwd（子进程缺省语义同款）。 */
export function resolveWorkspaceRoot(launchArgs: readonly string[]): string {
  const i = launchArgs.indexOf("--workspace");
  return i >= 0 && i + 1 < launchArgs.length ? (launchArgs[i + 1] as string) : process.cwd();
}

/** host 进程用法文本（--help 面——main 消费）。 */
export const HOST_HELP_TEXT = [
  "aegent host —— 端间协议传输落点（WS over TCP）",
  "用法：host.cjs [--port <n>] [--session <id>] [--ui <dir>] [--host-db <path>]",
  "       [--workspace <dir>] [--settings <path>] [--agent-entry <path>]",
  "       [--context-window <n>] （其余旗标透传 agent 子进程）",
].join("\n") + "\n";

/**
 * host 生产装配段（自 server.ts main 下沉：行数纪律拆分）——settings/
 * 凭据/launchArgs/事件库/workspace 根/设置网关的一次性构建（U1/U2/T-P3-172
 * 语义原样搬运）。
 */
export async function resolveHostProductionDeps(parsed: HostServerArgv): Promise<{
  credentials: import("../session/credentials.js").CredentialStore;
  sqliteStorage?: import("../session/db.js").SqliteEventStorage;
  workspaceRoot: string;
  settingsGateway: import("./settings-gateway.js").FileSettingsGateway;
  childArgs: string[];
}& { settings: import("../session/settings.js").SettingsShape } > {
  const { createCredentialStore } = await import("../session/credentials.js");
  const { loadSettings, resolveChildLaunchArgv, defaultSettingsPath } = await import("../session/settings.js");
  const { SqliteEventStorage } = await import("../session/db.js");
  const { FileSettingsGateway } = await import("./settings-gateway.js");
  const { InMemoryEventStorage } = await import("../session/store.js");
  const credentials = createCredentialStore(process.env["AEGENT_CREDENTIALS"] || undefined);
  const { settings } = await loadSettings(parsed.settingsPath);
  const providerFree =
    !parsed.childArgs.includes("--provider") &&
    (process.env["AEGENT_PROVIDER"] === undefined || process.env["AEGENT_PROVIDER"] === "");
  let credentialKey: string | undefined;
  if (providerFree && settings.defaultProvider !== undefined) {
    credentialKey = await credentials.getKey(settings.defaultProvider);
  }
  const { args: launchArgs } = resolveChildLaunchArgv(parsed.childArgs, process.env, settings, { credentialKey });
  const sqliteStorage =
    parsed.hostDbPath !== undefined ? SqliteEventStorage.open({ path: parsed.hostDbPath }) : undefined;
  const workspaceRoot = resolveWorkspaceRoot(launchArgs);
  const settingsGateway = new FileSettingsGateway(
    parsed.settingsPath ?? defaultSettingsPath(),
    credentials,
    undefined,
    sqliteStorage,
    workspaceRoot,
  );
  return {
    settings,
    credentials,
    ...(sqliteStorage !== undefined ? { sqliteStorage } : {}),
    workspaceRoot,
    settingsGateway,
    childArgs: [...launchArgs, ...(parsed.settingsPath !== undefined ? ["--settings", parsed.settingsPath] : [])],
  };
}
