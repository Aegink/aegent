import { describe, expect, it } from "vitest";
import {
    createSshFileSystem,
    SSH_SELF_ERROR_EXIT,
    SshConnectionError,
    SshExecutionEnv,
    type SshRunner,
} from "./ssh-backend.js";
import { TimeoutError } from "../kernel/deadline.js";
import type { ExecResult, ExecutionEnv } from "../kernel/tools/env.js";

/** 命令注入 mock：记录 args、按 script 应答（无真实 sshd 的测试面）。 */
function fakeRunner(
    script: (args: readonly string[]) => Partial<ExecResult> | Promise<Partial<ExecResult>>,
    seen: string[][] = [],
): SshRunner {
    return async (args) => {
        seen.push([...args]);
        const out = await script(args);
        return { exitCode: 0, stdout: "", stderr: "", ...out };
    };
}

describe("SshExecutionEnv —— ssh 命令包装（argv 形状）", () => {
    it("argv：BatchMode + ConnectTimeout + 端口 + -- host + 远端命令", async () => {
        const seen: string[][] = [];
        const env = new SshExecutionEnv({
            host: "user@example.com",
            port: 2222,
            connectTimeoutSeconds: 3,
            runner: fakeRunner(() => ({ stdout: "ok" }), seen),
        });
        const result = await env.exec("uname -a");
        expect(result).toEqual({ exitCode: 0, stdout: "ok", stderr: "" });
        expect(seen[0]).toEqual([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=3",
            "-p",
            "2222",
            "--",
            "user@example.com",
            "uname -a",
        ]);
        expect(env.target).toBe("user@example.com");
    });

    it("缺省无端口项；exitCode/stdout/stderr 原样透传（255 歧义如实——不特殊化）", async () => {
        const seen: string[][] = [];
        const env = new SshExecutionEnv({
            host: "h1",
            runner: fakeRunner(() => ({ exitCode: SSH_SELF_ERROR_EXIT, stderr: "boom" }), seen),
        });
        const result = await env.exec("false");
        expect(seen[0]).toEqual(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", "h1", "false"]);
        expect(result).toEqual({ exitCode: 255, stdout: "", stderr: "boom" });
    });

    it("cwd 以前缀 cd 兑现（单引号引用——内嵌单引号转义防注入）", async () => {
        const seen: string[][] = [];
        const env = new SshExecutionEnv({
            host: "h1",
            runner: fakeRunner(() => ({}), seen),
        });
        await env.exec("ls", { cwd: "/tmp/it's here" });
        expect(seen[0]!.at(-1)).toBe("cd '/tmp/it'\\''s here' && ls");
    });

    it("超时套 deadline 原语：挂死的 runner → TimeoutError；timeoutMs 传到底层", async () => {
        const seenTimeout: (number | undefined)[] = [];
        const env = new SshExecutionEnv({
            host: "h1",
            runner: async (_args, options) => {
                seenTimeout.push(options.timeoutMs);
                return new Promise(() => undefined); // 挂死
            },
        });
        await expect(env.exec("sleep 999", { timeoutMs: 50 })).rejects.toBeInstanceOf(TimeoutError);
        expect(seenTimeout).toEqual([50]);
    });

    it("probe：ssh 自身错误（255）→ 类型化 SshConnectionError；成功静默通过", async () => {
        const failEnv = new SshExecutionEnv({
            host: "unreachable",
            runner: fakeRunner(() => ({ exitCode: SSH_SELF_ERROR_EXIT, stderr: "Connection refused" })),
        });
        await expect(failEnv.probe()).rejects.toMatchObject({
            name: "SshConnectionError",
            code: "SSH_CONNECTION_FAILED",
        });
        await expect(failEnv.probe()).rejects.toBeInstanceOf(SshConnectionError);

        const okEnv = new SshExecutionEnv({ host: "h1", runner: fakeRunner(() => ({})) });
        await expect(okEnv.probe()).resolves.toBeUndefined();
    });
});

describe("fs-ssh 面（只读演示）", () => {
    it("readFile：cat 命令 + 路径引用；失败类型化抛错", async () => {
        const seen: string[][] = [];
        const env = new SshExecutionEnv({
            host: "h1",
            runner: fakeRunner(
                (args) =>
                    args.at(-1)!.includes("bad")
                        ? { exitCode: 1, stderr: "No such file" }
                        : { stdout: "内容" },
                seen,
            ),
        });
        const fs = createSshFileSystem(env);
        await expect(fs.readFile("/etc/hostname")).resolves.toBe("内容");
        expect(seen[0]!.at(-1)).toBe("cat -- '/etc/hostname'");
        await expect(fs.readFile("/bad")).rejects.toThrow(/远端读取失败/);
    });

    it("exists：test -e 判定（0 = 存在 / 非 0 = 不存在）", async () => {
        const env = new SshExecutionEnv({
            host: "h1",
            runner: fakeRunner((args) => ({ exitCode: args.at(-1)!.includes("yes") ? 0 : 1 })),
        });
        const fs = createSshFileSystem(env);
        await expect(fs.exists("/yes")).resolves.toBe(true);
        await expect(fs.exists("/no")).resolves.toBe(false);
    });
});

describe("三层接口断言（执行域远端实现位）", () => {
    it("SshExecutionEnv 满足 ExecutionEnv 契约（与 NodeExecutionEnv 同位互换）", async () => {
        const env: ExecutionEnv = new SshExecutionEnv({ host: "h1", runner: fakeRunner(() => ({})) });
        // 类型面：赋值通过即契约在位；行为面：exec 恒返回 {exitCode, stdout, stderr}
        const result = await env.exec("id");
        expect(Object.keys(result).sort()).toEqual(["exitCode", "stderr", "stdout"]);
    });

    it("零凭据落盘断言：实例字段与序列化不含密码/私钥词汇（红线）", () => {
        const env = new SshExecutionEnv({ host: "user@h", runner: fakeRunner(() => ({})) });
        const fields = Object.keys(env);
        for (const f of fields) {
            expect(f).not.toMatch(/pass|key|secret|token/i);
        }
        // argv 面同样零凭据参数（BatchMode 禁交互——认证走系统 ssh-agent/配置）
        expect(JSON.stringify(fields)).not.toMatch(/pass|key/i);
    });
});
