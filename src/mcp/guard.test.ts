import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
    createRepeatToolReminder,
    createTimeoutBudgetAdvisor,
    GuardError,
    GuardRegistry,
    type GuardAdvice,
} from "./guard.js";
import type { SessionEvent } from "../kernel/events.js";

function call(seq: number, name: string, args: string): SessionEvent {
    return { type: "tool/call", seq, ts: seq, turn: 1, step: 1, callId: `c${String(seq)}`, name, arguments: args } as SessionEvent;
}
function result(seq: number, callId: string, code?: string): SessionEvent {
    return {
        type: "tool/result",
        seq,
        ts: seq,
        turn: 1,
        step: 1,
        callId,
        message: { content: code !== undefined ? "超时" : "ok", ...(code !== undefined ? { isError: true } : {}) },
        ...(code !== undefined ? { error: { name: "ToolTimeoutError", code } } : {}),
    } as SessionEvent;
}

describe("内置例一：重复工具提醒（阈档升级 + 规范化重置）", () => {
    it("连续相同调用达档位出建议：首档温和 info、第二档 warn 带明细", () => {
        const reg = new GuardRegistry();
        reg.register(createRepeatToolReminder());
        const adv: GuardAdvice[] = [];
        for (let i = 1; i <= 5; i++) {
            const r = reg.dispatch(call(i, "bash", '{"command":"ls"}'));
            adv.push(...r.advices);
        }
        expect(adv).toHaveLength(2);
        expect(adv[0]).toMatchObject({ kind: "repeat_tool_reminder", severity: "info", tool: "bash" });
        expect(adv[1]).toMatchObject({ kind: "repeat_tool_reminder", severity: "warn", tool: "bash" });
        expect(adv[1]!.message).toContain("consecutive_calls=5");
    });

    it("不同调用重置计数；参数键序不同归同（deep key-sort 规范化）", () => {
        const reg = new GuardRegistry();
        reg.register(createRepeatToolReminder({ thresholds: [3] }));
        expect(reg.dispatch(call(1, "bash", '{"a":1,"b":2}')).advices).toHaveLength(0);
        expect(reg.dispatch(call(2, "bash", '{"b":2,"a":1}')).advices).toHaveLength(0); // 同义参数 → 计数 2
        expect(reg.dispatch(call(3, "bash", '{"a":2,"b":2}')).advices).toHaveLength(0); // 新参数 → 重置 1
        expect(reg.dispatch(call(4, "read", '{"a":2,"b":2}')).advices).toHaveLength(0); // 换工具 → 重置 1
    });

    it("参数预览按 argumentsPreviewChars 截断（大载荷不入提醒）", () => {
        const reg = new GuardRegistry();
        reg.register(createRepeatToolReminder({ thresholds: [2, 4], argumentsPreviewChars: 40 }));
        const big = `{"command":"${"x".repeat(200)}"}`;
        expect(reg.dispatch(call(1, "bash", big)).advices).toHaveLength(0);
        const first = reg.dispatch(call(2, "bash", big)).advices[0]!;
        expect(first.severity).toBe("info");
        reg.dispatch(call(3, "bash", big));
        const warn = reg.dispatch(call(4, "bash", big)).advices[0]!;
        expect(warn.severity).toBe("warn");
        // 第四档详细提醒引用参数，但被 40 字符预算截断（大载荷不入上下文）
        expect(warn.message.length).toBeLessThan(400);
    });

    it("配置校验：空/低于 2/非整数 thresholds 构造即拒绝", () => {
        expect(() => createRepeatToolReminder({ thresholds: [] })).toThrow(GuardError);
        expect(() => createRepeatToolReminder({ thresholds: [1] })).toThrow(GuardError);
        expect(() => createRepeatToolReminder({ thresholds: [2.5] })).toThrow(GuardError);
    });
});

