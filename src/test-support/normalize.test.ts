import { describe, expect, it } from "vitest";

import { createSnapshotter, snapshotToString } from "./snapshots.js";
import {
  MAX_SNAPSHOT_LINE_CHARS,
  normalizeValue,
  PLACEHOLDERS,
  stableStringify,
  StableLabels,
  tagKnownDirectives,
  truncateLines,
} from "./normalize.js";

describe("归一化自测（O3/O6：归一化自己要有测试，覆盖路径/ID/时间戳三类）", () => {
  it("路径类：cwd 与临时目录前缀替换为具名占位符（POSIX 与 Windows 分隔符）", () => {
    const normalized = normalizeValue(
      {
        posix: "/home/u/proj/src/a.ts",
        win: "F:\\aegent\\src\\a.ts",
        tmp: "/tmp/aegent-t-123/spill.txt",
        unrelated: "/etc/hosts",
      },
      { cwd: "/home/u/proj", tmpRoot: "/tmp/aegent-t-123" },
    );
    expect(normalized).toEqual({
      posix: "{{cwd}}/src/a.ts",
      win: "F:\\aegent\\src\\a.ts", // cwd 前缀不匹配则原样保留
      tmp: "{{tmp}}/spill.txt",
      unrelated: "/etc/hosts",
    });
    expect(normalized).toMatchObject({ posix: `${PLACEHOLDERS.cwd}/src/a.ts` });
  });

  it("ID 类：UUID 换稳定标签，同一 UUID 出现多次拿同一标签（保留身份，O5）", () => {
    const labels = new StableLabels();
    const idA = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const idB = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    const events = [
      { type: "turn/start", id: idA },
      { type: "tool/call", id: idB },
      { type: "tool/result", callId: idB }, // 同 idB 出现在事件 1、2——标签必须相同
    ];
    const [first, second, third] = normalizeValue(events, { labels }) as Array<Record<string, string>>;
    expect(first!.id).toBe("{{uuid:01}}");
    expect(second!.id).toBe("{{uuid:02}}");
    expect(third!.callId).toBe(second!.id); // 身份保留：可断言"同一 id"
    expect(labels.entries()).toHaveLength(2);
  });

  it("ID 类：不同标签表对同一 UUID 给出同一标签号——跨 run 快照可比", () => {
    const uuid = "0b9e6c9d-5f3a-4c1e-8f2d-9a7b6c5d4e3f";
    const runA = normalizeValue({ id: uuid }, { labels: new StableLabels() }) as Record<string, string>;
    const runB = normalizeValue({ id: uuid }, { labels: new StableLabels() }) as Record<string, string>;
    expect(runA.id).toBe(runB.id);
  });

  it("时间戳类：ISO 串与时间键下的 epoch 数值都归一为 {{eventTime}}", () => {
    const normalized = normalizeValue(
      {
        ts: 1_700_000_000_123,
        time: 1_700_000_001,
        createdAt: "2026-09-25T02:00:00.000Z",
        timestamp: "2026-09-25T02:00:00+08:00",
        counter: 42, // 非 time 键、小数字：原样
        bigNumber: 5_000_000_000, // 非 time 键的大数字：原样
      },
      {},
    );
    expect(normalized).toEqual({
      ts: "{{eventTime}}",
      time: "{{eventTime}}",
      createdAt: "{{eventTime}}",
      timestamp: "{{eventTime}}",
      counter: 42,
      bigNumber: 5_000_000_000,
    });
  });

  it("嵌套结构与数组逐层归一化；非字符串叶子原样保留", () => {
    const normalized = normalizeValue(
      {
        outer: {
          list: [
            { ts: 1_700_000_000_000 },
            "9f8d7c6b-5a49-4c3e-8d2f-1a2b3c4d5e6f",
            true,
            null,
          ],
        },
      },
      { labels: new StableLabels() },
    );
    expect(normalized).toEqual({
      outer: { list: [{ ts: "{{eventTime}}" }, "{{uuid:01}}", true, null] },
    });
  });

  it("stableStringify 键序确定：同形状不同键序的输入逐字节相等", () => {
    const a = stableStringify({ b: 1, a: { y: 2, x: 3 } });
    const b = stableStringify({ a: { x: 3, y: 2 }, b: 1 });
    expect(a).toBe(b);
  });
});

describe("快照长行截断 + 长指引标签化（O27/T-P2-505）", () => {
  it("truncateLines：短行零变化，超长行截断 + 尾标带截去量", () => {
    expect(truncateLines("short\nline")).toBe("short\nline");
    const long = "x".repeat(200);
    const cut = truncateLines(long);
    expect(cut.startsWith("x".repeat(160))).toBe(true);
    expect(cut.endsWith("…[truncated 40 chars]")).toBe(true);
    // 多行混合：只有超长行被截
    expect(truncateLines(`${"a".repeat(20)}\n${"b".repeat(180)}`).split("\n")).toHaveLength(2);
  });

  it("truncateLines 自定义上限；缺省常量 = 160（codex 同值）", () => {
    expect(truncateLines("abcdef", 4)).toBe("abcd…[truncated 2 chars]");
    expect(MAX_SNAPSHOT_LINE_CHARS).toBe(160);
  });

  it("tagKnownDirectives：persona 段（机制段之后的拼接块）替换为一行标签，无命中零变化", () => {
    // 真实形状：assembly 首落 system = 机制段 + 人格段追加（T-P2-105 同款拼接）
    const system = [
      "# 会话机制",
      "工作区：/tmp/proj",
      "",
      "# 人格：平衡协作（{{workspace}}）",
      "",
      "你以清晰、审慎、可验证为第一优先级：先理解再动手。",
      "重要决策先向用户确认再执行。",
    ].join("\n");
    expect(tagKnownDirectives(system)).toBe(
      [
        "# 会话机制",
        "工作区：/tmp/proj",
        "",
        "[directive: persona]",
      ].join("\n"),
    );
    expect(tagKnownDirectives("普通文本不含人格标题")).toBe("普通文本不含人格标题");
  });

  it("snapshotToString 接线：system 里的指引段标签化，超长行整体截断", () => {
    const snap = createSnapshotter()({
      system: "# 人格：编码专注（/proj）\n\n你是深度专注的软件工程师。",
      tools: [],
      messages: [{ role: "user", content: "y".repeat(300) }],
    }, null, { whyEnded: "turn/end", scenario: "O27 接线" });
    const text = snapshotToString(snap);
    expect(text).toContain("[directive: persona]");
    expect(text).not.toContain("深度专注");
    expect(text).toContain("[truncated");
  });
});
