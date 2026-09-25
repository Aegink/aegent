/**
 * DPAPI 封装（T-6-04 · D8）——API Key 落盘前的加密。
 *
 * 路线裁定（卡内二选一）：**PowerShell** 而非 Rust helper。理由：D8 是冷路径
 * （配置读写，不是热链路），PowerShell 5.1 系统自带零构建面，P0 不为此引入
 * Rust 工具链与交叉产物管理；T9 的"跨 TS↔Rust 一律子进程"边界由 PowerShell
 * 子进程同样满足（本卡是第一个跨语言组件，进程边界 + 可序列化协议在此定形）。
 * 未摘 codex dpapi.rs 的任何代码（走 PowerShell ConvertTo/From-SecureString
 * 的用户域 DPAPI），故 THIRD_PARTY.md 无需登记——域语义差异（用户域 vs codex
 * 的机器域 CRYPTPROTECT_LOCAL_MACHINE）记录在 dpapi.ps1 头注释。
 *
 * 进程协议（T9：只传可序列化值）：argv 动作名 + stdin/stdout base64 文本。
 * 明文密钥**不进命令行**（命令行对本机其他进程可见）；全程 base64 绕开控制台
 * 代码页（非 ASCII 载荷实测通过）。文件缺失即抛（helper 是运行时伴生资产，
 * copy-assets 清单负责随 dist 拷贝）。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DPAPI_UNSUPPORTED_PLATFORM = "DPAPI_UNSUPPORTED_PLATFORM";
export const DPAPI_PROTECT_FAILED = "DPAPI_PROTECT_FAILED";
export const DPAPI_UNPROTECT_FAILED = "DPAPI_UNPROTECT_FAILED";
export const DPAPI_HELPER_TIMEOUT = "DPAPI_HELPER_TIMEOUT";

export class DpapiError extends Error {
  override readonly name = "DpapiError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface DpapiOptions {
  /** PowerShell 可执行文件（缺省 powershell.exe = 系统自带 5.1+）。 */
  readonly powershellPath?: string;
  /** helper 超时毫秒（PowerShell 冷启动 1~3s，留足余量）。 */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function scriptPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "dpapi.ps1");
}

function runHelper(action: "protect" | "unprotect", plain: string, options: DpapiOptions): Promise<string> {
  if (process.platform !== "win32") {
    return Promise.reject(
      new DpapiError(
        DPAPI_UNSUPPORTED_PLATFORM,
        "DPAPI 仅在 Windows 可用（D8 是 Windows 密钥存储需求）；其他平台请用环境变量等替代方式注入密钥",
      ),
    );
  }
  const payload = Buffer.from(plain, "utf8").toString("base64");
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      options.powershellPath ?? "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath(), action],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new DpapiError(DPAPI_HELPER_TIMEOUT, `DPAPI helper 超时（${String(DEFAULT_TIMEOUT_MS)}ms），进程已终止`));
      },
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      // 截断上限防错误通道膨胀；密钥经 stdin 不进 stderr 文本
      stderr = (stderr + chunk.toString("utf8")).slice(0, 500);
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new DpapiError(DPAPI_PROTECT_FAILED, `DPAPI helper 启动失败：${String(e.message)}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const failed = action === "protect" ? DPAPI_PROTECT_FAILED : DPAPI_UNPROTECT_FAILED;
        reject(new DpapiError(failed, `DPAPI helper 退出码 ${String(code)}：${stderr !== "" ? stderr : "(无 stderr)"}`));
        return;
      }
      try {
        resolve(Buffer.from(stdout.trim(), "base64").toString("utf8"));
      } catch (e) {
        reject(new DpapiError(DPAPI_PROTECT_FAILED, `DPAPI helper 输出不可解析：${String((e as Error).message)}`));
      }
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

/** protect：明文 → DPAPI blob（同 Windows 用户可解）。 */
export async function protect(plain: string, options: DpapiOptions = {}): Promise<string> {
  if (!existsSync(scriptPath())) {
    throw new DpapiError(DPAPI_PROTECT_FAILED, `DPAPI helper 脚本缺失：${scriptPath()}（copy-assets 清单问题）`);
  }
  return runHelper("protect", plain, options);
}

/** unprotect：DPAPI blob → 明文。blob 损坏/跨用户 → DPAPI_UNPROTECT_FAILED。 */
export async function unprotect(blob: string, options: DpapiOptions = {}): Promise<string> {
  if (!existsSync(scriptPath())) {
    throw new DpapiError(DPAPI_UNPROTECT_FAILED, `DPAPI helper 脚本缺失：${scriptPath()}（copy-assets 清单问题）`);
  }
  return runHelper("unprotect", blob, options);
}
