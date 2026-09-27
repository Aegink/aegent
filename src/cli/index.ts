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
  childArgs: string[];
}

export function parseCliArgv(argv: readonly string[]): CliArgv {
  const childArgs: string[] = [];
  let smoke = false;
  let entryPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--smoke") smoke = true;
    else if (a === "--entry" && i + 1 < argv.length) entryPath = argv[++i];
    else childArgs.push(a);
  }
  return { smoke, ...(entryPath !== undefined ? { entryPath } : {}), childArgs };
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
  const { smoke, entryPath, childArgs } = parseCliArgv(argv);
  const { args } = resolveChildSessionArgv(childArgs);
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
