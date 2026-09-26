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
 */

import { writeFileSync } from "node:fs";

import { runDoctorChecks, formatDoctorReport, type DoctorReport } from "../sandbox/doctor.js";
import {
  collectRuntimeDoctorFacts,
  doctorReportToJson,
  runRuntimeDoctorChecks,
} from "../diagnostics/doctor.js";
import { BUILTIN_TOOL_NAMES } from "../kernel/tools/builtin/index.js";

function mergeReports(sandbox: DoctorReport, runtime: DoctorReport): DoctorReport {
  return {
    checks: [...sandbox.checks, ...runtime.checks],
    errors: sandbox.errors + runtime.errors,
    warnings: sandbox.warnings + runtime.warnings,
  };
}

const argv = process.argv.slice(2);
let jsonPath: string | undefined;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--json") {
    jsonPath = argv[++i];
    if (jsonPath === undefined || jsonPath.length === 0) {
      console.error("--json 需要输出文件路径");
      process.exit(2);
    }
    continue;
  }
  console.error(`未知参数「${argv[i]}」——可用：--json <path>`);
  process.exit(2);
}

const sandbox = await runDoctorChecks();
const runtime = runRuntimeDoctorChecks(
  collectRuntimeDoctorFacts({ builtinToolNames: BUILTIN_TOOL_NAMES }),
);
const report = mergeReports(sandbox, runtime);
console.log(formatDoctorReport(report));
if (jsonPath !== undefined) {
  writeFileSync(jsonPath, doctorReportToJson(report), "utf-8");
  console.log(`JSON 报告已导出：${jsonPath}`);
}
process.exit(report.errors > 0 ? 1 : 0);
