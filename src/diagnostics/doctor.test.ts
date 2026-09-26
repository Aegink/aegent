import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { doctorReportToJson, runRuntimeDoctorChecks, type RuntimeDoctorDeps } from "./doctor.js";
import { formatDoctorReport } from "../sandbox/doctor.js";
import { SqliteEventStorage } from "../session/db.js";

function deps(overrides: Partial<RuntimeDoctorDeps> = {}): RuntimeDoctorDeps {
  return {
    nodeVersion: "v22.0.0",
    platform: "win32",
    cwd: "F:\\aegent",
    workspaceRoot: "F:\\aegent",
    modelIdentities: [{ provider: "openai", modelId: "gpt-test" }],
    networkPolicy: "unconfigured",
    builtinToolNames: ["bash", "read"],
    ...overrides,
  };
}

describe("运行时诊断报告（O18，T-P1-35）", () => {
  it("四行报告结构完整：环境 ok / 配置 ok / 存储 warn（未配置 db）", () => {
    const report = runRuntimeDoctorChecks(deps());
    expect(report.checks.map((c) => c.id)).toEqual([
      "runtime-environment",
      "runtime-workspace",
      "runtime-config",
      "runtime-storage",
    ]);
    expect(report.checks[0]!.status).toBe("ok");
    expect(report.checks[0]!.details.join(" ")).toContain("node v22.0.0");
    expect(report.checks[2]!.status).toBe("ok");
    expect(report.checks[2]!.details.join(" ")).toContain("openai/gpt-test");
    // db 未配置 → warn + remediation（不是 error——诊断非前置条件）
    expect(report.checks[3]!.status).toBe("warn");
    expect(report.checks[3]!.remediation).toContain("--db");
    expect(report.errors).toBe(0);
  });

  it("workspace 缺失 → warn（不是 error）；模型注册表空 → 配置行 warn", () => {
    const report = runRuntimeDoctorChecks(
      deps({ workspaceRoot: "F:\\不存在的目录", modelIdentities: [] }),
    );
    expect(report.checks[1]!.status).toBe("warn");
    expect(report.checks[2]!.status).toBe("warn");
    expect(report.errors).toBe(0);
  });

  it("库目录不可写 → error（会话无法落盘）；库文件损坏 → error + 可读详情", () => {
    const root = mkdtempSync(join(tmpdir(), "aegent-doctor-"));
    try {
      // 只读目录：造一个"目录"形状的文件顶替，accessSync W_OK 失败
      const blockedDb = join(root, "blocked", "events.db");
      mkdirSync(join(root, "blocked"), { recursive: true });
      writeFileSync(blockedDb, "占位", "utf-8");
      const badReport = runRuntimeDoctorChecks(
        deps({ dbPath: join(root, "blocked", "子目录不存在", "events.db") }),
      );
      expect(badReport.checks[3]!.status).toBe("error");
      expect(badReport.errors).toBe(1);

      const corruptDb = join(root, "corrupt-events.db");
      writeFileSync(corruptDb, "not a sqlite file", "utf-8");
      const corruptReport = runRuntimeDoctorChecks(deps({ dbPath: corruptDb }));
      expect(corruptReport.checks[3]!.status).toBe("error");
      expect(corruptReport.checks[3]!.details.join(" ")).toContain("读取失败");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("正常库：读出 schema 版本与会话/事件计数", () => {
    const root = mkdtempSync(join(tmpdir(), "aegent-doctor2-"));
    try {
      const dbPath = join(root, "events.db");
      const storage = SqliteEventStorage.open({ path: dbPath });
      storage.appendBatch("s1", [
        { seq: 1, ts: 0, type: "turn/start", turn: 1 },
        { seq: 2, ts: 0, type: "turn/end", turn: 1, reason: { kind: "completed" } },
      ] as never);
      storage.db.close();

      const report = runRuntimeDoctorChecks(deps({ dbPath }));
      const storageCheck = report.checks[3]!;
      expect(storageCheck.status).toBe("ok");
      expect(storageCheck.details.join(" ")).toContain("会话 1 个 / 事件 2 条 · schema 版本 1");
      expect(report.errors).toBe(0);
    } finally {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // Windows 句柄释放竞态（WAL 文件短暂锁定）——临时目录由系统回收
      }
    }
  });

  it("报告 JSON 导出可解析且结构性无凭证（key/authorization 不出现）", () => {
    const report = runRuntimeDoctorChecks(
      deps({
        modelIdentities: [{ provider: "openai", modelId: "gpt-4o" }],
      }),
    );
    const json = doctorReportToJson(report);
    const parsed = JSON.parse(json) as { checks: { id: string; details: string[] }[] };
    expect(parsed.checks).toHaveLength(4);
    // 脱敏证伪：报告文本里不存在凭证形状（身份面只有 provider/modelId）
    expect(json).not.toMatch(/sk-|api[_-]?key|authorization|Bearer/i);
    expect(json).toContain("openai/gpt-4o");
    // 人话渲染面兼容两域合并输出
    const text = formatDoctorReport(report);
    expect(text).toContain("[ ok ]");
    expect(existsSync("F:\\不存在的目录")).toBe(false); // 前置确认：warn 分支真实
  });
});