describe("内置例二：超时预算建议（结构化超时统计）", () => {
    it("同一工具累计超时达阈值出建议（含调用/超时统计）；非超时结果零建议", () => {
        const reg = new GuardRegistry();
        reg.register(createTimeoutBudgetAdvisor({ timeoutThreshold: 2 }));
        expect(reg.dispatch(call(1, "bash", "{}")).advices).toHaveLength(0);
        expect(reg.dispatch(result(2, "c1", "TOOL_TIMEOUT")).advices).toHaveLength(0);
        reg.dispatch(call(3, "bash", "{}"));
        const a = reg.dispatch(result(4, "c3", "TOOL_TIMEOUT")).advices[0]!;
        expect(a).toMatchObject({ kind: "timeout_budget_advice", severity: "warn", tool: "bash" });
        expect(a.message).toContain("累计超时 2 次");
        expect(a.message).toContain("共调用 2 次");
        // 非超时错误不计数
        reg.dispatch(call(5, "bash", "{}"));
        expect(reg.dispatch(result(6, "c5", "TOOL_NOT_FOUND")).advices).toHaveLength(0);
    });

    it("配置校验：threshold < 1 或非整数拒绝", () => {
        expect(() => createTimeoutBudgetAdvisor({ timeoutThreshold: 0 })).toThrow(GuardError);
        expect(() => createTimeoutBudgetAdvisor({ timeoutThreshold: 1.5 })).toThrow(GuardError);
    });
});

describe("治理 ≠ 策略 —— 建议不拦截断言", () => {
    it("dispatch 只产建议：报告只有 advices/errors、事件对象逐字节不变", () => {
        const reg = new GuardRegistry();
        reg.register(createRepeatToolReminder({ thresholds: [2] }));
        const ev = call(1, "bash", '{"command":"ls"}');
        const before = JSON.stringify(ev);
        const r1 = reg.dispatch(ev);
        const r2 = reg.dispatch(call(2, "bash", '{"command":"ls"}'));
        expect(Object.keys(r1).sort()).toEqual(["advices", "errors"]);
        expect(JSON.stringify(ev)).toBe(before); // 派发零改写
        // 建议对象不携带任何决策/拦截字段
        const a = r2.advices[0]!;
        expect(Object.keys(a).sort()).toEqual(["kind", "message", "severity", "tool"]);
        expect("action" in a || "decision" in a || "blocked" in a).toBe(false);
    });

    it("源码证伪：治理模块不 import 工具注册表/策略/loop（核心零治理硬编码的另一面）", () => {
        const source = readFileSync(new URL("./guard.ts", import.meta.url), "utf8");
        const imports = source
            .split("\n")
            .filter((line) => line.trim().startsWith("import "))
            .join("\n");
        for (const forbidden of ["tools/registry", "policy", "loop", "gate"]) {
            expect(imports.includes(forbidden), `import 面不得引用 ${forbidden}`).toBe(false);
        }
    });
});

describe("注册面 —— 可注册/可卸载与隔离", () => {
    it("重名注册拒绝；订阅闭集外事件类型拒绝", () => {
        const reg = new GuardRegistry();
        reg.register(createRepeatToolReminder());
        expect(() => reg.register(createRepeatToolReminder())).toThrow(/重名/);
        expect(() =>
            reg.register({ name: "x", events: ["galaxy" as never], advise: () => undefined }),
        ).toThrow(GuardError);
    });

    it("卸载后零影响：注销插件不再被派发", () => {
        const reg = new GuardRegistry();
        const un = reg.register(createRepeatToolReminder({ thresholds: [2] }));
        expect(reg.list()).toEqual(["repeat-tool-reminder"]);
        un();
        expect(reg.list()).toEqual([]);
        reg.dispatch(call(1, "bash", "{}"));
        expect(reg.dispatch(call(2, "bash", "{}")).advices).toHaveLength(0);
        un(); // 幂等
    });

    it("隔离：插件抛错不冒泡——errors 如实报告、其余插件照常出建议", () => {
        const reg = new GuardRegistry();
        reg.register({
            name: "bad",
            events: ["tool/call"],
            advise: () => {
                throw new Error("guard boom");
            },
        });
        reg.register(createRepeatToolReminder({ thresholds: [2] }));
        reg.dispatch(call(1, "bash", "{}"));
        const r = reg.dispatch(call(2, "bash", "{}"));
        expect(r.errors).toEqual([{ plugin: "bad", message: "guard boom" }]);
        expect(r.advices).toHaveLength(1);
    });
});
