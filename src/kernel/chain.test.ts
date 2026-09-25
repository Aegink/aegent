import { describe, expect, it } from "vitest";

import {
  CHAIN_POINTS,
  composeChain,
  namedLayer,
  type ChainNext,
} from "./chain.js";

describe("composeChain —— I12 洋葱链骨架", () => {
  it("验收①：两层时执行序 = 前1 → 前2 → 链底 → 后2 → 后1", async () => {
    const order: string[] = [];
    const executor = composeChain<{ who: string }, string, string>({
      point: "modelRequest",
      terminal: async ($, e) => {
        order.push(`terminal(${$.who})`);
        return `done(${e})`;
      },
      layers: [
        async ($, e, next) => {
          order.push(`1:before(${$.who})`);
          const v = await next(e);
          order.push("1:after");
          return v;
        },
        async (_$, e, next) => {
          order.push("2:before");
          const v = await next(e);
          order.push("2:after");
          return v;
        },
      ],
    });
    const outcome = await executor.run({ who: "loop" }, "x");
    expect(order).toEqual([
      "1:before(loop)",
      "2:before",
      "terminal(loop)",
      "2:after",
      "1:after",
    ]);
    expect(outcome).toEqual({ truncated: false, value: "done(x)" });
  });

  it("验收②：中间层不调 next —— 外层 after 仍执行、链底不执行、返回截断标记", async () => {
    const order: string[] = [];
    const executor = composeChain<undefined, string, string>({
      point: "toolCall",
      terminal: async () => {
        order.push("terminal");
        return "executed";
      },
      layers: [
        async (_$, _e, next) => {
          order.push("1:before");
          const v = await next("ignored");
          order.push("1:after");
          return v;
        },
        // 中间层截断：不调 next，直接给出自己的应答
        async () => {
          order.push("2:truncate");
          return "denied";
        },
        async () => {
          order.push("3:never");
          return "unreachable";
        },
      ],
    });
    const outcome = await executor.run(undefined, "payload");
    expect(order).toEqual(["1:before", "2:truncate", "1:after"]);
    expect(outcome).toEqual({ truncated: true, value: "denied" });
  });

  it("槽位零行为变化：不配 budgetMs 时 budget 恒空槽（P0 回归）", async () => {
    const seen: ChainNext<string, string>[] = [];
    const executor = composeChain<undefined, string, string>({
      point: "toolCall",
      terminal: async (_$, e) => e,
      layers: [
        async (_$, e, next) => {
          seen.push(next);
          return next(e);
        },
        async (_$, e, next) => {
          seen.push(next);
          return next(e);
        },
      ],
    });
    await executor.run(undefined, "p");
    expect(seen).toHaveLength(2);
    for (const next of seen) {
      expect(next.point).toBe("toolCall");
      expect(next.budget).toEqual({});
    }
  });

  it("I13 trace：每层看到走过层的序号+名字，完整层序在最内层可见", async () => {
    const traces: unknown[] = [];
    const executor = composeChain<undefined, string, string>({
      point: "toolCall",
      terminal: async (_$, e) => e,
      layers: [
        namedLayer("gate", async (_$, e, next) => {
          traces.push(["layer0 sees", [...next.trace]]);
          return next(e);
        }),
        namedLayer("hooks", async (_$, e, next) => {
          traces.push(["layer1 sees", [...next.trace]]);
          return next(e);
        }),
        async (_$, e, next) => {
          // 未命名层缺省 layer#<index>
          traces.push(["layer2 sees", [...next.trace]]);
          return next(e);
        },
      ],
    });
    await executor.run(undefined, "p");
    expect(traces).toEqual([
      ["layer0 sees", []],
      ["layer1 sees", [{ layer: 0, name: "gate" }]],
      [
        "layer2 sees",
        [
          { layer: 0, name: "gate" },
          { layer: 1, name: "hooks" },
        ],
      ],
    ]);
  });

  it("I13 trace：截断层之后的层不入轨迹（trace 反映实际走过的层）", async () => {
    let layer1Trace: unknown;
    const executor = composeChain<undefined, string, string>({
      point: "toolCall",
      terminal: async () => "terminal",
      layers: [
        namedLayer("gate", (_$, e, next) => next(e)),
        namedLayer("deny", () => "denied"),
        async (_$, e, next) => {
          layer1Trace = "reachable";
          return next(e);
        },
      ],
    });
    const outcome = await executor.run(undefined, "p");
    expect(outcome).toEqual({ truncated: true, value: "denied" });
    expect(layer1Trace).toBeUndefined();
  });

  it("I13 budget：remaining 随注入时钟衰减，内层看到的不大于外层", async () => {
    let clock = 1_000;
    const now = () => clock;
    const seen: number[] = [];
    const executor = composeChain<undefined, string, string>({
      point: "modelRequest",
      terminal: async (_$, e) => e,
      budgetMs: 500,
      now,
      layers: [
        async (_$, e, next) => {
          seen.push(next.budget.remaining!);
          clock += 120;
          return next(e);
        },
        async (_$, e, next) => {
          seen.push(next.budget.remaining!);
          return next(e);
        },
      ],
    });
    await executor.run(undefined, "p");
    expect(seen).toEqual([500, 380]);
  });

  it("I13 budget：超支保留真实负值（诊断面，不截到 0）", async () => {
    let clock = 0;
    let innerSeen: number | undefined;
    const executor = composeChain<undefined, string, string>({
      point: "toolCall",
      terminal: async (_$, e) => e,
      budgetMs: 100,
      now: () => clock,
      layers: [
        async (_$, e, next) => {
          clock = 250;
          return next(e);
        },
        async (_$, e, next) => {
          innerSeen = next.budget.remaining;
          return next(e);
        },
      ],
    });
    await executor.run(undefined, "p");
    expect(innerSeen).toBe(-150);
  });

  it("L10：terminal 缺失时链底 next 无人应答抛错并点名事件", async () => {
    const unanswered = composeChain<undefined, string, string>({
      point: "toolCall",
      layers: [async (_$, e, next) => next(e)],
    });
    await expect(unanswered.run(undefined, "p")).rejects.toThrow(
      /无人应答（point=toolCall）/,
    );

    // 对照：无人应答只发生在到达链底时——截断的链不触达链底，不抛
    const truncating = composeChain<undefined, string, string>({
      point: "modelRequest",
      layers: [() => "blocked"],
    });
    await expect(truncating.run(undefined, "p")).resolves.toEqual({
      truncated: true,
      value: "blocked",
    });
  });

  it("next(e2) 换载荷：链底收到变换后的载荷（modelRequest 点位的必备语义）", async () => {
    let got = "";
    const executor = composeChain<undefined, string, string>({
      point: "modelRequest",
      terminal: async (_$, e) => {
        got = e;
        return "ok";
      },
      layers: [async (_$, e, next) => next(`${e}+context`)],
    });
    await executor.run(undefined, "base");
    expect(got).toBe("base+context");
  });

  it("同一层重复调用 next 抛错（防同一动作双重执行）", async () => {
    const executor = composeChain<undefined, string, string>({
      point: "toolCall",
      terminal: async (_$, e) => e,
      layers: [
        async (_$, e, next) => {
          await next(e);
          return next(e);
        },
      ],
    });
    await expect(executor.run(undefined, "p")).rejects.toThrow(/重复调用 next/);
  });

  it("同步层支持：同步截断与同步透传都成立", async () => {
    const truncating = composeChain<undefined, string, string>({
      point: "turnEnd",
      terminal: async () => "terminal",
      layers: [() => "sync-denied"],
    });
    await expect(truncating.run(undefined, "p")).resolves.toEqual({
      truncated: true,
      value: "sync-denied",
    });

    const passing = composeChain<undefined, string, string>({
      point: "turnEnd",
      terminal: (_$, e) => e,
      layers: [(_$, e, next) => next(e)],
    });
    await expect(passing.run(undefined, "p")).resolves.toEqual({
      truncated: false,
      value: "p",
    });
  });

  it("$ 逐层同引用：两层与链底看到同一个上下文对象", async () => {
    const $ctx = { tag: "ctx" };
    const seen: unknown[] = [];
    const executor = composeChain<{ tag: string }, string, string>({
      point: "toolCall",
      terminal: async ($, e) => {
        seen.push($);
        return e;
      },
      layers: [
        async ($, e, next) => {
          seen.push($);
          return next(e);
        },
        async ($, e, next) => {
          seen.push($);
          return next(e);
        },
      ],
    });
    await executor.run($ctx, "p");
    expect(seen).toHaveLength(3);
    for (const $ of seen) expect($).toBe($ctx);
  });

  it("截断判定不依赖返回值真值：截断层返回 undefined 仍记 truncated", async () => {
    const executor = composeChain<undefined, string, string | undefined>({
      point: "toolCall",
      terminal: async () => "terminal",
      layers: [() => undefined],
    });
    await expect(executor.run(undefined, "p")).resolves.toEqual({
      truncated: true,
      value: undefined,
    });
  });

  it("点位清单封闭：恰三个，与 T-3-01 卡的决定一致", () => {
    expect([...CHAIN_POINTS]).toEqual(["toolCall", "modelRequest", "turnEnd"]);
  });
});
