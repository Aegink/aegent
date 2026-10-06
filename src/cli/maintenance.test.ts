import { describe, expect, it } from "vitest";

import type { CleanupReport } from "../session/cleanup.js";
import { parseMaintenanceArgs, renderCleanupReport } from "./maintenance.js";

/** fail 参数化的测试替身：把 CLI 的 process.exit(2) 变成断言异常。 */
function testFail(message: string): never {
  throw new Error(`[exit 2] ${message}`);
}

describe("maintenance 参数解析（CLI 可测化）", () => {
  it("合法全参：db/dry-run/三保留窗覆盖/json 路径齐备", () => {
    const parsed = parseMaintenanceArgs(
      ["cleanup", "--db", "x.db", "--dry-run", "--audit-days", "30", "--keep-runs", "5", "--session-days", "60", "--json", "r.json"],
      testFail,
    );
    expect(parsed).toEqual({
      dbPath: "x.db",
      dryRun: true,
      jsonPath: "r.json",
      overrides: { auditDays: 30, taskRunRecords: 5, sessionRetentionDays: 60 },
    });
  });

  it("缺 --db / 未知 flag / 非负整数校验 / --json 缺参——全部参数错误", () => {
    expect(() => parseMaintenanceArgs(["cleanup"], testFail)).toThrow("用法：maintenance cleanup");
    expect(() => parseMaintenanceArgs(["clean", "--db", "x.db"], testFail)).toThrow("用法：");
    expect(() => parseMaintenanceArgs(["cleanup", "--db", "x.db", "--bogus"], testFail)).toThrow("未知参数「--bogus」");
    expect(() => parseMaintenanceArgs(["cleanup", "--db", "x.db", "--audit-days", "-1"], testFail)).toThrow(
      "--audit-days 需要一个非负整数",
    );
    expect(() => parseMaintenanceArgs(["cleanup", "--db", "x.db", "--keep-runs", "abc"], testFail)).toThrow(
      "--keep-runs 需要一个非负整数",
    );
    expect(() => parseMaintenanceArgs(["cleanup", "--db", "x.db", "--json"], testFail)).toThrow("用法：");
  });
});

describe("maintenance 报告渲染（CLI 可测化）", () => {
  const base: CleanupReport = {
    dryRun: true,
    now: 1_700_000_000_000,
    auditBefore: 1_690_000_000_000,
    keepLatestTaskRuns: 100,
    sessionCutoff: 1_695_000_000_000,
    auditRecords: 7,
    taskRunRecords: 12,
    sessions: [{ sessionId: "sess-a", lastActiveTs: 1_600_000_000_000 }],
    archived: [],
  };

  it("dry-run 形态：标题带只算不执行标注，无归档回执段", () => {
    const text = renderCleanupReport(base, "x.db");
    expect(text).toContain("旧数据清理（dry-run——只算不执行）：x.db");
    expect(text).toContain("审计记录：7 条超保留");
    expect(text).not.toContain("已归档");
  });

  it("执行形态：列出归档回执（归档 ≠ 删除）", () => {
    const text = renderCleanupReport(
      {
        ...base,
        dryRun: false,
        archived: [{ sessionId: "sess-a", archivePath: "arch/sess-a.db", eventCount: 42, archivedAt: 1_700_000_000_000 }],
      },
      "x.db",
    );
    expect(text).toContain("已归档 1 个会话（归档 ≠ 删除——归档档可读）");
    expect(text).toContain("sess-a → arch/sess-a.db（42 事件）");
  });
});
