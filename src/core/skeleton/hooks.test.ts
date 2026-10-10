/**
 * 内核 hooks 测试（I1 / T-P1-07）——注册/触发分离、嵌套序与截断、崩溃双轨
 * （trusted 上抛 = 策略层 T-5-01 同款；untrusted 隔离为 isError/吞错）、dispose、
 * 装配接线（hook 层挂 gate 外层）。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  composeChain,
  namedLayer,
  type ChainNext,
} from "./chain.js";
import { HookRegistry, type HookErrorReport } from "./hooks.js";
import {
  type LoopContext,
  type ModelRequestPayload,
  type ModelStepOutput,
  type ToolCallPayload,
  type ToolExecutionResult,
  type TurnEndPayload,
} from "../../kernel/loop.js";
import { ScriptedProvider, makeLoop } from "../../kernel/loop.test-utils.js";
import { createChildAssembly } from "../../kernel/assembly.js";
import { InMemoryEventStorage, SessionStore } from "../../session/store.js";

const identity = { provider: "mock", modelId: "m-1" };

/** registry 聚合层 + 单层链组合跑（registry 语义测试的最小 harness）。 */
async function runWithHook<E, R>(
  registry: HookRegistry,
  point: "toolCall" | "modelRequest" | "turnEnd",
  event: E,
  terminal: ($: undefined, e: E) => Promise<R> | R,
): Promise<{ truncated: boolean; value: R }> {
  const layer = registry.layer<undefined, E, R>(point);
  const executor = composeChain<undefined, E, R>({
    point,
    layers: layer ? [layer] : [],
    terminal,
  });
  return executor.run(undefined, event);
}

describe("HookRegistry 注册/触发分离（I1）", () => {
  it("无注册 layer = undefined、has = false（装配零开销）", () => {
    const registry = new HookRegistry();
    expect(registry.has("toolCall")).toBe(false);
    expect(registry.layer("toolCall")).toBeUndefined();
  });

  it("嵌套序 = 注册序（先注册外层先看到事件）；注销函数生效", async () => {
    const order: string[] = [];
    const registry = new HookRegistry();
    const offH1 = registry.on<undefined, string, string>(
      "toolCall",
      async (_$, e, next) => {
        order.push("h1:before");
        const v = await next(e);
        order.push("h1:after");
        return v;
      },
      { name: "h1" },
    );
    registry.on<undefined, string, string>(
      "toolCall",
      async (_$, e, next) => {
        order.push("h2:before");
        const v = await next(e);
        order.push("h2:after");
        return v;
      },
      { name: "h2" },
    );
    const outcome = await runWithHook(registry, "toolCall", "x", async (_$, e) => {
      order.push("terminal");
      return `done(${e})`;
    });
    expect(outcome).toEqual({ truncated: false, value: "done(x)" });
    expect(order).toEqual([
      "h1:before",
      "h2:before",
      "terminal",
      "h2:after",
      "h1:after",
    ]);

    // 注销 h1 后：h2 直连链底
    offH1();
    order.length = 0;
    await runWithHook(registry, "toolCall", "y", async (_$, e) => {
      order.push("terminal");
      return `done(${e})`;
    });
    expect(order).toEqual(["h2:before", "terminal", "h2:after"]);
  });

  it("hook 换载荷（next(e2)）：内层看到修改后的载荷——hook 改动会被内层权限重新判定", async () => {
    const registry = new HookRegistry();
    registry.on<undefined, string, string>(
      "toolCall",
      (_$, e, next) => next(`${e}(redacted)`),
      { name: "scrubber" },
    );
    let seen = "";
    const outcome = await runWithHook(
      registry,
      "toolCall",
      "raw-args",
      async (_$, e) => {
        seen = e;
        return "executed";
      },
    );
    expect(seen).toBe("raw-args(redacted)");
    expect(outcome).toEqual({ truncated: false, value: "executed" });
  });

  it("layer() 取快照：快照之后的注册不进已产出的层", async () => {
    const registry = new HookRegistry();
    const layer = registry.layer<undefined, string, string>("toolCall")!;
    registry.on<undefined, string, string>("toolCall", () => "late-blocker");
    // 层已快照（空），后注册的 hook 不生效——链直通 terminal
    const executor = composeChain<undefined, string, string>({
      point: "toolCall",
      layers: [layer],
      terminal: async (_$, e) => e,
    });
    await expect(executor.run(undefined, "p")).resolves.toEqual({
      truncated: false,
      value: "p",
    });
    // 新 layer() 才带上
    expect(registry.layer("toolCall")).toBeDefined();
  });

  it("dispose：此后 on() 抛错（pi close 同款）；已产出层直通不炸", async () => {
    const registry = new HookRegistry();
    registry.on<undefined, string, string>("toolCall", (_$, e, next) => next(e));
    const layer = registry.layer<undefined, string, string>("toolCall")!;
    registry.dispose();
    expect(() =>
      registry.on<undefined, string, string>("toolCall", () => "zombie"),
    ).toThrow(/已 dispose/);
    const executor = composeChain<undefined, string, string>({
      point: "toolCall",
      layers: [layer],
      terminal: async (_$, e) => e,
    });
    await expect(executor.run(undefined, "p")).resolves.toEqual({
      truncated: false,
      value: "p",
    });
  });
});

