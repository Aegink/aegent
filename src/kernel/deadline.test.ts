import { describe, expect, it } from "vitest";
import { TOOL_TIMEOUT, TimeoutError } from "./timeout.js";
import { Deadline, withDeadline } from "./deadline.js";

/** M7 显式时钟：绝对时点直接给值，不依赖 fake timers 与隐式 Date.now。 */
const T0 = 1_000_000;

describe("Deadline.fromTimeoutMs —— 相对时长换算绝对截止", () => {
    it("remainingMs 随 now 前进递减；负值 = 已超期的量", () => {
        const d = Deadline.fromTimeoutMs(TOOL_TIMEOUT, 5_000, T0);
        expect(d.remainingMs(T0)).toBe(5_000);
        expect(d.remainingMs(T0 + 2_500)).toBe(2_500);
        expect(d.remainingMs(T0 + 5_000)).toBe(0);
        expect(d.remainingMs(T0 + 6_000)).toBe(-1_000);
    });

    it("expired：到点即过期（剩余 ≤ 0）；未到点不判过期", () => {
        const d = Deadline.fromTimeoutMs(TOOL_TIMEOUT, 5_000, T0);
        expect(d.expired(T0 + 4_999)).toBe(false);
        expect(d.expired(T0 + 5_000)).toBe(true);
        expect(d.expired(T0 + 9_999)).toBe(true);
    });

    it("J24 闸在构造点：非正 / 非有限 / 超上限一律抛错", () => {
        expect(() => Deadline.fromTimeoutMs(TOOL_TIMEOUT, 0, T0)).toThrow();
        expect(() => Deadline.fromTimeoutMs(TOOL_TIMEOUT, -1, T0)).toThrow();
        expect(() => Deadline.fromTimeoutMs(TOOL_TIMEOUT, Number.NaN, T0)).toThrow();
        expect(() => Deadline.fromTimeoutMs(TOOL_TIMEOUT, 2_147_483_648, T0)).toThrow();
        expect(Deadline.fromTimeoutMs(TOOL_TIMEOUT, 2_147_483_647, T0)).toBeInstanceOf(Deadline);
    });
});

describe("Deadline.throwIfExpired —— 类型化到期错误（J22 归属）", () => {
    it("未到期静默通过；到期抛 TimeoutError，code 报归属、timeoutMs 报起算预算", () => {
        const d = Deadline.fromTimeoutMs("MY_SCOPE", 5_000, T0);
        expect(() => d.throwIfExpired(T0 + 4_999)).not.toThrow();
        try {
            d.throwIfExpired(T0 + 5_000);
            expect.unreachable("到期必须抛错");
        } catch (e) {
            expect(e).toBeInstanceOf(TimeoutError);
            const te = e as TimeoutError;
            expect(te.code).toBe("MY_SCOPE");
            expect(te.timeoutMs).toBe(5_000);
        }
    });
});

describe("Deadline.combine —— 多 deadline 取最近", () => {
    it("最早到期者胜，code 一并继承（先到层是到期错误的归属层）", () => {
        const outer = Deadline.fromTimeoutMs("OUTER", 10_000, T0);
        const inner = Deadline.fromTimeoutMs("INNER", 4_000, T0);
        const combined = Deadline.combine(outer, inner);
        expect(combined).toBeDefined();
        expect(combined!.code).toBe("INNER");
        expect(combined!.remainingMs(T0 + 4_000)).toBe(0);
        // 到期错误报的是起算预算与先到层的 code
        const err = combined!.expiredError();
        expect(err.code).toBe("INNER");
        expect(err.timeoutMs).toBe(4_000);
    });

    it("外层先到时取外层（组合不预设内外次序）", () => {
        const outer = Deadline.fromTimeoutMs("OUTER", 2_000, T0);
        const inner = Deadline.fromTimeoutMs("INNER", 9_000, T0);
        const combined = Deadline.combine(outer, inner);
        expect(combined!.code).toBe("OUTER");
    });

    it("undefined 输入被过滤（无该层约束）；全部无效返回 undefined（不虚构永不过期）", () => {
        const inner = Deadline.fromTimeoutMs("INNER", 4_000, T0);
        expect(Deadline.combine(undefined, inner, undefined)!.code).toBe("INNER");
        expect(Deadline.combine(undefined, undefined)).toBeUndefined();
    });

    it("同一时点到期取先入者（组合稳定可复现）", () => {
        const a = Deadline.fromTimeoutMs("A", 5_000, T0);
        const b = Deadline.fromTimeoutMs("B", 5_000, T0);
        expect(Deadline.combine(a, b)!.code).toBe("A");
    });
});

describe("withDeadline —— deadline 预算的 promise 包装", () => {
    it("无 deadline 直接透传（同一 promise，不武装定时器）", async () => {
        const p = Promise.resolve(42);
        expect(withDeadline(undefined, p)).toBe(p);
        await expect(withDeadline(undefined, p)).resolves.toBe(42);
    });

    it("未到期正常结算且内层值原样透传", async () => {
        const d = Deadline.fromTimeoutMs(TOOL_TIMEOUT, 10_000, Date.now());
        await expect(withDeadline(d, Promise.resolve("ok"))).resolves.toBe("ok");
    });

    it("到期 reject TimeoutError（code/timeoutMs 同 J22 形状）", async () => {
        const d = Deadline.fromTimeoutMs(TOOL_TIMEOUT, 20, Date.now());
        await expect(
            withDeadline(d, new Promise<string>(() => undefined)),
        ).rejects.toBeInstanceOf(TimeoutError);
    });

    it("内层 rejection 原样透传（不是 TimeoutError）", async () => {
        const d = Deadline.fromTimeoutMs(TOOL_TIMEOUT, 10_000, Date.now());
        const boom = new Error("inner boom");
        await expect(withDeadline(d, Promise.reject(boom))).rejects.toBe(boom);
    });

    it("内层完成晚于超时不产生 unhandled rejection（迟到结算被丢弃）", async () => {
        const d = Deadline.fromTimeoutMs(TOOL_TIMEOUT, 20, Date.now());
        let innerReject: (e: Error) => void = () => undefined;
        const inner = new Promise<string>((_, reject) => {
            innerReject = reject;
        });
        await expect(withDeadline(d, inner)).rejects.toBeInstanceOf(TimeoutError);
        // 超时结算之后内层才迟到失败——withDeadline 仍挂着 handler，不产生 unhandled rejection
        innerReject(new Error("late loser"));
        await new Promise((r) => setTimeout(r, 30));
    });

    it("拿到手时已过期的 deadline：立即 reject，不武装定时器", async () => {
        const stale = Deadline.fromTimeoutMs("STALE", 1_000, T0);
        let settled = false;
        const raced = withDeadline(stale, Promise.resolve("never")).catch((e) => {
            settled = true;
            throw e;
        });
        await expect(raced).rejects.toMatchObject({ code: "STALE", timeoutMs: 1_000 });
        expect(settled).toBe(true);
    });
});
