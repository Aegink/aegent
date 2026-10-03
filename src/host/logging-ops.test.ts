// T-P3-154：日志中心 ops——log-report 落盘/ui 通道/log-export 逐行脱敏。
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { logExportOp, logReportOp } from "./logging-ops.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function tempLogDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-logops-"));
  dirs.push(dir);
  return dir;
}

describe("logReportOp", () => {
  it("UI 错误批落 ui-日期.log；超限截断；空批零记录", () => {
    const dir = tempLogDir();
    const r = logReportOp(dir, [
      { ts: "2026-10-03T02:00:00.000Z", level: "error", message: "boom", stack: "Error: boom\n    at x" },
      { level: "warn", message: "警告一条" },
    ]);
    expect(r.recorded).toBe(2);
    const file = readdirSync(dir)[0]!;
    expect(file).toMatch(/^ui-\d{8}\.log$/);
    const first = JSON.parse(readFileSync(join(dir, file), "utf8").trim().split("\n")[0]!);
    expect(first.level).toBe("error");
    expect(first.channel).toBe("ui");
    expect(first.data.stack).toContain("at x");
    expect(logReportOp(dir, []).recorded).toBe(0);
  });
  it("entries 超 50 条截断到 50", () => {
    const dir = tempLogDir();
    const many = Array.from({ length: 60 }, (_, i) => ({ message: `e${i}` }));
    expect(logReportOp(dir, many).recorded).toBe(50);
  });
});

describe("logExportOp", () => {
  it("诊断包：doctor 报告+通道日志逐行脱敏（data 字段剔除）；raw 分片不进包", () => {
    const dir = tempLogDir();
    writeFileSync(
      join(dir, "host-20261003.log"),
      JSON.stringify({ ts: "2026-10-03T02:00:00.000Z", level: "info", channel: "host", category: "session", msg: "用户消息", data: { secret: "sk-abc123456789xyz" } }) + "\n" +
        "{broken\n",
      "utf8",
    );
    writeFileSync(join(dir, "raw-20261003.jsonl"), '{"chunks":[1,2,3]}\n', "utf8");
    const out = logExportOp(dir, {});
    expect(out.files).toBe(3); // doctor.json + manifest.json + host 日志（raw 排除）
    const zip = Buffer.from(out.base64, "base64");
    expect(zip.subarray(0, 2).toString()).toBe("PK"); // zip 魔数
    // 逐行脱敏断言：包内不含 data 原文与 sk- 密钥
    const text = zip.toString("latin1");
    expect(text).not.toContain("sk-abc123456789xyz");
    expect(text).not.toContain('"data"');
    expect(text).toContain("aegent-log-export"); // manifest
  });
  it("空目录：只有 doctor+manifest 两文件", () => {
    const out = logExportOp(tempLogDir(), {});
    expect(out.files).toBe(2);
  });
});
