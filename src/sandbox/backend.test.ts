import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLocalBackend,
  SANDBOX_UNAVAILABLE,
  SandboxUnavailableError,
  type SandboxBackend,
  type SandboxSpawnRequest,
} from "./backend.js";
import { NodeExecutionEnv, type ExecOptions, type ExecResult } from "../kernel/tools/env.js";

function makeFakeEnv(log: ExecOptions[], result?: Partial<ExecResult>) {
  return {
    exec: async (command: string, options?: ExecOptions): Promise<ExecResult> => {
      log.push(options ?? {});
      return { exitCode: 0, stdout: command, stderr: "", ...result };
    },
  };
}

describe("SandboxBackend 接口（D5：接口不写死）", () => {
  it("③假后端注入消费方多态可用（接口不被 local 实现绑死）", async () => {
    const scripted: SandboxBackend = {
      supportedModes: ["read-only", "workspace-write", "danger-full-access"],
      spawn: async (request: SandboxSpawnRequest) => ({
        exitCode: 7,
        stdout: `scripted:${request.mode}`,
        stderr: "",
      }),
    };
    const result = await scripted.spawn({ command: "echo hi", mode: "read-only" });
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toBe("scripted:read-only");
  });
});

describe("createLocalBackend", () => {
  let workspace = "";
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "aegent-d5-"));
  });
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("①danger-full-access 真命令跑通（exitCode/stdout 如实）", async () => {
    const backend = createLocalBackend({ env: new NodeExecutionEnv() });
    const result = await backend.spawn({ command: "echo d5-local", mode: "danger-full-access" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("d5-local");
  });

  it("①补：cwd 与非零退出如实透传", async () => {
    const backend = createLocalBackend({ env: new NodeExecutionEnv() });
    writeFileSync(join(workspace, "marker.txt"), "x");
    const ok = await backend.spawn({
      command: "cat marker.txt",
      mode: "danger-full-access",
      cwd: workspace,
    });
    expect(ok.stdout.trim()).toBe("x");
    const failed = await backend.spawn({ command: "exit 3", mode: "danger-full-access" });
    expect(failed.exitCode).toBe(3);
  });

  it("②受限 mode 请求报 SANDBOX_UNAVAILABLE 且零执行", async () => {
    const calls: ExecOptions[] = [];
    const backend = createLocalBackend({ env: makeFakeEnv(calls) as never });
    for (const mode of ["read-only", "workspace-write"] as const) {
      try {
        await backend.spawn({ command: "echo should-not-run", mode });
        expect.unreachable(`${mode} 应当被拒绝`);
      } catch (e) {
        expect(e).toBeInstanceOf(SandboxUnavailableError);
        const err = e as SandboxUnavailableError;
        expect(err.code).toBe(SANDBOX_UNAVAILABLE);
        expect(err.mode).toBe(mode);
        expect(err.message).toContain(mode);
        expect(err.message).toContain("未执行");
      }
    }
    expect(calls).toHaveLength(0);
  });

  it("④supportedModes 能力自述：local 只声明 danger-full-access", () => {
    const backend = createLocalBackend({ env: makeFakeEnv([]) as never });
    expect(backend.supportedModes).toEqual(["danger-full-access"]);
  });
});
