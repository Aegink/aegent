/**
 * 面板批 host op（T-P3-156 R/T——Git 管理面板 + 辅助对话历史落盘）：
 * - git 族：child_process git（status/diff/stage/commit/log），cwd = 项目根
 *   白名单（与 fs-gateway 同边界——roots 实时取自 settings.projects）；
 *   输出截断上限防大 diff 撑爆信封。
 * - assistant-log 族：辅助对话历史的 JSONL 落盘（裁决 9b——按日文件
 *   <home>/.aegent/assistant/assistant-YYYYMMDD.jsonl，复用日志中心按日
 *   管道思路）；append/最近读取两条面。
 */

import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const GIT_TIMEOUT_MS = 15_000;
const OUTPUT_MAX = 512 * 1024; // 512KB——diff/log 上限（超出截断标记）

/** 路径白名单校验（fs-gateway realpath 白名单同语义——posix 归一前缀匹配）。 */
function resolveAllowedRoot(roots: string[], cwd: string): string {
  const norm = (p: string) => p.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
  const target = norm(cwd);
  for (const root of roots) {
    if (target === norm(root) || target.startsWith(`${norm(root)}/`)) return cwd;
  }
  const err = new Error(`cwd 不在项目根白名单内（fs-gateway 同边界）`);
  (err as unknown as { code: string }).code = "CWD_NOT_ALLOWED";
  throw err;
}

function runGit(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd: root, timeout: GIT_TIMEOUT_MS, maxBuffer: OUTPUT_MAX, windowsHide: true },
      (err, stdout, stderr) => {
        if (err !== null) {
          const message = `${String(stderr ?? "").trim() || err.message}`.slice(0, 400);
          const wrapped = new Error(message);
          (wrapped as unknown as { code: string }).code = "GIT_FAILED";
          reject(wrapped);
          return;
        }
        resolve(String(stdout ?? ""));
      },
    );
  });
}

export async function gitStatusOp(roots: string[], cwd: string): Promise<unknown> {
  const root = resolveAllowedRoot(roots, cwd);
  const [branch, status] = await Promise.all([
    runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    runGit(root, ["status", "--porcelain=v1", "-b"]),
  ]);
  const lines = status.split("\n").filter((l) => l.trim() !== "");
  const changes = lines.slice(1).map((line) => {
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const file = line.slice(3);
    const staged = x !== " " && x !== "?";
    const unstaged = y !== " " || x === "?";
    return { file, staged, unstaged, untracked: x === "?" };
  });
  return {
    cwd: root,
    branch: branch.trim(),
    ahead: /ahead (\d+)/.exec(lines[0] ?? "")?.[1] ?? "0",
    behind: /behind (\d+)/.exec(lines[0] ?? "")?.[1] ?? "0",
    changes,
  };
}

export async function gitDiffOp(roots: string[], cwd: string, file: string, staged: boolean): Promise<unknown> {
  const root = resolveAllowedRoot(roots, cwd);
  const args = ["diff", "--no-color", file];
  if (staged) args.splice(1, 0, "--cached");
  const text = await runGit(root, args);
  return { file, staged, text: text.slice(0, OUTPUT_MAX), truncated: text.length > OUTPUT_MAX };
}

export async function gitStageOp(roots: string[], cwd: string, files: string[], unstage: boolean): Promise<unknown> {
  const root = resolveAllowedRoot(roots, cwd);
  if (files.length === 0) throw Object.assign(new Error("文件清单为空"), { code: "GIT_FAILED" });
  await runGit(root, unstage ? ["reset", "HEAD", "--", ...files] : ["add", "--", ...files]);
  return { done: true };
}

export async function gitCommitOp(roots: string[], cwd: string, message: string, amend: boolean): Promise<unknown> {
  const root = resolveAllowedRoot(roots, cwd);
  if (message.trim() === "" && !amend) throw Object.assign(new Error("提交信息为空"), { code: "GIT_FAILED" });
  const hash = await runGit(root, amend ? ["commit", "--amend", "--no-edit"] : ["commit", "-m", message]);
  return { done: true, output: hash.trim().slice(0, 200) };
}

export async function gitLogOp(roots: string[], cwd: string): Promise<unknown> {
  const root = resolveAllowedRoot(roots, cwd);
  const text = await runGit(root, ["log", "--pretty=format:%h%x1f%s%x1f%an%x1f%ar", "-n", "30"]);
  const commits = text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((line) => {
      const [hash, subject, author, date] = line.split("\x1f");
      return { hash: hash ?? "", subject: subject ?? "", author: author ?? "", date: date ?? "" };
    });
  return { commits };
}

// ---------------------------------------------------------------------------
// 辅助对话历史（T 方案——裁决 9b：会话外 JSONL 落盘）
// ---------------------------------------------------------------------------

function assistantLogPath(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return path.join(homedir(), ".aegent", "assistant", `assistant-${y}${m}${d}.jsonl`);
}

export async function assistantLogAppendOp(entry: {
  role: "user" | "assistant";
  text: string;
}): Promise<{ appended: true }> {
  const file = assistantLogPath(new Date());
  await mkdir(path.dirname(file), { recursive: true });
  const line = `${JSON.stringify({ ts: Date.now(), role: entry.role, text: String(entry.text).slice(0, 32_000) })}\n`;
  await appendFile(file, line, "utf8");
  return { appended: true };
}

export async function assistantLogReadOp(limit?: number): Promise<unknown> {
  const cap = Math.max(1, Math.min(500, Number(limit) || 200));
  // 最近 3 天文件倒序回看（按日管道——读侧聚合）
  const rows: Array<{ ts: number; role: string; text: string }> = [];
  for (let dayOffset = 0; dayOffset < 3 && rows.length < cap; dayOffset++) {
    const d = new Date(Date.now() - dayOffset * 86_400_000);
    const file = assistantLogPath(d);
    let text = "";
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue; // 当日无文件（还没聊过）
    }
    for (const line of text.split("\n").reverse()) {
      if (line.trim() === "" || rows.length >= cap) continue;
      try {
        rows.push(JSON.parse(line) as { ts: number; role: string; text: string });
      } catch {
        continue; // 损坏行跳过（日志中心同纪律）
      }
    }
  }
  return { entries: rows.reverse() };
}
