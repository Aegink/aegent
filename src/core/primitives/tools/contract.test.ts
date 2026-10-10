import { describe, expect, it } from "vitest";
import type { ToolResultEvent } from "../../skeleton/events.js";
import { ScriptedProvider, makeLoop } from "../loop/loop.test-utils.js";
import { ToolRegistry, type ToolDef } from "./registry.js";
import { isContractResult, projectResult } from "./contract.js";

describe("projectResult / isContractResult（B12 投影）", () => {
  it("识别契约富值（value + render 函数）与纯投影值", () => {
    expect(
      isContractResult({ value: 1, render: () => "x" }),
    ).toBe(true);
    expect(isContractResult({ content: "x" })).toBe(false);
    expect(isContractResult({ value: 1 })).toBe(false); // 无 render 不是契约
  });

  it("投影产出只含 content/isError/error/meta——无 value 键、无函数", async () => {
    interface RichValue {
      fn: () => string;
      rows: { id: number; pad: string }[];
    }
    const value: RichValue = {
      // 故意含函数与大对象——都不得出现在投影产物里
      fn: () => "boom",
      rows: Array.from({ length: 5000 }, (_, i) => ({ id: i, pad: "x".repeat(64) })),
    };
    const projected = await projectResult({ q: "x" }, {
      value,
      meta: { rows: 5000 },
      render: (_args, v: { rows: { id: number; pad: string }[] }) => `matched ${String(v.rows.length)} rows`,
    });
    const serialized = JSON.stringify(projected);
    expect(Object.keys(projected).sort()).toEqual(["content", "meta"]);
    expect(projected.content).toBe("matched 5000 rows");
    expect(serialized).not.toContain("fn");
    expect(serialized.length).toBeLessThan(200); // 体积 = render 产物级别，非 5000 行大对象
    expect(serialized).not.toContain("value");
  });
});

describe("registry.dispatch 集成（契约工具 → 投影 + 截断链共存）", () => {
  it("返回契约富值的工具经 dispatch 落投影产物（含 isError 通道）", async () => {
    const registry = new ToolRegistry();
    const def: ToolDef = {
      name: "query",
      execute: () => ({
        value: { hits: [1, 2, 3], internal: () => 42 },
        isError: false,
        meta: { count: 3 },
        render: (_args, value: { hits: number[] }) => `hits=${String(value.hits.length)}`,
      }),
    };
    registry.registerTool(def);
    const result = await registry.dispatch({ callId: "c1", name: "query", arguments: "{}" });
    expect(result.content).toBe("hits=3");
    expect(result.meta).toEqual({ count: 3 });
    expect(JSON.stringify(result)).not.toContain("internal");
    expect(JSON.stringify(result)).not.toContain("value");
  });

  it("契约的 isError/error 通道投影正确", async () => {
    const registry = new ToolRegistry();
    registry.registerTool({
      name: "failing",
      execute: () => ({
        value: { detail: "坏输入的部分回显" },
        isError: true,
        error: { name: "QueryError", code: "BAD_INPUT" },
        render: (_args, value: { detail: string }) => `query failed: ${value.detail}`,
      }),
    });
    const result = await registry.dispatch({ callId: "c2", name: "failing", arguments: "{}" });
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("BAD_INPUT");
    expect(result.content).toBe("query failed: 坏输入的部分回显");
  });
});

describe("loop 落盘事件流验证（验收：事件 payload 无 value / 无函数）", () => {
  it("tool/result 事件的 payload 只含 render 产物，富值不出现在事件里", async () => {
    const provider = new ScriptedProvider();
    // 第一步：模型发 tool_call；第二步：空手，DecideTurn 显式 end
    provider.mount([
      { type: "tool-call-delta", id: "call-1", name: "query", argsDelta: '{"q":"x"}' },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "done" }, { type: "done" }]);

    const registry = new ToolRegistry();
    registry.registerTool({
      name: "query",
      execute: () => ({
        value: {
          secretFn: () => "NEVER",
          bigRows: Array.from({ length: 2000 }, (_, i) => ({ id: i, blob: "y".repeat(128) })),
        },
        render: (_args, value: { bigRows: { id: number }[] }) => `rows=${String(value.bigRows.length)}`,
      }),
    });

    const harness = makeLoop(provider, {
      executeTool: (call) => registry.dispatch(call),
    });
    await harness.loop.runTurn("跑一下 query");

    const toolResults = harness.store
      .load("s1")
      .filter((e): e is ToolResultEvent => e.type === "tool/result");
    expect(toolResults).toHaveLength(1);
    const payload = JSON.stringify(toolResults[0]);
    // 落盘事件：无 value 字段、无函数、无富值痕迹；体积是 render 产物级别
    expect(payload).not.toContain("value");
    expect(payload).not.toContain("secretFn");
    expect(payload).not.toContain("NEVER");
    expect(payload.length).toBeLessThan(500);
    const event = toolResults[0] as ToolResultEvent;
    expect(event.message.content).toBe("rows=2000");
    expect(event.callId).toBe("call-1");
  });
});
