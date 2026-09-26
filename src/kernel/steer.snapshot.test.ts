import { describe, expect, it } from "vitest";

import type { AgentLoopDeps, DecideTurn } from "./loop.js";
import { PromptQueue } from "./queue.js";
import { ScriptedProvider, makeLoop } from "./loop.test-utils.js";

/**
 * steer 准入全链快照（O21/O22 反哺，T-P1-54）——批次 6 治理面的规格快照：
 * 读 Scenario 行即知被钉死的行为。事件流含 A12 关联 id（promptId）、A10 准入
 * 后的 step 边界注入位置（user/message 在 step/end 与下一 step/start 之间）、
 * A11 消费时点（注入后的 assistant/message 属于下一次请求的产出）。
 */

const SCENARIO =
  "steer 全链：在途轮受理补充指令（expectedTurn 准入）→ 已启动工具照常结算 → " +
  "step 边界注入 user/message（同一持久 turn，promptId 各一枚）→ 下一次模型请求才消费";

function renderSteerSnapshot(scenario: string, events: readonly unknown[]): string {
  const lines = [`Scenario: ${scenario}`];
  for (const e of events) {
    lines.push(`[emit] ${JSON.stringify(e)}`);
  }
  return lines.join("\n");
}

async function steerFlowSnapshot(): Promise<string> {
  const provider = new ScriptedProvider();
  provider.mount([
    { type: "text-delta", text: "先跑工具" },
    { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: "{}" },
    { type: "done" },
  ]);
  provider.mount([{ type: "text-delta", text: "已收到补充并收束" }, { type: "done" }]);
  const queue = new PromptQueue("one-at-a-time");
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let steered = false;
  const executeTool: AgentLoopDeps["executeTool"] = async () => {
    if (!steered) {
      steered = true;
      queue.enqueue("补充：把行号也报一下"); // 在途工具执行期间到达（受理窗口）
    }
    await gate;
    return { content: "工具完成" };
  };
  const { loop, store } = makeLoop(provider, { queue, executeTool });

  const done = loop.runTurn("开工");
  await new Promise<void>((r) => setTimeout(r, 0));
  release();
  await done;
  return renderSteerSnapshot(SCENARIO, store.load("s1"));
}

describe("steer 全链快照（O21/O22：批次 6 治理面规格一条）", () => {
  it("Scenario 头 + 事件面派生断言（promptId / 注入位置 / 配平 / 单终态）", async () => {
    const snapshot = await steerFlowSnapshot();
    expect(snapshot).toContain("Scenario: steer 全链");
    // A12：两条输入各一枚关联 id（p1 首条、p2 steer 注入）
    expect(snapshot).toContain('"promptId":"p1"');
    expect(snapshot).toContain('"promptId":"p2"');
    // A11：steer 的 user/message 落在 tool/result 之后（step 边界注入）、
    // 其内容出现在下一次请求的产出（第二个 assistant/message）之前
    const lines = snapshot.split("\n");
    const resultIdx = lines.findIndex((l) => l.includes('"type":"tool/result"'));
    const injectIdx = lines.findIndex((l) => l.includes("把行号也报一下"));
    const secondMsgIdx = lines.findIndex((l) => l.includes("已收到补充并收束"));
    expect(injectIdx).toBeGreaterThan(resultIdx);
    expect(secondMsgIdx).toBeGreaterThan(injectIdx);
    // 终态恰一且 completed
    expect(snapshot).toContain('"kind":"completed"');
    expect(lines.filter((l) => l.includes('"type":"turn/end"'))).toHaveLength(1);
  });
});
