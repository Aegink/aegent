import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createContainedBackend, CONTAINMENT_DEGRADED_PREFIX } from "./containment.js";
import { SANDBOX_UNAVAILABLE } from "./backend.js";
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
