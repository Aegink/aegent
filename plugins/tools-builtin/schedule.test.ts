/** T7-4 调度工具族测试：相对时间归一化 / CRUD 面闭环 / 默认不注册（preset 决定）。
 * W16 排查 B2：schedule_update 补齐（部分更新 + 不存在 NOT_FOUND）。 */
import { describe, expect, it } from "vitest";

import { createScheduleTools, normalizeRelativeDelay } from "./schedule.js";
import type { ScheduleToolDeps } from "./schedule.js";
import type { ToolDef } from "../../src/core/index.js";

const run = async (t: ToolDef, args: Record<string, unknown>): Promise<{ content: string; isError?: boolean; error?: { code: string } }> =>
  (await t.execute!(args as never, { toolCallId: "test" })) as never;
const tool = (ts: ToolDef[], name: string): ToolDef => {
  const t = ts.find((x) => x.name === name);
  if (t === undefined) throw new Error(`missing ${name}`);
  return t;
};

function makeDeps(): { deps: ScheduleToolDeps; rows: { id: string; expr: string; prompt: string }[] } {
  const rows: { id: string; expr: string; prompt: string }[] = [];
  let seq = 0;
  return {
    rows,
    deps: {
      add: async (expr, prompt) => {
        const id = `cron-${++seq}`;
        rows.push({ id, expr, prompt });
        return { id };
      },
      list: async () => rows,
      remove: async (id) => {
        const i = rows.findIndex((r) => r.id === id);
        if (i < 0) return false;
        rows.splice(i, 1);
        return true;
      },
      update: async (id, patch) => {
        const row = rows.find((r) => r.id === id);
        if (row === undefined) return false;
        if (patch.expr !== undefined) row.expr = patch.expr;
        if (patch.prompt !== undefined) row.prompt = patch.prompt;
        return true;
      },
    },
  };
}

describe("W16/T7-4 调度工具族（EP-7）", () => {
  it("相对时间归一化：N 分钟/小时/秒后 → 毫秒；非匹配返回 null", () => {
    expect(normalizeRelativeDelay("8分钟后")).toBe(480_000);
    expect(normalizeRelativeDelay("2小时后")).toBe(7_200_000);
    expect(normalizeRelativeDelay("30秒后")).toBe(30_000);
    expect(normalizeRelativeDelay("0 9 * * *")).toBeNull();
  });

  it("CRUD 闭环：create（相对时间归一化为 @once）→ list → delete；不存在 = SCHEDULE_NOT_FOUND", async () => {
    const { deps, rows } = makeDeps();
    const tools = createScheduleTools(deps);
    const created = await run(tool(tools, "schedule_create"), { expr: "8分钟后", prompt: "提醒我" });
    expect(created.content).toContain("@once+480000ms");
    expect(rows).toHaveLength(1);
    const listed = await run(tool(tools, "schedule_list"), {});
    expect(JSON.parse(listed.content as string)).toHaveLength(1);
    const removed = await run(tool(tools, "schedule_delete"), { id: "cron-1" });
    expect(removed.content).toContain("已删除");
    const ghost = await run(tool(tools, "schedule_delete"), { id: "cron-ghost" });
    expect(ghost.isError).toBe(true);
    expect(ghost.error?.code).toBe("SCHEDULE_NOT_FOUND");
  });

  it("W16 B2 回归：schedule_update 部分更新 + 不存在 NOT_FOUND + 缺参 INVALID_ARGUMENTS", async () => {
    const { deps, rows } = makeDeps();
    const tools = createScheduleTools(deps);
    await run(tool(tools, "schedule_create"), { expr: "0 9 * * *", prompt: "早报" });
    // 部分更新：只改 prompt
    const updated = await run(tool(tools, "schedule_update"), { id: "cron-1", prompt: "晚报" });
    expect(updated.content).toContain("已更新");
    expect(rows[0]).toMatchObject({ expr: "0 9 * * *", prompt: "晚报" });
    // 全缺参 = INVALID_ARGUMENTS
    const none = await run(tool(tools, "schedule_update"), { id: "cron-1" });
    expect(none.isError).toBe(true);
    expect(none.error?.code).toBe("INVALID_ARGUMENTS");
    // 不存在 = SCHEDULE_NOT_FOUND
    const ghost = await run(tool(tools, "schedule_update"), { id: "cron-ghost", expr: "0 10 * * *" });
    expect(ghost.isError).toBe(true);
    expect(ghost.error?.code).toBe("SCHEDULE_NOT_FOUND");
    // 四工具闭集（T7-4 卡面——W16 排查前缺 update）
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["schedule_create", "schedule_delete", "schedule_list", "schedule_update"],
    );
  });

  it("缺声明 = 从严：create/delete 都声明 needsApproval（W5 元数据——审批链消费）", () => {
    const tools = createScheduleTools(makeDeps().deps);
    const create = tools.find((t) => t.name === "schedule_create")!;
    expect(create.needsApproval).toBe(true);
    expect(create.sideEffectScope).toBe("workspace");
    expect(tools.find((t) => t.name === "schedule_update")!.needsApproval).toBe(true);
  });
});
