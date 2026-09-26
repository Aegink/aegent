import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import type { AssertNever } from "../events.js";
import { TimeoutError } from "../timeout.js";
import type { ToolContext } from "./context.js";
import { NodeExecutionEnv } from "./env.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-env-"));
  tmpDirs.push(dir);
  return dir;
}

describe("NodeExecutionEnv（D4 实现层，真实 bash 执行）", () => {
  const env = new NodeExecutionEnv();

  it("exec 回显 stdout", async () => {
    const result = await env.exec("echo aegent-env-ok");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("aegent-env-ok\n");
  });

  it("非零退出码照实返回（shell 语义，不 reject），stderr 捕获", async () => {
    const result = await env.exec("echo before-err >&2; exit 3");
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("before-err");
  });

  it("空输出命令（true）→ stdout/stderr 均空（验收边界：空输出）", async () => {
    const result = await env.exec("true");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("cwd 选项生效", async () => {
    const cwd = tempDir();
    writeFileSync(path.join(cwd, "marker.txt"), "x", "utf8");
    const result = await env.exec("ls marker.txt", { cwd });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("marker.txt");
  });

  it("timeoutMs 超时 kill 并 reject TimeoutError（code=TOOL_TIMEOUT，J22 词汇）", async () => {
    await expect(env.exec("sleep 5", { timeoutMs: 200 })).rejects.toMatchObject({
      constructor: TimeoutError,
      code: "TOOL_TIMEOUT",
    });
  }, 10_000);

  it("spawn 失败（cwd 不存在）→ reject 带 errno code", async () => {
    await expect(
      env.exec("echo hi", { cwd: path.join(tempDir(), "no-such-dir") }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("ToolContext 类型面（D4 的编译期证明）", () => {
  it("键集合封闭：除 env/toolCallId/signal/reportProgress 外多出任何键即编译失败", () => {
    type AllowedKeys = "env" | "toolCallId" | "signal" | "reportProgress";
    // 若有人给 ToolContext 加 spawn/exec/proc 等裸进程 API 字段，
    // 下一行的 Exclude 不再收窄为 never，此文件编译失败——这是特性（C16 同款）。
    const _forbidden: AssertNever<Exclude<keyof ToolContext, AllowedKeys>> = true;
    void _forbidden;
    // 形状自证：键集合恰为清单本身
    expectTypeOf<keyof ToolContext>().toEqualTypeOf<AllowedKeys>();
  });

  it("env 类型是 ExecutionEnv 接口（不含任何 node 进程具体类型）", () => {
    expectTypeOf<NonNullable<ToolContext["env"]>>().toEqualTypeOf<
      import("./env.js").ExecutionEnv
    >();
  });
});
