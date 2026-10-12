/**
 * W19：/revert 双回退 CLI e2e 联测（自 src/session/git-checkpoint.test.ts 拆出
 * ——内核仓不含 CLI 面，产品仓保留本文件）。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "aegent-gitckpt-cli-"));
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

// ---------------------------------------------------------------------------
// CLI /revert 双回退联测（内存桥 + 真 git 仓 + 真 write 工具）——场景①端到端
// ---------------------------------------------------------------------------

import { PassThrough } from "node:stream";
import { runCli } from "../cli/repl.js";
import { runAgentChildStdio } from "../runtime/agent-process.js";
import { decodeMessage } from "../core/index.js";
import type { AgentConnection } from "../cli/repl.js";
import type { StreamChunk } from "../core/index.js";

describe("/revert 双回退（E4 对话态 + E11 代码态，场景①联测）", () => {
  it("审批放行 write 改文件 → /revert 到改前 → 文件与对话同时回退", async () => {
    const workspace = repo; // 工作区 = git 仓（装配 checkpointRepoRoot）
    const target = path.join(workspace, "baseline.txt");
    mkdirSync(workspace, { recursive: true });

    const childInput = new PassThrough();
    const childOutput = new PassThrough();
    childOutput.setEncoding("utf8");
    const done = runAgentChildStdio({
      input: childInput,
      output: childOutput,
      exit: () => childOutput.end(),
      assembly: {
        workspaceRoot: workspace,
        checkpointRepoRoot: workspace,
        contextWindow: 200_000,
        approvalTimeoutMs: 5_000,
      },
      provider: (() => {
        // 两轮剧本：第一轮产 write 调用（触发审批），第二轮空手收轮——
        // 每轮同名 call_1 会让审批走 Duplicate 无限循环（测试曾踩）
        let call = 0;
        return {
          async *streamChat() {
            call += 1;
            if (call === 1) {
              yield {
                type: "tool-call-delta",
                id: "call_1",
                name: "write",
                argsDelta: JSON.stringify({ path: target, content: "改后" }),
              } as StreamChunk;
              yield { type: "done" } as StreamChunk;
              return;
            }
            yield { type: "text-delta", text: "已写入。" } as StreamChunk;
            yield { type: "done" } as StreamChunk;
          },
        };
      })(),
    }).catch(() => undefined);

    const messages = (async function* () {
      let buffer = "";
      for await (const chunk of childOutput) {
        buffer += chunk as string;
        for (;;) {
          const nl = buffer.indexOf("\n");
          if (nl < 0) break;
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.trim() !== "") yield decodeMessage(line);
        }
      }
    })();
    const connection: AgentConnection = {
      send: (request) => childInput.write(`${JSON.stringify(request)}\n`),
      messages,
      kill: async () => {
        childInput.end();
        await done;
      },
    };

    const output: string[] = [];
    const waiters: { predicate: (l: string) => boolean; resolve: () => void }[] = [];
    const waitFor = (predicate: (l: string) => boolean): Promise<void> =>
      new Promise<void>((resolve) => {
        if (output.some(predicate)) {
          resolve();
          return;
        }
        waiters.push({ predicate, resolve });
      });
    const out = (line: string): void => {
      output.push(line);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i]!.predicate(line)) waiters.splice(i, 1)[0]!.resolve();
      }
    };

    // 会话前先打点验证"改前"基线：capture 在 kick 里做（turn 1 前的检查点
    // 落在 prompt 之后）——write 放行后文件为"改后"
    await runCli({
      connection,
      input: (async function* () {
        yield `把"改后"写进 ${target}`;
        await waitFor((l) => l.includes("⏸ 待审批 [call_1]"));
        yield "/approve call_1 allow";
        await waitFor((l) => l.includes("turn 1 结束"));
        yield "/revert 2"; // seq=2 = 改前事件点（checkpoint seq=1 ≤ 2）
        await waitFor((l) => l.includes("会话与代码已回退到 seq=2"));
      })(),
      out,
    });
    await connection.kill();

    // 代码态：文件回到改前（HEAD）内容
    expect(readFileSync(target, "utf8")).toBe("改前");
    // 对话态：输出含双回退回执与 revert 事件摘要
    expect(output.some((l) => l.includes("◆ 会话回退 → seq=2"))).toBe(true);
    expect(output.some((l) => l.includes("◆ 会话与代码已回退到 seq=2"))).toBe(true);
  });
});

