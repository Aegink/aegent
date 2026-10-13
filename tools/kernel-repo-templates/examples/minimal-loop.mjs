/**
 * agenticore 最小示例：一个完整 Agent 回合的全过程（零外部依赖）。
 *
 * 展示三件事：
 *   ① 回合循环：user 输入 → 模型请求 → 工具调用 → 工具结果 → 模型收尾 → turn 结束
 *   ② 事件流是唯一真相：每一步都落成不可变事件（seq 单调），投影从流重建
 *   ③ 装配即数据：模型（provider）与工具执行都是注入的普通函数——内核不认识
 *      "哪个模型/哪个工具"，只认识契约。
 *
 * 运行：npm run example（= tsc && node examples/minimal-loop.mjs）
 */
// 从编译产物导入（tsconfig 的 .js 说明符惯例——`npm run example` 会先跑 tsc）
import { AgentLoop, project } from "../dist/src/core/index.js";
import { SessionEventStore } from "../dist/src/session/store.js";

// ---------------------------------------------------------------------------
// 1) 脚本化模型："恰好两轮回应"——先要一次工具，再给最终答复。
//    真实场景里 provider 换成 Anthropic/OpenAI/Google 适配器即可，循环不变。
// ---------------------------------------------------------------------------
const script = [
  // 第一次模型调用：模型决定调用 bash 工具
  [
    { type: "text-delta", text: "我先看看当前时间。" },
    { type: "tool-call-delta", id: "call_1", name: "bash", argsDelta: '{"cmd":"date"}' },
    { type: "usage", usage: { inputTokens: 42, outputTokens: 18 } },
    { type: "done" },
  ],
  // 第二次模型调用（工具结果已回喂）：模型给出最终答复
  [
    { type: "text-delta", text: "现在是 2026 年 10 月 12 日，任务完成。" },
    { type: "usage", usage: { inputTokens: 88, outputTokens: 21 } },
    { type: "done" },
  ],
];
let call = 0;
const scriptedProvider = {
  async *streamChat() {
    const chunks = script[call] ?? [];
    call += 1;
    for (const chunk of chunks) yield chunk;
  },
};

// ---------------------------------------------------------------------------
// 2) 装配：事件流（内存后端）+ 工具执行器 + 回合决策——全部是注入的契约实现
// ---------------------------------------------------------------------------
const store = new SessionEventStore(); // 缺省 InMemoryEventStorage：零 native 依赖

const loop = new AgentLoop({
  sessionId: "demo",
  store,
  provider: scriptedProvider,
  identity: { provider: "example", modelId: "scripted-1" },
  // 工具执行器：这里是"内核看到的工具"——真实装配下 = ToolRegistry.dispatch
  executeTool: async (call) => {
    if (call.name === "bash") {
      const args = JSON.parse(call.arguments); // 内核把原始参数交给你解析
      return { content: `$ ${args.cmd}\n(模拟输出) 2026-10-12 13:00:00 CST` };
    }
    return { content: "", message: { content: "", isError: true } };
  },
  // 回合决策：内核不看"模型想不想停"，停/续由装配显式决定
  decideTurn: async (record) => (record.toolCalls.length > 0 ? { action: "continue" } : { action: "end" }),
});

// ---------------------------------------------------------------------------
// 3) 跑一个回合
// ---------------------------------------------------------------------------
const reason = await loop.runTurn("现在几点了？");

// ---------------------------------------------------------------------------
// 4) 展示：事件流（唯一真相）+ 投影（从流重建的对话）
// ---------------------------------------------------------------------------
const events = store.load("demo");

const summarize = (e) => {
  switch (e.type) {
    case "user/message":
      return `「${e.message.content}」`;
    case "assistant/message":
      return `「${e.message.content}」`;
    case "tool/call":
      return `${e.name} ${e.arguments}`;
    case "tool/result":
      return e.message.isError ? "✗ 失败" : `「${String(e.message.content).split("\n")[0]}」`;
    case "request/header":
      return `provider=${e.config.provider}/${e.config.modelId}`;
    case "turn/end":
      return `reason=${e.reason.kind}`;
    default:
      return "";
  }
};

console.log("═══ 事件流（append-only，seq 即真相顺序）═══\n");
for (const e of events) {
  const detail = summarize(e);
  console.log(`  #${String(e.seq).padStart(2)}  ${e.type.padEnd(16)} ${detail}`);
}

console.log("\n═══ 投影重建（从事件流 fold 出的对话——投影不是第二份状态）═══\n");
for (const m of project(events).messages) {
  const text = (m.content ?? "").replaceAll("\n", " ").slice(0, 72);
  console.log(`  [${m.role}]${" ".repeat(Math.max(0, 8 - m.role.length))}${text}`);
}

const usage = events.find((e) => e.type === "assistant/message" && e.usage)?.usage;
console.log(
  `\n═══ 统计 ═══\n  事件 ${events.length} 条 / 模型调用 2 次 / 工具执行 1 次` +
    (usage ? ` / token in=${usage.inputTokens} out=${usage.outputTokens}` : "") +
    `\n  回合终态：${reason.kind}`,
);
