// T-P3-174 批次 4：thinking/set 落流归档——受理落流 + 重启后档位保持
//（runAgentChildStdio 内存桥 + 共享 storage 两段启动）。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { decodeMessage, type AgentMessage } from "./agent-protocol.js";
import { runAgentChildStdio } from "./agent-process.js";
import { InMemoryEventStorage } from "../session/store.js";
import { drainUntil } from "../test-support/event-asserts.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

interface Harness {
  input: PassThrough;
  send: (msg: unknown) => void;
  next: () => Promise<AgentMessage>;
  stop: () => Promise<void>;
  providerRequests: { reasoningEffort?: string }[];
}

function startChild(storage: InMemoryEventStorage, providerRequests: { reasoningEffort?: string }[]): Harness {
  const input = new PassThrough();
  const output = new PassThrough();
  const provider = {
    async *streamChat(req: unknown) {
      providerRequests.push(req as { reasoningEffort?: string });
      yield { type: "text-delta" as const, text: "ok" };
      yield { type: "done" as const };
    },
  };
  const running = runAgentChildStdio({
    input,
    output,
    provider: provider as never,
    storage,
    assembly: {
      workspaceRoot: mkdtempSync(path.join(tmpdir(), "aegent-think-")),
      contextWindow: 100_000,
      approvalTimeoutMs: 5_000,
    },
    exit: () => {},
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
  return {
    input,
    send: (msg) => void input.write(`${JSON.stringify(msg)}\n`),
    next: async () =>
      new Promise<AgentMessage>((resolve) => {
        const item = items.shift();
        if (item) return resolve(item);
        waiters.push((r) => resolve(r.value as AgentMessage));
      }),
    stop: async () => {
      input.write(`${JSON.stringify({ type: "dispose" })}\n`);
      input.end();
      await running;
    },
    providerRequests,
  };
}

describe("thinking/set 落流归档（T-P3-174 批次 4）", () => {
  it("受理落流（thinking/set 事件进流 + thinking_set 回执）；重启后 override 从流重建（provider 收到 reasoningEffort）", async () => {
    const storage = new InMemoryEventStorage();
    const requests: { reasoningEffort?: string }[] = [];

    // —— 第一段启动：发 thinking/set high ——
    const first = startChild(storage, requests);
    const ready1 = await first.next();
    first.send({ type: "thinking/set", level: "high" });
    // 落流的 ForwardingStore 先回显事件行，thinking_set 回执随后——循环过滤
    let receipt: AgentMessage;
    for (;;) {
      receipt = await first.next();
      if (receipt.type === "error") throw new Error(`error 回执：${JSON.stringify(receipt)}`);
      if (receipt.type === "thinking_set") break;
    }
    expect(receipt).toMatchObject({ type: "thinking_set", level: "high" });
    // 流内事实：thinking/set 事件已落（会话级元事件——turn 挂 0/流内最后轮）
    const stored = storage.readAll("s0");
    const thinkingEvent = stored.find((e) => e.type === "thinking/set");
    expect(thinkingEvent).toMatchObject({ level: "high" });
    // 覆盖即时生效：下一轮 provider 收到 reasoningEffort=high
    first.send({ type: "prompt", messageId: "m1", content: "第一问" });
    const deadline1 = Date.now() + 10_000;
    for (;;) {
      const m = await first.next();
      if (Date.now() > deadline1) throw new Error("第一段 turn/end 等待超时");
      if (m.type === "event" && m.event.type === "turn/end") break;
    }
    expect(requests[0]?.reasoningEffort).toBe("high"); // loop 注入形状：options 展开到请求顶层
    await first.stop();

    // —— 第二段启动（同 storage = "重启"）：override 从流重建 ——
    const second = startChild(storage, requests);
    const ready2 = await second.next();
    expect(ready2.type).toBe("ready");
    second.send({ type: "prompt", messageId: "m2", content: "第二问" });
    const deadline2 = Date.now() + 10_000;
    for (;;) {
      const m = await second.next();
      if (Date.now() > deadline2) throw new Error("第二段 turn/end 等待超时");
      if (m.type === "event" && m.event.type === "turn/end") break;
    }
    expect(requests[1]?.reasoningEffort).toBe("high"); // 重启后档位保持
    await second.stop();
  }, 30_000);
});
