/**
 * ACP agent 进程的 stdio 传输（C4 生产装配面——自 subagent-backend.ts 拆出
 * ：行数纪律）。argv 数组不经 shell（无注入面）；stderr 有界收集（4KB
 * ——spawn 失败/崩溃的信息来源）；windowsHide 不闪 console 窗（壳
 * CREATE_NO_WINDOW 同款语义）。进程生命周期随 transport.close()
 * （createAcpBackend 每次 spawn 后收摊——一次派发一个 agent 进程，进程
 * 模型与 in-process fork 对齐）。
 */

import { spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "node:readline";

import type { AcpBackendTransport } from "./subagent-backend.js";

/**
 * 真实 ACP agent 进程的 stdio 传输（C4 生产装配面）：argv 数组不经 shell
 * （无注入面）；stderr 有界收集（4KB——spawn 失败/崩溃的信息来源）；
 * windowsHide 不闪 console 窗（壳 CREATE_NO_WINDOW 同款语义）。
 * 进程生命周期随 transport.close()（createAcpBackend 每次 spawn 后收摊——
 * 一次派发一个 agent 进程，进程模型与 in-process fork 对齐）。
 */
export function spawnAcpTransport(
  command: readonly string[],
  options?: { cwd?: string },
): AcpBackendTransport {
  const [exe, ...args] = command;
  const child = nodeSpawn(exe!, args, {
    stdio: ["pipe", "pipe", "pipe"],
    ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
    windowsHide: true,
  });
  // 入站行流：readline 逐行推入队列，iterator 在队列空且流关时收束
  const buffered: string[] = [];
  let wake: () => void = () => {};
  let closed = false;
  let spawnError: string | undefined;
  child.on("error", (e) => {
    spawnError = e.message;
    closed = true;
    wake();
  });
  let stderrTail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-4096);
  });
  createInterface({ input: child.stdout!, crlfDelay: Infinity }).on("line", (line: string) => {
    buffered.push(line);
    wake();
  });
  child.stdout!.on("close", () => {
    closed = true;
    wake();
  });

  const spawnErrorMessage = (): string | undefined =>
    spawnError !== undefined
      ? spawnError
      : stderrTail.trim() !== ""
        ? stderrTail.trim().split("\n").slice(-3).join("\n")
        : undefined;

  return {
    write: (line) => {
      if (closed) throw new Error(`ACP agent 进程已退出${spawnErrorMessage() !== undefined ? `：${spawnErrorMessage()}` : ""}`);
      child.stdin!.write(`${line}\n`);
    },
    lines: {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<string>> => {
          for (;;) {
            const line = buffered.shift();
            if (line !== undefined) return { done: false, value: line };
            if (closed) throw new Error(`ACP agent 进程流已关闭${spawnErrorMessage() !== undefined ? `：${spawnErrorMessage()}` : ""}`);
            await new Promise<void>((resolve) => (wake = resolve));
          }
        },
      }),
    },
    close: () => {
      try {
        child.stdin?.end();
      } catch {
        /* 收摊尽力而为 */
      }
      try {
        child.kill();
      } catch {
        /* 已退出 */
      }
    },
  };
}
