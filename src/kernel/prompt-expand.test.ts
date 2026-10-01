import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentChildStdio } from "./agent-process.js";
import { decodeMessage, type AgentMessage } from "./agent-protocol.js";
import type { PromptTemplateSummary } from "./prompts.js";
import { runPromptPolish } from "./prompt-polish.js";
import type { ModelProvider } from "../models/provider.js";

const disposables: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const d of disposables.splice(0).reverse()) await d();
});

/** agent-process 驱动手工版（agent-process.test 同款）：行 → 消息迭代器。 */
async function drive(options: Parameters<typeof runAgentChildStdio>[0]) {
  const input = new PassThrough();
  const output = new PassThrough();
  const running = runAgentChildStdio({ input, output, exit: () => {} , ...options });
  disposables.push(async () => {
    input.end();
    await running;
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
          return new Promise<IteratorResult<AgentMessage>>((resolve) => waiters.push(resolve));
        },
      };
    },
  };
  return {
    input,
    next: async (): Promise<AgentMessage> => (await iter[Symbol.asyncIterator]().next()).value,
    /** 收集至 turn/end（assistant/message 在 end 之前——一次性收集后断言）。 */
    async collectUntilTurnEnd(turn: number): Promise<AgentMessage[]> {
      const seen: AgentMessage[] = [];
      for (;;) {
        const m = await this.next();
        seen.push(m);
        if (m.type === "event" && m.event.type === "turn/end" && m.event.turn === turn) return seen;
      }
    },
  };
}

const assistantOf = (seen: AgentMessage[], turn: number): string | undefined => {
  for (const m of seen) {
    if (m.type === "event" && m.event.type === "assistant/message" && m.event.turn === turn) {
      return m.event.message?.content;
    }
  }
  return undefined;
};

const TEMPLATES: PromptTemplateSummary[] = [
  {
    name: "greet",
    description: "问好",
    argumentHint: "<name>",
    content: "$1 你好，欢迎 $1。",
    filePath: "/x/.zcode/prompts/greet.md",
    origin: "/x/.zcode/prompts",
  },
  { name: "fixed", content: "固定指令", filePath: "/x/.zcode/prompts/fixed.md", origin: "/x/.zcode/prompts" },
];

const fakeContext = {
  templates: TEMPLATES,
  disabled: ["fixed"],
  allowShellExpansion: false,
  workspaceRoot: "/x",
};

describe("提示词模板发送时展开链（T-P3-146 A）", () => {
  it("有参模板：/greet world → 参数替换 + command 原文落 user/message", async () => {
    const d = await drive({ promptContext: async () => fakeContext });
    expect(await d.next()).toMatchObject({ type: "ready" });
    d.input.write(`${JSON.stringify({ type: "prompt", messageId: "m1", content: "/greet world" })}\n`);
    expect(await d.next()).toEqual({ type: "accepted", messageId: "m1" });
    const seen = await d.collectUntilTurnEnd(1);
    expect(assistantOf(seen, 1)).toBe("echo: world 你好，欢迎 world。");
    const userMsg = seen.find((m) => m.type === "event" && m.event.type === "user/message");
    expect((userMsg as { event?: { command?: string } })?.event?.command).toBe("/greet world");
  }, 20_000);

  it("未知命令：本地拦截不进模型（类型化 PROMPT_COMMAND_UNKNOWN，不收执）", async () => {
    const d = await drive({ promptContext: async () => fakeContext });
    expect(await d.next()).toMatchObject({ type: "ready" });
    d.input.write(`${JSON.stringify({ type: "prompt", messageId: "m2", content: "/zzz args" })}\n`);
    expect(await d.next()).toMatchObject({ type: "error", code: "PROMPT_COMMAND_UNKNOWN" });
  });

  it("停用模板视同未知；工具名直通不展开", async () => {
    const d = await drive({ promptContext: async () => fakeContext });
    expect(await d.next()).toMatchObject({ type: "ready" });
    // fixed 在 disabled 名单 → PROMPT_COMMAND_UNKNOWN
    d.input.write(`${JSON.stringify({ type: "prompt", messageId: "m3", content: "/fixed" })}\n`);
    expect(await d.next()).toMatchObject({ type: "error", code: "PROMPT_COMMAND_UNKNOWN" });
    // 工具名（bash 是 builtin）直通为普通文本——echo 正常开轮回显
    d.input.write(`${JSON.stringify({ type: "prompt", messageId: "m4", content: "/bash 列出文件" })}\n`);
    expect(await d.next()).toEqual({ type: "accepted", messageId: "m4" });
    const seen = await d.collectUntilTurnEnd(1);
    expect(assistantOf(seen, 1)).toBe("echo: /bash 列出文件");
  }, 20_000);

  it("无占位符模板 + 参数 = 空行追加；ready 目录含 builtin", async () => {
    const ctx = { ...fakeContext, disabled: [] };
    const d = await drive({ promptContext: async () => ctx });
    const ready = await d.next();
    expect(ready.type).toBe("ready");
    expect((ready as { prompts?: { name: string; source: string }[] }).prompts?.some((p) => p.name === "init" && p.source === "builtin")).toBe(true);
    d.input.write(`${JSON.stringify({ type: "prompt", messageId: "m5", content: "/fixed 附加要求" })}\n`);
    expect(await d.next()).toEqual({ type: "accepted", messageId: "m5" });
    const seen = await d.collectUntilTurnEnd(1);
    expect(assistantOf(seen, 1)).toBe("echo: 固定指令\n\n附加要求");
  }, 20_000);
});

describe("一键润色旁路调用（T-P3-146 I）", () => {
  it("协议回执：polish → polish_result（模型文本经 strip 后回传）", async () => {
    const provider: ModelProvider = {
      async *streamChat(req) {
        for (const m of req.messages) {
          if (m.role === "user") {
            yield { type: "text-delta", text: `改写：${m.content}` };
          }
        }
        yield { type: "done" };
      },
    };
    const d = await drive({
      polish: { model: { provider, identity: { provider: "echo", modelId: "p1" } } },
    });
    expect(await d.next()).toMatchObject({ type: "ready" });
    d.input.write(`${JSON.stringify({ type: "polish", requestId: "p1", draft: "帮我修bug" })}\n`);
    for (;;) {
      const m = await d.next();
      if (m.type === "polish_result") {
        expect(m.ok).toBe(true);
        expect(m.text).toContain("帮我修bug");
        break;
      }
    }
  });
  it("runPromptPolish：用户模板 split/join 填充 + 空输出类型化失败", async () => {
    const provider: ModelProvider = {
      async *streamChat() {
        yield { type: "text-delta", text: "  " };
        yield { type: "done" };
      },
    };
    await expect(
      runPromptPolish({ provider, identity: { provider: "e", modelId: "m" }, draft: "x" }),
    ).rejects.toMatchObject({ code: "POLISH_EMPTY" });
  });
});
