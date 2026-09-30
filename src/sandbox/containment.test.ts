import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createContainedBackend,
  createRoutingBackend,
  resolveSandboxHelperPath,
  CONTAINMENT_DEGRADED_PREFIX,
} from "./containment.js";
import { SANDBOX_UNAVAILABLE, type SandboxBackend } from "./backend.js";
import { Win32SandboxBackend } from "./win32-backend.js";
import { NodeExecutionEnv } from "../kernel/tools/env.js";

const helperPath = fileURLToPath(new URL(`../../${"src/sandbox/win32-helper/target/release/win32-sandbox-helper.exe"}`, import.meta.url));
const helperReady = existsSync(helperPath);
const MISSING = "src/sandbox/win32-helper/target/release/不存在.exe";

describe("createContainedBackend（D14：不可靠兜底显式告警）", () => {
  it("①helper 在场 → 强管辖后端零告警", () => {
    if (!helperReady) return; // 真机前提：helper 已构建
    const warns: string[] = [];
    const backend = createContainedBackend({
      helperPath,
      workspace: process.cwd(),
      localEnv: new NodeExecutionEnv(),
      logger: { warn: (m) => warns.push(m) },
    });
    expect(backend).toBeInstanceOf(Win32SandboxBackend);
    expect(warns).toHaveLength(0);
  });

  it("②helper 缺席 → warn 恰一次（文案含降级前缀与不承诺管住）+ 弱兜底", async () => {
    const warns: string[] = [];
    const backend = createContainedBackend({
      helperPath: MISSING,
      workspace: process.cwd(),
      localEnv: new NodeExecutionEnv(),
      logger: { warn: (m) => warns.push(m) },
    });
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(CONTAINMENT_DEGRADED_PREFIX);
    expect(warns[0]).toContain("不被承诺管住");
    // 弱兜底连受限模式都无法强制——"不假装已管住"的机制面。
    await expect(
      backend.spawn({ command: "echo hi", mode: "workspace-write" }),
    ).rejects.toMatchObject({ code: SANDBOX_UNAVAILABLE });
  });

  it("③每个 provider 生命周期告警一次：两个降级 provider 各自告警（非全局一次）", () => {
    const logger = { warns: [] as string[] };
    createContainedBackend({
      helperPath: MISSING,
      workspace: process.cwd(),
      localEnv: new NodeExecutionEnv(),
      logger: { warn: (m) => logger.warns.push(m) },
    });
    createContainedBackend({
      helperPath: MISSING,
      workspace: process.cwd(),
      localEnv: new NodeExecutionEnv(),
      logger: { warn: (m) => logger.warns.push(m) },
    });
    expect(logger.warns).toHaveLength(2);
  });

  it("④无 logger 注入时降级不抛（告警是 best-effort，兜底仍然成立）", () => {
    const backend = createContainedBackend({
      helperPath: MISSING,
      workspace: process.cwd(),
      localEnv: new NodeExecutionEnv(),
    });
    expect(backend).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createRoutingBackend（T-P3-140 批次 A——按 mode 路由的复合后端）
// ---------------------------------------------------------------------------

describe("createRoutingBackend（按 mode 路由：全自动恒直通、受限档走强制面）", () => {
  /** 假受限后端：记录请求并回显 mode（证明路由命中）。 */
  function fakeRestricted() {
    const seen: string[] = [];
    const backend: SandboxBackend = {
      supportedModes: ["read-only", "workspace-write"],
      async spawn(request) {
        seen.push(request.mode);
        return { exitCode: 0, stdout: `restricted:${request.mode}`, stderr: "" };
      },
    };
    return { seen, backend };
  }

  it("①全自动档恒 local 直通——受限后端不被触碰", async () => {
    const { seen, backend: restricted } = fakeRestricted();
    const backend = createRoutingBackend({ restricted, localEnv: new NodeExecutionEnv() });
    expect(backend.supportedModes).toContain("danger-full-access");
    const result = await backend.spawn({ command: "echo hi", mode: "danger-full-access" });
    expect(result.exitCode).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it("②受限档路由到 restricted 后端（read-only / workspace-write 各一次）", async () => {
    const { seen, backend: restricted } = fakeRestricted();
    const backend = createRoutingBackend({ restricted, localEnv: new NodeExecutionEnv() });
    const ro = await backend.spawn({ command: "x", mode: "read-only" });
    const ww = await backend.spawn({ command: "y", mode: "workspace-write" });
    expect(seen).toEqual(["read-only", "workspace-write"]);
    expect(ro.stdout).toBe("restricted:read-only");
    expect(ww.stdout).toBe("restricted:workspace-write");
  });

  it("③restricted 缺席 → warn 恰一次 + 受限档 fail-closed（SANDBOX_UNAVAILABLE）+ 全自动不受影响", async () => {
    const warns: string[] = [];
    const backend = createRoutingBackend({
      localEnv: new NodeExecutionEnv(),
      logger: { warn: (m) => warns.push(m) },
    });
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(CONTAINMENT_DEGRADED_PREFIX);
    await expect(
      backend.spawn({ command: "echo hi", mode: "workspace-write" }),
    ).rejects.toMatchObject({ code: SANDBOX_UNAVAILABLE });
    const result = await backend.spawn({ command: "echo hi", mode: "danger-full-access" });
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveSandboxHelperPath（三段式：env 显式 → 发行包伴随位 → 仓库约定位）
// ---------------------------------------------------------------------------

describe("resolveSandboxHelperPath（显式 env 优先；缺席回约定位）", () => {
  const ENV_KEY = "AEGENT_SANDBOX_HELPER";

  it("①env 指向存在的文件 → 恒用它（测试/替代实现注入面）", () => {
    const existing = process.execPath; // 恒存在的文件
    process.env[ENV_KEY] = existing;
    try {
      expect(resolveSandboxHelperPath()).toBe(existing);
    } finally {
      delete process.env[ENV_KEY];
    }
  });

  it("②env 指向不存在的文件 → 跳过（回退链继续）", () => {
    const missing = process.platform === "win32" ? "Z:\\__no_such__\\helper.exe" : "/__no_such__/helper";
    process.env[ENV_KEY] = missing;
    try {
      expect(resolveSandboxHelperPath()).not.toBe(missing);
    } finally {
      delete process.env[ENV_KEY];
    }
  });
});
