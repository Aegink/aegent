/** T7-6 goal 自主续跑驱动测试：配额/blocker/可裁。 */
import { describe, expect, it } from "vitest";
import { createGoalRoundDriver } from "./goal-round-driver.js";

describe("goal 自主续跑驱动（T7-6，dsh §13）", () => {
  it("goal 活跃 + 配额未尽 → 自动再起一轮（kick 收到 prompt；配额递减）", async () => {
    const kicks: string[] = [];
    const goal = {
      current: { text: "完成调研", status: "active" } as { text: string; status: string },
    };
    const driver = createGoalRoundDriver({
      goal: goal as never,
      kick: async (p) => {
        kicks.push(p);
      },
      quota: 3,
    });
    await driver.onIdle();
    expect(kicks).toHaveLength(1);
    expect(kicks[0]).toContain("完成调研");
    expect(driver.consumed).toBe(1);
  });

  it("配额耗尽 → blocker（不 kick；宿主落事实）", async () => {
    const kicks: string[] = [];
    const goal = { current: { text: "任务", active: true } };
    const driver = createGoalRoundDriver({ goal: goal as never, kick: async (p) => { kicks.push(p); }, quota: 1 });
    await driver.onIdle(); // 消耗 1/1
    const blocker = await driver.onIdle(); // 耗尽
    expect(kicks).toHaveLength(1); // 不再 kick
    expect(blocker).toEqual({ goalText: "任务", quota: 1, consumed: 1 });
  });

  it("goal 缺席/非活跃 → 不续跑（null）", async () => {
    const kicks: string[] = [];
    const driver = createGoalRoundDriver({
      goal: { current: null } as never,
      kick: async (p) => { kicks.push(p); },
    });
    expect(await driver.onIdle()).toBeNull();
    expect(kicks).toHaveLength(0);
    const driver2 = createGoalRoundDriver({
      goal: { current: { text: "x", status: "abandoned" } } as never,
      kick: async (p) => { kicks.push(p); },
    });
    expect(await driver2.onIdle()).toBeNull();
    expect(kicks).toHaveLength(0);
  });

  it("可裁：未装配驱动 = 现行为（不挂即不跑——本测试就是驱动缺席面）", () => {
    // 无断言——文档化"不装配即无此行为"
  });
});
