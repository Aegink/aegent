import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { decodeMessage, type AgentMessage } from "./agent-protocol.js";
import { runAgentChildStdio, spawnAgentProcess } from "./agent-process.js";
import { drainUntil, recvWithTimeout } from "../test-support/event-asserts.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const entryPath = path.join(root, "dist", "src", "kernel", "agent-child.js");

describe("agent-process —— T9 agent 出进程", () => {
  beforeAll(() => {
    // 子进程只能跑编译产物（node 22 无 TS loader；选型未含 tsx）——先构建
    execSync("npm run build", { cwd: root, stdio: "pipe" });
  }, 180_000);

  it("验收①：真实 stdio spawn——发 3 条 prompt 收全事件（管道不 mock）", async () => {
    const proc = spawnAgentProcess({ entryPath });

    const ready = await recvWithTimeout(proc.messages, (m) => m.type === "ready", "ready", 10_000);
    expect(ready).toEqual({ type: "ready" });

    for (let i = 1; i <= 3; i++) {
      proc.send({ type: "prompt", messageId: `m${i}`, content: `第 ${i} 问` });
      // A9：prompt 的应答只有入队收执，没有 per-prompt 结果消息
      const accepted = await recvWithTimeout(
        proc.messages,
        (m) => m.type === "accepted",
        `accepted(m${i})`,
        10_000,
      );
      expect(accepted).toEqual({ type: "accepted", messageId: `m${i}` });

      // 轮终态像任何消费者一样从事件流观察（无 session.finished）——
      // 收集到 turn/end 为止（O8：recv 全程带超时与具名期望）
      const { items, last } = await drainUntil(
        proc.messages,
        (m): m is Extract<AgentMessage, { type: "event" }> =>
          m.type === "event" && m.event.type === "turn/end",
        `turn/end(m${i})`,
        10_000,
      );
      const events = items
        .filter((m): m is Extract<AgentMessage, { type: "event" }> => m.type === "event")
        .map((m) => m.event);
      expect(events[0]!.type).toBe("turn/start");
      expect(last).toMatchObject({
        type: "event",
        event: { type: "turn/end", turn: i, reason: { kind: "completed" } },
      });
      const assistant = events.find((e) => e.type === "assistant/message");
      expect(assistant).toMatchObject({
        turn: i,
        message: { content: `echo: 第 ${i} 问` },
      });
    }
    await proc.kill();
  }, 60_000);

  it("进程编排：prompt 即答收执、轮后自动续开、dispose 优雅退出（进程内注入流）", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let exitCode: number | null = null;
    let resolveExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });

    const running = runAgentChildStdio({
      input,
      output,
      exit: (code) => {
        if (exitCode === null) {
          exitCode = code;
          resolveExit(code);
        }
      },
    });

    // 行 → 消息 的异步迭代器（与父进程同一套分帧逻辑的手工版）
    const items: AgentMessage[] = [];
    const waiters: ((r: IteratorResult<AgentMessage>) => void)[] = [];
    let buf = "";
    output.setEncoding("utf-8");
    output.on("data", (chunk: string) => {
      buf += chunk;
      for (;;) {
        const nl = buf.indexOf("\n");
        if (nl < 0) break;
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = decodeMessage(line);
        const w = waiters.shift();
        if (w) w({ value: msg, done: false });
        else items.push(msg);
      }
    });
    const iter = {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            const item = items.shift();
            if (item) return Promise.resolve({ value: item, done: false });
            return new Promise<IteratorResult<AgentMessage>>((resolve) =>
              waiters.push(resolve),
            );
          },
        };
      },
    };
    const next = async () => (await iter[Symbol.asyncIterator]().next()).value;

    expect(await next()).toEqual({ type: "ready" });
    input.write(`${JSON.stringify({ type: "prompt", messageId: "a", content: "甲" })}\n`);
    expect(await next()).toEqual({ type: "accepted", messageId: "a" });
    for (;;) {
      const m = await next();
      if (m.type === "event" && m.event.type === "turn/end") {
        expect(m.event.turn).toBe(1);
        break;
      }
    }

    // 第二条 prompt：无论调度器此刻忙/闲，收执即答、轮会续开（kick）
    input.write(`${JSON.stringify({ type: "prompt", messageId: "b", content: "乙" })}\n`);
    expect(await next()).toEqual({ type: "accepted", messageId: "b" });
    for (;;) {
      const m = await next();
      if (m.type === "event" && m.event.type === "turn/end") {
        expect(m.event.turn).toBe(2);
        break;
      }
    }

    input.write(`${JSON.stringify({ type: "dispose" })}\n`);
    expect(await exited).toBe(0);
    input.end();
    await running;
  }, 30_000);

  it("session/fork（E5/T-P1-40）：完整轮后 fork → forked 回执带切点；非法目标 → 类型化 error 行", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let exitCode: number | null = null;
    let resolveExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });

    const running = runAgentChildStdio({
      input,
      output,
      exit: (code) => {
        if (exitCode === null) {
          exitCode = code;
          resolveExit(code);
        }
      },
    });

    const items: AgentMessage[] = [];
    const waiters: ((r: IteratorResult<AgentMessage>) => void)[] = [];
    let buf = "";
    output.setEncoding("utf-8");
    output.on("data", (chunk: string) => {
      buf += chunk;
      for (;;) {
        const nl = buf.indexOf("\n");
        if (nl < 0) break;
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = decodeMessage(line);
        const w = waiters.shift();
        if (w) w({ value: msg, done: false });
        else items.push(msg);
      }
    });
    const iter = {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            const item = items.shift();
            if (item) return Promise.resolve({ value: item, done: false });
            return new Promise<IteratorResult<AgentMessage>>((resolve) =>
              waiters.push(resolve),
            );
          },
        };
      },
    };
    const next = async () => (await iter[Symbol.asyncIterator]().next()).value;

    expect(await next()).toEqual({ type: "ready" });
    input.write(JSON.stringify({ type: "prompt", messageId: "a", content: "甲" }) + "\n");
    for (;;) {
      const m = await next();
      if (m.type === "event" && m.event.type === "turn/end") break;
    }

    // fork 合法路径：forked 回执（sessionId/cutSeq/eventCount）
    input.write(JSON.stringify({ type: "session/fork", targetId: "f1" }) + "\n");
    const forked = await next();
    expect(forked).toEqual({
      type: "forked",
      sessionId: "f1",
      cutSeq: expect.any(Number),
      eventCount: expect.any(Number),
    });
    if (forked.type === "forked") {
      expect(forked.eventCount).toBe(forked.cutSeq + 1); // 复制前缀 + lineage 标记
    }

    // fork 非法路径：目标 id 冲突 → 类型化 error 行（连接不断）
    input.write(JSON.stringify({ type: "session/fork", targetId: "f1" }) + "\n");
    const err = await next();
    expect(err).toEqual({ type: "error", code: "FORK_TARGET_EXISTS", message: expect.any(String) });

    input.write(JSON.stringify({ type: "dispose" }) + "\n");
    expect(await exited).toBe(0);
    input.end();
    await running;
  }, 30_000);

  it("Q3 会话关闭触发 spill 清理（T-P1-14）：dispose 退出前清掉本会话自动可删文件", async () => {
    const spillDir = mkdtempSync(path.join(tmpdir(), "aegent-spill-wire-"));
    const writeSpill = (sessionId: string, deletable: "manual" | "after-session-end"): string => {
      const filePath = path.join(
        spillDir,
        `spill-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.txt`,
      );
      const marker = {
        kind: "aegent/tool-output-spill",
        sessionId,
        tool: "fake",
        callId: "c",
        createdAt: new Date().toISOString(),
        deletable,
        truncatedBy: "bytes",
      };
      writeFileSync(filePath, `${JSON.stringify(marker)}\n\n原文`, "utf8");
      return filePath;
    };
    // 预置四类：本会话自动可删（应清）/ 本会话 manual（留）/ 其他会话（留）/ 外来（留）
    const s0Auto = writeSpill("s0", "after-session-end");
    const s0Manual = writeSpill("s0", "manual");
    const s1File = writeSpill("s1", "after-session-end");
    const foreign = path.join(spillDir, "notes.txt");
    writeFileSync(foreign, "keep", "utf8");

    const input = new PassThrough();
    const output = new PassThrough();
    let exitCode: number | null = null;
    let resolveExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const running = runAgentChildStdio({
      input,
      output,
      exit: (code) => {
        if (exitCode === null) {
          exitCode = code;
          resolveExit(code);
        }
      },
      sessionId: "s0",
      spillDir,
    });
    output.resume(); // 本用例不消费协议消息，防 PassThrough 背压积压
    try {
      // 一轮完整对话确认子进程服务正常，随后 dispose 触发会话关闭清理
      input.write(`${JSON.stringify({ type: "prompt", messageId: "m1", content: "问" })}\n`);
      // 无消息消费需求：等 exit（dispose → finish 内的 sweep 完成后才 exit）
      input.write(`${JSON.stringify({ type: "dispose" })}\n`);
      expect(await exited).toBe(0);
      input.end();
      await running;
      // finish() 在 exit 前 await 清理——exit 码 0 落定时删除已结算
      expect(existsSync(s0Auto)).toBe(false);
      expect(existsSync(s0Manual)).toBe(true);
      expect(existsSync(s1File)).toBe(true);
      expect(existsSync(foreign)).toBe(true);
    } finally {
      rmSync(spillDir, { recursive: true, force: true });
    }
  }, 30_000);
});
