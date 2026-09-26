#!/usr/bin/env node
/**
 * 沙箱 doctor 独立入口（T-P1-29 · D7）——**不起 agent 循环**：直接探测
 * 本机沙箱能力并输出报告（D7 验收要点"可独立运行"）。
 *
 * 运行：`npm run doctor`（= build 后 node dist/src/cli/doctor.js）。
 * 退出码：0 = 无 error（warn 不算失败）；1 = 有 error（沙箱不可用面）。
 */

import { runDoctorChecks, formatDoctorReport } from "../sandbox/doctor.js";

const report = await runDoctorChecks();
console.log(formatDoctorReport(report));
process.exit(report.errors > 0 ? 1 : 0);
