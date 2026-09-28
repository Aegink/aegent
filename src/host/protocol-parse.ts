/**
 * 端间协议解析半边（K8/T-P1-115；K5/T-P1-128 拆分）——端 → host 信封的
 * 类型与严格校验（未知属性拒绝 + 错误消息有界 + MAX_LINE_BYTES 行防呆）。
 * 与传输无关（pi transport-neutral——字节怎么走在 server.ts）；服务端信封
 * 与连接状态机在 protocol.ts（本文件是其解析前置面——行数纪律的拆分位）。
 */

import {
  MAX_LINE_BYTES,
  type AgentRequest,
} from "../kernel/agent-protocol.js";

/** 错误消息有界（pi boundedErrorMessage 同款 500 字符截断）。 */
export function bounded(message: string): string {
  return message.length <= 500 ? message : `${message.slice(0, 497)}...`;
}

export interface ProtocolErrorShape {
  readonly code: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// 端 → host 信封（严格校验：未知属性拒绝）
// ---------------------------------------------------------------------------

export type ClientEnvelope =
  | {
      type: "hello";
      version: number;
      /** N2/T-P1-116：端身份注册（可选——缺省 = 匿名观察者，只收广播不可写）。
       * surfaceId/deliveryKind 成对出现由 HostBridge 校验。 */
      surfaceId?: string;
      deliveryKind?: string;
    }
  | { type: "request"; requestId: string; sessionId: string; call: AgentRequest }
  /**
   * N7/T-P1-116 run 租约的协议面（host 域命令——不经 agent，bridge 直答）：
   * acquire 获得写命令权（单 holder，已有人持约 → LeaseBusy error）；
   * release 主动归还。断线自动释放（SurfaceHub close 面）。
   */
  | { type: "lease"; op: "acquire" | "release"; surfaceId: string }
  /**
   * K5/T-P1-128 只读查询面（bridge 直答——lease 信封同构：不经 agent）。
   * op:"events" = 恢复视图（连接前的会话事件可查——UI 重连/刷新的快照面，
   * pi·client "快照先行 + 流续播"的重连行为）；afterSeq 可选游标（只回
   * seq 大于它的部分）。只读不落流——零事件零载荷扩展。
   */
  | {
      type: "query";
      requestId: string;
      sessionId: string;
      op: "events";
      afterSeq?: number;
    }
  /**
   * U14/T-P3-103 settings 直答信封（host 面配置——不经 agent、不落流）：
   * op:"get" 读整份配置；op:"update" 段级补丁（providers/permission/sandbox/
   * appearance/defaultProvider/defaultModel——提段整体替换，白名单外拒绝）；
   * op:"credentials-set|delete|list" 凭据管理（U2——key 材料只在 set 载荷，
   * list/get 只回掩码面）。补丁与凭据操作是 host 配置面写操作，不属于会话
   * 写命令（不参与 run 租约——host 单实例本机面，记档）。
   */
  | {
      type: "settings";
      requestId: string;
      op: "get" | "update" | "credentials-set" | "credentials-delete" | "credentials-list";
      patch?: Record<string, unknown>;
      provider?: string;
      key?: string;
    };

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return `未知属性 "${key}"`;
  }
  return null;
}

