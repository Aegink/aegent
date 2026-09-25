/**
 * 代码状态检查点（E11，T-8-02）——git stash 快照与事件点对齐。
 * 形状取 pi·git-checkpoint.ts（"Creates git stash checkpoints at each turn
 * so /fork can restore code state"）：`git stash create` 产快照 ref、检查点
 * 与会话条目（我方 = 事件流）对齐、`git stash apply <ref>` 恢复。
 *
 * 打点时点是本卡的语义核心：**turn 开始前**（pi turn_start 回调 "before LLM
 * makes changes" 的等价时点）——stash create 捕获的是"当前工作区"，此刻的
 * 工作区就是"该轮模型动手前"的状态。场景①（工具改文件 → revert 到改前
 * 事件点）只有在改前有检查点才成立；turn 末打点捕获的永远是"改后"，无法
 * 回到"改前"。装配处（agent-process 的 kick 调度）在 loop.runTurn 之前调
 * capture(即将开始的 turn 号)，checkpoint 事件因此落在 turn/start 之前
 * （词汇表 checkpoint 无轮开启要求，只有 turn 归属字段）。
 *
 * 空 stash 的处理与 pi 不同（自觉偏离）：pi 对空 ref 直接跳过（不设检查点），
 * 那样"改前恰好干净"的场景①就没有可恢复的检查点。我方落 `checkpoint{ref:
 * null}` 表示"该时点工作区与 HEAD 一致"——restoreCodeTo 据此恢复到 HEAD。
 *
 * 恢复语义（restoreCodeTo(seq)）：找 seq 之前（≤）最新的 git 检查点 →
 * 先 `git checkout -- .` 丢弃当前 tracked 改动（revert 的代码面本来就要
 * 丢弃"未来"的改动；untracked 新文件不回退，与 stash create 不含 untracked
 * 一致，pi 同款边界）→ ref 非 null 再 `git stash apply <ref>`。
 * 非 git 目录：明确拒绝打点并提示（首次 warn，之后静默防刷屏），不做初始化
 * git 的隐式动作（卡面风险项）。
 */

import { execFile } from "node:child_process";

import type { SessionStore } from "./store.js";

/** git 命令运行器（注入面：生产 execFile，测试可注入记录器或真仓）。 */
export type GitRunner = (
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/** 生产实现：在 repoRoot 下执行 git 子命令（跨进程只传字符串参数，T9）。 */
export function createGitRunner(repoRoot: string): GitRunner {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        "git",
        [...args],
        { cwd: repoRoot, windowsHide: true },
        (error, stdout, stderr) => {
          // git 非零退出码是业务结果（not a repo / 冲突），不是基础设施崩溃
          const code = error !== null && error !== undefined ? ((error as { code?: number }).code ?? 1) : 0;
          resolve({
            stdout: String(stdout),
            stderr: String(stderr),
            exitCode: typeof code === "number" ? code : 1,
          });
        },
      );
    });
}

export interface GitCheckpointDeps {
  sessionId: string;
  store: SessionStore;
  runGit: GitRunner;
  /** 打点被拒绝（非 git 目录等）时的提示去向；缺省静默。 */
  onWarn?: (message: string) => void;
}

export class GitCheckpointService {
  private warned = false;

  constructor(private readonly deps: GitCheckpointDeps) {}

  /**
   * turn 开始前打点：stash create → checkpoint 事件落流（turn/start 之前，
   * 装配处 kick 调度调用）。失败不抛——打点是尽力而为的伴生动作，git 不可用
   * 时 turn 照常进行（restoreCodeTo 会明确报"无检查点"）。
   */
  async capture(turn: number): Promise<void> {
    const result = await this.deps.runGit(["stash", "create"]);
    if (result.exitCode !== 0) {
      // 非 git 目录 / git 不可用：明确拒绝打点并提示（首次提示，之后静默）
      if (!this.warned) {
        this.warned = true;
        this.deps.onWarn?.(
          `代码检查点未启用（git stash create 失败：${result.stderr.trim() || `退出码 ${result.exitCode}`}）——` +
            "非 git 目录不做初始化 git 的隐式动作",
        );
      }
      return;
    }
    const ref = result.stdout.trim();
    // 空输出 = 工作区与 HEAD 一致（pi 在此跳过；我方落 ref:null 保留
    // "改前恰好干净"场景的恢复能力——头注释的自觉偏离）
    this.deps.store.append(this.deps.sessionId, [
      {
        type: "checkpoint",
        turn,
        provider: "git",
        ref: ref === "" ? null : ref,
      },
    ]);
  }

  /**
   * 恢复代码到 seq 时刻：≤seq 的最新 git 检查点 → 丢弃当前 tracked 改动 →
   * ref 非 null 时 apply 快照。无检查点 / apply 失败 / git 失败都抛明确错误
   * （调用方回 CLI error 行）——代码回退失败绝不能静默吞掉。
   */
  async restoreCodeTo(seq: number): Promise<void> {
    const events = this.deps.store.load(this.deps.sessionId);
    let target: { seq: number; ref: string | null } | undefined;
    for (const e of events) {
      if (e.type === "checkpoint" && e.provider === "git" && e.seq <= seq) {
        target = { seq: e.seq, ref: (e.ref as string | null) ?? null };
      }
    }
    if (target === undefined) {
      throw new Error(
        `无法恢复代码到 seq=${seq}：该事件点之前没有 git 检查点（检查点在每轮开始前打点）`,
      );
    }
    const reset = await this.deps.runGit(["checkout", "--", "."]);
    if (reset.exitCode !== 0) {
      throw new Error(
        `代码恢复失败（git checkout 丢弃工作区改动被拒：${reset.stderr.trim()}）`,
      );
    }
    if (target.ref === null) return; // 检查点 = 与 HEAD 一致，checkout 即恢复完成
    const apply = await this.deps.runGit(["stash", "apply", target.ref]);
    if (apply.exitCode !== 0) {
      throw new Error(
        `代码恢复失败（git stash apply ${target.ref} 被拒：${apply.stderr.trim()}）`,
      );
    }
  }
}
