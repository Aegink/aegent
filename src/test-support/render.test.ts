import { describe, expect, it } from "vitest";

import {
  formatGenerateInput,
  formatRequestWindow,
  renderEventStream,
  type EventStreamLine,
  type RenderableRequest,
} from "./render.js";

const TOOLS_A = [{ name: "bash" }, { name: "read" }];
const TOOLS_B = [{ name: "bash" }, { name: "read" }, { name: "write" }];

function req(overrides: Partial<RenderableRequest> = {}): RenderableRequest {
  return {
    identity: { provider: "mock", modelId: "m-1" },
    system: "你是测试助理",
    tools: TOOLS_A,
    messages: [{ role: "user", content: "hi" }],
    ...overrides,
  };
}

describe("formatGenerateInput（O24：变化才打印 + 默认值折叠成标签）", () => {
  it("首请求（无 previous）：全量渲染", () => {
    const text = formatGenerateInput(req());
    expect(text).toContain("identity: mock/m-1");
    expect(text).toContain("system: 你是测试助理");
    expect(text).toContain("tools: 2 件（bash, read）");
    expect(text).toContain("messages: 全量");
    expect(text).toContain("[0] user: hi");
    expect(text).not.toContain("[unchanged]");
  });

  it("system 与 tools 未变 → [unchanged] 标签（O24 验收原文语义）", () => {
    const previous = req({ messages: [{ role: "user", content: "hi" }] });
    const input = req({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "继续" },
      ],
    });
    const text = formatGenerateInput(input, previous);
    expect(text).toContain("system: [unchanged]");
    expect(text).toContain("tools: [unchanged]（2 件）");
    expect(text).not.toContain("你是测试助理"); // 未变不打印——折叠后可读
    expect(text).toContain("messages: 前缀延伸 +2 条：");
    expect(text).toContain("[1] assistant: hello");
    expect(text).toContain("[2] user: 继续");
    expect(text).not.toContain("[0] user: hi"); // 前缀不重打
  });

  it("消息非前缀（分叉）→ 全量渲染并标分叉点", () => {
    const previous = req({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });
    const input = req({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "被改写的历史" }, // 第 1 条变了
        { role: "user", content: "新方向" },
      ],
    });
    const text = formatGenerateInput(input, previous);
    expect(text).toContain("messages: 分叉于第 1 条（与前驱非前缀关系）——全量渲染");
    expect(text).toContain("[1] assistant: 被改写的历史");
    expect(text).toContain("[2] user: 新方向");
  });

  it("tool_calls 与 tool 消息渲染携带身份（callId）", () => {
    const text = formatGenerateInput(
      req({
        messages: [
          { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "bash" }] },
          { role: "tool", callId: "c1", content: "结果" },
        ],
      }),
    );
    expect(text).toContain("[0] assistant（tool_calls: bash@c1）");
    expect(text).toContain("[1] tool(c1): 结果");
  });
});

