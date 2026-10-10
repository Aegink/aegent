#!/usr/bin/env node
/**
 * doctor 独立入口（T-P1-29 · D7 沙箱域 + T-P1-35 · O18 运行时域）——**不起
 * agent 循环**：聚合沙箱可用性与运行时环境/配置/存储检查，一次输出报告
 * （codex doctor 全域形状）。
 *
 * 运行：`npm run doctor [-- --json report.json]`（= build 后 node dist/src/cli/doctor.js）。
 * `--json <path>`：结构化报告落盘（DoctorReport 序列化——结构性无凭证，
 * 模型身份只含 provider/modelId，key 从未收集）。
 * 退出码：0 = 无 error（warn 不算失败）；1 = 有 error；2 = 参数错误。
 *
 * 可测化（D 级债务清偿）：参数解析/报告合并导出为纯函数，入口经主模块
 * 判定（import 本文件做测试不会触发执行流）。
 */

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { runDoctorChecks, formatDoctorReport, type DoctorReport } from "../sandbox/doctor.js";
import {
  collectRuntimeDoctorFacts,
  doctorReportToJson,
  runRuntimeDoctorChecks,
} from "../diagnostics/doctor.js";
import { BUILTIN_TOOL_NAMES } from "../../plugins/tools-builtin/index.js";

/** 双域报告合并（checks 拼接、error/warning 计数求和）。 */
export function mergeReports(sandbox: DoctorReport, runtime: DoctorReport): DoctorReport {
  return {
    checks: [...sandbox.checks, ...runtime.checks],
    errors: sandbox.errors + runtime.errors,
    warnings: sandbox.warnings + runtime.warnings,
  };
}

/** 参数解析（fail 参数化——CLI 用 process.exit(2)，测试用断言）。 */
export function parseDoctorArgs(
  argv: readonly string[],
  fail: (message: string) => never,
): { jsonPath?: string } {
  let jsonPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") {
      jsonPath = argv[++i];
      if (jsonPath === undefined || jsonPath.length === 0) {
        fail("--json 需要输出文件路径");
      }
      continue;
    }
    fail(`未知参数「${arg}」——可用：--json <path>`);
  }
  return { ...(jsonPath !== undefined ? { jsonPath } : {}) };
}

export async function doctorMain(
  argv: readonly string[],
  io: Pick<Console, "log" | "error"> = console,
): Promise<void> {
  const fail = (message: string): never => {
    io.error(message);
    process.exit(2);
  };
  const { jsonPath } = parseDoctorArgs(argv, fail);

  const sandbox = await runDoctorChecks();
  const runtime = runRuntimeDoctorChecks(
    collectRuntimeDoctorFacts({ builtinToolNames: BUILTIN_TOOL_NAMES }),
  );
  const report = mergeReports(sandbox, runtime);
  io.log(formatDoctorReport(report));
  if (jsonPath !== undefined) {
    writeFileSync(jsonPath, doctorReportToJson(report), "utf-8");
    io.log(`JSON 报告已导出：${jsonPath}`);
  }
  process.exit(report.errors > 0 ? 1 : 0);
}

// 入口判定：仅直接执行本文件时运行（npm run doctor → dist 产物）；
// 测试 import 走不到这里。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await doctorMain(process.argv.slice(2));
}
