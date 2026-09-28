/**
 * K7 Slack 端（T-P2-410）——场景③ 的 IM 端（opencode·slack 同构行为）：
 * webhook 入站（url_verification 握手 + Events API message 事件——bot
 * 自身消息过滤防环）→ prompt 派发 / 审批应答回传；事件流摘要出站
 * （chat.postMessage）。平台 SDK 不抄（HTTP 直调 fetch 零依赖；凭据
 * 红线：bot token 环境变量注入，缺省跳过 = 未配置不激活）。
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

export interface SlackConfig {
  /** Slack bot token（xoxb-…——环境变量注入，零落盘）。 */
  botToken: string;
  /** 目标频道 id（单频道绑定——最小面）。 */
  channelId: string;
  /** Slack API 根（缺省 https://slack.com/api）。 */
  baseUrl?: string;
}

export interface SlackDeps extends ImSurfaceDeps {
  config?: SlackConfig;
  fetchImpl?: typeof fetch;
}

export function createSlackSurface(deps: SlackDeps): ImSurface | null {
  // 凭据缺省跳过（未配置不激活——卡面验收点）
  if (deps.config === undefined) return null;
  const { botToken, channelId, baseUrl = "https://slack.com/api" } = deps.config;
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function sendMessage(text: string): Promise<void> {
    const response = await fetchImpl(`${baseUrl}/chat.postMessage`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${botToken}` },
      body: JSON.stringify({ channel: channelId, text }),
    });
    const body = (await response.json()) as { ok?: unknown; error?: unknown };
    if (response.ok !== true || body["ok"] !== true) {
      throw new Error(`Slack 消息发送失败：${String(body["error"] ?? `HTTP ${String(response.status)}`)}`);
    }
  }

  return {
    surfaceId: "slack",
    async handleWebhook(_headers: Record<string, string>, body: string): Promise<boolean> {
      let payload: JsonRecord;
      try {
        payload = JSON.parse(body) as JsonRecord;
      } catch {
        return false;
      }
      // Events API 握手（Slack url_verification——challenge 原样回显）
      if (payload["type"] === "url_verification") {
        await sendMessage(`challenge:${String(payload["challenge"] ?? "")}`);
        return true;
      }
      const event = payload["event"] as { type?: unknown; text?: unknown; bot_id?: unknown } | undefined;
      if (event?.["type"] !== "message" || typeof event["text"] !== "string") return true;
      // bot 自身消息过滤（回环防呆——opencode 同款纪律）
      if (typeof event["bot_id"] === "string" && event["bot_id"] !== "") return true;
      const text = event["text"];
      // 审批指令（approve/deny <requestId>）→ 应答回传
      const command = parseApprovalCommand(text);
      if (command !== null) {
        await dispatchApproval(deps, command.requestId, command.allow, command.reason);
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
