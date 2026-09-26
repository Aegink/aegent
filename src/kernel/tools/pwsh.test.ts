import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnv } from "./env.js";
import { createPwshTool } from "./builtin/pwsh.js";
import { PathGuard } from "../../sandbox/path-guard.js";
import { isWriteExecuteTool } from "../../policy/protected-paths.js";
import { BUILTIN_TOOL_NAMES } from "./builtin/index.js";
import { ToolRegistry } from "./registry.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const toSlash = (p: string): string => p.split("\\").join("/");

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-d11-"));
  tmpDirs.push(dir);
  return dir;
}

describe("NodeExecutionEnv pwsh 通道（D11 执行器两态）", () => {
  it("①pwsh 真命令跑通（Write-Output 回显）", async () => {
    const env = new NodeExecutionEnv({ shell: "pwsh" });
    const result = await env.exec("Write-Output d11-pwsh-ok");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("d11-pwsh-ok");
  });

  it("②bash 缺省零行为变化（不指定 shell 时语义与 P0 一致）", async () => {
    const env = new NodeExecutionEnv();
    const result = await env.exec("echo d11-bash-default");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("d11-bash-default\n");
  });

  it("②补：显式 shell=bash 同样走 bash 通道", async () => {
    const env = new NodeExecutionEnv({ shell: "bash" });
    const result = await env.exec("echo explicit-bash");
    expect(result.stdout).toBe("explicit-bash\n");
  });

  it("①补：cwd 透传（pwsh 通道）", async () => {
    const dir = tempDir();
    const env = new NodeExecutionEnv({ shell: "pwsh" });
    const result = await env.exec("Write-Output $PWD.Path", { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().toLowerCase()).toBe(dir.toLowerCase());
  });
});

describe("pwsh 工具（D11 模型面）", () => {
  it("①真命令经 registry.dispatch 跑通 + started 标记（D15 复用）", async () => {
    const registry = new ToolRegistry({ env: new NodeExecutionEnv({ shell: "pwsh" }) });
    registry.registerTool(createPwshTool({ pathGuard: PathGuard.forWorkspace(process.cwd()) }));
    const result = await registry.dispatch({
      callId: "c-d11-1",
      name: "pwsh",
      arguments: JSON.stringify({ command: "Write-Output tool-ok" }),
    });
    expect(result.content).toContain("tool-ok");
    expect((result.meta as Record<string, unknown>).started).toBe(true);
  });

  it("③sandbox 态经 SandboxBackend（强管辖区分面；此处用假后端验证多态）", async () => {
    // pwsh 的 sandbox 两态由装配决定 env 实现（Win32SandboxBackend 的
    // 缺省宿主即 powershell——win32-backend.test 真机验证）；本用例钉
    // 工具面只依赖 ExecutionEnv 抽象（D4：不绑死具体实现）。
    const scripted = {
      exec: async (command: string) => ({
        exitCode: 0,
        stdout: `sandboxed:${command}`,
        stderr: "",
      }),
    };
    const registry = new ToolRegistry({ env: scripted as never });
    registry.registerTool(createPwshTool({ pathGuard: PathGuard.forWorkspace(process.cwd()) }));
    const result = await registry.dispatch({
      callId: "c-d11-2",
      name: "pwsh",
      arguments: JSON.stringify({ command: "Write-Output pwsh" }),
    });
    expect(result.content).toContain("sandboxed:Write-Output pwsh");
  });

  it("④出口级硬拦联动：重定向写 workspace 外被拒（与 bash 同款守卫面）", async () => {
    const outside = tempDir();
    const guard = PathGuard.forWorkspace(tempDir());
    const registry = new ToolRegistry({ env: new NodeExecutionEnv({ shell: "pwsh" }) });
    registry.registerTool(createPwshTool({ pathGuard: guard }));
    // 正斜杠绝对路径（反斜杠会触发 bash 转义符保守提示——LIMITATIONS 语义）。
    const result = await registry.dispatch({
      callId: "c-d11-3",
      name: "pwsh",
      arguments: JSON.stringify({ command: `Write-Output x > ${toSlash(outside)}/bad.txt` }),
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("越界写入被拒绝");
    expect(existsSync(join(outside, "bad.txt"))).toBe(false);
  });

  it("④补：plan 硬关清单含 pwsh（WRITE_EXECUTE_TOOLS 联动）", () => {
    expect(isWriteExecuteTool("pwsh")).toBe(true);
    expect(BUILTIN_TOOL_NAMES).toContain("pwsh");
  });

  it("bash 语义分析器不对 pwsh 命令运行其方言特有判定（重定向字面解析跨方言有效）", async () => {
    // 重定向到 workspace 内 = 放行（字面解析跨 shell 同形状），证明
    // pwsh 走的是重定向守卫而非 bash 危险模式裁决。
    const workspace = tempDir();
    const guard = PathGuard.forWorkspace(workspace);
    const registry = new ToolRegistry({ env: new NodeExecutionEnv({ shell: "pwsh" }) });
    registry.registerTool(createPwshTool({ pathGuard: guard }));
    // 正斜杠绝对路径（相对路径按进程 cwd 解析——PathGuard 既有语义）。
    const result = await registry.dispatch({
      callId: "c-d11-4",
      name: "pwsh",
      arguments: JSON.stringify({
        command: `Write-Output d11 > ${toSlash(workspace)}/inside.txt`,
      }),
    });
    expect(result.isError).toBeUndefined();
    expect(existsSync(join(workspace, "inside.txt"))).toBe(true);
  });
});
