/**
 * host server 测试件（K5/T-P1-128）——server.test.ts 的 helper 半边：
 * agent 注入（内存桥 / fake 脚本通道）、ui fixture、server rig、真实 ws
 * 客户端。*.test-utils.ts 与测试同规则（架构检查出边豁免）。
 */

import { PassThrough } from "node:stream";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import WebSocket from "ws";

import { decodeMessage, type AgentMessage, type AgentRequest } from "../kernel/agent-protocol.js";
import { runAgentChildStdio, type AgentChildOptions } from "../kernel/agent-process.js";
import { InMemoryEventStorage, type EventStorage } from "../session/store.js";
import { HostServer, type HostServerHandle } from "./server.js";
import type { AgentChannel } from "./bridge.js";

export const uiFixtures: string[] = [];
export const handles: HostServerHandle[] = [];


export function startMemoryChild(childOptions: AgentChildOptions): AgentChannel & { kill(): Promise<void> } {
  const childInput = new PassThrough();
  const childOutput = new PassThrough();
  childOutput.setEncoding("utf8");
  const done = runAgentChildStdio({
    ...childOptions,
    input: childInput,
    output: childOutput,
    exit: () => {
      childOutput.end();
    },
  }).then(
    () => undefined,
    () => undefined,
  );
  const messages = (async function* () {
    let buffer = "";
    for await (const chunk of childOutput) {
      buffer += chunk as string;
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl < 0) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim() === "") continue;
        yield decodeMessage(line);
      }
    }
  })();
  return {
    send: (request) => childInput.write(`${JSON.stringify(request)}\n`),
    messages,
    kill: async () => {
      childInput.end();
      await done;
    },
  };
}


export interface FakeAgent extends AgentChannel {
  sent: AgentRequest[];
  emit(message: AgentMessage): void;
  end(): void;
  kill(): Promise<void>;
}

export function fakeAgent(): FakeAgent {
  const sent: AgentRequest[] = [];
  const pending: AgentMessage[] = [];
  let ended = false;
  let wake: (() => void) | undefined;
  const emit = (message: AgentMessage): void => {
    pending.push(message);
    wake?.();
  };
  const channel: FakeAgent = {
    sent,
    send(request) {
      sent.push(request);
      // 真实 agent 对 prompt 必回 accepted（A9 收执面）——微任务回放避免
      // 与 ws 往返的竞态（accepted 先于 request 到达 bridge 即被丢弃）
      if (request.type === "prompt") {
        queueMicrotask(() => emit({ type: "accepted", messageId: request.messageId }));
      }
    },
    messages: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (pending.length > 0) {
            const message = pending.shift();
            if (message !== undefined) yield message;
          }
          if (ended) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = undefined;
        }
      },
    },
    emit,
    end() {
      ended = true;
      wake?.();
    },
    async kill() {
      this.end();
    },
  };
  return channel;
}

// ---------------------------------------------------------------------------
// server rig + ws 客户端
// ---------------------------------------------------------------------------


export function makeUiFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-ui-"));
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><html><title>aegent-test</title></html>");
  writeFileSync(path.join(dir, "app.js"), "export const x = 1;");
  writeFileSync(path.join(dir, "style.css"), "body{}");
  return dir;
}

