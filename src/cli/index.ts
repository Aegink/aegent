#!/usr/bin/env node
/**
 * aegent CLI 入口（K1，T-8-01）——`node dist/src/cli/index.js [--smoke] [子进程参数]`。
 *
 * 本文件是壳：连接生产（spawnAgentProcess → dist/src/kernel/agent-child.js）、
 * 输入（stdin 行流：管道喂入 = --smoke 脚本化会话；TTY = 交互 REPL）、输出
 * （stdout）。逻辑在 repl.ts（runCli，测试经内存桥直连）。
 *
 * 子进程参数透传（见 agent-child.ts）：--provider echo|openai、--db <path>、
 * --workspace <dir>、--context-window <n>、--approval-timeout <ms>。
 */

import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnAgentProcess } from "../kernel/agent-process.js";
import { InvalidSessionIdError, createSessionId, isValidSessionId } from "../session/session-id.js";
import { createCredentialStore } from "../session/credentials.js";
import { loadSettings, resolveChildLaunchArgv } from "../session/settings.js";
import { runKeyCommand } from "./key.js";
import { runCli } from "./repl.js";

/** 编译产物旁的子进程入口（dist/src/cli/index.js → dist/src/kernel/agent-child.js）。 */
export function defaultChildEntryPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "kernel",
    "agent-child.js",
  );
}

export interface CliArgv {
  smoke: boolean;
  entryPath?: string;
  /** U1/T-P3-101：settings.json 显式路径（缺省 <home>/.aegent/settings.json）。 */
  settingsPath?: string;
  childArgs: string[];
}

export function parseCliArgv(argv: readonly string[]): CliArgv {
  const childArgs: string[] = [];
  let smoke = false;
  let entryPath: string | undefined;
  let settingsPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--smoke") smoke = true;
    else if (a === "--entry" && i + 1 < argv.length) entryPath = argv[++i];
    else if (a === "--settings" && i + 1 < argv.length) settingsPath = argv[++i];
    else childArgs.push(a);
  }
  return {
    smoke,
    ...(entryPath !== undefined ? { entryPath } : {}),
    ...(settingsPath !== undefined ? { settingsPath } : {}),
    childArgs,
  };
}

/**
 * N1/T-P1-110：会话 id 的规范生成点在 CLI 入口——childArgs 未显式带
 * --session 时生成 UUID 注入（此前缺省恒为 "s0"，跨端引用无唯一性保证）；
 * 显式指定的 id 过形状校验，非法抛 InvalidSessionIdError（启动即拒）。
 * 纯函数以便直测（main 的 spawn 面不可直测——同 agent-child 先例）。
 */
export function resolveChildSessionArgv(
  childArgs: readonly string[],
): { args: string[] } {
  const args = [...childArgs];
  const sessionIdx = args.indexOf("--session");
  if (sessionIdx >= 0) {
    const explicit = args[sessionIdx + 1];
    if (explicit === undefined || !isValidSessionId(explicit)) {
      throw new InvalidSessionIdError(explicit ?? "(缺失)");
    }
    return { args };
  }
  return { args: [...args, "--session", createSessionId()] };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const { smoke, entryPath, settingsPath, childArgs } = parseCliArgv(argv);
  // U2/T-P3-102：`aegent key` 是管理命令（无会话装配无 spawn）——最先分流。
  if (childArgs[0] === "key") {
    const code = await runKeyCommand(childArgs.slice(1), {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    });
    if (code !== 0) process.exitCode = 1;
    return;
  }
  // U1/T-P3-101：settings 装配（损坏 fail-closed——SettingsError 直达启动
  // 失败出口，错误消息自带行列号与修复指引）。三入口共用同一翻译面。
  const { settings } = await loadSettings(settingsPath);
  // U2：凭据装配——仅当 provider 槽完全空缺（文件档条目会被选中）时提前
  // decrypt defaultProvider 的凭据（DPAPI 是异步子进程面，同步注入点）。
  const providerFree =
    !childArgs.includes("--provider") &&
    (process.env["AEGENT_PROVIDER"] === undefined || process.env["AEGENT_PROVIDER"] === "");
  let credentialKey: string | undefined;
  if (providerFree && settings.defaultProvider !== undefined) {
    credentialKey = await createCredentialStore().getKey(settings.defaultProvider);
  }
  const { args: launchArgs } = resolveChildLaunchArgv(childArgs, process.env, settings, { credentialKey });
  // U5/T-P3-104：settings 路径透传子进程（多注册表装配面——子进程自读
  // 同一 settings.json/credentials.bin，单一事实源）。
  const { args } = resolveChildSessionArgv([
    ...launchArgs,
    ...(settingsPath !== undefined ? ["--settings", settingsPath] : []),
  ]);
  const connection = spawnAgentProcess({
    entryPath: entryPath ?? defaultChildEntryPath(),
    args,
  });
  if (!smoke) {
    process.stdout.write("aegent CLI（输入指令回车执行；/exit 退出）\n");
  }
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  await runCli({
    connection,
    input: rl,
    out: (line) => process.stdout.write(`${line}\n`),
  });
  await connection.kill();
}

// bin 入口：被直接执行时运行（import 时不运行）
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main().catch((e: unknown) => {
    process.stderr.write(`aegent CLI 启动失败：${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
