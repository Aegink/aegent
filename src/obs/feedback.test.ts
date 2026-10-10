/**
 * S5 反馈上报测试（T-P2-404）——落流 + 关联校验（targetSeq 存在）+
 * doctor 随附 + 校验闭面（kind/二选一/长度）+ 词汇表 29 计数。
 */

import { describe, expect, it } from "vitest";

import { EVENT_TYPES } from "../kernel/events.js";
import {InMemoryEventStorage, SessionEventStore, type SessionStore} from "../session/store.js";
import {
    FeedbackValidationError,
    MAX_FEEDBACK_TEXT_LENGTH,
    submitFeedback,
} from "./feedback.js";

function makeStore(): SessionStore {
    return new SessionEventStore(new InMemoryEventStorage());
}

/** 预置一条真实流（turn/start → user/message → turn/end——seq 由 store 分配）。 */
function seed(store: SessionStore, sessionId: string): number {
    store.append(sessionId, [
        { type: "turn/start", turn: 0 },
        { type: "user/message", turn: 0, message: { content: "你好" }, source: "user" },
        { type: "turn/end", turn: 0, reason: { kind: "completed" } },
    ]);
    return store.load(sessionId)[1]!.seq; // user/message 的实际序号（seq 从 1 起）
}

describe("submitFeedback", () => {
    it("反馈落流：feedback/note 事件（log-only turn=0）", () => {
        const store = makeStore();
        const seq = seed(store, "s1");
        const event = submitFeedback(store, "s1", { kind: "up", targetSeq: seq, comment: "很好" });
        expect(event.type).toBe("feedback/note");
        expect(event.kind).toBe("up");
        expect(event.targetSeq).toBe(seq);
        expect(event.comment).toBe("很好");
        expect(event.turn).toBe(0);
        const loaded = store.load("s1");
        expect(loaded.at(-1)?.type).toBe("feedback/note");
    });

    it("关联校验：targetSeq 不在流内 → 类型化拒绝", () => {
        const store = makeStore();
        const seq = seed(store, "s1");
        expect(() => submitFeedback(store, "s1", { kind: "down", targetSeq: seq + 999 })).toThrow(
            FeedbackValidationError,
        );
        // 存在的 seq 可提交
        expect(() => submitFeedback(store, "s1", { kind: "down", targetSeq: seq })).not.toThrow();
    });

    it("commandId 关联面：命令反馈落流（二选一）", () => {
        const store = makeStore();
        seed(store, "s1");
        const event = submitFeedback(store, "s1", { kind: "down", commandId: "c1" });
        expect(event.commandId).toBe("c1");
        expect(event.targetSeq).toBeUndefined();
    });

    it("校验闭面：kind 闭集 / 二选一 / 空 commandId / 长度防呆", () => {
        const store = makeStore();
        const seq = seed(store, "s1");
        expect(() => submitFeedback(store, "s1", { kind: "meh" as never, targetSeq: seq })).toThrow(
            FeedbackValidationError,
        );
        expect(() => submitFeedback(store, "s1", { kind: "up" })).toThrow(FeedbackValidationError);
        expect(() =>
            submitFeedback(store, "s1", { kind: "up", targetSeq: seq, commandId: "c1" }),
        ).toThrow(FeedbackValidationError);
        expect(() =>
            submitFeedback(store, "s1", { kind: "up", targetSeq: -1 }),
        ).toThrow(FeedbackValidationError);
        expect(() => submitFeedback(store, "s1", { kind: "up", commandId: "" })).toThrow(
            FeedbackValidationError,
        );
        expect(() =>
            submitFeedback(store, "s1", {
                kind: "up",
                targetSeq: seq,
                comment: "x".repeat(MAX_FEEDBACK_TEXT_LENGTH + 1),
            }),
        ).toThrow(FeedbackValidationError);
    });

    it("doctor 随附：doctorSummary 进事件载荷（codex attachment 同构）", () => {
        const store = makeStore();
        const seq = seed(store, "s1");
        const event = submitFeedback(store, "s1", {
            kind: "up",
            targetSeq: seq,
            doctorSummary: "errors=0 warnings=1 node=22",
        });
        expect(event.doctorSummary).toBe("errors=0 warnings=1 node=22");
    });
});

describe("词汇表基线（#24 立案）", () => {
    it("EVENT_TYPES 28→29（feedback/note 入册）", () => {
        expect(EVENT_TYPES).toHaveLength(31);
        expect(EVENT_TYPES).toContain("feedback/note");
    });
});
