/**
 * SSH 远程执行后端（D12）——执行域的远端实现位：`SshExecutionEnv`
 * implements ExecutionEnv（批次 4 接口的第二个实现，与 NodeExecutionEnv
 * 同位互换）+ fs-ssh 面（文件操作经 ssh 命令——读写受限：只读演示面）。
 *
 * 取 dsh·packages/ssh 的行为："执行域三面（文件 / 沙箱 / 子进程）都有
 * 远端实现位"（其 fs-ssh / sandbox-ssh / subprocess-ssh 三包同挂一个
 * seam）；**不抄其实现**——依赖决策（卡内定形）：**命令行 ssh 子进程
 * 包装**（零新依赖，复用系统 OpenSSH client；其 ssh-RPC 协议形态不取）。
 *
 * 红线（全局约束 3）：**凭据零落盘**——不接密码 / 私钥参数，认证走系统
 * ssh 配置与 ssh-agent（BatchMode 禁止交互提示，认证失败快速失败而非挂
 * 起等输入）。对象里不存任何秘密（构造参数只有 host/port 等非敏感值）。
 *
 * 三层对应（我方最小面）：
 *   - **subprocess 面** = `exec`（ExecutionEnv 契约）——远端 shell 执行；
 *   - **fs 面** = `SshFileSystem`（readFile / exists 只读两枚——写面
 *     "读写受限只读演示"按卡面不做，记档）；
 *   - **sandbox 面** = 远端环境自身的边界（本地沙箱是 Windows 专属、
 *     不适用远端——"远端实现位"由 exec 承载，记档）。
 *
 * 失败面：连接/认证失败经 `probe()` 类型化拒绝（SshConnectionError——
 * ssh 自身错误退出码 255 的语义；exec 的 255 歧义（远端命令自身 exit 255
 * 与 ssh 错误同码）如实记档——需要区分时先 probe）。超时套 deadline
 * 原语（M7）：挂死的连接可回收。
 */

import { execFile } from "node:child_process";
import { Deadline, withDeadline, TimeoutError } from "../core/index.js";
import type { ExecOptions, ExecResult, ExecutionEnv } from "../core/index.js";

/** ssh 自身错误的退出码（OpenSSH 契约：连接/认证失败的统一码）。 */
export const SSH_SELF_ERROR_EXIT = 255;

/** 连接/认证失败的类型化拒绝（probe 面专有——exec 的 255 歧义见头注释）。 */
export class SshConnectionError extends Error {
    readonly code = "SSH_CONNECTION_FAILED";
    constructor(
        readonly host: string,
        readonly detail: string,
    ) {
        super(`SSH 连接失败（${host}）：${detail}（认证走系统 ssh-agent/配置——BatchMode 禁交互）`);
        this.name = "SshConnectionError";
    }
}

/** 底层 ssh 调用注入面（测试命令注入 mock；缺省真 execFile）。 */
export type SshRunner = (
    args: readonly string[],
    options: { timeoutMs?: number },
) => Promise<ExecResult>;

export interface SshExecutionEnvOptions {
    /** 目标（`[user@]host`——不含任何凭据）。 */
    readonly host: string;
    readonly port?: number;
    /** ssh 可执行文件（缺省 "ssh"——系统 OpenSSH client）。 */
    readonly sshBinary?: string;
    /** 连接建立预算（秒——`-o ConnectTimeout`；缺省 10）。 */
    readonly connectTimeoutSeconds?: number;
    /** 注入的 ssh 执行器（测试用；缺省真 execFile）。 */
    readonly runner?: SshRunner;
}

