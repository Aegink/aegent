/**
 * 图片卸载测试（P2/T-P1-125）：最老优先选择、只进不退、校验闭面、
 * 投影占位与回取路径。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Projector } from "../session/project.js";
import { buildChatMessages } from "../session/messages.js";
import type { NewSessionEvent, SessionEvent } from "../kernel/events.js";
import { offloadOldestImages } from "./offload.js";
import { effectiveEvents } from "../session/messages.js";
import type { AttachmentRef } from "./types.js";

const ref = (id: string): AttachmentRef => ({
  attachmentId: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
  mediaType: "image/png",
  size: 100,
});

let seq = 0;
// Omit 不分发联合——用宽入参 + 断言出参（测试构造 helper）
const ev = (e: Record<string, unknown>): SessionEvent =>
  ({ ...e, seq: ++seq, ts: 0 }) as unknown as SessionEvent;

const userMsg = (turn: number, refs: AttachmentRef[]): Record<string, unknown> => ({
  type: "user/message",
  turn,
  message: { content: `消息 ${turn}` },
  source: "user",
  attachments: refs,
});

describe("offloadOldestImages（选择纯函数）", () => {
  beforeEach(() => {
    seq = 0;
  });

  it("最老优先：早消息的图片先卸；count 跨消息分配", () => {
    const events = [
      ev({ type: "turn/start", turn: 1 }),
      ev(userMsg(1, [ref("1"), ref("2")])),
      ev(userMsg(1, [ref("3")])),
      ev({ type: "turn/end", turn: 1, reason: { kind: "completed" } }),
    ];
    const r = offloadOldestImages(events, 3)!;
    expect(r.targets).toEqual([
      { seq: 2, imageIndexes: [0, 1] },
      { seq: 3, imageIndexes: [0] },
    ]);
    // count=2 只卸最老的两个出现（同消息内连续取）
    seq = 0;
    expect(offloadOldestImages(events, 2)!.targets).toEqual([{ seq: 2, imageIndexes: [0, 1] }]);
  });

  it("已卸载出现跳过（重放同流同选——决策持久化后选择稳定）", () => {
    const events = [
      ev({ type: "turn/start", turn: 1 }),
      ev(userMsg(1, [ref("1"), ref("2")])),
      ev({ type: "image/offload", turn: 1, targets: [{ seq: 2, imageIndexes: [0] }] }),
      ev(userMsg(1, [ref("3")])),
    ];
    const r = offloadOldestImages(events, 1)!;
    // seq=2 index=0 已卸载 → 下一最老是 seq=2 index=1
    expect(r.targets).toEqual([{ seq: 2, imageIndexes: [1] }]);
  });

  it("count 超出可用数 → 部分卸载（上限语义）；零可用出现 → null（exhausted delegates）", () => {
    seq = 0;
    const events = [ev({ type: "turn/start", turn: 1 }), ev(userMsg(1, [ref("1")]))];
    // count=3 但只有 1 个出现 → 卸掉那 1 个（卸到尽，调用方可从 targets 长度得知实际数）
    expect(offloadOldestImages(events, 3)).toEqual({ targets: [{ seq: 2, imageIndexes: [0] }] });
    expect(offloadOldestImages([ev({ type: "turn/start", turn: 1 })], 1)).toBe(null);
  });

  it("count 非法（0/负/非整数）抛出", () => {
    expect(() => offloadOldestImages([], 0)).toThrow(/正整数/);
    expect(() => offloadOldestImages([], -1)).toThrow(/正整数/);
    expect(() => offloadOldestImages([], 1.5)).toThrow(/正整数/);
  });

  it("有效视窗语义：revert 保留段内的卸载事实继续参与选择（E4——卸载是流内事实）", () => {
    seq = 0;
    const events = [
      ev({ type: "turn/start", turn: 1 }),
      ev(userMsg(1, [ref("1"), ref("2")])),
      ev({ type: "image/offload", turn: 1, targets: [{ seq: 2, imageIndexes: [0] }] }),
      ev({ type: "session/revert", turn: 1, targetSeq: 3, phase: "revert" }),
    ];
    // 有效视窗 = seq ≤ 3（消息 seq=2 + 卸载 seq=3 均在）——index0 已卸，
    // 下一最老是 index1（卸载决策不因 revert 重置——只进不退）；
    // 视窗截断由调用方做（effectiveEvents——session 域）
    const r = offloadOldestImages(effectiveEvents(events), 1)!;
    expect(r.targets).toEqual([{ seq: 2, imageIndexes: [1] }]);
  });
});

describe("image/offload 校验闭面（project append——required-on-read）", () => {
  const base = (): { events: SessionEvent[]; projector: Projector } => {
    seq = 0;
    const events = [
      ev({ type: "turn/start", turn: 1 }),
      ev(userMsg(1, [ref("1"), ref("2")])),
    ];
    return { events, projector: Projector.fresh() };
  };
  const appendAll = (projector: Projector, events: SessionEvent[]) => {
    for (const e of events) projector.append([e]);
  };

  it("合法卸载通过（落流后投影可查）", () => {
    const { events, projector } = base();
    appendAll(projector, events);
    expect(() =>
      projector.append([ev({ type: "image/offload", turn: 1, targets: [{ seq: 2, imageIndexes: [0, 1] }] })]),
    ).not.toThrow();
  });

  it("重复卸载同一出现拒绝（只进不退）", () => {
    const { events, projector } = base();
    appendAll(projector, events);
    projector.append([ev({ type: "image/offload", turn: 1, targets: [{ seq: 2, imageIndexes: [0] }] })]);
    expect(() =>
      projector.append([ev({ type: "image/offload", turn: 1, targets: [{ seq: 2, imageIndexes: [0] }] })]),
    ).toThrow(/重复卸载/);
  });

  it("坏引用拒绝：seq 非附件消息 / 索引越界 / 索引乱序 / targets 空 / seq 重复", () => {
    // 每个子断言独立 projector（append 的 seq 连续性约束——失败 append 后
    // lastSeq 不动，后续事件必须重放基线）
    const expectReject = (make: () => NewSessionEvent, pattern: RegExp) => {
      seq = 0;
      const { events, projector } = base();
      appendAll(projector, events);
      expect(() => projector.append([ev(make())])).toThrow(pattern);
    };
    expectReject(
      () => ({ type: "image/offload", turn: 1, targets: [{ seq: 999, imageIndexes: [0] }] }),
      /不指向携带附件/,
    );
    expectReject(() => ({ type: "image/offload", turn: 1, targets: [{ seq: 2, imageIndexes: [5] }] }), /越界/);
    expectReject(
      () => ({ type: "image/offload", turn: 1, targets: [{ seq: 2, imageIndexes: [1, 0] }] }),
      /严格升序/,
    );
    expectReject(() => ({ type: "image/offload", turn: 1, targets: [] }), /非空数组/);
    expectReject(
      () => ({
        type: "image/offload",
        turn: 1,
        targets: [
          { seq: 2, imageIndexes: [0] },
          { seq: 2, imageIndexes: [1] },
        ],
      }),
      /重复/,
    );
  });
});

describe("buildChatMessages × 卸载投影（模型请求面事实）", () => {
  it("被卸出现从 images 剔除 + content 追加占位行（带回取键 id）；未卸照常展开", () => {
    seq = 0;
    const r1 = ref("1");
    const r2 = ref("2");
    const events = [
      ev({ type: "turn/start", turn: 1 }),
      ev(userMsg(1, [r1, r2])),
      ev({ type: "image/offload", turn: 1, targets: [{ seq: 2, imageIndexes: [0] }] }),
    ];
    const messages = buildChatMessages(events, {
      resolveImage: (r) => ({ mediaType: r.mediaType, data: "AAAA" }),
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      role: "user",
      content: `消息 1\n[image offloaded: image (image/png, 100B, id=${r1.attachmentId})]`,
      images: [{ mediaType: "image/png", data: "AAAA" }],
    });
  });

  it("全部卸载后请求面无图片字节（防 token 膨胀的机验面）", () => {
    seq = 0;
    const events = [
      ev({ type: "turn/start", turn: 1 }),
      ev(userMsg(1, [ref("1")])),
      ev({ type: "image/offload", turn: 1, targets: [{ seq: 2, imageIndexes: [0] }] }),
    ];
    const messages = buildChatMessages(events, {
      resolveImage: (r) => ({ mediaType: r.mediaType, data: "QUJD" }),
    });
    expect(messages[0]).toEqual({
      role: "user",
      content: `消息 1\n[image offloaded: image (image/png, 100B, id=${(events[1] as unknown as { attachments: AttachmentRef[] }).attachments[0]!.attachmentId})]`,
    });
    expect(JSON.stringify(messages)).not.toContain("QUJD");
  });

  it("只进不退：卸载决策在流内不可逆（无恢复事件——词汇表无该形状）", () => {
    // 结构性断言：EVENT_TYPES 中不存在 image/restore 类事件（回取是
    // store.read 显式动作，不是投影回滚）
    import("../kernel/events.js").then(({ EVENT_TYPES }) => {
      expect(EVENT_TYPES.some((t) => t.startsWith("image/") && t !== "image/offload")).toBe(false);
    });
  });
});
