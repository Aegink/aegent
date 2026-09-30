/**
 * 沙箱自检数据面（T-P3-140 批次 B）——settings-gateway 的拆分位：host
 * 行数纪律（maxFileLines 400）下的独立域文件。doctor 检查面与 helper
 * 路径解析/provision 探针在 sandbox 域，本文件只做装配与如实回执
 * （不假装已管住——降级事实原样上报，由 UI 自检卡常显）。
 */

import { existsSync } from "node:fs";
import { runDoctorChecks, type DoctorCheck } from "../sandbox/doctor.js";
import { resolveSandboxHelperPath } from "../sandbox/containment.js";
import { PROTECTED_METADATA_PATH_NAMES } from "../policy/protected-names.js";
import type { SandboxMode } from "../sandbox/backend.js";
import { loadSettings } from "../session/settings.js";

export interface SandboxDoctorPayload {
  checks: DoctorCheck[];
  errors: number;
  warnings: number;
  helperPath: string;
  helperAvailable: boolean;
  sandboxMode: SandboxMode | undefined;
  networkPolicy: "allow" | "deny" | undefined;
  writeWhitelist: readonly string[];
  protectedNames: readonly string[];
}

export async function sandboxDoctorOp(
  settingsPath: string,
  workspaceRoot: string | undefined,
): Promise<SandboxDoctorPayload> {
  const settings = (await loadSettings(settingsPath)).settings;
  const helperPath = resolveSandboxHelperPath();
  const report = await runDoctorChecks({
    helperPath,
    ...(workspaceRoot !== undefined ? { workspace: workspaceRoot } : {}),
    ...(settings.sandbox?.network !== undefined
      ? { networkPolicy: settings.sandbox.network }
      : {}),
  });
  return {
    checks: [...report.checks],
    errors: report.errors,
    warnings: report.warnings,
    helperPath,
    helperAvailable: existsSync(helperPath),
    sandboxMode: settings.sandbox?.mode,
    networkPolicy: settings.sandbox?.network,
    writeWhitelist: settings.sandbox?.writeWhitelist ?? [],
    // 展示面（批次 D）：保护名单只读展示——闭集常量直读（防手抄漂移）
    protectedNames: PROTECTED_METADATA_PATH_NAMES,
  };
}
