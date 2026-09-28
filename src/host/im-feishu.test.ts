/**
 * K6 飞书端测试（T-P2-410）——mock HTTP 往返（token + 发消息）+ 握手 +
 * 消息 → prompt 派发（抢约序）+ 审批应答链（source=feishu）+ 凭据缺省
 * 跳过。
 */

import { describe, expect, it } from "vitest";

import { createFeishuSurface, type FeishuConfig } from "./im-feishu.js";
import type { HostBridge } from "./bridge.js";
import type { JsonRecord } from "../kernel/events.js";

const CONFIG: FeishuConfig = { appId: "cli_a", appSecret: "s3cret", chatId: "oc_chat1" };

/** fake 装配：记录 send/acquire/release 时序。 */
function makeDeps(config: FeishuConfig | undefined, fetchLog: Array<{ url: string; body?: string }>): {
  deps: Parameters<typeof createFeishuSurface>[0];
  calls: string[];
  sent: Array<{ type: string } & JsonRecord>;
} {
  const calls: string[] = [];
  const sent: Array<{ type: string } & JsonRecord> = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    fetchLog.push({ url: String(url), body: typeof init?.body === "string" ? init.body : undefined });
    const urlStr = String(url);
    if (urlStr.includes("tenant_access_token")) {
      return new Response(JSON.stringify({ tenant_access_token: "t-1", expire: 7200 }), { status: 200 });
    }
    if (urlStr.includes("im/v1/messages")) {
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const deps = {
    bridge: {
      send: async (_sid: string, request: { type: string }, _from: unknown) => {
        calls.push(`send:${request.type}`);
        sent.push(request);
        return { sent: true };
      },
    } as unknown as HostBridge,
    sessionId: "s1",
    surfaceId: "feishu",
    acquire: () => calls.push("acquire"),
    release: () => calls.push("release"),
    configured: true,
    config,
    fetchImpl,
  };
  return { deps, calls, sent };
}

describe("createFeishuSurface", () => {
  it("凭据缺省跳过（未配置不激活）", () => {
    const { deps } = makeDeps(undefined, []);
    expect(createFeishuSurface(deps)).toBeNull();
  });

  it("url_verification 握手：challenge 回显", async () => {
    const fetchLog: Array<{ url: string; body?: string }> = [];
    const { deps } = makeDeps(CONFIG, fetchLog);
    const surface = createFeishuSurface(deps)!;
    const handled = await surface.handleWebhook(
      {},
      JSON.stringify({ type: "url_verification", challenge: "xyz123" }),
    );
    expect(handled).toBe(true);
    expect(fetchLog.some((f) => f.body?.includes("challenge:xyz123"))).toBe(true);
  });

  it("IM 消息 → prompt 派发（抢约序：acquire → send:prompt → release）", async () => {
    const { deps, calls, sent } = makeDeps(CONFIG, []);
    const surface = createFeishuSurface(deps)!;
    const handled = await surface.handleWebhook(
      {},
      JSON.stringify({
        header: { event_type: "im.message.receive_v1" },
        event: { message: { content: JSON.stringify({ text: "帮我看看构建" }) } },
      }),
    );
    expect(handled).toBe(true);
    expect(calls).toEqual(["acquire", "send:prompt", "release"]);
    expect(sent[0]?.type).toBe("prompt");
    expect(sent[0]?.["content"]).toBe("帮我看看构建");
  });

  it("审批应答链：approve 指令 → bridge approve（抢约序 + source=feishu）", async () => {
    const { deps, calls, sent } = makeDeps(CONFIG, []);
    const surface = createFeishuSurface(deps)!;
    await surface.handleWebhook(
      {},
      JSON.stringify({
        header: { event_type: "im.message.receive_v1" },
        event: { message: { content: JSON.stringify({ text: "approve call-9 看过了没问题" }) } },
      }),
    );
    expect(calls).toEqual(["acquire", "send:approve", "release"]);
    expect(sent[0]).toMatchObject({ type: "approve", requestId: "call-9", action: "allow", source: "feishu" });
    expect(sent[0]?.["reason"]).toBe("看过了没问题");
  });

  it("deny 指令 → action=deny", async () => {
    const { deps, sent } = makeDeps(CONFIG, []);
    const surface = createFeishuSurface(deps)!;
    await surface.handleWebhook(
      {},
      JSON.stringify({
        header: { event_type: "im.message.receive_v1" },
        event: { message: { content: JSON.stringify({ text: "deny call-9" }) } },
      }),
    );
    expect(sent[0]).toMatchObject({ type: "approve", action: "deny", source: "feishu" });
  });

  it("非订阅事件已处理但零动作；tenant token 缓存（第二次发消息不再取 token）", async () => {
    const fetchLog: Array<{ url: string; body?: string }> = [];
    const { deps } = makeDeps(CONFIG, fetchLog);
    const surface = createFeishuSurface(deps)!;
    expect(await surface.handleWebhook({}, JSON.stringify({ header: { event_type: "other.event" } }))).toBe(true);
    await surface.deliverEvent({ type: "assistant/message", message: { content: "结果文本" } } as JsonRecord);
    await surface.deliverEvent({ type: "assistant/message", message: { content: "第二条" } } as JsonRecord);
    const tokenCalls = fetchLog.filter((f) => f.url.includes("tenant_access_token"));
    expect(tokenCalls).toHaveLength(1); // 缓存生效
    expect(fetchLog.filter((f) => f.url.includes("im/v1/messages"))).toHaveLength(2);
  });

  it("deliverEvent：非摘要事件零发送；assistant/message 截断 500 字符内", async () => {
    const fetchLog: Array<{ url: string; body?: string }> = [];
    const { deps } = makeDeps(CONFIG, fetchLog);
    const surface = createFeishuSurface(deps)!;
    await surface.deliverEvent({ type: "step/start" } as JsonRecord);
    expect(fetchLog.filter((f) => f.url.includes("im/v1/messages"))).toHaveLength(0);
    await surface.deliverEvent({ type: "assistant/message", message: { content: "x".repeat(600) } } as JsonRecord);
    const sent = JSON.parse(fetchLog.at(-1)?.body ?? "{}") as { content: string };
    expect((JSON.parse(sent.content) as { text: string }).text.length).toBeLessThanOrEqual(505);
  });
});
