/**
 * todo_write 工具测试（G2 / T-P1-10）——参数校验 fail-closed 回喂 /
 * 落流（验收①：todo/update 事件 + 投影可查）/ turn 归属（会话级元事件
 * 纪律）/ 整值提交（E12）/ emit 崩溃不谎报 / 注册面（emit 缺省不注册）。
 */

import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../../../kernel/events.js";
import { createTodoUpdateEmitter } from "../../../kernel/assembly.js";
import { ToolRegistry } from "../registry.js";
import { createTodoWriteTool } from "./todo.js";
import { InMemoryEventStorage, SessionStore } from "../../../session/store.js";
import { project } from "../../../session/project.js";
import { registerBuiltinTools } from "./index.js";

/** 带 store 落流出口的 registry（生产接线同款：createTodoUpdateEmitter）。 */
function makeRegistry(store: SessionStore, sessionId = "s0"): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerTool(createTodoWriteTool({ emit: createTodoUpdateEmitter(store, sessionId) }));
  return registry;
}

function todoUpdateEvents(events: readonly SessionEvent[]) {
  return events.filter((e): e is Extract<SessionEvent, { type: "todo/update" }> => e.type === "todo/update");
}

describe("参数校验（fail-closed 回喂，emit 不被调）", () => {
  it("items 非数组 / 缺字段 / 坏 status → INVALID_ARGUMENTS 且定位到 items[i]", async () => {
    let emitted = 0;
    const registry = new ToolRegistry();
    registry.registerTool(
      createTodoWriteTool({
        emit: () => {
          emitted += 1;
        },
      }),
    );
    const cases: Array<[{ items?: unknown }, string]> = [
      [{}, "items"],
      [{ items: "三步走" }, "items"],
      [{ items: [{ status: "pending" }] }, "items[0].content"],
      [{ items: [{ content: "", status: "pending" }] }, "items[0].content"],
      [{ items: [{ content: "a", status: "done" }] }, "items[0].status"],
      [{ items: ["裸字符串"] }, "items[0]"],
    ];
    for (const [args, expected] of cases) {
      const result = await registry.dispatch({
        callId: "c",
        name: "todo_write",
        arguments: JSON.stringify(args),
      });
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.error?.code, JSON.stringify(args)).toBe("INVALID_ARGUMENTS");
      expect(result.content).toContain(expected);
    }
    expect(emitted).toBe(0);
  });

  it("超上限（>50 项 / content>500 字符）拒绝且不落流", async () => {
    const store = new SessionStore();
    const registry = makeRegistry(store);
    const tooMany = await registry.dispatch({
      callId: "c1",
      name: "todo_write",
      arguments: JSON.stringify({
        items: Array.from({ length: 51 }, (_, i) => ({ content: `t${i}`, status: "pending" })),
      }),
    });
    expect(tooMany.isError).toBe(true);
    expect(tooMany.content).toContain("最多 50 项");
    const tooLong = await registry.dispatch({
      callId: "c2",
      name: "todo_write",
      arguments: JSON.stringify({
        items: [{ content: "长".repeat(501), status: "pending" }],
      }),
    });
    expect(tooLong.isError).toBe(true);
    expect(tooLong.content).toContain("500 字符上限");
    expect(store.load("s0")).toHaveLength(0);
  });
});

