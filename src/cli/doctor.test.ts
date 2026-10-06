import { describe, expect, it } from "vitest";

import { mergeReports, parseDoctorArgs } from "./doctor.js";

/** fail 参数化的测试替身：把 CLI 的 process.exit(2) 变成断言异常。 */
function testFail(message: string): never {
  throw new Error(`[exit 2] ${message}`);
}

describe("doctor 参数解析与报告合并（CLI 可测化）", () => {
  it("--json 合法路径；缺参与未知参都是参数错误", () => {
    expect(parseDoctorArgs(["--json", "r.json"], testFail)).toEqual({ jsonPath: "r.json" });
    expect(parseDoctorArgs([], testFail)).toEqual({});
    expect(() => parseDoctorArgs(["--json"], testFail)).toThrow("--json 需要输出文件路径");
    expect(() => parseDoctorArgs(["--verbose"], testFail)).toThrow("未知参数「--verbose」");
  });

  it("mergeReports：checks 拼接、error/warning 计数求和", () => {
    const sandbox = { checks: [{ name: "s1" } as never], errors: 1, warnings: 2 };
    const runtime = { checks: [{ name: "r1" } as never, { name: "r2" } as never], errors: 0, warnings: 3 };
    const merged = mergeReports(sandbox, runtime);
    expect(merged.checks).toHaveLength(3);
    expect(merged.errors).toBe(1);
    expect(merged.warnings).toBe(5);
  });
});
