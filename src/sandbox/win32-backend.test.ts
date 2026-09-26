import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_HELPER_PATH,
  Win32SandboxBackend,
} from "./win32-backend.js";
import {
  SANDBOX_UNAVAILABLE,
  SandboxUnavailableError,
} from "./backend.js";
import { TimeoutError } from "../kernel/timeout.js";

/** 真机集成前提：helper 已构建（npm run build:sandbox-helper）。 */
const helperPath = fileURLToPath(new URL(`../../${DEFAULT_HELPER_PATH}`, import.meta.url));
const helperReady = existsSync(helperPath);

describe("Win32SandboxBackend（fail-closed 面，无 helper 依赖）", () => {
  it("②helper 缺席 → SANDBOX_UNAVAILABLE（命令零执行，不降级不受限）", async () => {
    const backend = new Win32SandboxBackend({
      helperPath: "src/sandbox/win32-helper/target/release/不存在.exe",
      workspace: process.cwd(),
    });
    expect(backend.isHelperAvailable()).toBe(false);
    await expect(
      backend.spawn({ command: "echo hi", mode: "workspace-write" }),
    ).rejects.toMatchObject({ code: SANDBOX_UNAVAILABLE });
  });

  it("danger-full-access 不是本后端的强制面（能力按 mode 判定）", async () => {
    const backend = new Win32SandboxBackend({
      helperPath,
      workspace: process.cwd(),
    });
    await expect(
      backend.spawn({ command: "echo hi", mode: "danger-full-access" }),
    ).rejects.toMatchObject({ code: SANDBOX_UNAVAILABLE });
  });
});

describe.skipIf(!helperReady)("Win32SandboxBackend 真机集成（受限令牌 + ACL）", () => {
  let workspace = "";
  let outside = "";
  let privateTemp = "";

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "aegent-d6-ws-"));
    outside = mkdtempSync(join(tmpdir(), "aegent-d6-out-"));
    privateTemp = mkdtempSync(join(tmpdir(), "aegent-d6-tmp-"));
  });
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    rmSync(privateTemp, { recursive: true, force: true });
  });

  const makeBackend = () =>
    new Win32SandboxBackend({
      helperPath,
      workspace,
      tempDir: privateTemp,
    });

  it("①③workspace-write：写 workspace 内成功、写 workspace 外被拒", async () => {
    const backend = makeBackend();
    const inside = await backend.spawn({
      command: `Set-Content -Path inside.txt -Value d6-ok`,
      mode: "workspace-write",
    });
    expect(inside.exitCode).toBe(0);
    expect(existsSync(join(workspace, "inside.txt"))).toBe(true);

    const outsidePath = join(outside, "bad.txt").replace(/\\/g, "\\\\");
    const denied = await backend.spawn({
      command: `Set-Content -Path ${outsidePath} -Value nope`,
      mode: "workspace-write",
    });
    expect(denied.exitCode).not.toBe(0);
    expect(existsSync(join(outside, "bad.txt"))).toBe(false);
  });

  it("③read-only：写 workspace 内也被拒（零 grant）", async () => {
    const backend = makeBackend();
    const denied = await backend.spawn({
      command: "Set-Content -Path ro.txt -Value nope",
      mode: "read-only",
    });
    expect(denied.exitCode).not.toBe(0);
    expect(existsSync(join(workspace, "ro.txt"))).toBe(false);
  });

  it("③read-only：读 workspace 内不受限（WRITE_RESTRICTED 只限写）", async () => {
    writeFileSync(join(workspace, "known.txt"), "d6-readable");
    const backend = makeBackend();
    const ok = await backend.spawn({
      command: "Get-Content known.txt",
      mode: "read-only",
    });
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain("d6-readable");
  });

  it("④幂等：同 workspace 连续两次 spawn（standing grant exact-ACE skip）", async () => {
    const backend = makeBackend();
    const first = await backend.spawn({ command: "echo first", mode: "workspace-write" });
    const second = await backend.spawn({ command: "echo second", mode: "workspace-write" });
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
  });

  it("超时 → TimeoutError（TOOL_TIMEOUT 词汇透传）", async () => {
    const backend = makeBackend();
    await expect(
      backend.spawn({
        command: "Start-Sleep -Seconds 30",
        mode: "read-only",
        timeoutMs: 1500,
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it("⑤D13：后代活过宿主仍被 Job 持有——结算等到范围空（后代睡 3s，宿主立即退）", async () => {
    const backend = makeBackend();
    const started = Date.now();
    const result = await backend.spawn({
      // 宿主立即退出，派生的后代独立睡 3s（重挂父进程/活过宿主场景）。
      command: `Start-Process powershell -ArgumentList '-Command','Start-Sleep 3' -WindowStyle Hidden; Write-Output host-exit`,
      mode: "read-only",
    });
    const elapsed = Date.now() - started;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("host-exit");
    // 结算发生在后代跑完之后（Job 持有活过宿主的后代，范围空才算完）。
    expect(elapsed).toBeGreaterThanOrEqual(2800);
  }, 20_000);

  it("⑤D13：超时全树回收——宿主与后代均被 TerminateJobObject（不等后代 30s）", async () => {
    const backend = makeBackend();
    const started = Date.now();
    await expect(
      backend.spawn({
        command: `Start-Process powershell -ArgumentList '-Command','Start-Sleep 30' -WindowStyle Hidden; Start-Sleep 30`,
        mode: "read-only",
        timeoutMs: 2500,
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
    const elapsed = Date.now() - started;
    // 全树回收即时生效（~2.5s），绝不等 30s 的后代自然跑完。
    expect(elapsed).toBeLessThan(15_000);
  }, 20_000);
});
