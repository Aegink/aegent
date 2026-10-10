/** T7-4 调度工具族测试：相对时间归一化 / CRUD 面闭环 / 默认不注册（preset 决定）。 */
import { describe, expect, it } from "vitest";

import { createScheduleTools, normalizeRelativeDelay } from "./schedule.js";
import type { ToolDef } from "../../src/core/index.js";

const run = async (t: ToolDef, args: Record<string, unknown>): Promise<{ content: string; isError?: boolean; error?: { code: string } }> =>
  (await t.execute!(args as never, { toolCallId: "test" })) as never;
const tool = (ts: ToolDef[], name: string): ToolDef => {
  const t = ts.find((x) => x.name === name);
  if (t === undefined) throw new Error(`missing ${name}`);
  return t;
};

describe("W16/T7-4 调度工具族（EP-7）", () => {
  it("相对时间归一化：N 分钟/小时/秒后 → 毫秒；非匹配返回 null", () => {
    expect(normalizeRelativeDelay("8分钟后")).toBe(480_000);
    expect(normalizeRelativeDelay("2小时后")).toBe(7_200_000);
    expect(normalizeRelativeDelay("30秒后")).toBe(30_000);
    expect(normalizeRelativeDelay("0 9 * * *")).toBeNull();
  });

  it("CRUD 闭环：create（相对时间归一化为 @once）→ list → delete；不存在 = SCHEDULE_NOT_FOUND", async () => {
    const rows: { id: string; expr: string; prompt: string }[] = [];
    let seq = 0;
    const tools = createScheduleTools({
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
    });
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

  it("缺声明 = 从严：create/delete 都声明 needsApproval（W5 元数据——审批链消费）", () => {
    const tools = createScheduleTools({ add: async () => ({ id: "x" }), list: async () => [], remove: async () => true });
    const create = tools.find((t) => t.name === "schedule_create")!;
    expect(create.needsApproval).toBe(true);
    expect(create.sideEffectScope).toBe("workspace");
  });
});