/** 解析并严格校验一条端 → host 信封（坏信封抛 Error——调用方转 error 行）。 */
export function parseClientEnvelope(line: string): ClientEnvelope {
  if (line.length > MAX_LINE_BYTES) {
    throw new Error(`行超长（上限 ${MAX_LINE_BYTES} 字符）`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(`非 JSON 行：${bounded(error instanceof Error ? error.message : String(error))}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("信封必须是 JSON 对象");
  }
  const record = parsed as Record<string, unknown>;
  const type = record["type"];
  if (type === "hello") {
    const unknownKey = rejectUnknownKeys(record, ["type", "version", "surfaceId", "deliveryKind"]);
    if (unknownKey) throw new Error(`hello 信封${unknownKey}`);
    if (typeof record["version"] !== "number" || !Number.isInteger(record["version"])) {
      throw new Error("hello 需要 version 整数");
    }
    const surfaceId = record["surfaceId"];
    const deliveryKind = record["deliveryKind"];
    if (surfaceId !== undefined && (typeof surfaceId !== "string" || surfaceId === "")) {
      throw new Error("hello 的 surfaceId 须为非空字符串");
    }
    if (deliveryKind !== undefined && deliveryKind !== "push" && deliveryKind !== "poll") {
      throw new Error(`hello 的 deliveryKind 非法：${String(deliveryKind)}（合法：push|poll）`);
    }
    return {
      type: "hello",
      version: record["version"],
      ...(surfaceId !== undefined ? { surfaceId: surfaceId as string } : {}),
      ...(deliveryKind !== undefined ? { deliveryKind: deliveryKind as "push" | "poll" } : {}),
    };
  }
  if (type === "lease") {
    const unknownKey = rejectUnknownKeys(record, ["type", "op", "surfaceId"]);
    if (unknownKey) throw new Error(`lease 信封${unknownKey}`);
    if (record["op"] !== "acquire" && record["op"] !== "release") {
      throw new Error(`lease 的 op 非法：${String(record["op"])}（合法：acquire|release）`);
    }
    if (typeof record["surfaceId"] !== "string" || record["surfaceId"] === "") {
      throw new Error("lease 需要 surfaceId 非空字符串");
    }
    return { type: "lease", op: record["op"] as "acquire" | "release", surfaceId: record["surfaceId"] };
  }
  if (type === "query") {
    const unknownKey = rejectUnknownKeys(record, ["type", "requestId", "sessionId", "op", "afterSeq"]);
    if (unknownKey) throw new Error(`query 信封${unknownKey}`);
    if (typeof record["requestId"] !== "string" || record["requestId"] === "") {
      throw new Error("query 需要 requestId 非空字符串");
    }
    if (typeof record["sessionId"] !== "string" || record["sessionId"] === "") {
      throw new Error("query 需要 sessionId 非空字符串");
    }
    if (record["op"] !== "events") {
      throw new Error(`query 的 op 非法：${String(record["op"])}（合法：events）`);
    }
    if (
      record["afterSeq"] !== undefined &&
      (typeof record["afterSeq"] !== "number" || !Number.isInteger(record["afterSeq"]) || record["afterSeq"] < 0)
    ) {
      throw new Error("query 的 afterSeq 须为非负整数");
    }
    return {
      type: "query",
      requestId: record["requestId"],
      sessionId: record["sessionId"],
      op: "events",
      ...(record["afterSeq"] !== undefined ? { afterSeq: record["afterSeq"] as number } : {}),
    };
  }
  if (type === "settings") {
    const unknownKey = rejectUnknownKeys(record, [
      "type",
      "requestId",
      "op",
      "patch",
      "provider",
      "key",
    ]);
    if (unknownKey) throw new Error(`settings 信封${unknownKey}`);
    if (typeof record["requestId"] !== "string" || record["requestId"] === "") {
      throw new Error("settings 需要 requestId 非空字符串");
    }
    const op = record["op"];
    if (
      op !== "get" &&
      op !== "update" &&
      op !== "credentials-set" &&
      op !== "credentials-delete" &&
      op !== "credentials-list"
    ) {
      throw new Error(
        `settings 的 op 非法：${String(op)}（合法：get|update|credentials-set|credentials-delete|credentials-list）`,
      );
    }
    if (op === "update") {
      if (record["patch"] === null || typeof record["patch"] !== "object" || Array.isArray(record["patch"])) {
        throw new Error("settings op=update 需要 patch 对象");
      }
      // 段白名单在 gateway 层（applySettingsPatch——业务规则回类型化
      // SETTINGS_PATCH_SECTION_UNKNOWN；parse 层只管信封形状）
    }
    if (op === "credentials-set") {
      if (typeof record["provider"] !== "string" || record["provider"] === "") {
        throw new Error("settings op=credentials-set 需要 provider 非空字符串");
      }
      if (typeof record["key"] !== "string" || record["key"] === "") {
        throw new Error("settings op=credentials-set 需要 key 非空字符串");
      }
    }
    if (op === "credentials-delete") {
      if (typeof record["provider"] !== "string" || record["provider"] === "") {
        throw new Error("settings op=credentials-delete 需要 provider 非空字符串");
      }
    }
    return {
      type: "settings",
      requestId: record["requestId"],
      op,
      ...(record["patch"] !== undefined ? { patch: record["patch"] as Record<string, unknown> } : {}),
      ...(typeof record["provider"] === "string" ? { provider: record["provider"] } : {}),
      ...(typeof record["key"] === "string" ? { key: record["key"] } : {}),
    };
  }
  if (type === "request") {
    const unknownKey = rejectUnknownKeys(record, ["type", "requestId", "sessionId", "call"]);
    if (unknownKey) throw new Error(`request 信封${unknownKey}`);
    if (typeof record["requestId"] !== "string" || record["requestId"] === "") {
      throw new Error("request 需要 requestId 非空字符串");
    }
    if (typeof record["sessionId"] !== "string" || record["sessionId"] === "") {
      throw new Error("request 需要 sessionId 非空字符串");
    }
    if (record["call"] === null || typeof record["call"] !== "object" || Array.isArray(record["call"])) {
      throw new Error("request 需要 call 对象（AgentRequest）");
    }
    const call = record["call"] as Record<string, unknown>;
    if (typeof call["type"] !== "string" || call["type"] === "") {
      throw new Error("request.call 需要 type 字段");
    }
    return {
      type: "request",
      requestId: record["requestId"],
      sessionId: record["sessionId"],
      call: call as unknown as AgentRequest,
    };
  }
  throw new Error(`未知信封类型：${String(type)}`);
}
