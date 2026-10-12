/**
 * 代码状态检查点测试（E11，T-8-02）——临时 git 仓夹具 + 真实 store 事件流。
 * 核心 = 场景①的代码面验收：工具改文件 → revert 到改前事件点 → 工作区文件
 * 内容与改前一致。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {SessionEventStore, type SessionStore} from "./store.js";
import {
  GitCheckpointService,
  createGitRunner,
} from "./git-checkpoint.js";
import type { NewSessionEvent } from "../core/index.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "aegent-gitckpt-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(path.join(repo, "baseline.txt"), "改前", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"],
    { cwd: repo },
  );
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** 组装 service + 把"一轮"的最小合法事件流落进 store（checkpoint 由 capture 落）。 */
function makeService(runGit = createGitRunner(repo)) {
  const store = new SessionEventStore();
  const service = new GitCheckpointService({
    sessionId: "s0",
    store,
    runGit,
    onWarn: () => undefined,
  });
  return { store, service };
}

/** 一轮的最小合法事件流（checkpoint 由 capture 落在 turn/start 之前）。 */
function appendTurn(
  store: SessionStore,
  turn: number,
): void {
  const events: NewSessionEvent[] = [
    { type: "turn/start", turn },
    { type: "user/message", turn, message: { content: `第 ${turn} 轮指令` }, source: "user" },
    { type: "step/start", turn, step: 1 },
    { type: "assistant/message", turn, step: 1, message: { content: "改好了" }, stream: [] },
    { type: "step/end", turn, step: 1 },
    { type: "turn/end", turn, reason: { kind: "completed" } },
  ];
  store.append("s0", events);
}

describe("GitCheckpointService（T-8-02 · E11）", () => {
  it("场景①代码面：改文件 → 恢复到改前事件点 → 内容与改前一致", async () => {
    const { store, service } = makeService();
    // turn 1 开始前打点：工作区干净（= HEAD"改前"）→ ref:null 检查点
    await service.capture(1);
    const baselineSeq = store.load("s0").length; // checkpoint 的 seq（改前事件点）
    expect(baselineSeq).toBe(1);
    appendTurn(store, 1); // turn 1 的事件流（其中模型经工具改了文件——直接改工作区模拟）
    writeFileSync(path.join(repo, "baseline.txt"), "改后", "utf8");
    writeFileSync(path.join(repo, "new-file.txt"), "新文件", "utf8");
    // turn 2 开始前打点：工作区 dirty → stash ref 检查点
    await service.capture(2);
    const events = store.load("s0");
    expect(events.filter((e) => e.type === "checkpoint").length).toBe(2);

    // revert 到改前事件点（seq=1）→ checkout 到 HEAD → baseline.txt 回"改前"
    await service.restoreCodeTo(baselineSeq);
    expect(readFileSync(path.join(repo, "baseline.txt"), "utf8")).toBe("改前");

    // 恢复到改后事件点（seq=8，覆盖 ref 非 null 的检查点）→ apply 快照
    const afterSeq = events[events.length - 1]!.seq;
    await service.restoreCodeTo(afterSeq);
    expect(readFileSync(path.join(repo, "baseline.txt"), "utf8")).toBe("改后");
  });

  it("干净工作区打点落 ref:null 检查点（pi 跳过空 ref 的自觉偏离）", async () => {
    const { store, service } = makeService();
    await service.capture(1);
    const [checkpoint] = store.load("s0").filter((e) => e.type === "checkpoint");
    expect(checkpoint).toBeDefined();
    expect(checkpoint!.type === "checkpoint" ? checkpoint!.ref : undefined).toBeNull();
    expect(checkpoint!.type === "checkpoint" ? checkpoint!.provider : undefined).toBe("git");
  });

  it("非 git 目录明确拒绝打点并提示（首次 warn 后静默），不做隐式 git init", async () => {
    const warnings: string[] = [];
    const store = new SessionEventStore();
    const fakeRunner = async () => ({
      stdout: "",
      stderr: "fatal: not a git repository (or any of the parent directories): .git",
      exitCode: 128,
    });
    const service = new GitCheckpointService({
      sessionId: "s0",
      store,
      runGit: fakeRunner,
      onWarn: (m) => warnings.push(m),
    });
    await service.capture(1);
    await service.capture(2);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("代码检查点未启用");
    expect(store.load("s0").length).toBe(0); // 无 checkpoint 事件落流
  });

  it("restoreCodeTo 无检查点覆盖时抛明确错误", async () => {
    const { service } = makeService();
    await expect(service.restoreCodeTo(1)).rejects.toThrow("没有 git 检查点");
  });

  it("stash apply 失败（冲突等）抛含 stderr 的错误，不静默", async () => {
    const { store } = makeService(createGitRunner(repo));
    const calls: string[][] = [];
    const failingRunner = async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === "stash" && args[1] === "create") {
        return { stdout: "abc123\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "checkout") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "error: Your local changes would be overwritten", exitCode: 1 };
    };
    const service = new GitCheckpointService({
      sessionId: "s0",
      store,
      runGit: failingRunner,
    });
    store.append("s0", [{ type: "checkpoint", turn: 1, provider: "git", ref: "abc123" }]);
    await expect(service.restoreCodeTo(1)).rejects.toThrow("git stash apply abc123");
    expect(calls.some((c) => c.join(" ") === "stash apply abc123")).toBe(true);
  });
});
