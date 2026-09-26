/**
 * 沙箱 doctor 自检（T-P1-29 · D7）——**可独立运行**的沙箱健康报告
 * （codex cli/doctor 的 DoctorCheck 形状：逐项 check → status + details
 * + remediation 提示；"run codex sandbox setup --elevated …" 的 remediation
 * 文案风格同源）。
 *
 * 报告面（验收要点："报告沙箱可用性与网络策略"）：
 *   - 沙箱可用性：helper 在场性（受限令牌后端）、Job 管辖（随 helper）、
 *     工作区守卫（PathGuard 可构造性）；
 *   - 网络策略：D3 NetworkPolicy 现值、D16 provision 状态（未装 → warn +
 *     remediation）、P0 弱承诺降级告警（D14 联动——"不假装已管住"）。
 *
 * **依赖全部经 DoctorDeps 注入**：测试不依赖真机特权面（elevated 探针、
 * helper spawn 均可注入桩值）；`runDoctorChecks` 只组装判定，不做 I/O。
 */

import { existsSync } from "node:fs";
import { DEFAULT_HELPER_PATH } from "./win32-backend.js";
import { probeNetworkProvisioned } from "./offline-network.js";

export type DoctorStatus = "ok" | "warn" | "error";

export interface DoctorCheck {
  readonly id: string;
  readonly title: string;
  readonly status: DoctorStatus;
  readonly details: readonly string[];
  /** status != ok 时的修复提示（codex WINDOWS_SETUP_REMEDIATION 同位）。 */
  readonly remediation?: string;
}

export interface DoctorDeps {
  /** helper exe 路径（缺省仓库约定位置）。 */
  readonly helperPath?: string;
  /** 工作区根（PathGuard 面）。 */
  readonly workspace?: string;
  /** D3 网络策略现值（装配配置；缺省 undefined = 未配置）。 */
  readonly networkPolicy?: "allow" | "deny";
  /** D16 WFP filter 在位性探针（缺省 helper probe；注入桩值用于测试）。 */
  readonly probeProvisioned?: () => Promise<boolean | null>;
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  /** 汇总：error 数（>0 = 沙箱不可用）与 warn 数。 */
  readonly errors: number;
  readonly warnings: number;
}

const HELPER_BUILD_REMEDIATION = "运行 npm run build:sandbox-helper 构建 win32 沙箱 helper（cargo build --release）";
const NETWORK_PROVISION_REMEDIATION =
  "以管理员运行 npm run sandbox:provision 安装 WFP 网络隔离（专用账户 + persistent 出站 BLOCK）";

export async function runDoctorChecks(deps: DoctorDeps = {}): Promise<DoctorReport> {
  const helperPath = deps.helperPath ?? DEFAULT_HELPER_PATH;
  const checks: DoctorCheck[] = [];

  // ── 沙箱可用性 ──
  const helperPresent = existsSync(helperPath);
  checks.push({
    id: "sandbox-helper",
    title: "win32 受限令牌 helper（D6/D10 受限 spawn）",
    status: helperPresent ? "ok" : "error",
    details: [
      `路径：${helperPath}`,
      helperPresent
        ? "helper 在场：workspace-write/read-only 模式可强制（受限令牌 + ACL grant + kill-on-close Job 管辖）"
        : "helper 缺席：受限模式请求将报 SANDBOX_UNAVAILABLE，绝不降级为不受限运行（D5 fail-closed）",
    ],
    remediation: helperPresent ? undefined : HELPER_BUILD_REMEDIATION,
  });

  checks.push({
    id: "containment-fallback",
    title: "子进程管辖降级面（D14）",
    status: helperPresent ? "ok" : "warn",
    details: helperPresent
      ? ["强管辖在位：setsid/重挂父进程/活过父进程的后代仍被 kill-on-close Job 管住（超时全树回收）"]
      : ["管辖降级：逃逸后代与工作区外写入不被承诺管住——降级事实已对装配告警（provider 生命周期一次性）"],
  });

  // ── 网络策略 ──
  const policy = deps.networkPolicy;
  checks.push({
    id: "network-policy",
    title: "网络策略现值（D3 独立一档）",
    status: "ok",
    details: [
      policy === undefined
        ? "未配置（装配未注入 NetworkPolicy——webfetch 等网络工具随装配 fail-closed 不注册）"
        : `NetworkPolicy = ${policy}（deny 档拦截工具层 fetch，路径/权限两轴独立）`,
    ],
  });

  const probe = deps.probeProvisioned ?? (() => probeNetworkProvisioned(helperPath));
  let provisioned: boolean | null;
  try {
    provisioned = await probe();
  } catch {
    provisioned = null;
  }
  checks.push({
    id: "network-isolation",
    title: "网络隔离（D16：OS 身份 + WFP）",
    status: provisioned === true ? "ok" : provisioned === false ? "warn" : "warn",
    details:
      provisioned === true
        ? ["WFP persistent 出站 BLOCK 在位：沙箱账户的进程网络被强制拦截（offline 身份）"]
        : provisioned === false
          ? ["未 provision：对任意子进程的网络行为**不承诺管住**（P0 弱承诺生效——「网络策略只在工具层生效」）"]
          : ["probe 不可得（helper 缺席或引擎不可达）——网络隔离状态未知，不假装已管住"],
    remediation: provisioned === true ? undefined : NETWORK_PROVISION_REMEDIATION,
  });

  const errors = checks.filter((c) => c.status === "error").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  return { checks, errors, warnings };
}

/** 报告文本渲染（独立 CLI 输出面；codex DoctorCheck 输出风格）。 */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = ["aegent 沙箱 doctor 自检", "===================="];
  for (const check of report.checks) {
    const mark = check.status === "ok" ? "[ ok ]" : check.status === "warn" ? "[warn]" : "[error]";
    lines.push(`${mark} ${check.title}`);
    for (const detail of check.details) lines.push(`       ${detail}`);
    if (check.remediation !== undefined) lines.push(`       ↳ 修复：${check.remediation}`);
  }
  lines.push(`====================`);
  lines.push(`结果：${report.errors} error / ${report.warnings} warning / ${report.checks.length - report.errors - report.warnings} ok`);
  return lines.join("\n");
}
