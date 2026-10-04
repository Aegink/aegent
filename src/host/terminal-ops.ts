/**
 * 终端面板 host 面（T-P3-156 方案 P——node-pty per-workspace PTY 池）：
 * - 创建：settings op "terminal-create"（cwd = 项目根白名单——panel-ops
 *   同边界）；idle 回收（30min 无输入/输出——zcode workspace 关闭回收的
 *   时限版）；
 * - 输入/resize：settings op（高频小包——WS 信封一帧一发）；
 * - 输出/退出：**notification 下行**（terminal-data / terminal-exit）——
 *   notifier 由 server 组装时注入（bridge.notifyAll 的引用透传）；
 * - spike 证据：node-pty 1.1.0 prebuilds/win32-x64 在 dev+portable 双环境
 *   spawn 实测通过（2026-10-03，见 notes 进度记档）。
 */

import { spawn as ptySpawn, type IPty } from "node-pty";
import { homedir } from "node:os";
import path from "node:path";

interface TerminalSession {
  pty: IPty;
  cwd: string;
  lastActive: number;
}

const sessions = new Map<string, TerminalSession>();
const IDLE_REAP_MS = 30 * 60_000;

let notifier: ((name: string, payload: unknown) => void) | null = null;

/** server 组装时注入（bridge.notifyAll 透传——终端输出是 host 主动下行）。 */
export function setTerminalNotifier(fn: (name: string, payload: unknown) => void): void {
  notifier = fn;
}

/** 路径白名单（panel-ops.resolveAllowedRoot 同语义——此处进程内复制防环）。 */
function resolveAllowedRoot(roots: string[], cwd: string): string {
  const norm = (p: string) => p.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
  const target = norm(cwd);
  for (const root of roots) {
    if (target === norm(root) || target.startsWith(`${norm(root)}/`)) return cwd;
  }
  throw Object.assign(new Error("cwd 不在项目根白名单内"), { code: "CWD_NOT_ALLOWED" });
}

export function terminalCreateOp(
  roots: string[],
  payload: { id: string; cwd: string; shell?: "cmd" | "powershell" | "pwsh" | "bash" },
): unknown {
  const { id, cwd } = payload;
  const existing = sessions.get(id);
  if (existing !== undefined) {
    existing.lastActive = Date.now();
    return { id, reused: true, cwd: existing.cwd }; // 幂等——Tab 重挂不杀进程
  }
  const root = resolveAllowedRoot(roots, cwd);
  // T-P3-166 需求 4：命令 Shell 选择（settings.chat.shell——缺省系统 ComSpec）
  const SHELL_MAP: Record<string, string> = {
    cmd: process.env.ComSpec ?? "cmd.exe",
    powershell: "powershell.exe",
    pwsh: "pwsh.exe",
    bash: "bash.exe",
  };
  const shell =
    payload.shell !== undefined && SHELL_MAP[payload.shell] !== undefined
      ? SHELL_MAP[payload.shell] as string
      : process.platform === "win32"
        ? process.env.ComSpec ?? "cmd.exe"
        : process.env.SHELL ?? "/bin/bash";
  const pty = ptySpawn(shell, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: root,
    env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
  });
  sessions.set(id, { pty, cwd: root, lastActive: Date.now() });
  pty.onData((data) => {
    notifier?.("terminal-data", { id, data });
  });
  pty.onExit(({ exitCode }) => {
    sessions.delete(id);
    notifier?.("terminal-exit", { id, exitCode });
  });
  return { id, reused: false, cwd: root };
}

export function terminalInputOp(payload: { id: string; data: string }): { written: true } {
  const session = sessions.get(payload.id);
  if (session === undefined) throw Object.assign(new Error("终端会话不存在（已退出）"), { code: "TERMINAL_GONE" });
  session.lastActive = Date.now();
  session.pty.write(payload.data);
  return { written: true };
}

export function terminalResizeOp(payload: { id: string; cols: number; rows: number }): { resized: true } {
  const session = sessions.get(payload.id);
  if (session === undefined) throw Object.assign(new Error("终端会话不存在"), { code: "TERMINAL_GONE" });
  session.lastActive = Date.now();
  session.pty.resize(Math.max(2, Math.min(500, Math.floor(payload.cols))), Math.max(2, Math.min(200, Math.floor(payload.rows))));
  return { resized: true };
}

/** 周期回收（server 起 interval——idle 30min 杀 PTY；进程退出兜底 dispose）。 */
export function reapIdleTerminals(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActive > IDLE_REAP_MS) {
      session.pty.kill();
      sessions.delete(id);
    }
  }
}

export function disposeAllTerminals(): void {
  for (const [, session] of sessions) session.pty.kill();
  sessions.clear();
}

/** cwd 缺省回退（UI 未选项目时——用户主目录）。 */
export function defaultTerminalCwd(): string {
  return homedir() ?? path.parse(process.cwd()).root;
}
