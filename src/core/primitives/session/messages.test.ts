/**
 * buildChatMessages 附件投影测试（P1/T-P1-124）：resolveImage 注入展开、
 * 缺省零变化、null 过滤。
 */

import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../../skeleton/events.js";
import { buildChatMessages } from "./messages.js";
import type { AttachmentRef } from "../../../attachments/types.js";

const ref: AttachmentRef = {
  attachmentId: "00000000-0000-4000-8000-000000000001",
  mediaType: "image/png",
  size: 100,
};

const userEventWithAttachments = (refs: AttachmentRef[]): SessionEvent =>
  ({
    type: "user/message",
    seq: 1,
    ts: 0,
    turn: 1,
    message: { content: "看这张图" },
    source: "user",
    attachments: refs,
  }) as unknown as SessionEvent;

describe("buildChatMessages × 附件（P1/T-P1-124）", () => {
  it("注入 resolver：attachments 引用展开为 images（声明性追加 content 之后）", () => {
    const messages = buildChatMessages([userEventWithAttachments([ref])], {
      resolveImage: (r) => ({ mediaType: r.mediaType, data: "AAAA" }),
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      role: "user",
      content: "看这张图",
      images: [{ mediaType: "image/png", data: "AAAA" }],
    });
  });

  it("缺省不注入：引用只落流不进请求（未配置附件能力零行为变化）", () => {
    const messages = buildChatMessages([userEventWithAttachments([ref])]);
    expect(messages[0]).toEqual({ role: "user", content: "看这张图" });
  });

  it("resolver 返回 null 的出现被过滤（卸载/缺失路径——P2 消费位）", () => {
    const ref2: AttachmentRef = { ...ref, attachmentId: "00000000-0000-4000-8000-000000000002" };
    const messages = buildChatMessages([userEventWithAttachments([ref, ref2])], {
      resolveImage: (r) => (r.attachmentId.endsWith("1") ? { mediaType: "image/png", data: "BBBB" } : null),
    });
    expect(messages[0]).toEqual({
      role: "user",
      content: "看这张图",
      images: [{ mediaType: "image/png", data: "BBBB" }],
    });
  });

  it("全部出现被过滤后无 images 字段（不落空数组）", () => {
    const messages = buildChatMessages([userEventWithAttachments([ref])], {
      resolveImage: () => null,
    });
    expect(messages[0]).toEqual({ role: "user", content: "看这张图" });
  });
});

// ---------------------------------------------------------------------------
// E9/T-P2-107：会话引用的投影注入（流存引用不存内容——内容在读取时注入）
// ---------------------------------------------------------------------------

const userEventWithRefs = (
  refs: Array<{ sessionId: string; upToSeq?: number }>,
): SessionEvent =>
  ({
    type: "user/message",
    seq: 2,
    ts: 0,
    turn: 1,
    message: { content: "结合这个会话的内容" },
    source: "user",
    sessionRefs: refs,
  }) as unknown as SessionEvent;

describe("buildChatMessages × 会话引用（E9/T-P2-107）", () => {
  it("注入 resolver：快照文本追加在 content 之后（声明性注入）", () => {
    const messages = buildChatMessages([userEventWithRefs([{ sessionId: "s-ref", upToSeq: 7 }])], {
      resolveSessionRef: (r) => `[引用会话 ${r.sessionId}]（视窗 upToSeq=${r.upToSeq ?? "全流"}）\nuser: 历史内容`,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content).toContain("结合这个会话的内容");
    expect(messages[0]!.content).toContain("[引用会话 s-ref]（视窗 upToSeq=7）");
    expect(messages[0]!.content).toContain("user: 历史内容");
  });

  it("缺省不注入：引用只落流不进请求（零行为变化）；resolver 返回 null 同样不注入", () => {
    const only = buildChatMessages([userEventWithRefs([{ sessionId: "s-ref" }])]);
    expect(only[0]).toEqual({ role: "user", content: "结合这个会话的内容" });

    const filtered = buildChatMessages([userEventWithRefs([{ sessionId: "s-ref" }])], {
      resolveSessionRef: () => null,
    });
    expect(filtered[0]).toEqual({ role: "user", content: "结合这个会话的内容" });
  });

  it("多引用按序注入；空串不注入（不落空段）", () => {
    const messages = buildChatMessages(
      [userEventWithRefs([{ sessionId: "s-a" }, { sessionId: "s-b" }])],
      {
        resolveSessionRef: (r) => (r.sessionId === "s-a" ? "快照A" : ""),
      },
    );
    expect(messages[0]!.content).toBe("结合这个会话的内容\n\n快照A");
  });

  it("referenced 内容零进流：事件载荷本身只有指针（注入仅是投影行为）", () => {
    const event = userEventWithRefs([{ sessionId: "s-ref", upToSeq: 9 }]);
    expect(JSON.stringify(event)).not.toContain("快照");
    expect(JSON.stringify(event)).toContain("\"sessionRefs\":[{\"sessionId\":\"s-ref\",\"upToSeq\":9}]");
  });
});
