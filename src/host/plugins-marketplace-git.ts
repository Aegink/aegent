/**
 * 插件市场 git 运行器（T-P3-148 M——codex git_policy.rs 的 Node 对齐裁剪）：
 *
 *   - 环境净化：git 子进程只拿到白名单 env（PATH/HOME/系统路径/代理）——
 *     codex 移除 17 个 GIT_* 变量的语义在此收敛为"干净 env 白名单"（更强：
 *     GIT_DIR/GIT_CONFIG 等仓库劫持面整类消失）；
 *   - `GIT_TERMINAL_PROMPT=0` + `-c safe.bareRepository=explicit`（codex
 *     同值——防裸仓库当工作树）+ windowsHide；
 *   - 30s 超时 kill（execFile timeout——codex run_git_command_with_timeout
 *     同语义）；sha/ref 操作数校验（非空、不以 - 开头防选项注入、sha 全 hex）；
 *   - sha pin：clone 后 checkout + `rev-parse HEAD` 忽略大小写比对（codex
 *     loader.rs:1862-1869 同语义——ref 漂移防线）。
 */

import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const GIT_TIMEOUT_MS = 30_000;

const SHA_HEX_RE = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

/** git 子进程 env 白名单（宿主环境变量不透传——GIT_* 劫持面整类消除）。 */
function gitEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const key of ["HOME", "USERPROFILE", "SYSTEMROOT", "COMSPEC", "HOMEDRIVE", "HOMEPATH", "TEMP", "TMP", "LANG"] as const) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  for (const key of ["https_proxy", "http_proxy", "no_proxy", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"] as const) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/** git 操作数值校验（url/ref 非空、无 NUL、不以 - 开头；sha 全 hex）。 */
export function gitArgError(kind: "url" | "ref" | "sha", value: string): string | undefined {
  if (value === "" || value.includes("\0")) return `git ${kind} 不能为空`;
  if (value.startsWith("-")) return `git ${kind} 不得以 "-" 开头（防选项注入）：${value}`;
  if (kind === "sha" && !SHA_HEX_RE.test(value)) {
    return `git sha 须为 40/64 位 hex：${value}`;
  }
  return undefined;
}

/** 运行 git（净化 env + 超时 kill + 截断输出回执）。 */
export function runGit(args: readonly string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-c", "safe.bareRepository=explicit", ...args],
      {
        ...(cwd !== undefined ? { cwd } : {}),
        env: gitEnv(),
        timeout: GIT_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error !== null && error !== undefined) {
          const timedOut = (error as unknown as { killed?: boolean }).killed === true;
          const detail = String(stderr ?? "").slice(-800).trim();
          reject(
            new Error(
              `git ${args[0] ?? ""} 失败${timedOut ? "（30s 超时）" : ""}：${error.message}${detail !== "" ? ` — ${detail}` : ""}`,
            ),
          );
          return;
        }
        resolve(String(stdout ?? "").trim());
      },
    );
  });
}

export interface GitCloneRequest {
  readonly url: string;
  readonly dest: string;
  /** ref（branch/tag）；sha pin 时走 fetch + rev-parse 校验。 */
  readonly ref?: string;
  readonly sha?: string;
  /** 仓库内子目录（sparse checkout——monorepo 市场/插件取子目录）。 */
  readonly subdir?: string;
}

/** clone 一份源（普通/--depth 1 + sparse + sha pin 校验——codex loader 同序）。 */
export async function gitCloneSource(req: GitCloneRequest): Promise<void> {
  const urlErr = gitArgError("url", req.url);
  if (urlErr !== undefined) throw new Error(urlErr);
  if (req.sha !== undefined) {
    const shaErr = gitArgError("sha", req.sha);
    if (shaErr !== undefined) throw new Error(shaErr);
  }
  if (req.ref !== undefined) {
    const refErr = gitArgError("ref", req.ref);
    if (refErr !== undefined) throw new Error(refErr);
  }
  if (req.sha !== undefined) {
    // sha pin：fetch 固定对象后 checkout（grok-build sha-pinned clone 同构——
    // clone --branch 不收裸 sha）
    await runGit(["init", "--quiet", req.dest]);
    await runGit(["remote", "add", "--", "origin", req.url], req.dest);
    await runGit(["fetch", "--depth", "1", "--", "origin", req.sha], req.dest);
    await runGit(["checkout", "--quiet", "FETCH_HEAD"], req.dest);
  } else {
    await runGit(["clone", "--depth", "1", ...(req.ref !== undefined ? ["--branch", req.ref] : []), "--", req.url, req.dest]);
  }
  if (req.sha !== undefined) {
    const head = await runGit(["rev-parse", "HEAD"], req.dest);
    if (head.toLowerCase() !== req.sha.toLowerCase()) {
      throw new Error(`sha 校验失败：rev-parse HEAD=${head} ≠ 请求 ${req.sha}`);
    }
  } else if (req.ref !== undefined) {
    await runGit(["checkout", "--quiet", req.ref], req.dest).catch(() => {
      // --branch 已带 ref；checkout 兜底对 tag/ detached 场景容错
    });
  }
}

/** sparse 模式的仓库子目录物化（v1 全量 clone + 子目录定位——sparse 滤波随需要）。 */
export function pluginRootFromClone(cloneDir: string, subdir: string | undefined): string {
  if (subdir === undefined || subdir === "") return cloneDir;
  const normalized = subdir.replace(/^\.\//, "").replace(/\/+$/, "");
  if (normalized === "" || normalized.split("/").includes("..")) {
    throw new Error(`git source 子目录非法：${subdir}`);
  }
  const abs = path.resolve(cloneDir, normalized);
  if (!abs.startsWith(path.resolve(cloneDir) + path.sep)) {
    throw new Error(`git source 子目录越界：${subdir}`);
  }
  return abs;
}

/** ls-remote 拿远端 revision（full sha ref 免网络短路——codex upgrade 同语义）。 */
export async function gitRemoteRevision(url: string, ref?: string): Promise<string> {
  if (ref !== undefined && SHA_HEX_RE.test(ref)) return ref;
  const out = await runGit(["ls-remote", "--", url, ref ?? "HEAD"]);
  const first = out.split("\n")[0] ?? "";
  const sha = first.split("\t")[0]?.trim() ?? "";
  if (!SHA_HEX_RE.test(sha)) {
    throw new Error(`ls-remote 未返回合法 revision：${out.slice(0, 120)}`);
  }
  return sha;
}

/** staging 临时目录（进程退出由调用方清理——best-effort）。 */
export function makeStagingDir(root: string, prefix: string): string {
  try {
    return mkdtempSync(path.join(root, prefix));
  } catch {
    return mkdtempSync(path.join(tmpdir(), prefix));
  }
}
