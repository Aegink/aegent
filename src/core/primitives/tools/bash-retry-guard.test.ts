/**
 * bash 重试守卫测试（T-6-06 · D15）——注入超时的 bash 调用，重试层不发起
 * 第二次 spawn（计数断言）；错误信息含"命令已启动，不自动重试"（验收）。
 * 分界三态各有用例：已启动（成功/超时/非零/未知失败）标记、spawn 失败
 * （ENOENT）无标记可重试、无标记结果检查点放行。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolRegistry } from "./registry.js";
import type { ExecutionEnv } from "./env.js";
import type { ToolExecutionResult } from "../loop/loop.js";
import { TimeoutError } from "../../skeleton/timeout.js";
import {
  RETRY_REFUSED_MESSAGE,
  RETRY_REFUSED_STARTED,
  assertRetryAllowed,
  isSpawnFailure,
  markStarted,
} from "./bash-retry-guard.js";
import { createBashTool } from "../../../../plugins/tools-builtin/bash.js";
import { PathGuard } from "../../../sandbox/path-guard.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeBash(env: ExecutionEnv): { dispatch: (command: string) => Promise<ToolExecutionResult>; calls: string[] } {
  const calls: string[] = [];
  const realExec = env.exec.bind(env);
  const spyEnv = {
    exec: (cmd: string, opts?: { timeoutMs?: number }) => {
      calls.push(cmd);
      return realExec(cmd, opts);
    },
  } as unknown as ExecutionEnv;
  const workspace = mkdtempSync(path.join(tmpdir(), "aegent-d15-"));
  tmpDirs.push(workspace); // 只清自己的夹具目录
  const registry = new ToolRegistry({ env: spyEnv });
  registry.registerTool(createBashTool({ pathGuard: PathGuard.forWorkspace(workspace) }));
  const dispatch = async (command: string): Promise<ToolExecutionResult> =>
    registry.dispatch({ callId: "c1", name: "bash", arguments: JSON.stringify({ command }) });
  return { dispatch, calls };
}

/** 任何自动重试层的消费者形态：失败即过检查点，标记了就不再重发。 */
async function autoRetryLayer(
  dispatch: (command: string) => Promise<ToolExecutionResult>,
  command: string,
  maxAttempts: number,
): Promise<ToolExecutionResult> {
  let last: ToolExecutionResult;
  for (let attempt = 1; ; attempt++) {
    last = await dispatch(command);
    if (!last.isError || attempt >= maxAttempts) return last;
    assertRetryAllowed(last); // 见"已启动"标记即抛——不重发
  }
}

describe("D15 · 已启动标记（成功/失败一律）", () => {
  it("成功执行 → meta.started = true（成功结果同样不可自动重发）", async () => {
    const { dispatch } = makeBash({ exec: async () => ({ stdout: "ok", stderr: "", exitCode: 0 }) } as unknown as ExecutionEnv);
    const result = await dispatch("echo hi");
    expect(result.isError).toBeUndefined();
    expect(result.meta).toMatchObject({ started: true });
  });

  it("非零退出码 → started 标记与 exitCode 同在 meta", async () => {
    const { dispatch } = makeBash({ exec: async () => ({ stdout: "", stderr: "boom", exitCode: 7 }) } as unknown as ExecutionEnv);
    const result = await dispatch("exit 7");
    expect(result.isError).toBe(true);
    expect(result.meta).toMatchObject({ started: true, exitCode: 7 });
  });

  it("超时（TOOL_TIMEOUT）→ started 标记", async () => {
    const { dispatch } = makeBash({
      exec: async () => {
        throw new TimeoutError("TOOL_TIMEOUT", 1000);
      },
    } as unknown as ExecutionEnv);
    const result = await dispatch("sleep 5");
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("TOOL_TIMEOUT");
    expect(result.meta).toMatchObject({ started: true });
  });

  it("未知失败 → 保守标记 started（D15 fail-closed：判断不了就不重试）", async () => {
    const { dispatch } = makeBash({ exec: async () => { throw new Error("weird transport state"); } } as unknown as ExecutionEnv);
    const result = await dispatch("anything");
    expect(result.isError).toBe(true);
    expect(result.meta).toMatchObject({ started: true });
  });

  it("spawn 失败（ENOENT）→ 无标记（命令未启动，重试安全）", async () => {
    const enoent = Object.assign(new Error("spawn nonexistent ENOENT"), { code: "ENOENT" });
    const { dispatch } = makeBash({ exec: async () => { throw enoent; } } as unknown as ExecutionEnv);
    const result = await dispatch("nonexistent-binary");
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("ENOENT");
    expect(result.meta).toBeUndefined(); // 未启动：无标记（也无 exitCode）
    // 检查点放行：重试层可以再试（bounded backoff 是它的职责）
    expect(() => assertRetryAllowed(result)).not.toThrow();
  });
});

