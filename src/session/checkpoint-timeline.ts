/**
 * 检查点时间线（T-P3-174 批次 4——E11 checkpoint 的 UI 消费面）：
 *  - 时间线：从会话流提取 git 检查点事件（turn 开始前打点——"该轮模型动手
 *    前"的工作区状态），相邻检查点之间附 git diff --shortstat 变更统计
 *    （"该轮改了多少"的一眼读数）；
 *  - 回退：restoreWorkspaceToCheckpoint 复用 GitCheckpointService.restoreCodeTo
 *    的恢复语义（≤seq 最新检查点 → 丢弃 tracked 改动 → apply 快照）——host
 *    侧直接跑 git（同工作区原子操作），不依赖 child 存活（历史会话可回退）。
 * ref=null 语义 = "该时点工作区与 HEAD 一致"（git-checkpoint.ts 头注释的
 * 自觉偏离）；diff 的 exitCode 1 = 有差异（业务结果，非错误）。
 */

import { createGitRunner, type GitRunner } from "./git-checkpoint.js";
import type { SessionEvent } from "../core/index.js";

export interface CheckpointTimelineItem {
  /** 检查点事件 seq（回退目标定位键）。 */
  seq: number;
  /** 打点时的轮号（turn 开始前打点——该轮改动的"改前"锚）。 */
  turn: number;
  /** 事件时间（epoch 毫秒）。 */
  ts: number;
  /** stash 快照 ref（null = 与 HEAD 一致）。 */
  ref: string | null;
  /** 与上一检查点之间的变更统计（git diff --shortstat；首个检查点无前项 = null）。 */
  changesText?: string;
  /** 变更统计不可得（git 失败/非 git 目录）——诚实降级标注。 */
  changesUnavailable?: string;
}

function resolveRef(ref: string | null): string {
  return ref === null || ref === "" ? "HEAD" : ref;
}

function runDiff(runGit: GitRunner, from: string, to: string): Promise<{ text?: string; error?: string }> {
  return runGit(["diff", "--shortstat", from, to]).then((r) => {
    const text = r.stdout.trim();
    // diff 的退出码 1 = 有差异（业务结果）；非 0/1 或 stderr 才是真失败
    if (r.exitCode !== 0 && r.exitCode !== 1) {
      return { error: r.stderr.trim() || `git diff 退出码 ${r.exitCode}` };
    }
    return { ...(text !== "" ? { text } : {}) };
  });
}

/**
 * 时间线构建（读面：事件流 + git diff——不触碰工作区）。git 不可用时变更
 * 统计诚实降级（changesUnavailable），时间线本身仍可用（回退不受影响）。
 */
export async function checkpointTimelineFromEvents(
  events: readonly SessionEvent[],
  repoRoot: string,
  runGit: GitRunner = createGitRunner(repoRoot),
): Promise<{ items: CheckpointTimelineItem[] }> {
  const checkpoints = events.filter(
    (e) => e.type === "checkpoint" && e.provider === "git",
  );
  const items: CheckpointTimelineItem[] = [];
  let prevRef: string | null = null;
  let hasPrev = false; // "首个检查点无前项"哨兵——prevRef=null（与 HEAD 一致）是合法基线，不是"无前项"
  for (const e of checkpoints) {
    if (e.type !== "checkpoint" || e.provider !== "git") continue; // 收窄
    const ref = (e.ref as string | null) ?? null;
    const item: CheckpointTimelineItem = { seq: e.seq, turn: e.turn, ts: e.ts, ref };
    if (hasPrev) {
      const diff = await runDiff(runGit, resolveRef(prevRef), resolveRef(ref));
      if (diff.error !== undefined) item.changesUnavailable = diff.error;
      else if (diff.text !== undefined) item.changesText = diff.text;
    }
    items.push(item);
    prevRef = ref;
    hasPrev = true;
  }
  return { items };
}

/**
 * 工作区回退（写面：git checkout 丢弃 tracked 改动 + stash apply 快照）——
 * 与 GitCheckpointService.restoreCodeTo 同语义（历史会话无 child 时 host 侧
 * 的等价执行面）。失败抛明确错误（调用方回 UI——代码回退绝不静默吞掉）。
 */
export async function restoreWorkspaceToCheckpoint(
  events: readonly SessionEvent[],
  seq: number,
  runGit: GitRunner,
): Promise<{ applied: true; ref: string | null }> {
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
  const reset = await runGit(["checkout", "--", "."]);
  if (reset.exitCode !== 0) {
    throw new Error(`代码恢复失败（git checkout 丢弃工作区改动被拒：${reset.stderr.trim()}）`);
  }
  if (target.ref === null || target.ref === "") return { applied: true, ref: null }; // 检查点 = 与 HEAD 一致
  const apply = await runGit(["stash", "apply", target.ref]);
  if (apply.exitCode !== 0) {
    throw new Error(`代码恢复失败（git stash apply ${target.ref} 被拒：${apply.stderr.trim()}）`);
  }
  return { applied: true, ref: target.ref };
}