// ---------------------------------------------------------------------------
// 验收①：hook 在工具执行前后序正确（前 hook 可截断不调 next）——loop 级
// ---------------------------------------------------------------------------

describe("验收① loop 级：hook 挂 toolCall 点位", () => {
  it("前 hook → 链底（工具执行）→ 后 hook 的次序在事件流可断言", async () => {
    const order: string[] = [];
    const registry = new HookRegistry();
    registry.on<LoopContext, ToolCallPayload, ToolExecutionResult>(
      "toolCall",
      async (_$, e, next) => {
        order.push(`hook:before:${e.name}`);
        const v = await next(e);
        order.push("hook:after");
        return v;
      },
      { name: "observer" },
    );
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: '{"cmd":"ls"}' },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "完" }, { type: "done" }]);
    const { loop, store } = makeLoop(provider, {
      layers: {
        toolCall: [registry.layer<LoopContext, ToolCallPayload, ToolExecutionResult>("toolCall")!],
      },
      executeTool: async (call) => {
        order.push(`exec:${call.name}`);
        return { content: "ok" };
      },
    });
    const reason = await loop.runTurn("跑个工具");
    expect(reason).toEqual({ kind: "completed" });
    expect(order).toEqual(["hook:before:bash", "exec:bash", "hook:after"]);
    const result = store
      .load("s1")
      .find((e) => e.type === "tool/result");
    expect(result).toMatchObject({ message: { content: "ok" } });
  });

  it("前 hook 截断（不调 next）：工具不执行，hook 返回值成为 tool/result", async () => {
    const executed: string[] = [];
    const registry = new HookRegistry();
    registry.on<LoopContext, ToolCallPayload, ToolExecutionResult>(
      "toolCall",
      () => ({
        content: "hook 拦截：该工具本 turn 禁用",
        isError: true,
        error: { name: "HookDeny", code: "HOOK_DENY" },
      }),
      { name: "blocker" },
    );
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: "{}" },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "完" }, { type: "done" }]);
    const { loop, store } = makeLoop(provider, {
      layers: {
        toolCall: [registry.layer<LoopContext, ToolCallPayload, ToolExecutionResult>("toolCall")!],
      },
      executeTool: async (call) => {
        executed.push(call.name);
        return { content: "ok" };
      },
    });
    const reason = await loop.runTurn("跑个工具");
    expect(reason).toEqual({ kind: "completed" });
    expect(executed).toEqual([]); // 工具不执行
    const result = store.load("s1").find((e) => e.type === "tool/result");
    expect(result).toMatchObject({
      message: { content: "hook 拦截：该工具本 turn 禁用", isError: true },
      error: { name: "HookDeny", code: "HOOK_DENY" },
    });
  });
});

// ---------------------------------------------------------------------------
// I6 分轨与崩溃双轨（T-P1-09）：trusted 同链直调 / untrusted 独立观察轨
// ---------------------------------------------------------------------------

/** untrusted 轨的宿主侧伪 next（观察轨不在内核链上，无真实 next 可透传）。 */
function trailNext<E, R>(): ChainNext<E, R> {
  return Object.assign(async () => undefined as R, {
    point: "toolCall" as const,
    trace: Object.freeze([]),
    budget: Object.freeze({}),
  });
}

