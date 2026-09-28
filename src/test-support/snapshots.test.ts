import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createSnapshotter, firstDifference, snapshotToString, type GenerateCallSnapshot } from "./snapshots.js";

function modelCall(uuid: string, ts: number, answer: string): GenerateCallSnapshot {
  return {
    system: "You are aegent. Cwd is {{cwd}}.",
    tools: [
      {
        name: "bash",
        description: "Run a shell command.",
        // schema 原样进快照（负面发现：不做"只打名字"）
        parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
      },
    ],
    messages: [
      { role: "user", content: "hi", ts },
      { role: "assistant", content: answer, toolCallId: uuid },
    ],
  };
}

describe("模型上下文快照（O1/O5）", () => {
  it("验收③：同一逻辑流的两次快照逐字节相等（UUID/时间戳不同但归一化后一致）", () => {
    const runA = createSnapshotter({ cwd: "/home/run-a" });
    const runB = createSnapshotter({ cwd: "/home/run-b" });
    const snapA = runA(modelCall(randomUUID(), 1_700_000_000_001, "hello"));
    const snapB = runB(modelCall(randomUUID(), 1_799_999_999_999, "hello"));
    const textA = snapshotToString(snapA);
    const textB = snapshotToString(snapB);
    expect(textA).toBe(textB);
    expect(firstDifference(textA, textB)).toBeNull();
  });

  it("稳定标签保留身份：同一 callId 在 input 与 previous 中拿同一标签（可断言跨事件同 id）", () => {
    const snap = createSnapshotter();
    const id = randomUUID();
    const first = snap(modelCall(id, 1, "a"));
    const second = snap(modelCall(id, 2, "b"), first.input);
    const text = snapshotToString(second);
    // UUID 从未出现，但它的标签出现两次且指向同一身份
    expect(text).not.toContain(id);
    const occurrences = text.match(/\{\{uuid:01\}\}/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("previous 差分在序列化时现算：input 与 previous 的差异可逐字段定位", () => {
    const snap = createSnapshotter();
    const previous = snap(modelCall(randomUUID(), 1, "hello")).input;
    const changed = snap(modelCall(randomUUID(), 2, "world"), previous);
    // input 与 previous 同构，只有 assistant 回答不同——这是可断言的最小差分面
    expect(changed.previous).not.toBeNull();
    expect(changed.input.messages).toHaveLength(previous.messages.length);
    const lastA = changed.input.messages.at(-1) as { content: string };
    const lastB = (changed.previous!.messages.at(-1)) as { content: string };
    expect(lastA.content).not.toBe(lastB.content);
    expect(firstDifference(snapshotToString(changed), snapshotToString({ header: changed.header, input: changed.input, previous: changed.input })))
      .toBeTruthy();
  });

  it("工具快照带 schema 而非只打名字（O 层负面发现的正面钉子）", () => {
    const snap = createSnapshotter();
    const text = snapshotToString(snap(modelCall(randomUUID(), 1, "x")));
    expect(text).toContain('"cmd"');
    expect(text).toContain('"required"');
    expect(text).toContain('"description"');
  });

  it("keyless 复核（O28）：同一快照重复渲染逐字节相等，易变值无一漏网", () => {
    // 规格即断言（docs/test-policy.md §2）：同进程两遍逐字节等；跨进程由
    // 全量测试多次运行覆盖（任何一次全量绿即一次复核）
    const snap = createSnapshotter({ cwd: "/tmp/keyless-probe" })(
      modelCall(randomUUID(), 1_700_000_000_000, "same"),
      null,
      { whyEnded: "turn/end", scenario: "keyless 复核" },
    );
    const first = snapshotToString(snap);
    const second = snapshotToString(snap);
    expect(first).toBe(second);
    // 易变值三类漏网哨兵：UUID 原文 / ISO 时间 / 未归一路径不得出现在渲染文本
    expect(first).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(first).not.toContain("/tmp/keyless-probe");
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });
});
