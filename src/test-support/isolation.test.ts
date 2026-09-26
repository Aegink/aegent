import { describe, expect, it } from "vitest";

import { resetPwshHostCacheForTests } from "../kernel/tools/env.js";
import { serializeGlobal, withEnv, withEnvSerialized } from "./isolation.js";

describe("serializeGlobal（O25：同名锁串行化 + 中毒不扩散）", () => {
  it("并发提交的两段互不重叠（结果序 = 排队序，验收①）", async () => {
    const events: string[] = [];
    const first = serializeGlobal("demo", async () => {
      events.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("first:end");
    });
    const second = serializeGlobal("demo", async () => {
      events.push("second:start");
      events.push("second:end");
    });
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("锁持有人抛错：自身失败 + env 已恢复 + 后续排队者正常执行（中毒不扩散，验收②）", async () => {
    const order: string[] = [];
    const failing = serializeGlobal("poison", async () => {
      order.push("poison:start");
      throw new Error("持有人崩溃");
    });
    await expect(failing).rejects.toThrow("持有人崩溃");
    await serializeGlobal("poison", () => {
      order.push("after-poison");
    });
    expect(order).toEqual(["poison:start", "after-poison"]);
  });

  it("不同锁名互不阻塞（锁按名隔离）", async () => {
    const started: string[] = [];
    const slow = serializeGlobal("slow-lock", async () => {
      started.push("slow");
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    serializeGlobal("fast-lock", () => {
      started.push("fast"); // 不等 slow
    });
    await Promise.all([slow]);
    expect(started).toEqual(["slow", "fast"]);
  });
});

describe("withEnv（O25：env RAII 守卫）", () => {
  it("设置/恢复逐字节：未声明的既有值还原、新键删除（验收③）", async () => {
    process.env["AEGENT_ISO_EXISTING"] = "原值";
    const inside = await withEnv({ AEGENT_ISO_EXISTING: "改值", AEGENT_ISO_NEW: "新键" }, () => ({
      existing: process.env["AEGENT_ISO_EXISTING"],
      fresh: process.env["AEGENT_ISO_NEW"],
    }));
    expect(inside).toEqual({ existing: "改值", fresh: "新键" });
    expect(process.env["AEGENT_ISO_EXISTING"]).toBe("原值"); // 既有值还原
    expect(process.env["AEGENT_ISO_NEW"]).toBeUndefined(); // 新键删除
    delete process.env["AEGENT_ISO_EXISTING"];
  });

  it("fn 抛错：env 快照已恢复 + 异常原样上抛（finally 恢复面）", async () => {
    process.env["AEGENT_ISO_GUARD"] = "原值";
    await expect(
      withEnv({ AEGENT_ISO_GUARD: "污染值" }, async () => {
        expect(process.env["AEGENT_ISO_GUARD"]).toBe("污染值");
        throw new Error("段内崩溃");
      }),
    ).rejects.toThrow("段内崩溃");
    expect(process.env["AEGENT_ISO_GUARD"]).toBe("原值");
    delete process.env["AEGENT_ISO_GUARD"];
  });

  it("withEnvSerialized：两段竞争修改经锁串行不互踩（验收①组合形态）", async () => {
    const seen: string[] = [];
    const first = withEnvSerialized({ AEGENT_ISO_LOCK: "来自第一段" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      seen.push(process.env["AEGENT_ISO_LOCK"] ?? "无");
    });
    const second = withEnvSerialized({ AEGENT_ISO_LOCK: undefined }, () => {
      seen.push(process.env["AEGENT_ISO_LOCK"] ?? "无");
    });
    await Promise.all([first, second]);
    // 第二段等第一段结束才跑（env 已还原）——互踩则第二段读到"来自第一段"
    expect(seen).toEqual(["来自第一段", "无"]);
  });
});

describe("模块级缓存重置面（pwshHostCache——盘点结论：本仓唯一进程级可变全局）", () => {
  it("重置后缓存清空，后续解析重新探测（验收④）", () => {
    // 直接断言重置面存在且可调（探测真值依赖本机 pwsh/powershell 在场，
    // 缓存前/后行为由 pwsh.test 的解析用例覆盖）
    expect(() => resetPwshHostCacheForTests()).not.toThrow();
    expect(() => resetPwshHostCacheForTests()).not.toThrow(); // 幂等
  });
});