describe("I6 分轨（T-P1-09 验收①）", () => {
  it("untrusted 不进内核链：layer 只含 trusted，untracked 副作用不出现在链上", async () => {
    const registry = new HookRegistry();
    const touched: string[] = [];
    registry.on<undefined, string, string>(
      "toolCall",
      async (_$, e, next) => {
        touched.push("trusted:see");
        return next(e);
      },
      { name: "trusted-observer" },
    );
    registry.on<undefined, string, string>(
      "toolCall",
      async (_$, e, next) => {
        touched.push("untracked:see");
        return next(e);
      },
      { name: "untracked-observer", trust: "untrusted" },
    );
    // 内核链（layer）：只有 trusted——untracked 的钩子体不执行
    const kernelLayer = registry.layer<undefined, string, string>("toolCall")!;
    const kernel = composeChain<undefined, string, string>({
      point: "toolCall",
      layers: [namedLayer("hooks", kernelLayer)],
      terminal: async (_$, e) => e,
    });
    const outcome = await kernel.run(undefined, "x");
    expect(outcome).toEqual({ truncated: false, value: "x" });
    expect(touched).toEqual(["trusted:see"]); // untracked 未被内核链触发

    // 独立观察轨：untracked 在这里触发（宿主/后续进程外协议消费）
    const trailLayer = registry.untrustedLayer<undefined, string, string>("toolCall")!;
    await trailLayer(undefined, "x", trailNext<string, string>());
    expect(touched).toEqual(["trusted:see", "untracked:see"]);
  });

  it("分轨后内核链零感知：只注册 untrusted 时 layer = undefined", () => {
    const registry = new HookRegistry();
    registry.on("toolCall", async () => "ignored", { trust: "untrusted" });
    expect(registry.has("toolCall")).toBe(true);
    expect(registry.layer("toolCall")).toBeUndefined(); // 内核链不挂
    expect(registry.untrustedLayer("toolCall")).toBeDefined(); // 观察轨在
  });

  it("能力越界：untracked hook 调 next → 被轨隔离且报告点名越界（能力白名单 = 只观察）", async () => {
    const reports: HookErrorReport[] = [];
    const registry = new HookRegistry({ reportError: (r) => reports.push(r) });
    registry.on<undefined, string, string>(
      "toolCall",
      (_$, e, next) => next(e), // 观察轨的 hook 试图驱动内核
      { name: "overreaching", trust: "untrusted" },
    );
    const trail = registry.untrustedLayer<undefined, string, string>("toolCall")!;
    await trail(undefined, "x", trailNext<string, string>());
    expect(reports).toHaveLength(1);
    expect(reports[0]!.hook).toBe("overreaching");
    expect(reports[0]!.isolated).toBe(true);
    expect((reports[0]!.error as Error).message).toContain("能力越界");
  });

  it("untrusted 轨崩溃隔离：崩溃 hook 被跳过（报告可检索），轨内其余 hook 照常", async () => {
    const reports: HookErrorReport[] = [];
    const registry = new HookRegistry({ reportError: (r) => reports.push(r) });
    registry.on<undefined, string, string>(
      "toolCall",
      async () => {
        throw new Error("扩展插件炸了");
      },
      { name: "flaky-plugin", trust: "untrusted" },
    );
    const seen: string[] = [];
    registry.on<undefined, string, string>(
      "toolCall",
      (_$, e) => {
        seen.push(`observed:${e}`);
        return "observed";
      },
      { name: "healthy-observer", trust: "untrusted" },
    );
    const trail = registry.untrustedLayer<undefined, string, string>("toolCall")!;
    const result = await trail(undefined, "x", trailNext<string, string>());
    expect(seen).toEqual(["observed:x"]); // 健康观察者照常
    expect(reports).toEqual([
      { point: "toolCall", hook: "flaky-plugin", isolated: true, error: expect.any(Error) },
    ]);
    expect(result).toBe("observed"); // 观察返回向外传播（宿主决定消费与否）
  });

  it("trusted hook 崩溃 → 上抛（策略层 T-5-01 同款：fail-open 禁止）；toolCall 侧由基础设施 catch 落 isError", async () => {
    const registry = new HookRegistry();
    registry.on<LoopContext, ToolCallPayload, ToolExecutionResult>(
      "toolCall",
      async () => {
        throw new Error("可信扩展坏了");
      },
      { name: "trusted-broken" },
    );
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "tool-call-delta", id: "c1", name: "bash", argsDelta: "{}" },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "完" }, { type: "done" }]);
    const { loop, store } = makeLoop(provider, {
      layers: {
        toolCall: [registry.layer<LoopContext, ToolCallPayload, ToolExecutionResult>("toolCall")!],
      },
    });
    // 上抛穿层（错误不经 hook 层转化）→ loop 的 dispatchTool catch 兜底：
    // turn 不炸但工具被拒（TOOL_EXECUTE_FAILED，与 HOOK_FAILED 区分错误来源）
    const reason = await loop.runTurn("跑个工具");
    expect(reason).toEqual({ kind: "completed" });
    const result = store.load("s1").find((e) => e.type === "tool/result");
    expect(result).toMatchObject({
      error: { code: "TOOL_EXECUTE_FAILED" },
    });
  });

  it("untrusted 轨 dispose：已产出观察轨退场（返回 undefined 不炸）", async () => {
    const registry = new HookRegistry();
    registry.on<undefined, string, string>(
      "toolCall",
      (_$, e) => `observed:${e}`,
      { name: "watcher", trust: "untrusted" },
    );
    const trail = registry.untrustedLayer<undefined, string, string>("toolCall")!;
    registry.dispose();
    const result = await trail(undefined, "x", trailNext<string, string>());
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 装配接线：hook 层挂 gate 外层（T-P1-07）
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("装配接线（I1 hooks → gate → terminal）", () => {
  it("hooks 传入时三层首位是 hooks 层；未注册点位不挂层；不传时零行为变化", () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "hooks-asm-"));
    tmpRoots.push(workspaceRoot);
    const store = new SessionStore(new InMemoryEventStorage());
    const registry = new HookRegistry();
    const passthrough = async (_$: LoopContext, e: unknown, next: (x: unknown) => unknown) =>
      next(e);
    registry.on("toolCall", passthrough);
    registry.on("modelRequest", passthrough);
    registry.on("turnEnd", passthrough);
    const withHooks = createChildAssembly({
      sessionId: "s0",
      store,
      workspaceRoot,
      contextWindow: 100_000,
      approvalTimeoutMs: 5_000,
      hooks: registry,
    });
    const withoutHooks = createChildAssembly({
      sessionId: "s0",
      store,
      workspaceRoot,
      contextWindow: 100_000,
      approvalTimeoutMs: 5_000,
    });
    const layerName = (layer: unknown): string | undefined =>
      (layer as { chainLayerName?: string }).chainLayerName;
    expect(withHooks.layers.toolCall).toHaveLength(2);
    expect(layerName(withHooks.layers.toolCall![0])).toBe("hooks");
    expect(layerName(withHooks.layers.toolCall![1])).toBeUndefined(); // gate（未命名）
    expect(withHooks.layers.modelRequest).toHaveLength(2);
    expect(layerName(withHooks.layers.modelRequest![0])).toBe("hooks");
    expect(withHooks.layers.turnEnd).toHaveLength(2);
    expect(layerName(withHooks.layers.turnEnd![0])).toBe("hooks");

    // 未注册的点位不挂层（零开销）：只注册 toolCall 的 registry
    const partial = new HookRegistry();
    partial.on("toolCall", passthrough);
    const partialAsm = createChildAssembly({
      sessionId: "s0",
      store,
      workspaceRoot,
      contextWindow: 100_000,
      approvalTimeoutMs: 5_000,
      hooks: partial,
    });
    expect(partialAsm.layers.toolCall!).toHaveLength(2);
    expect(partialAsm.layers.modelRequest!).toHaveLength(1);
    expect(partialAsm.layers.turnEnd!).toHaveLength(1);

    // 零行为变化：无 hooks 时维持 P0 层面
    expect(withoutHooks.layers.toolCall!).toHaveLength(1);
    expect(withoutHooks.layers.modelRequest!).toHaveLength(1);
    expect(withoutHooks.layers.turnEnd!).toHaveLength(1);
    rmSync(workspaceRoot, { recursive: true, force: true });
  });
});
