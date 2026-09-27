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
import type { ModelProvider } from "../models/provider.js";

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

  it("steer（A10/T-P1-47）：在途轮目标受理→step 边界消费；轮已结束 TURN_NOT_ACTIVE 拒绝且不入队", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let exitCode: number | null = null;
    let resolveExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });

    // 挂起 provider：第一次调用产 toolCall（decideTurn continue）后挂起
    // （steer 到达窗口），放行后收束；第二次调用直接收束（step 边界注入后的续步）。
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const requests: { messages: { content: string }[] }[] = [];
    let call = 0;
    const provider = {
      async *streamChat(req: { messages: { content: string }[] }) {
        requests.push(req);
        call += 1;
        if (call === 1) {
          yield { type: "tool-call-delta" as const, id: "c1", name: "read", argsDelta: '{"path":"a.txt"}' };
          await gate;
          yield { type: "done" as const };
        } else {
          yield { type: "text-delta" as const, text: "续步收束" };
          yield { type: "done" as const };
        }
      },
    };

    const running = runAgentChildStdio({
      input,
      output,
      provider: provider as never,
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
    expect(await next()).toEqual({ type: "accepted", messageId: "a" });
    // 等到 request/header（首次模型请求已发出、流在挂起中）——在途轮窗口
    for (;;) {
      const m = await next();
      if (m.type === "event" && m.event.type === "request/header") break;
    }
    // 流挂起期间 steer 到达：目标 = 活动轮 1 → 受理（无专用回执，A9 纪律）
    input.write(JSON.stringify({ type: "steer", expectedTurn: 1, content: "边跑边补充" }) + "\n");
    release();

    for (;;) {
      const m = await next();
      if (m.type === "event" && m.event.type === "turn/end") break;
    }
    // 受理路径零 error 行；steer 内容出现在下一次模型请求（A11），首轮请求不含
    expect(items.filter((m) => m.type === "error")).toEqual([]);
    expect(requests[0]!.messages.map((m) => m.content)).not.toContain("边跑边补充");
    expect(requests[1]!.messages.map((m) => m.content)).toContain("边跑边补充");

    // 轮已结束：steer 目标 1 不是活动轮 → TURN_NOT_ACTIVE 类型化拒绝
    input.write(JSON.stringify({ type: "steer", expectedTurn: 1, content: "迟到的补充" }) + "\n");
    const err = await next();
    expect(err).toEqual({ type: "error", code: "TURN_NOT_ACTIVE", message: expect.any(String) });

    input.write(JSON.stringify({ type: "dispose" }) + "\n");
    expect(await exited).toBe(0);
    input.end();
    await running;
  }, 30_000);

  it("M9/T-P1-48 有限队列：队列满时 prompt → QUEUE_FULL error 行且无收执、不入队", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let exitCode: number | null = null;
    let resolveExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });

    // 挂起 provider：轮 1 挂起中制造排队窗口
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let call = 0;
    const provider = {
      async *streamChat() {
        call += 1;
        if (call === 1) {
          yield { type: "tool-call-delta" as const, id: "c1", name: "read", argsDelta: "{}" };
          await gate;
          yield { type: "done" as const };
        } else {
          yield { type: "text-delta" as const, text: "收束" };
          yield { type: "done" as const };
        }
      },
    };

    const running = runAgentChildStdio({
      input,
      output,
      provider: provider as never,
      queueMaxSize: 2,
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
    expect(await next()).toEqual({ type: "accepted", messageId: "a" });
    // 等轮 1 真正开始（request/header 转发 = provider 流已开）再排队
    for (;;) {
      const m = await next();
      if (m.type === "event" && m.event.type === "request/header") break;
    }
    // 上限 2：b 入队（size 1）、c 入队（size 2）、d 超限 → QUEUE_FULL
    input.write(JSON.stringify({ type: "prompt", messageId: "b", content: "乙" }) + "\n");
    expect(await next()).toEqual({ type: "accepted", messageId: "b" });
    input.write(JSON.stringify({ type: "prompt", messageId: "c", content: "丙" }) + "\n");
    expect(await next()).toEqual({ type: "accepted", messageId: "c" });
    input.write(JSON.stringify({ type: "prompt", messageId: "d", content: "丁" }) + "\n");
    const err = await next();
    expect(err).toEqual({ type: "error", code: "QUEUE_FULL", message: expect.any(String) });

    release();
    for (;;) {
      const m = await next();
      if (m.type === "event" && m.event.type === "turn/end") break;
    }
    input.write(JSON.stringify({ type: "dispose" }) + "\n");
    expect(await exited).toBe(0);
    input.end();
    await running;
  }, 30_000);

  it("A8/T-P1-52 取消退回：aborted 轮后 prompt_returned 携带未消费条目、不自动续开、照常 idle", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let exitCode: number | null = null;
    let resolveExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });

    // 挂起 provider：轮 1 挂起中制造排队窗口
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let call = 0;
    const provider = {
      async *streamChat() {
        call += 1;
        if (call === 1) {
          yield { type: "tool-call-delta" as const, id: "c1", name: "read", argsDelta: "{}" };
          await gate;
          yield { type: "done" as const };
        } else {
          yield { type: "text-delta" as const, text: "不该被消费的续轮" };
          yield { type: "done" as const };
        }
      },
    };

    const running = runAgentChildStdio({
      input,
      output,
      provider: provider as never,
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
    expect(await next()).toEqual({ type: "accepted", messageId: "a" });
    for (;;) {
      const m = await next();
      if (m.type === "event" && m.event.type === "request/header") break;
    }
    // 轮 1 挂起中排队两条（未消费——尚未进入模型历史）
    input.write(JSON.stringify({ type: "prompt", messageId: "b", content: "乙" }) + "\n");
    expect(await next()).toEqual({ type: "accepted", messageId: "b" });
    input.write(JSON.stringify({ type: "prompt", messageId: "c", content: "丙" }) + "\n");
    expect(await next()).toEqual({ type: "accepted", messageId: "c" });
    // 取消当前轮：abort → 队列退回
    input.write(JSON.stringify({ type: "cancel", cause: { kind: "user" } }) + "\n");
    release();

    let sawReturned: string[] | null = null;
    let sawIdle = false;
    for (;;) {
      const m = await next();
      if (m.type === "prompt_returned") sawReturned = m.contents;
      if (m.type === "idle") {
        sawIdle = true;
        break;
      }
    }
    // 未消费的两条全量退回（FIFO）；不丢也不自动执行
    expect(sawReturned).toEqual(["乙", "丙"]);
    // 不自动续开：idle 宣告（无在途轮且队列空）而非第二轮事件
    expect(sawIdle).toBe(true);
    expect(call).toBe(1);

    input.write(JSON.stringify({ type: "dispose" }) + "\n");
    expect(await exited).toBe(0);
    input.end();
    await running;
  }, 30_000);

  it("J20/T-P1-49 收尾闭闸：dispose 后 prompt/steer → SERVER_DRAINING 类型化拒绝（连接不断）", async () => {
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
    // dispose（空闲时立即收尾）——闭闸后新输入被类型化拒绝
    input.write(JSON.stringify({ type: "dispose" }) + "\n");
    // 闭闸后紧接两条请求：prompt 与 steer 都得 SERVER_DRAINING（在 finish
    // 退出前到达——error 行先于进程退出写入）
    input.write(JSON.stringify({ type: "prompt", messageId: "late", content: "迟到的输入" }) + "\n");
    const err1 = await next();
    expect(err1).toEqual({
      type: "error",
      code: "SERVER_DRAINING",
      message: expect.any(String),
    });
    input.write(JSON.stringify({ type: "steer", expectedTurn: 1, content: "迟到的 steer" }) + "\n");
    const err2 = await next();
    expect(err2).toEqual({
      type: "error",
      code: "SERVER_DRAINING",
      message: expect.any(String),
    });

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

describe("assistant/retrying 一等事件（J27/T-P1-61）", () => {
  it("provider 层重试回调经观察者落流——协议 event 行可见（turn/step/attempt/delayMs/error）", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
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

    // 挂住的 provider：轮内模型请求挂起（模拟在途流），释放前在轮内触发重试回调
    let release: (() => void) | undefined;
    const heldProvider = {
      identity: { provider: "mock", modelId: "m-1" },
      async *streamChat() {
        yield { type: "text-delta", text: "前缀" };
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        yield { type: "done" };
      },
    };

    let observer: ((o: { attempt: number; delayMs: number; error: { errorName: string; errorMessage: string; statusCode?: number } }) => void) | undefined;
    const running = runAgentChildStdio({
      input,
      output,
      provider: heldProvider as never,
      exit: () => {},
    }, {
      registerRetryObserver: (fn) => {
        observer = fn;
      },
    });
    void running;

    for (let i = 0; i < 50 && observer === undefined; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(observer).toBeDefined();

    // 开轮（provider 挂住——轮保持在途，step=1 开启）
    input.write(
      `${JSON.stringify({ type: "prompt", messageId: "m-retry", content: "触发重试" })}\n`,
    );
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && release === undefined) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(release).toBeDefined();

    // 轮内触发重试回调 → 落流 → 协议 event 行转发
    observer!({
      attempt: 0,
      delayMs: 500,
      error: { errorName: "ProviderHttpError", errorMessage: "429 too many requests", statusCode: 429 },
    });

    // 释放 provider → 轮正常收尾
    release!();
    const deadline2 = Date.now() + 5_000;
    let retrying: Record<string, unknown> | undefined;
    while (Date.now() < deadline2) {
      const found = items.find(
        (m): m is Extract<AgentMessage, { type: "event" }> =>
          m.type === "event" && m.event.type === "assistant/retrying",
      );
      if (found) {
        retrying = found.event as unknown as Record<string, unknown>;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(retrying).toBeDefined();
    expect(retrying).toMatchObject({
      type: "assistant/retrying",
      turn: 1,
      step: 1,
      attempt: 0,
      delayMs: 500,
      error: { name: "ProviderHttpError", message: "429 too many requests", status: 429 },
    });
    input.end();
    await new Promise((r) => setTimeout(r, 50));
  }, 30_000);
});

describe("config/refresh 协议链（B21/T-P1-63）", () => {
  it("白名单 patch → config_refreshed 回执（applied）；静态键 → STATIC_CONFIG_IMMUTABLE error 行且零应用", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: AgentMessage[] = [];
    let buf = "";
    output.setEncoding("utf-8");
    output.on("data", (chunk: string) => {
      buf += chunk;
      for (;;) {
        const nl = buf.indexOf("\n");
        if (nl < 0) break;
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) lines.push(decodeMessage(line));
      }
    });
    const running = runAgentChildStdio({ input, output, exit: () => {} });
    void running;

    // 白名单刷新
    input.write(
      `${JSON.stringify({ type: "config/refresh", patch: { approvalTimeoutMs: 5_000 } })}\n`,
    );
    const deadline = Date.now() + 5_000;
    let refreshed: { type: string; applied?: string[] } | undefined;
    while (Date.now() < deadline) {
      const found = lines.find((m) => m.type === "config_refreshed");
      if (found) {
        refreshed = found as { type: string; applied?: string[] };
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(refreshed).toMatchObject({ type: "config_refreshed", applied: ["approvalTimeoutMs"] });

    // 静态键 → 类型化拒绝
    input.write(
      `${JSON.stringify({ type: "config/refresh", patch: { model: "gpt-9" } })}\n`,
    );
    const deadline2 = Date.now() + 5_000;
    let err: { type: string; code?: string } | undefined;
    while (Date.now() < deadline2) {
      const found = lines.find(
        (m): m is Extract<AgentMessage, { type: "error" }> =>
          m.type === "error" && m.code === "STATIC_CONFIG_IMMUTABLE",
      );
      if (found) {
        err = found;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(err).toBeDefined();
    input.end();
    await new Promise((r) => setTimeout(r, 50));
  }, 15_000);
});

// ---------------------------------------------------------------------------
// M3/T-P1-86 崩溃续跑：协议级 session/resume 三路 + "历史含工具结果、不重调"
// ---------------------------------------------------------------------------

import { findInterruptedTurn, reconcileBootState } from "../session/boot-maintenance.js";
import { InMemoryEventStorage } from "../session/store.js";
import type { NewSessionEvent } from "./events.js";
import type { AgentChildOptions } from "./agent-process.js";
import type { ChatRequest } from "../models/provider.js";
import type { SessionEvent } from "./events.js";

describe("session/resume（M3/T-P1-86）", () => {
  const letSeq = (start: number, events: NewSessionEvent[]): SessionEvent[] =>
    events.map((e, i) => ({ ...e, seq: start + i, ts: 1_700_000_000_000 }) as SessionEvent);

  const crashStorage = (): InMemoryEventStorage => {
    const storage = new InMemoryEventStorage();
    // 崩溃前缀：turn 1 step 1 完成（read 工具执行落流）→ step 2 开着 → 进程死亡
    storage.appendBatch(
      "s0",
      letSeq(1, [
        { type: "turn/start", turn: 1 },
        { type: "user/message", turn: 1, message: { content: "查一下配置" }, source: "user", promptId: "p1" },
        { type: "step/start", turn: 1, step: 1 },
        { type: "tool/call", turn: 1, step: 1, callId: "c1", name: "read", arguments: "{}" },
        { type: "tool/result", turn: 1, step: 1, callId: "c1", message: { content: "配置内容 X" } },
        { type: "assistant/message", turn: 1, step: 1, message: { content: "第一步完成" }, stream: [] },
        { type: "step/end", turn: 1, step: 1 },
        { type: "step/start", turn: 1, step: 2 },
      ]),
    );
    return storage;
  };

  const childHarness = (childOptions: AgentChildOptions = {}) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const running = runAgentChildStdio({ input, output, exit: () => {
        input.end();
      }, ...childOptions });
    output.setEncoding("utf-8");
    const items: AgentMessage[] = [];
    const waiters: ((m: AgentMessage) => void)[] = [];
    let buf = "";
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
        if (w) w(msg);
        else items.push(msg);
      }
    });
    return {
      running,
      items,
      next: (timeoutMs = 10_000): Promise<AgentMessage> => {
        const item = items.shift();
        if (item) return Promise.resolve(item);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("收消息超时")), timeoutMs);
          waiters.push((m) => {
            clearTimeout(timer);
            resolve(m);
          });
        });
      },
      send: (req: unknown): void => {
        input.write(`${JSON.stringify(req)}` + "\n");
      },
      end: async (): Promise<void> => {
        input.end();
        await running.catch(() => undefined);
      },
    };
  };

  it("无可续跑轮（干净流）→ NO_INTERRUPTED_TURN 类型化 error 行", async () => {
    const child = childHarness();
    expect(await child.next()).toEqual({ type: "ready" });
    child.send({ type: "session/resume" });
    const error = await child.next();
    expect(error).toMatchObject({ type: "error", code: "NO_INTERRUPTED_TURN" });
    // 零自动执行：resume 被拒后无任何轮启动（无事件行）
    expect(child.items.filter((m) => m.type === "event")).toHaveLength(0);
    await child.end();
  });

  it("resume 全链：restore → 对账闭合 → resumed 回执 → 新轮以原输入重开且模型历史含工具结果（不重调）", async () => {
    const storage = crashStorage();
    // 旧进程视角：同一份 storage 上 findInterruptedTurn 定位（对账在 resume 内做）
    const probe = childHarness({ storage });
    expect(await probe.next()).toEqual({ type: "ready" });

    const requests: ChatRequest[] = [];
    const provider: ModelProvider = {
      async *streamChat(req) {
        requests.push(req);
        yield { type: "text-delta", text: "续跑完成：配置已查明，无需重查" } as const;
        yield { type: "done" } as const;
      },
    };
    const child = childHarness({ storage, provider });
    expect(await child.next()).toEqual({ type: "ready" });
    await probe.end();

    child.send({ type: "session/resume" });
    // 对账闭合事件（ForwardingStore 转发）先于 resumed 回执到达——收集
    // 全部事件（对账闭合 + 新轮）直到 resumed 之后的 turn/end
    const events: SessionEvent[] = [];
    let resumed: Extract<AgentMessage, { type: "resumed" }> | null = null;
    for (;;) {
      const m = await child.next();
      if (m.type === "resumed") {
        resumed = m;
        continue;
      }
      if (m.type === "event") {
        events.push(m.event);
        if (resumed !== null && m.event.type === "turn/end") break;
      }
    }
    expect(resumed).toEqual({ type: "resumed", fromTurn: 1 });
    // 对账闭合先落（append-only：原轮 interrupted 闭合不删改）
    const kinds = events.map((e) => (e.type === "turn/end" ? e.reason.kind : e.type));
    expect(kinds[0]).toBe("step/end");
    expect(kinds[1]).toBe("interrupted");
    // 新轮以原输入重开（turn 2）并正常收束（M3 场景⑤）
    expect(events.filter((e) => e.type === "turn/start").map((e) => e.turn)).toEqual([2]);
    const resumedInput = events.find((e) => e.type === "user/message");
    expect(resumedInput).toMatchObject({ turn: 2, message: { content: "查一下配置" } });
    expect(kinds.at(-1)).toBe("completed");

    // "不重复已完成副作用"：模型请求的历史含原轮工具结果（结构保证），剧本
    // 只回话不调工具（行为结果）——工具没有第二次执行
    expect(requests).toHaveLength(1);
    const toolResults = requests[0]!.messages.filter((m) => m.role === "tool");
    expect(JSON.stringify(toolResults)).toContain("配置内容 X");
    const assistant = events.find((e) => e.type === "assistant/message");
    expect(assistant).toMatchObject({ turn: 2, message: { content: "续跑完成：配置已查明，无需重查" } });
    await child.end();
  });
});

