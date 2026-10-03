/**
 * host 进程 argv 解析（行数纪律拆分自 server.ts）——生产入口的旗表面：
 * host 自有旗（--session/--port/--ui/--host-db/--settings/--agent-entry）
 * 与透传子进程的 childArgs 分流（agent-child parseArgs 消费）。
 */

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