describe("D15 · 重试层检查点（验收：不发起第二次 spawn）", () => {
  it("超时的 bash 调用：重试层不发起第二次 spawn（计数断言）且拒绝信息含固定文案", async () => {
    let execCount = 0;
    const env = {
      exec: async () => {
        execCount += 1;
        throw new TimeoutError("TOOL_TIMEOUT", 1000);
      },
    } as unknown as ExecutionEnv;
    const { dispatch } = makeBash(env);
    const first = await dispatch("sleep 5");
    expect(first.isError).toBe(true);
    expect(first.error?.code).toBe("TOOL_TIMEOUT");
    expect(first.meta).toMatchObject({ started: true });

    // 重试层（maxAttempts=3）：首次尝试合法（须拿到结果才能检查），随后被
    // 检查点拦下——初始 1 次 + 重试层首次 1 次 = 2，绝无第 3 次 spawn
    await expect(autoRetryLayer(dispatch, "sleep 5", 3)).rejects.toThrowError(RETRY_REFUSED_MESSAGE);
    expect(execCount).toBe(2);

    expect(() => assertRetryAllowed(first)).toThrowError(/命令已启动，不自动重试/);
    try {
      assertRetryAllowed(first);
      throw new Error("unreachable");
    } catch (e) {
      expect((e as { code?: string }).code).toBe(RETRY_REFUSED_STARTED);
    }
  });

  it("spawn 失败的结果可被重试层重发直到成功（可重试路径对照）", async () => {
    let execCount = 0;
    const env = {
      exec: async () => {
        execCount += 1;
        if (execCount === 1) {
          throw Object.assign(new Error("transient resource"), { code: "EAGAIN" });
        }
        return { stdout: "recovered", stderr: "", exitCode: 0 };
      },
    } as unknown as ExecutionEnv;
    const { dispatch } = makeBash(env);
    const result = await autoRetryLayer(dispatch, "flaky-spawn", 3);
    expect(result.isError).toBeUndefined();
    expect(result.content).toBe("recovered");
    expect(execCount).toBe(2); // 未启动的失败被重发了一次
  });
});

describe("D15 · 原语", () => {
  it("markStarted 合并既有 meta 且防御非对象 meta；isSpawnFailure 只认清单码", () => {
    expect(markStarted({ content: "x", meta: { exitCode: 3 } }).meta).toEqual({ exitCode: 3, started: true });
    expect(markStarted({ content: "x" }).meta).toEqual({ started: true });
    expect(markStarted({ content: "x", meta: "junk" }).meta).toEqual({ started: true });
    expect(isSpawnFailure(Object.assign(new Error("x"), { code: "EMFILE" }))).toBe(true);
    expect(isSpawnFailure(new Error("no code"))).toBe(false);
    expect(isSpawnFailure(Object.assign(new Error("x"), { code: "EHOPE" }))).toBe(false);
  });
});
