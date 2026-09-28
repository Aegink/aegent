/**
 * IM 端同构接口（K6/K7·T-P2-410）——飞书与 Slack 共用的行为契约：
 * ①入站：IM 消息 → prompt 派发；②出站：事件流摘要 → IM 消息；
 * ③审批：挂起 → 指令卡片 → IM 应答回传 approve（replySource 审计）。
 * 锚点 pideck·FeishuBridge + opencode·slack 的同构行为（其平台 SDK/
 * Electron/CardKit 流式卡片不抄——HTTP API 直调 fetch 零依赖）。
 *
 * 凭据红线（全局约束 3）：平台 token/app secret 一律环境变量经 deps
 * 注入——**凭据缺省跳过**（未配置不激活，构造期零副作用）。
 *
 * 租约语义（卡内定形记档）：IM 端是写命令发起方但默认不持约（N7 单
 * holder）——**抢约派发**：入站消息/应答 → acquire（抢占）→ 命令 →
 * release（发完即还）。语义 = "在 IM 发消息/应答 = 声明控制端"。
 */

import type { HostBridge } from "./bridge.js";
import type { JsonRecord } from "../kernel/events.js";

/** IM 端统一行为面（两平台实现同构——差异只在平台 HTTP API 层）。 */
export interface ImSurface {
  /** 平台标识（= APPROVAL_SURFACES 成员：feishu / slack）。 */
  readonly surfaceId: string;
  /**
   * webhook 入站处理（host server 按路径分型转发）。返回 true = 已处理
   * （含 url_verification 握手与消息/指令解析）；false = 不归本端。
   */
  handleWebhook(headers: Record<string, string>, body: string): Promise<boolean>;
  /** 出站摘要投递（事件流 → IM 消息——platform API 由实现封装）。 */
  deliverEvent(event: JsonRecord): Promise<void>;
}

/** IM 端装配依赖（bridge 编排 + 租约面 + 平台出站 + 凭据缺省跳过）。 */
export interface ImSurfaceDeps {
  bridge: HostBridge;
  sessionId: string;
  /** 平台标识（= APPROVAL_SURFACES 成员——write 命令租约校验的身份）。 */
  surfaceId: string;
  /**
   * 抢约/还约（N7 单 holder 的 IM 面语义——装配桥到
   * host.surfaces.acquireRunLease(surfaceId) / releaseRunLease(surfaceId)；
   * acquire 抛 LeaseBusyError = 另一端正持约，如实报错）。
   */
  acquire: () => void;
  release: () => void;
}

/**
 * 审批指令协议（文本指令——两平台同构、零平台 SDK 依赖）：
 * `approve <requestId>` / `deny <requestId>`（可选尾随 reason）。
 */
export function parseApprovalCommand(text: string): { requestId: string; allow: boolean; reason?: string } | null {
  const m = /^(approve|deny)\s+(\S+)(?:\s+([\s\S]+))?$/.exec(text.trim());
  if (m === null) return null;
  const [, action, requestId, reason] = m as unknown as [string, string, string, string?];
  return { requestId, allow: action === "approve", ...(reason !== undefined ? { reason: reason.trim() } : {}) };
}

/** 抢约派发（N7 单 holder 的 IM 面语义——见文件头记档）。 */
export async function withLease(
  deps: ImSurfaceDeps,
  run: () => Promise<void>,
): Promise<void> {
  // acquire（抢占——LeaseBusyError 即"另一端正持约"，IM 面如实报错）
  deps.acquire();
  try {
    await run();
  } finally {
    deps.release();
  }
}

/** prompt 派发（IM 消息 → agent 会话——bridge 写命令，须在租约内）。 */
export async function dispatchPrompt(
  deps: ImSurfaceDeps,
  text: string,
): Promise<void> {
  await withLease(deps, async () => {
    await deps.bridge.send(
      deps.sessionId,
      { type: "prompt", messageId: `im-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, content: text },
      { surfaceId: deps.surfaceId },
    );
  });
}

/**
 * 审批应答回传（IM 指令 → bridge approve——**抢约三步**：acquire →
 * approve（带 source=平台标识 → C6 replySource 审计）→ release）。
 */
export async function dispatchApproval(
  deps: ImSurfaceDeps,
  requestId: string,
  allow: boolean,
  reason?: string,
): Promise<void> {
  await withLease(deps, async () => {
    await deps.bridge.send(
      deps.sessionId,
      {
        type: "approve",
        requestId,
        action: allow ? "allow" : "deny",
        source: deps.surfaceId,
        ...(reason !== undefined ? { reason } : {}),
      },
      { surfaceId: deps.surfaceId },
    );
  });
}

/** 事件 → 文本摘要（出站渲染的最小面——两平台共用）。 */
export function summarizeEvent(event: JsonRecord): string | null {
  const type = String(event["type"] ?? "");
  if (type === "turn/start") return "▶ 轮开始";
  if (type === "turn/end") {
    const reason = event["reason"] as { kind?: string } | undefined;
    return `■ 轮结束（${reason?.kind ?? "unknown"}）`;
  }
  if (type === "assistant/message") {
    const message = event["message"] as { content?: string } | undefined;
    const text = typeof message?.content === "string" ? message.content : "";
    if (text.trim() === "") return null;
    return `🤖 ${text.slice(0, 500)}`;
  }
  return null;
}