describe("落流（验收①：todo/update 事件 + 投影可查）", () => {
  it("合法调用落 todo/update：seq 连续、items 整值、投影 todos 尾=当前值", async () => {
    const store = new SessionStore();
    const registry = makeRegistry(store);
    const result = await registry.dispatch({
      callId: "c1",
      name: "todo_write",
      arguments: JSON.stringify({
        items: [
          { content: "读 plan", status: "completed" },
          { content: "写事件", status: "in_progress" },
          { content: "验收", status: "pending" },
        ],
      }),
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("1/3 完成");
    const updates = todoUpdateEvents(store.load("s0"));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.items).toEqual([
      { content: "读 plan", status: "completed" },
      { content: "写事件", status: "in_progress" },
      { content: "验收", status: "pending" },
    ]);
    const projection = project(store.load("s0"));
    expect(projection.todos).toHaveLength(1);
    expect(projection.todos[0]!.items.map((i) => i.status)).toEqual([
      "completed",
      "in_progress",
      "pending",
    ]);
  });

  it("turn 归属：空流兜 0；有流挂最后轮（会话级元事件纪律）", async () => {
    const store = new SessionStore();
    store.append("s0", [
      { type: "turn/start", turn: 1 },
      { type: "turn/end", turn: 1, reason: { kind: "completed" } },
      { type: "turn/start", turn: 2 },
    ]);
    const registry = makeRegistry(store);
    await registry.dispatch({
      callId: "c1",
      name: "todo_write",
      arguments: JSON.stringify({ items: [{ content: "a", status: "pending" }] }),
    });
    expect(todoUpdateEvents(store.load("s0"))[0]!.turn).toBe(2);

    const empty = new SessionStore();
    const emptyRegistry = makeRegistry(empty, "fresh");
    await emptyRegistry.dispatch({
      callId: "c1",
      name: "todo_write",
      arguments: JSON.stringify({ items: [{ content: "a", status: "pending" }] }),
    });
    expect(todoUpdateEvents(empty.load("fresh"))[0]!.turn).toBe(0);
  });

  it("整值提交：第二次调用当前值被覆盖，两次更新都留历史（E12）", async () => {
    const store = new SessionStore();
    const registry = makeRegistry(store);
    await registry.dispatch({
      callId: "c1",
      name: "todo_write",
      arguments: JSON.stringify({
        items: [
          { content: "a", status: "in_progress" },
          { content: "b", status: "pending" },
        ],
      }),
    });
    await registry.dispatch({
      callId: "c2",
      name: "todo_write",
      arguments: JSON.stringify({
        items: [{ content: "a", status: "completed" }],
      }),
    });
    const projection = project(store.load("s0"));
    expect(projection.todos).toHaveLength(2);
    expect(projection.todos[1]!.items).toEqual([{ content: "a", status: "completed" }]);
    expect(projection.todos[1]!.seq).toBe(projection.todos[0]!.seq + 1);
  });

  it("emit 崩溃（流校验拒绝）→ 异常上抛交 loop 兜底 TOOL_EXECUTE_FAILED，绝不谎报成功", async () => {
    const registry = new ToolRegistry();
    registry.registerTool(
      createTodoWriteTool({
        emit: () => {
          throw new Error("append 失败");
        },
      }),
    );
    // 注册表分层：dispatch 只包"可预期失败"（isError 回喂），execute 崩溃
    // 原样上抛——loop.dispatchTool 兜底成 isError（registry.ts 头注释）。
    await expect(
      registry.dispatch({
        callId: "c1",
        name: "todo_write",
        arguments: JSON.stringify({ items: [{ content: "a", status: "pending" }] }),
      }),
    ).rejects.toThrow("append 失败");
  });
});

describe("注册面（BUILTIN_TOOL_NAMES 与生产接线同步）", () => {
  it("带 emit 注册含 todo_write；缺省不注册（不变量 1：无落流出口的状态写入不暴露）", () => {
    const withEmit = new ToolRegistry();
    registerBuiltinTools(withEmit, {
      todoEmit: () => undefined,
    });
    expect(withEmit.names()).toContain("todo_write");
    // 全配置（todoEmit + planMode）= BUILTIN_TOOL_NAMES 全集的等价断言在
    // plan-mode.test.ts（T-P1-11 起清单含 plan_enter/plan_exit）。

    const minimal = new ToolRegistry();
    registerBuiltinTools(minimal);
    expect(minimal.names()).not.toContain("todo_write");
    expect(minimal.names()).toHaveLength(7);
  });
});