// ---------------------------------------------------------------------------
// N1/T-P1-110：会话 id 形状校验（runAgentChildStdio 统一防御面——进程内
// 构造面与 wire 通道同规则；"s0" 等脚手架短 id 合法，wire 危险形状被拒）
// ---------------------------------------------------------------------------

describe("N1/T-P1-110 会话 id 校验（子进程入口防御面）", () => {
  it("options.sessionId 非法形状 → InvalidSessionIdError 启动即拒", async () => {
    await expect(
      runAgentChildStdio({ sessionId: "bad id", exit: () => {} }),
    ).rejects.toMatchObject({ code: "INVALID_SESSION_ID" });
    await expect(
      runAgentChildStdio({ sessionId: "", exit: () => {} }),
    ).rejects.toMatchObject({ code: "INVALID_SESSION_ID" });
  });

  it("合法短 id（s-ceiling 等）与缺省不受影响（回归锚）", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const running = runAgentChildStdio({
      sessionId: "s-ceiling",
      input,
      output,
      exit: () => {},
    });
    // ready 行可到即说明入口校验放行、装配正常
    output.setEncoding("utf-8");
    const firstLine = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("等待 ready 超时")), 3000);
      output.once("data", (chunk: string) => {
        clearTimeout(timer);
        resolve(chunk.trim());
      });
    });
    expect(firstLine).toContain("ready");
    input.end();
    await running;
  });
});
