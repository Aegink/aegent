import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatDoctorReport, runDoctorChecks } from "./doctor.js";
import { DEFAULT_HELPER_PATH } from "./win32-backend.js";

const helperPath = fileURLToPath(new URL(`../../${DEFAULT_HELPER_PATH}`, import.meta.url));
const helperReady = existsSync(helperPath);

const MISSING = "src/sandbox/win32-helper/target/release/不存在.exe";

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) {
    const dir = cleanup.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-d7-"));
  cleanup.push(dir);
  return dir;
}

describe("runDoctorChecks（D7：可独立运行 + 注入面）", () => {
  it("①真机独立运行：报告四行且 status 判定与 helper 在场性一致", async () => {
    const report = await runDoctorChecks({ helperPath, workspace: tempWorkspace() });
    expect(report.checks.map((c) => c.id)).toEqual([
      "sandbox-helper",
      "containment-fallback",
      "network-policy",
      "network-isolation",
    ]);
    if (helperReady) {
      expect(report.checks[0]!.status).toBe("ok");
      expect(report.checks[1]!.status).toBe("ok");
    } else {
      expect(report.checks[0]!.status).toBe("error");
    }
    // D3 行始终 ok（配置值如实陈述，未配置不是错误）。
    expect(report.checks[2]!.status).toBe("ok");
    expect(report.checks[2]!.details[0]).toContain("未配置");
  });

  it("②helper 缺席构造态 → sandbox 行 error 且 remediation 指向 build:sandbox-helper", async () => {
    const report = await runDoctorChecks({ helperPath: MISSING, workspace: tempWorkspace() });
    const helperCheck = report.checks.find((c) => c.id === "sandbox-helper")!;
    expect(helperCheck.status).toBe("error");
    expect(helperCheck.remediation).toContain("build:sandbox-helper");
    expect(report.errors).toBe(1);
  });

  it("③未 provision → 网络隔离行 warn + 弱承诺文案 + remediation（不假装已管住）", async () => {
    const report = await runDoctorChecks({
      helperPath: MISSING,
      workspace: tempWorkspace(),
      probeProvisioned: () => Promise.resolve(false),
      networkPolicy: "deny",
    });
    const netCheck = report.checks.find((c) => c.id === "network-isolation")!;
    expect(netCheck.status).toBe("warn");
    expect(netCheck.details[0]).toContain("不承诺管住");
    expect(netCheck.remediation).toContain("sandbox:provision");
    // D3 现值如实报告。
    expect(report.checks.find((c) => c.id === "network-policy")!.details[0]).toContain("deny");
    expect(report.warnings).toBe(2); // containment 降级 + 网络隔离未 provision
  });

  it("③补：已 provision → 网络隔离行 ok（无弱承诺文案）", async () => {
    const report = await runDoctorChecks({
      helperPath: MISSING,
      workspace: tempWorkspace(),
      probeProvisioned: () => Promise.resolve(true),
    });
    const netCheck = report.checks.find((c) => c.id === "network-isolation")!;
    expect(netCheck.status).toBe("ok");
    expect(netCheck.remediation).toBeUndefined();
  });

  it("③补：probe 不可得 → warn 且陈述未知（不假装已管住）", async () => {
    const report = await runDoctorChecks({
      helperPath: MISSING,
      workspace: tempWorkspace(),
      probeProvisioned: () => Promise.resolve(null),
    });
    const netCheck = report.checks.find((c) => c.id === "network-isolation")!;
    expect(netCheck.status).toBe("warn");
    expect(netCheck.details[0]).toContain("未知");
  });

  it("④纯函数组装：probe 抛异常等价于不可得（判定面无 I/O）", async () => {
    const report = await runDoctorChecks({
      helperPath: MISSING,
      workspace: tempWorkspace(),
      probeProvisioned: () => Promise.reject(new Error("boom")),
    });
    expect(report.checks.find((c) => c.id === "network-isolation")!.status).toBe("warn");
  });
});

describe("formatDoctorReport（CLI 输出面）", () => {
  it("逐行渲染 status 标记与修复提示，汇总行含计数", async () => {
    const report = await runDoctorChecks({
      helperPath: MISSING,
      workspace: tempWorkspace(),
      probeProvisioned: () => Promise.resolve(false),
    });
    const text = formatDoctorReport(report);
    expect(text).toContain("[error]");
    expect(text).toContain("[warn]");
    expect(text).toContain("↳ 修复：");
    expect(text).toContain("1 error / 2 warning");
  });
});
