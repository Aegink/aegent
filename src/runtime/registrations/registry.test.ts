/**
 * 装配注册清单测试（T5-4/EP-10）：按 id 寻址（重名拒绝）、依赖缺项
 * fail-closed、requires 拓扑（顺序无关 apply）、能力位传递。
 */
import { describe, expect, it } from "vitest";

import {
  RegistrationError,
  RegistrationList,
  type RuntimeApplyContext,
} from "./registry.js";

function makeCtx(): RuntimeApplyContext & { caps: Map<string, unknown>; logs: string[] } {
  const caps = new Map<string, unknown>();
  const logs: string[] = [];
  return {
    caps,
    logs,
    capability<T>(provides: string): T | undefined {
      return caps.get(provides) as T | undefined;
    },
    provide(provides: string, value: unknown): void {
      caps.set(provides, value);
    },
    log(message: string): void {
      logs.push(message);
    },
  };
}

describe("EP-10 注册清单（T5-4，dsh 装配数据化）", () => {
  it("按 id 寻址：重名 id 类型化拒绝；ids() 观测", () => {
    const list = new RegistrationList();
    list.register({ id: "sandbox.local", kind: "sandbox", provides: "sandbox.local", apply: () => {} });
    expect(list.ids()).toEqual(["sandbox.local"]);
    expect(() =>
      list.register({ id: "sandbox.local", kind: "sandbox", provides: "sandbox.local2", apply: () => {} }),
    ).toThrow(RegistrationError);
  });

  it("缺项 fail-closed：requirement 无提供方 → 拒绝且不执行任何 apply", async () => {
    const ctx = makeCtx();
    let applied = false;
    const list = new RegistrationList();
    list.register({
      id: "needs-ghost",
      kind: "tools",
      provides: "tools.x",
      requires: ["ghost.capability"],
      apply: () => {
        applied = true;
      },
    });
    await expect(list.applyAll(ctx)).rejects.toThrow(RegistrationError);
    expect(applied).toBe(false); // 缺项时不执行任何装配动作
  });

  it("顺序无关：乱序注册也按 requires 拓扑 apply（依赖先于依赖者）", async () => {
    const ctx = makeCtx();
    const order: string[] = [];
    const list = new RegistrationList();
    // 故意按"依赖者在前"的顺序注册
    list.register({
      id: "consumer",
      kind: "scheduler",
      provides: "scheduler.round-robin",
      requires: ["sandbox.local"],
      apply: (c) => {
        expect(c.capability("sandbox.local")).toBeDefined(); // 依赖已就绪
        order.push("consumer");
      },
    });
    list.register({
      id: "sandbox.local",
      kind: "sandbox",
      provides: "sandbox.local",
      apply: (c) => {
        c.provide("sandbox.local", { backend: "local" });
        order.push("sandbox.local");
      },
    });
    await list.applyAll(ctx);
    expect(order).toEqual(["sandbox.local", "consumer"]);
  });

  it("成环 fail-closed：互依注册拒绝（明确报告）", async () => {
    const ctx = makeCtx();
    const list = new RegistrationList();
    list.register({
      id: "a",
      kind: "lsp",
      provides: "lsp.a",
      requires: ["lsp.b"],
      apply: () => {},
    });
    list.register({
      id: "b",
      kind: "mcp",
      provides: "lsp.b",
      requires: ["lsp.a"],
      apply: () => {},
    });
    await expect(list.applyAll(ctx)).rejects.toThrow(/成环或缺项/);
  });

  it("六注册域并存：tools/channels/sandbox/scheduler/lsp/mcp 全部可注册与 apply", async () => {
    const ctx = makeCtx();
    const kinds = ["tools", "channels", "sandbox", "scheduler", "lsp", "mcp"] as const;
    const list = new RegistrationList();
    kinds.forEach((kind, i) => {
      list.register({ id: `${kind}.core`, kind, provides: `${kind}.core`, apply: (c) => c.provide(`${kind}.core`, i) });
    });
    await list.applyAll(ctx);
    expect(ctx.caps.size).toBe(6);
  });
});
