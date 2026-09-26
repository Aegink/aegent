/**
 * Windows 受限令牌后端（T-P1-25 · D6+D10）——SandboxBackend 的 win32 强制
 * 实现：全部 Win32 面（受限令牌 / ACL grant / Low integrity）在 Rust
 * helper 子进程（`win32-helper`），TS 侧仅调用（T9：只传可序列化值——
 * stdin JSON 请求 / stdout JSON 结果）。
 *
 * fail-closed 面：
 *   - helper 不在场 → SANDBOX_UNAVAILABLE（绝不降级为不受限运行）；
 *   - helper 内任何 Win32 失败 → 结构化错误退出（目标**零执行**）；
 *   - 超时 → helper 回收进程后报 TIMEOUT，TS 侧转 TimeoutError（与
 *     env.exec 的 TOOL_TIMEOUT 同词汇）。
 *
 * 宿主 shell：Windows 沙箱态的缺省宿主是 PowerShell（dsh 同款决策
 * "Choose a Bash executor for POSIX, a PowerShell executor for Windows"；
 * msys 运行时在受限令牌下 NtCreateDirectoryObject 被拒 0xC0000022——
 * bash 的 sandbox 态在 Windows 结构性不可用，见 docs/shell-semantics-
 * limitations.md）。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  SandboxUnavailableError,
  type SandboxBackend,
  type SandboxMode,
  type SandboxSpawnRequest,
  type SandboxSpawnResult,
} from "./backend.js";
import { canonicalize, tempWriteSid, workspaceWriteSid } from "./workspace-sid.js";
import { TimeoutError, TOOL_TIMEOUT } from "../kernel/timeout.js";

/** helper exe 的仓库内约定位置（npm run build:sandbox-helper 的产物）。 */
export const DEFAULT_HELPER_PATH =
  "src/sandbox/win32-helper/target/release/win32-sandbox-helper.exe";

export interface SandboxShellHost {
  /** 宿主可执行（"powershell.exe" / "pwsh.exe" / "cmd.exe"）。 */
  readonly program: string;
  /** 命令行参数前缀（命令行字符串追加在最后）。 */
  readonly args: readonly string[];
}

/** 缺省沙箱宿主：Windows PowerShell（系统自带，无安装面）。 */
export const POWERSHELL_HOST: SandboxShellHost = {
  program: "powershell.exe",
  args: ["-NoProfile", "-NonInteractive", "-Command"],
};

export interface Win32BackendOptions {
  /** helper exe 路径；缺失 → SANDBOX_UNAVAILABLE。 */
  readonly helperPath: string;
  /** 工作区根（canonical 化在构造时完成一次）。 */
  readonly workspace: string;
  /** 私有 temp 目录（dsh："tempDir: null to disable temp writes"——环境
   * temp root 绝不隐式授予）；缺省 null。 */
  readonly tempDir?: string | null;
  /** 宿主 shell；缺省 PowerShell。 */
  readonly shell?: SandboxShellHost;
}

interface HelperOk {
  ok: true;
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface HelperErr {
  ok: false;
  error: { code: string; message: string };
}

type HelperResponse = HelperOk | HelperErr;

/** Windows 受限令牌沙箱后端。 */
export class Win32SandboxBackend implements SandboxBackend {
  readonly supportedModes: readonly SandboxMode[] = ["read-only", "workspace-write"];
  private readonly options: Win32BackendOptions;
  private readonly workspaceCanonical: string;
  private readonly workspaceSid: string;

  constructor(options: Win32BackendOptions) {
    this.options = options;
    this.workspaceCanonical = canonicalize(options.workspace);
    this.workspaceSid = workspaceWriteSid(this.workspaceCanonical);
  }

  /** helper 在场性探针（D7 doctor 消费）。 */
  isHelperAvailable(): boolean {
    return existsSync(this.options.helperPath);
  }

  async spawn(request: SandboxSpawnRequest): Promise<SandboxSpawnResult> {
    if (!this.isHelperAvailable()) {
      throw new SandboxUnavailableError(
        request.mode,
        `win32 沙箱 helper 不在场（${this.options.helperPath}）——命令未执行；` +
          `先运行 npm run build:sandbox-helper 构建（D5：不可强制即报错，不不受限运行）。`,
      );
    }
    if (request.mode === "danger-full-access") {
      // 强制面语义：本后端只提供受限模式；danger-full-access 不是
      // "受限运行"，由消费方直接走 local 后端（能力按 mode 判定）。
      throw new SandboxUnavailableError(
        request.mode,
        "win32 受限令牌后端不提供 danger-full-access（该模式请走 local 后端直通）",
      );
    }
    const shell = this.options.shell ?? POWERSHELL_HOST;
    const tempDir = this.options.tempDir ?? null;
    const payload = {
      mode: request.mode,
      workspace: this.workspaceCanonical,
      workspaceSid: this.workspaceSid,
      tempDir: tempDir === null ? null : canonicalize(tempDir),
      tempSid: tempDir === null ? null : tempWriteSid(canonicalize(tempDir)),
      program: shell.program,
      args: [...shell.args, request.command],
      cwd: request.cwd ?? this.workspaceCanonical,
      timeoutMs: request.timeoutMs ?? null,
    };
    const response = await this.runHelper(JSON.stringify(payload));
    if (response.ok) {
      return {
        exitCode: response.exitCode,
        stdout: response.stdout,
        stderr: response.stderr,
      };
    }
    if (response.error.code === "TIMEOUT") {
      throw new TimeoutError(TOOL_TIMEOUT, request.timeoutMs ?? 0);
    }
    throw new SandboxUnavailableError(
      request.mode,
      `win32 沙箱执行失败（${response.error.code}）：${response.error.message}`,
    );
  }

  /** 单请求协议：stdin JSON → stdout JSON；helper 退出码 2 = 结构化失败。 */
  private runHelper(stdinJson: string): Promise<HelperResponse> {
    return new Promise<HelperResponse>((resolve, reject) => {
      const child = spawn(this.options.helperPath, ["--action", "run"], {
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
          resolve(JSON.parse(line) as HelperResponse);
        } catch {
          reject(
            new SandboxUnavailableError(
              "read-only",
              `win32 沙箱 helper 输出无法解析（exit ${String(code)}）：${out.slice(0, 200)}`,
            ),
          );
        }
      });
      child.stdin.end(stdinJson);
    });
  }
}
