/**
 * buildChatMessages 附件投影测试（P1/T-P1-124）：resolveImage 注入展开、
 * 缺省零变化、null 过滤。
 */

import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../kernel/events.js";
import { buildChatMessages } from "./messages.js";
import type { AttachmentRef } from "../attachments/types.js";

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
