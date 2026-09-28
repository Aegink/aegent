/**
 * K6 飞书端（T-P2-410）——场景③ 的 IM 端（FeishuBridge 同构行为）：
 * webhook 入站（url_verification 握手 + im.message.receive_v1 消息）→
 * prompt 派发 / 审批应答回传；事件流摘要出站（im/v1/messages）。
 * pideck 的 CardKit 流式卡片 / Electron / Session Mirror 不抄（HTTP API
 * 直调 fetch 零依赖——全局约束凭据红线：app_id/secret 环境变量注入，
 * 凭据缺省跳过 = 未配置不激活）。
 */

import {
  dispatchApproval,
  dispatchPrompt,
  parseApprovalCommand,
  summarizeEvent,
  type ImSurface,
  type ImSurfaceDeps,
} from "./im-surface.js";
import type { JsonRecord } from "../kernel/events.js";

export interface FeishuConfig {
  /** 飞书开放平台应用凭证（环境变量注入——零落盘）。 */
  appId: string;
  appSecret: string;
  /** 接收消息的会话 id（单群绑定——pideck"1 会话 = 1 群"的最小面）。 */
  chatId: string;
  /** 飞书开放平台根（缺省 https://open.feishu.cn）。 */
  baseUrl?: string;
}

export interface FeishuDeps extends ImSurfaceDeps {
  config?: FeishuConfig;
  fetchImpl?: typeof fetch;
}

/** tenant_access_token 缓存（进程内——expire 前复用，凭据零落盘日志）。 */
interface TokenCache {
  token: string;
  expiresAt: number;
}

export function createFeishuSurface(deps: FeishuDeps): ImSurface | null {
  // 凭据缺省跳过（未配置不激活——卡面验收点）
  if (deps.config === undefined) return null;
  const { appId, appSecret, chatId, baseUrl = "https://open.feishu.cn" } = deps.config;
  const fetchImpl = deps.fetchImpl ?? fetch;
  let tokenCache: TokenCache | undefined;

  async function tenantAccessToken(): Promise<string> {
    if (tokenCache !== undefined && tokenCache.expiresAt > Date.now()) return tokenCache.token;
    const response = await fetchImpl(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const body = (await response.json()) as { tenant_access_token?: unknown; expire?: unknown };
    if (typeof body["tenant_access_token"] !== "string" || typeof body["expire"] !== "number") {
      throw new Error("飞书 tenant_access_token 获取失败（凭证或网络面——错误面不含 secret）");
    }
    tokenCache = { token: body["tenant_access_token"], expiresAt: Date.now() + (body["expire"] - 60) * 1000 };
    return tokenCache.token;
  }

  async function sendMessage(text: string): Promise<void> {
    const token = await tenantAccessToken();
    const response = await fetchImpl(`${baseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }) }),
    });
    if (!response.ok) {
      throw new Error(`飞书消息发送失败：HTTP ${String(response.status)}（错误面不含 token）`);
    }
  }

  return {
    surfaceId: "feishu",
    async handleWebhook(_headers: Record<string, string>, body: string): Promise<boolean> {
      let payload: JsonRecord;
      try {
        payload = JSON.parse(body) as JsonRecord;
      } catch {
        return false;
      }
      // 事件订阅握手（飞书 url_verification——challenge 原样回显）
      if (payload["type"] === "url_verification") {
        await sendMessage(`challenge:${String(payload["challenge"] ?? "")}`);
        return true;
      }
      const header = payload["header"] as { event_type?: unknown } | undefined;
      if (header?.["event_type"] !== "im.message.receive_v1") return true; // 订阅内事件——已处理（其余忽略）
      const event = payload["event"] as { message?: { content?: unknown } } | undefined;
      const contentRaw = event?.message?.["content"];
      let text = "";
      try {
        const content = JSON.parse(String(contentRaw ?? "{}")) as { text?: unknown };
        text = typeof content["text"] === "string" ? content["text"] : "";
      } catch {
        text = "";
      }
      // 审批指令（approve/deny <requestId>）→ 应答回传
      const command = parseApprovalCommand(text);
      if (command !== null) {
        await dispatchPromptApproval(deps, command.requestId, command.allow, command.reason);
        return true;
      }
      // 普通消息 → prompt 派发（抢约——N7 记档）
      if (text.trim() !== "") {
        await dispatchPrompt(deps, text);
      }
      return true;
    },
    async deliverEvent(event: JsonRecord): Promise<void> {
      const summary = summarizeEvent(event);
      if (summary !== null) await sendMessage(summary);
    },
  };
}

async function dispatchPromptApproval(
  deps: ImSurfaceDeps,
  requestId: string,
  allow: boolean,
  reason?: string,
): Promise<void> {
  const { dispatchApproval } = await import("./im-surface.js");
  await dispatchApproval(deps, requestId, allow, reason);
}
