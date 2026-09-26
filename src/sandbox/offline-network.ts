/**
 * 网络隔离（OS 身份 + WFP）TS 面（T-P1-27 · D16）。
 *
 * 语义锚（codex setup.rs:740 `SandboxNetworkIdentity{Offline,Online}`）：
 * offline 是与网络策略联动的**身份选择**——network policy disabled（或
 * proxy 强制）→ offline 身份，其出站流量被 WFP persistent BLOCK（按专用
 * 账户 SID）拦截；enabled → online 身份。Q17 用户裁决（2026-09-25）：
 * "接受建 OS 账户，但降到 P1"——本卡即该落点。
 *
 * 生命周期：
 *   - provision（elevated 一次性，`npm run sandbox:provision`）：helper
 *     创建专用本地账户（随机密码）+ WFP 三件套 persistent 安装 → 响应
 *     里的密码由调用方 DPAPI 加密落盘（D8 面，机器级——明文不进命令行
 *     不落盘，D8 argv 纪律同款）；
 *   - runtime：`runOffline` 经 stdin 把 DPAPI 解密后的密码传给 helper
 *     （CreateProcessWithLogonW 走 seclogon，不需要 SE_TCB）；
 *   - **未 provision → NETWORK_SANDBOX_NOT_PROVISIONED（绝不静默降级为
 *     有网运行——Q17 纪律）**。
 *
 * 全部 API 需 helper 在场（T-P1-25 的构建脚本）。
 */

import { spawn } from "node:child_process";
import { DEFAULT_HELPER_PATH } from "./win32-backend.js";
import { TimeoutError, TOOL_TIMEOUT } from "../kernel/timeout.js";

/** 沙箱账户密码的 DPAPI 加密存储位置（D8 机器级——跨进程可解密）。 */
export const CREDENTIAL_FILE = "config/sandbox-account.json.enc";

export interface SandboxNetworkIdentity {
  /** offline = 走专用账户（网络被 WFP 拦）；online = 正常身份。 */
  readonly kind: "offline" | "online";
}

/**
 * 网络策略 → 身份选择的联动判定（codex `SandboxNetworkIdentity::
 * from_permissions` 同构：proxy_enforced 或 network disabled → Offline）。
 *
 * @param networkEnabled NetworkPolicy 是否 allow（deny = 网络禁用）
 * @param proxyEnforced 出站是否被代理强制（强制时也走 offline——流量路径
 *   已由代理收口，无需再给目标进程网络身份）
 */
export function resolveNetworkIdentity(
  networkEnabled: boolean,
  proxyEnforced: boolean,
): SandboxNetworkIdentity {
  if (proxyEnforced || !networkEnabled) {
    return { kind: "offline" };
  }
  return { kind: "online" };
}

export interface ProvisionResult {
  /** 账户名（provision 复用已存在账户）。 */
  account: string;
  /** 自动生成的密码（明文）——**调用方必须立即 DPAPI 加密落盘**；
   * 调用方自带密码时为空串。 */
  passwordGenerated: boolean;
  password: string;
  detail: string;
}

/** 纯逻辑：账户名形状校验（防 provision 注入形状外的账户名）。 */
export function isValidSandboxAccount(account: string): boolean {
  return /^aegent-sbx-[0-9a-f]{6}$/.test(account);
}

export interface OfflineSpawnRequest {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs?: number;
}

export interface OfflineNetworkOptions {
  /** helper exe 路径。 */
  readonly helperPath?: string;
  /** 沙箱账户名（provision 产出）。 */
  readonly account: string;
  /** DPAPI 解密后的密码（runtime 内存持有；本模块不落盘）。 */
  readonly password: string;
}

/** 离线身份进程执行器（D16 runtime 面）。 */
export class OfflineNetworkExecutor {
  private readonly helperPath: string;
  private readonly options: OfflineNetworkOptions;

  constructor(options: OfflineNetworkOptions) {
    this.options = options;
    this.helperPath = options.helperPath ?? DEFAULT_HELPER_PATH;
  }

  /**
   * 以沙箱账户 spawn 命令（其网络被 WFP 拦）。未 provision / 账户密码
   * 失配 → 类型化错误（helper 的 NETWORK_SANDBOX_NOT_PROVISIONED 透传）。
   */
  async execute(request: OfflineSpawnRequest): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        account: this.options.account,
        password: this.options.password,
        program: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-Command", request.command],
        cwd: request.cwd,
        timeoutMs: request.timeoutMs ?? null,
      });
      const child = spawn(this.helperPath, ["--action", "run-offline"], {
        stdio: ["pipe", "pipe", "inherit"],
        windowsHide: true,
      });
      let out = "";
      child.stdout.on("data", (chunk: Buffer) => {
        out += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        const line = out.trim().split("\n").filter((s) => s !== "").pop() ?? "";
        try {
          const parsed = JSON.parse(line) as
            | { ok: true; exitCode: number; stdout: string; stderr: string }
            | { ok: false; error: { code: string; message: string } };
          if (parsed.ok) {
            resolve({ exitCode: parsed.exitCode, stdout: parsed.stdout, stderr: parsed.stderr });
            return;
          }
          if (parsed.error.code === "TIMEOUT") {
            reject(new TimeoutError(TOOL_TIMEOUT, request.timeoutMs ?? 0));
            return;
          }
          const err = new Error(parsed.error.message) as Error & { code: string };
          err.code = parsed.error.code;
          reject(err);
        } catch {
          reject(
            new Error(
              `win32 沙箱 helper（run-offline）输出无法解析（exit ${String(code)}）：${out.slice(0, 200)}`,
            ),
          );
        }
      });
      child.stdin.end(payload);
    });
  }
}

/**
 * probe（doctor 消费）：WFP filter 在位性。非特权可读（FwpmEngineOpen0
 * 非 dynamic 会话对只读查询不要求管理员——真机已验证）。
 */
export function probeNetworkProvisioned(helperPath: string = DEFAULT_HELPER_PATH): Promise<boolean | null> {
  return new Promise((resolve) => {
    const child = spawn(helperPath, ["--action", "probe-network"], {
      stdio: ["pipe", "pipe", "inherit"],
      windowsHide: true,
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      try {
        const parsed = JSON.parse(out.trim()) as { ok: true; provisioned: boolean };
        resolve(parsed.provisioned);
      } catch {
        // helper 错误退出（含权限不足）——探针不可得，交由 doctor 报原因。
        resolve(null);
      }
    });
    child.stdin.end("{}");
  });
}