/** 缺省 runner：真 execFile + timeout 选项 kill（挂死连接可回收）。 */
function defaultRunner(sshBinary: string): SshRunner {
    return (args, options) =>
        new Promise<ExecResult>((resolve, reject) => {
            execFile(
                sshBinary,
                [...args],
                {
                    windowsHide: true,
                    encoding: "utf8",
                    maxBuffer: 10 * 1024 * 1024,
                    ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
                },
                (error, stdout, stderr) => {
                    if (error !== null) {
                        const e = error as { killed?: boolean; code?: number | string };
                        if (e.killed === true) {
                            reject(new TimeoutError("SSH_TIMEOUT", options.timeoutMs ?? 0));
                            return;
                        }
                        if (typeof e.code === "number") {
                            resolve({ exitCode: e.code, stdout, stderr });
                            return;
                        }
                        reject(new Error(String(error.message)));
                        return;
                    }
                    resolve({ exitCode: 0, stdout, stderr });
                },
            );
        });
}

/** 单引号 shell 引用（路径注入防护——内嵌单引号转义 `'\''`）。 */
function shQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * SSH 执行环境（ExecutionEnv 第二实现）：`exec(command, {timeoutMs, cwd})`
 * 经 `ssh [opts] -- <host> <command>` 在远端执行；`cwd` 以前缀 `cd <cwd> &&
 * ` 兑现（ssh 无独立工作目录概念——远端 shell 语义）。
 */
export class SshExecutionEnv implements ExecutionEnv {
    private readonly host: string;
    private readonly runner: SshRunner;
    private readonly baseArgs: readonly string[];

    constructor(options: SshExecutionEnvOptions) {
        this.host = options.host;
        const sshBinary = options.sshBinary ?? "ssh";
        this.runner = options.runner ?? defaultRunner(sshBinary);
        const connectTimeout = options.connectTimeoutSeconds ?? 10;
        this.baseArgs = [
            "-o",
            "BatchMode=yes",
            "-o",
            `ConnectTimeout=${String(connectTimeout)}`,
            ...(options.port !== undefined ? ["-p", String(options.port)] : []),
            "--",
            options.host,
        ];
    }

    /** 目标描述（诊断用——不含凭据）。 */
    get target(): string {
        return this.host;
    }

    async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
        const remote = options?.cwd !== undefined
            ? `cd ${shQuote(options.cwd)} && ${command}`
            : command;
        if (options?.timeoutMs === undefined) {
            return this.runner([...this.baseArgs, remote], {});
        }
        // 超时套 deadline 原语（M7）：runner 面与 kill 面双层兜底
        return withDeadline(
            Deadline.fromTimeoutMs("SSH_TIMEOUT", options.timeoutMs),
            this.runner([...this.baseArgs, remote], { timeoutMs: options.timeoutMs }),
        );
    }

    /**
     * 显式连通性探针（probe）：`ssh … true`；ssh 自身错误码（255）→
     * 类型化 SshConnectionError（连接/认证失败的判别面——exec 的 255
     * 歧义靠它消解）。构造期不做网络动作（惰性——装配零副作用）。
     */
    async probe(): Promise<void> {
        const result = await this.runner([...this.baseArgs, "true"], { timeoutMs: 15_000 });
        if (result.exitCode === SSH_SELF_ERROR_EXIT) {
            throw new SshConnectionError(this.host, result.stderr.trim() || "ssh 自身错误（255）");
        }
    }
}

/**
 * fs-ssh 面（只读演示）：文件操作经 ssh 命令（无 sftp 依赖——零新依赖
 * 纪律的延续）。写面不做（卡面"读写受限只读演示"）。
 */
export interface SshFileSystem {
    readFile(path: string): Promise<string>;
    exists(path: string): Promise<boolean>;
}

export function createSshFileSystem(env: SshExecutionEnv): SshFileSystem {
    return {
        async readFile(path: string): Promise<string> {
            const result = await env.exec(`cat -- ${shQuote(path)}`);
            if (result.exitCode !== 0) {
                throw new Error(`远端读取失败（${path}，exit=${String(result.exitCode)}）：${result.stderr.trim()}`);
            }
            return result.stdout;
        },
        async exists(path: string): Promise<boolean> {
            const result = await env.exec(`test -e ${shQuote(path)}`);
            return result.exitCode === 0;
        },
    };
}
