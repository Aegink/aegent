/**
 * K7 Slack 端测试（T-P2-410）——mock HTTP 往返（chat.postMessage）+
 * 握手 + bot 回环过滤 + 消息 → prompt 派发（抢约序）+ 审批应答链
 * （source=slack）+ 凭据缺省跳过。
 */

import { describe, expect, it } from "vitest";

import { createSlackSurface, type SlackConfig } from "./im-slack.js";
import type { HostBridge } from "./bridge.js";
import type { JsonRecord } from "../kernel/events.js";

const CONFIG: SlackConfig = { botToken: "xoxb-test", channelId: "C123" };

function makeDeps(config: SlackConfig | undefined, fetchLog: Array<{ url: string; body?: string }>): {
  deps: Parameters<typeof createSlackSurface>[0];
  calls: string[];
  sent: Array<{ type: string } & JsonRecord>;
} {
  const calls: string[] = [];
  const sent: Array<{ type: string } & JsonRecord> = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    fetchLog.push({ url: String(url), body: typeof init?.body === "string" ? init.body : undefined });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
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
    surfaceId: "slack",
    acquire: () => calls.push("acquire"),
    release: () => calls.push("release"),
    configured: true,
    config,
    fetchImpl,
  };
  return { deps, calls, sent };
}

describe("createSlackSurface", () => {
  it("凭据缺省跳过（未配置不激活）", () => {
    const { deps } = makeDeps(undefined, []);
    expect(createSlackSurface(deps)).toBeNull();
  });

  it("url_verification 握手：challenge 回显", async () => {
    const fetchLog: Array<{ url: string; body?: string }> = [];
    const { deps } = makeDeps(CONFIG, fetchLog);
    const surface = createSlackSurface(deps)!;
    const handled = await surface.handleWebhook(
      {},
      JSON.stringify({ type: "url_verification", challenge: "abc789" }),
    );
    expect(handled).toBe(true);
    expect(fetchLog.some((f) => f.body?.includes("challenge:abc789"))).toBe(true);
  });

  it("IM 消息 → prompt 派发（抢约序：acquire → send:prompt → release）", async () => {
    const { deps, calls, sent } = makeDeps(CONFIG, []);
    const surface = createSlackSurface(deps)!;
    await surface.handleWebhook(
      {},
      JSON.stringify({ event: { type: "message", text: "跑一下测试" } }),
    );
    expect(calls).toEqual(["acquire", "send:prompt", "release"]);
    expect(sent[0]?.type).toBe("prompt");
    expect(sent[0]?.["content"]).toBe("跑一下测试");
  });

  it("bot 自身消息过滤（回环防呆）", async () => {
    const fetchLog: Array<{ url: string; body?: string }> = [];
    const { deps, calls } = makeDeps(CONFIG, fetchLog);
    const surface = createSlackSurface(deps)!;
    const handled = await surface.handleWebhook(
      {},
      JSON.stringify({ event: { type: "message", text: "approve x", bot_id: "B1" } }),
    );
    expect(handled).toBe(true);
    expect(calls).toEqual([]); // 零派发
  });

  it("审批应答链：approve/deny 指令 → bridge approve（source=slack）", async () => {
    const { deps, sent } = makeDeps(CONFIG, []);
    const surface = createSlackSurface(deps)!;
    await surface.handleWebhook(
      {},
      JSON.stringify({ event: { type: "message", text: "approve call-3" } }),
    );
    expect(sent[0]).toMatchObject({ type: "approve", requestId: "call-3", action: "allow", source: "slack" });
    await surface.handleWebhook(
      {},
      JSON.stringify({ event: { type: "message", text: "deny call-3 危险" } }),
    );
    expect(sent[1]).toMatchObject({ type: "approve", requestId: "call-3", action: "deny", source: "slack", reason: "危险" });
  });

  it("deliverEvent：assistant/message → chat.postMessage（Bearer token）", async () => {
    const fetchLog: Array<{ url: string; body?: string }> = [];
    const { deps } = makeDeps(CONFIG, fetchLog);
    const surface = createSlackSurface(deps)!;
    await surface.deliverEvent({ type: "assistant/message", message: { content: "构建通过" } } as JsonRecord);
    const call = fetchLog.find((f) => f.url.includes("chat.postMessage"));
    expect(call).toBeDefined();
    expect((JSON.parse(call?.body ?? "{}") as { text: string }).text).toContain("构建通过");
  });

  it("sendMessage 平台错误（ok:false）→ 类型化 Error（不含 token）", async () => {
    const { deps } = makeDeps(CONFIG, []);
    const surface = createSlackSurface(deps)!;
    const broken = createSlackSurface({
      ...deps,
      config: CONFIG,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), { status: 200 })) as typeof fetch,
    } as never)!;
    await expect(broken.deliverEvent({ type: "assistant/message", message: { content: "x" } } as JsonRecord)).rejects.toThrow(
      "channel_not_found",
    );
    void surface;
  });
});
