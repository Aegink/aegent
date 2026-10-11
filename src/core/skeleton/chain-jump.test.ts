import { describe, expect, it } from "vitest";
import {
    ChainJumpError,
    composeChain,
    jumpTo,
    namedLayer,
    UNSKIPPABLE_LAYER_NAMES,
    type ChainNext,
} from "./chain.js";

/** I14 验收：跳层直达 / 回程语义 / 三重闸拒绝 / 既有链零变化。 */

function fourLayers(order: string[], skippableLayers?: readonly string[]) {
    return composeChain<undefined, string, string>({
        point: "toolCall",
        terminal: async (_$, e) => {
            order.push("terminal");
            return `T:${e}`;
        },
        layers: [
            namedLayer("outer", async (_$, e, next) => {
                order.push("outer:before");
                const r = e === "jump" ? await next.to!(e, "inner") : await next(e);
                order.push("outer:after");
                return r;
            }),
            namedLayer("mid-a", async (_$, e, next) => {
                order.push("mid-a:before");
                const r = await next(e);
                order.push("mid-a:after");
                return r;
            }),
            namedLayer("mid-b", async (_$, e, next) => {
                order.push("mid-b:before");
                const r = await next(e);
                order.push("mid-b:after");
                return r;
            }),
            namedLayer("inner", async (_$, e, next) => {
                order.push("inner:before");
                const r = await next(e);
                order.push("inner:after");
                return r;
            }),
        ],
        ...(skippableLayers !== undefined ? { skippableLayers } : {}),
    });
}

describe("I14 跨层跳 —— 直达与回程语义", () => {
    it("跳层直达：中间层零执行零回程，目标层及其内层正常，结果返回调用层", async () => {
        const order: string[] = [];
        await fourLayers(order, ["mid-a", "mid-b"]).run(undefined, "jump");
        expect(order).toEqual([
            "outer:before",
            // mid-a / mid-b 进与出都不经过（零执行零回程）
            "inner:before",
            "terminal",
            "inner:after",
            "outer:after",
        ]);
    });

    it("无跳层时等价普通 next（既有链零变化）；目标层 trace 含调用层不含被跳层", async () => {
        const order: string[] = [];
        const traces: unknown[] = [];
        const executor = composeChain<undefined, string, string>({
            point: "toolCall",
            terminal: async () => "end",
            layers: [
                namedLayer("outer", (_$, e, next) => next.to!(e, "inner")),
                namedLayer("mid", (_$, e, next) => {
                    order.push("mid");
                    return next(e);
                }),
                namedLayer("inner", (_$, e, next) => {
                    traces.push([...next.trace]);
                    return next(e);
                }),
            ],
            skippableLayers: ["mid"],
        });
        await executor.run(undefined, "x");
        expect(order).toEqual([]); // mid 被跳过
        // trace 如实：含 outer（实际走过）不含 mid（被跳）
        expect(traces).toEqual([[{ layer: 0, name: "outer" }]]);
    });
});

describe("I14 跨层跳 —— 三重闸 fail-closed", () => {
    const run = (skippable?: readonly string[]) => {
        const order: string[] = [];
        return fourLayers(order, skippable).run(undefined, "jump");
    };

    it("缺省无跳层能力：不配 skippableLayers → to 拒绝（JUMP_TARGET_NOT_ALLOWED）", async () => {
        await expect(run()).rejects.toMatchObject({ name: "ChainJumpError", code: "JUMP_TARGET_NOT_ALLOWED" });
    });

    it("中间层未授权：mid-a 不在白名单 → 拒绝且点名该层", async () => {
        await expect(run(["mid-b"])).rejects.toThrow(/未授权层「mid-a」/);
    });

    it("审批层硬保护：gate 即使被误列进白名单也恒拒（C 族不变量）", async () => {
        const order: string[] = [];
        const executor = composeChain<undefined, string, string>({
            point: "toolCall",
            terminal: async () => "end",
            layers: [
                namedLayer("outer", (_$, e, next) => next.to!(e, "core")),
                namedLayer("gate", (_$, e, next) => next(e)),
                namedLayer("core", (_$, e, next) => next(e)),
            ],
            skippableLayers: [...UNSKIPPABLE_LAYER_NAMES, "gate"], // 误配置也在保护面
        });
        await expect(executor.run(undefined, "x")).rejects.toMatchObject({
            code: "JUMP_LAYER_PROTECTED",
        });
        expect(order).toEqual([]); // gate 未被执行（拒绝在建链前）
    });

    it("目标不存在：从本层向内无此名 → JUMP_TARGET_NOT_FOUND", async () => {
        const executor = composeChain<undefined, string, string>({
            point: "toolCall",
            terminal: async () => "end",
            layers: [namedLayer("outer", (_$, e, next) => next.to!(e, "nope"))],
            skippableLayers: ["nope"],
        });
        await expect(executor.run(undefined, "x")).rejects.toMatchObject({
            code: "JUMP_TARGET_NOT_FOUND",
        });
    });

    it("未命名中间层不可跳（layer#N 不在白名单——fail-closed 缺省）", async () => {
        const executor = composeChain<undefined, string, string>({
            point: "toolCall",
            terminal: async () => "end",
            layers: [
                namedLayer("outer", (_$, e, next) => next.to!(e, "inner")),
                (_$, e, next) => next(e), // 未命名
                namedLayer("inner", (_$, e, next) => next(e)),
            ],
            skippableLayers: ["layer#1", "inner"],
        });
        // 白名单里写了 "layer#1" 也不放行——未命名层不是显式声明面
        await expect(executor.run(undefined, "x")).rejects.toMatchObject({
            code: "JUMP_TARGET_NOT_ALLOWED",
        });
    });
});

describe("I14 跨层跳 —— 配额与调用入口", () => {
    it("to 与 next 共享每层一次配额：next 后再 to 抛错", async () => {
        const executor = composeChain<undefined, string, string>({
            point: "toolCall",
            terminal: async () => "end",
            layers: [
                namedLayer("outer", async (_$, e, next) => {
                    await next(e);
                    return next.to!(e, "inner");
                }),
                namedLayer("inner", (_$, e, next) => next(e)),
            ],
            skippableLayers: ["inner"],
        });
        await expect(executor.run(undefined, "x")).rejects.toThrow(/每层至多一次/);
    });

    it("jumpTo 入口：无 to 的 next 上跳层 = 类型化拒绝（不静默 undefined）", () => {
        const bare = Object.assign(async () => "r", {
            point: "toolCall" as const,
            trace: Object.freeze([]) as never,
            budget: Object.freeze({}),
        }) as ChainNext<undefined, string>;
        expect(() => jumpTo(bare, undefined, "core")).toThrow(ChainJumpError);
        // 有 to 时透传
        const withTo = Object.assign(bare, { to: async () => "jumped" });
        return expect(jumpTo(withTo, undefined, "core")).resolves.toBe("jumped");
    });

    it("相邻层 to = 普通 next 的退化（中间层为空——合法）", async () => {
        const order: string[] = [];
        const executor = composeChain<undefined, string, string>({
            point: "toolCall",
            terminal: async () => "end",
            layers: [
                namedLayer("a", (_$, e, next) => next.to!(e, "b")),
                namedLayer("b", (_$, e, next) => {
                    order.push("b");
                    return next(e);
                }),
            ],
            // 无中间层——不需要白名单
        });
        await executor.run(undefined, "x");
        expect(order).toEqual(["b"]);
    });
});
