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

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const { smoke, entryPath, childArgs } = parseCliArgv(argv);
  const connection = spawnAgentProcess({
    entryPath: entryPath ?? defaultChildEntryPath(),
    args: childArgs,
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
