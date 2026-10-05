// T-P3-174 批次 4：检查点时间线（diff 统计 + host 侧工作区回退——纯注入面）。
import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../kernel/events.js";
import {
  checkpointTimelineFromEvents,
  restoreWorkspaceToCheckpoint,
} from "./checkpoint-timeline.js";
import type { GitRunner } from "./git-checkpoint.js";

function checkpoint(seq: number, turn: number, ref: string | null): SessionEvent {
  return { type: "checkpoint", seq, ts: 1_700_000_000_000 + seq, turn, provider: "git", ref } as SessionEvent;
}

describe("checkpointTimelineFromEvents", () => {
  it("时间线提取 + 相邻 diff 统计（exitCode 1 = 有差异是业务结果）", async () => {
    const events: SessionEvent[] = [checkpoint(1, 1, "abc"), checkpoint(2, 2, null), checkpoint(3, 3, "def")];
    const calls: string[][] = [];
    const runGit: GitRunner = async (args) => {
      calls.push([...args]);
      return { stdout: " 2 files changed, 3 insertions(+)\n", stderr: "", exitCode: 1 };
    };
    const { items } = await checkpointTimelineFromEvents(events, "/repo", runGit);
    expect(items).toHaveLength(3);
    expect(items[0]!).toMatchObject({ seq: 1, turn: 1, ref: "abc" });
    expect(items[0]!.changesText).toBeUndefined(); // 首个检查点无前项基线
    expect(items[1]!.changesText).toContain("2 files changed");
    expect(items[2]!.changesText).toContain("2 files changed");
    // diff 请求面：prev→current（ref null 解析为 HEAD）
    expect(calls[0]!).toEqual(["diff", "--shortstat", "abc", "HEAD"]);
    expect(calls[1]!).toEqual(["diff", "--shortstat", "HEAD", "def"]);
  });
  it("git 失败：变更统计诚实降级（changesUnavailable），时间线本体可用", async () => {
    const runGit: GitRunner = async () => ({ stdout: "", stderr: "fatal: not a git repository", exitCode: 128 });
    const { items } = await checkpointTimelineFromEvents([checkpoint(1, 1, "abc"), checkpoint(2, 2, "def")], "/repo", runGit);
    expect(items[1]!.changesUnavailable).toContain("not a git repository");
    expect(items[0]!.changesUnavailable).toBeUndefined();
  });
});

describe("restoreWorkspaceToCheckpoint", () => {
  const events: SessionEvent[] = [checkpoint(1, 1, null), checkpoint(3, 2, "abc"), checkpoint(5, 3, "def")];
  it("定位 ≤seq 最新检查点 → checkout 丢弃 tracked → stash apply 快照", async () => {
    const calls: string[][] = [];
    const runGit: GitRunner = async (args) => {
      calls.push([...args]);
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const r = await restoreWorkspaceToCheckpoint(events, 4, runGit);
    expect(r).toEqual({ applied: true, ref: "abc" }); // seq=4 → 最新 ≤4 是 seq=3
    expect(calls).toEqual([["checkout", "--", "."], ["stash", "apply", "abc"]]);
  });
  it("目标 = ref:null 检查点 → 只 checkout（与 HEAD 一致即恢复完成）", async () => {
    const calls: string[][] = [];
    const runGit: GitRunner = async (args) => {
      calls.push([...args]);
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const r = await restoreWorkspaceToCheckpoint(events, 2, runGit);
    expect(r).toEqual({ applied: true, ref: null });
    expect(calls).toEqual([["checkout", "--", "."]]);
  });
  it("无检查点/checkout 被拒/apply 被拒——全部明确抛错（不静默）", async () => {
    await expect(restoreWorkspaceToCheckpoint([], 1, async () => ({ stdout: "", stderr: "", exitCode: 0 }))).rejects.toThrow(/没有 git 检查点/);
    const rejected: GitRunner = async (args) => ({
      stdout: "",
      stderr: args[0] === "checkout" ? "cannot checkout" : "conflict",
      exitCode: 1,
    });
    await expect(restoreWorkspaceToCheckpoint(events, 5, rejected)).rejects.toThrow(/checkout 丢弃工作区改动被拒/);
    const applyReject: GitRunner = async (args) => ({
      stdout: "",
      stderr: args[0] === "checkout" ? "" : "conflict",
      exitCode: args[0] === "checkout" ? 0 : 1,
    });
    await expect(restoreWorkspaceToCheckpoint(events, 5, applyReject)).rejects.toThrow(/stash apply def 被拒/);
  });
});