describe("formatRequestWindow（O14：首条全量、后续只留后缀；settings 变化开新窗）", () => {
  it("settings 不变 + 消息追加 → 同窗，首条全量后续只渲染后缀", () => {
    const text = formatRequestWindow([
      req(),
      req({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "ok" }] }),
      req({
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "ok" },
          { role: "user", content: "下一轮" },
        ],
      }),
    ]);
    expect(text).toContain("窗口 1（3 请求）——首个窗口");
    expect(text).toContain("#1 全量");
    expect(text).toContain("#2 前缀延伸: +1 messages（自 1 条起）");
    expect(text).toContain("#3 前缀延伸: +1 messages（自 2 条起）");
    expect(text).not.toContain("窗口 2");
  });

  it("identity 变更（换模）开新窗并记录原因（J6/F13 语义）", () => {
    const text = formatRequestWindow([
      req({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "ok" }] }),
      req({
        identity: { provider: "mock", modelId: "m-2" },
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "ok" },
        ],
      }),
    ]);
    expect(text).toContain("窗口 2（1 请求）——identity 变更（mock/m-1 → mock/m-2）");
    expect(text).toContain("#2 全量");
  });

  it("system prompt 变更与 tools 变更各自开新窗（codex 判据原文语义）", () => {
    const text = formatRequestWindow([
      req(),
      req({ system: "换了个系统提示" }),
      req({ system: "换了个系统提示", tools: TOOLS_B }),
    ]);
    expect(text).toContain("窗口 2（1 请求）——system prompt 变更");
    expect(text).toContain("窗口 3（1 请求）——tools 变更");
  });

  it("输入分叉（修改历史中间条目）开新窗并标分叉点", () => {
    const text = formatRequestWindow([
      req({
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "原版回复" },
        ],
      }),
      req({
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "改写回复" },
        ],
      }),
    ]);
    expect(text).toContain("窗口 2（1 请求）——输入分叉于第 1 条");
  });

  it("空序列与窗内多请求后缀逐条渲染", () => {
    expect(formatRequestWindow([])).toBe("（无请求）");
    const text = formatRequestWindow([
      req({ messages: [{ role: "user", content: "a" }] }),
      req({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }),
    ]);
    expect(text).toContain("[1] assistant: b");
    expect(text).not.toContain("[0] user: a\n      [0]"); // 前缀不在后缀段重复
  });
});

describe("renderEventStream（O23：列对齐 + 单行 JSON + 同流交错，T-P1-33）", () => {
  const lines: EventStreamLine[] = [
    { source: "emit", type: "user/message", payload: { message: { content: "hi" } } },
    { source: "wire", type: "request", payload: { id: 1, method: "prompt" } },
    { source: "emit", type: "tool/call", payload: { callId: "c1", name: "bash" } },
    { source: "wire", type: "message", payload: { kind: "approval_requested" } },
  ];

  it("列对齐：所有行 JSON 起始列相同（padEnd 断言）", () => {
    const text = renderEventStream(lines);
    const rows = text.split("\n");
    expect(rows).toHaveLength(4);
    const jsonStart = rows.map((row) => row.indexOf("{"));
    expect(new Set(jsonStart).size).toBe(1);
    // 长事件名决定对齐列，短名右侧补空格（user/message 自身最长，仅分隔空格）
    expect(rows[0]).toMatch(/^\[emit\] user\/message \{/);
    expect(rows[2]).toMatch(/^\[emit\] tool\/call {3} \{/);
    expect(rows[1]).toMatch(/^\[wire\] request {5} \{/);
  });

  it("单行 JSON：载荷含物理换行被转义，行数 = 输入数", () => {
    const text = renderEventStream([
      { source: "emit", type: "user/message", payload: { content: "第一行\n第二行\t制表" } },
      { source: "emit", type: "tool/call", payload: { nested: { deep: { x: [1, 2] } } } },
    ]);
    expect(text.split("\n")).toHaveLength(2);
    expect(text).toContain("第一行\\n第二行\\t制表");
  });

  it("emit/wire 混合序列保序交错、前缀正确（验收③）", () => {
    const text = renderEventStream(lines);
    const rows = text.split("\n");
    expect(rows.map((r) => r.slice(0, 6))).toEqual(["[emit]", "[wire]", "[emit]", "[wire]"]);
  });

  it("长载荷截断带标记（maxLineChars 可选；缺省不截）", () => {
    const big = "x".repeat(300);
    const stream: EventStreamLine[] = [
      { source: "emit", type: "assistant/message", payload: { content: big } },
    ];
    expect(renderEventStream(stream)).toContain(big); // 缺省不截
    const cut = renderEventStream(stream, { maxLineChars: 40 });
    expect(cut).toContain("…(+");
    expect(cut.length).toBeLessThan(80);
  });

  it("normalize 注入生效（易变值归一化接入点）与空流占位", () => {
    const text = renderEventStream(
      [{ source: "emit", type: "tool/call", payload: { callId: "uuid-1234" } }],
      { normalize: (p) => ({ ...(p as object), callId: "{{callId}}" }) },
    );
    expect(text).toContain("{{callId}}");
    expect(renderEventStream([])).toBe("（空事件流）");
  });
});
