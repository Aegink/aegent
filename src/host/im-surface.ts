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

/**
 * W3/T7-1 入站授权四态（hermes §13 同构——P0 安全项）：
 * - open：全部放行（开发态）；
 * - allowlist：principal ∈ 白名单放行（**blank principal 一律拒绝**）；
 * - disabled：全部拒绝（渠道下线）；
 * - pairing：pairing 握手门（首消息须带配对码，通过后 principal 进白名单）。
 */
export type ImAuthorizeMode = "open" | "allowlist" | "disabled" | "pairing";

export interface ImAuthorizeDecision {
  readonly decision: "allow" | "deny";
  readonly reason?: string;
}

/** IM 端装配依赖（bridge 编排 + 租约面 + 平台出站 + 凭据缺省跳过）。 */
export interface ImSurfaceDeps {
  bridge: HostBridge;
  sessionId: string;
  /**
   * W3/T7-1 入站授权面（装配注入——mode/allowlist 来自 settings IM 段）。
   * 缺省 undefined = 既有行为零变化（记档：生产装配必须显式配置——
   * 缺省 open 的旧语义随 W3 收紧为"未配置即 deny"，装配面负责迁移）。
   */
  authorize?(principal: string | undefined, mode: ImAuthorizeMode, allowlist: readonly string[]): ImAuthorizeDecision;
  /** 授权模式与白名单来源（活查询——settings 热刷即生效）。 */
  authorizeConfig?(): { mode: ImAuthorizeMode; allowlist: readonly string[] };
  /** pairing 握手通过回调（principal 进白名单的持久化——装配面注入）。 */
  onPaired?(principal: string): void;
  /** 入站可建会话（T7-1：IM 入站改可"建真实会话"——返回新 sessionId）。 */
  createInboundSession?(parentSessionId: string | undefined, title: string): Promise<string> | string;
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
/** W3/T7-1 入站授权（dispatchPrompt/dispatchApproval 共用的首个闸）。 */
export function authorizeInbound(
  deps: ImSurfaceDeps,
  principal: string | undefined,
): ImAuthorizeDecision {
  if (deps.authorize === undefined || deps.authorizeConfig === undefined) {
    // 未装配授权面：保持既有行为（记档——生产装配显式配置）
    return { decision: "allow" };
  }
  const { mode, allowlist } = deps.authorizeConfig();
  if (mode === "disabled") {
    return { decision: "deny", reason: "渠道已禁用（disabled）" };
  }
  if (mode === "open") return { decision: "allow" };
  // allowlist / pairing：blank principal 一律拒绝（无身份不可授权）
  if (principal === undefined || principal.trim() === "") {
    return { decision: "deny", reason: "空 principal（W3：无身份不可授权）" };
  }
  if (allowlist.includes(principal)) return { decision: "allow" };
  if (mode === "pairing") {
    // pairing 握手门：首消息须为配对指令 `pair <code>`——宿主装配校验码后回调 onPaired
    return { decision: "deny", reason: "pairing 模式：请先发送 pair <配对码> 完成绑定" };
  }
  return { decision: "deny", reason: `principal ${principal} 不在白名单（allowlist）` };
}

export async function dispatchPrompt(
  deps: ImSurfaceDeps,
  text: string,
  options?: { principal?: string; createNew?: boolean },
): Promise<void> {
  // W3/T7-1：入站授权首闸（许可检查先于租约与投递——未授权内容不进解析面）
  const verdict = authorizeInbound(deps, options?.principal);
  if (verdict.decision === "deny") {
    throw new Error(`IM 入站拒绝：${verdict.reason ?? "未授权"}`);
  }
  // T7-1：入站可建会话（createInboundSession 在位且调用方要求建新会话时——
  // IM 消息写死单 sessionId 的旧语义由此突破；缺省投递既有会话零变化）
  let targetSessionId = deps.sessionId;
  if (options?.createNew === true && deps.createInboundSession !== undefined) {
    targetSessionId = await deps.createInboundSession(undefined, text.slice(0, 40));
  }
  await withLease(deps, async () => {
    await deps.bridge.send(
      targetSessionId,
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

/**
 * W12/T7-3 渠道注册面（EP-6）：渠道实现（feishu/slack）以 Channel 注册——
 * host 装配经此挂载/卸载；**关渠道（不注册）= 无该渠道入站面**（可裁剪）。
 * 凭据经插件/装配设置注入（不落代码）。
 */
export interface ChannelRegistration {
  readonly channelId: string;
  /** webhook 路径前缀（host 路由表键——如 /webhook/feishu）。 */
  readonly routePath: string;
  /** 入站处理（ImSurface.handleWebhook 的注册形态）。 */
  handleWebhook(headers: Record<string, string>, body: string): Promise<boolean>;
  /** 出站摘要投递。 */
  deliverEvent(event: JsonRecord): Promise<void>;
  /** 凭据注入（settings 段 → 平台 token——装配面在注册前调用）。 */
  configureCredentials(credentials: Record<string, string>): void;
}

/** 渠道注册表（host 装配持有——路由表数据源；可裁剪语义的载体）。 */
export class ChannelRegistry {
  private readonly channels = new Map<string, ChannelRegistration>();

  register(channel: ChannelRegistration): this {
    this.channels.set(channel.channelId, channel);
    return this;
  }

  unregister(channelId: string): boolean {
    return this.channels.delete(channelId);
  }

  /** webhook 路由解析（host 按路径分型转发——未注册路径 = 不归任何渠道）。 */
  byRoutePath(pathname: string): ChannelRegistration | undefined {
    return [...this.channels.values()].find((c) => pathname.startsWith(c.routePath));
  }

  get(channelId: string): ChannelRegistration | undefined {
    return this.channels.get(channelId);
  }

  ids(): readonly string[] {
    return [...this.channels.keys()];
  }
}