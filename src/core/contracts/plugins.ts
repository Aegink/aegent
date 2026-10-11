/**
 * 插件宿主契约（T2-5，纯类型不接线——形状来源 pi-desktop plugin-sdk 与
 * 我方 src/mcp/plugin-sdk.ts 现状）。
 *
 * 记档（任务卡"下沉 manifest 形状"的解释）：PluginManifest 本体形状随
 * T4-1 外置 plugin-runtime 时下沉（其依赖 ChainPoint/HookTrust/
 * PluginContributes 一并随迁）；本文件放宿主 ↔ 插件的**接口形状契约**：
 * 受限能力面（现 3 方法 → EP-11 分片能力面的扩展位）、工具贡献形状、
 * EP-12 常驻服务/总线 contributes 预告。
 */

import type { JsonRecord, JsonValue } from "../skeleton/events.js";

/** 插件工具贡献形状（与 kernel/tools 的 ToolDef 同构子集——宿主侧登记面）。 */
export interface PluginToolDef {
  name: string;
  description: string;
  /** JSON Schema 形状的参数描述（原样透传厂商）。 */
  parameters: JsonValue;
  execute(args: JsonRecord, ctx: unknown): unknown | Promise<unknown>;
}

/**
 * 插件宿主 API（EP-11 分片能力面预告）：现 3 方法是 P0 闭集（内核句柄
 * 不外泄）；分片命名空间（net/fs.read/session.read/settings/bus…）随
 * W15/T9-5 扩展，每片一组权限名 + 网关前置断言。
 */
export interface PluginHostApi {
  /** 登记工具（重名即类型化拒绝——同名覆盖会让不可信代码静默换掉可信工具）。 */
  readonly registerTool: (def: PluginToolDef) => void;
  /** 订阅事件类型（⊆ 事件类型闭集，未知类型类型化拒绝）；返回退订函数。 */
  readonly subscribe: (types: readonly string[]) => () => void;
  /** 本插件的设置值（合并 default 后的只读快照——类型不符已回退缺省）。 */
  readonly pluginSettings: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// W15/T9-5 能力分片 + 权限闭集（pi-desktop PLUGIN_PERMISSIONS 形状——flat
// 字符串闭集；闭集大小对齐我方宿主面而非全量 44 项——清单即宿主事实面）。
// ---------------------------------------------------------------------------

/** 权限名闭集（flat 字符串——清单 capabilities 可声明：分片名或权限名）。 */
export const PLUGIN_PERMISSIONS = [
  // P0 三方法（既有面）
  "tool.register",
  "event.subscribe",
  "hooks.register",
  // W15a 分片面
  "settings.read",
  "net.fetch",
  "session.read",
  // W15b（T9-6 接线的词汇位——闭集一次冻结，实现随 T9-6 落）
  "service.register",
  "service.invoke",
  "bus.publish",
  "bus.subscribe",
  // 贡献绑定词汇
  "command.register",
  "skill.register",
  "view.register",
  "mcp.register",
  "settings.schema",
  // W15b（T9-6）：OTLP 导出通道（contributes.telemetry 声明）
  "telemetry.export",
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

/** 能力分片（声明单元 → 权限名组；网关按片前置断言）。 */
export const PLUGIN_CAPABILITY_SHARDS = {
  registerTool: ["tool.register"],
  subscribe: ["event.subscribe"],
  hooks: ["hooks.register"],
  "settings.read": ["settings.read"],
  net: ["net.fetch"],
  "session.read": ["session.read"],
  services: ["service.register", "service.invoke"],
  bus: ["bus.publish", "bus.subscribe"],
} as const;

export type PluginCapabilityShard = keyof typeof PLUGIN_CAPABILITY_SHARDS;

/** 贡献类别 → 必需权限（贡献↔权限绑定校验的权威表）。 */
export const CONTRIBUTION_PERMISSION_BINDINGS: Readonly<
  Record<string, PluginPermission>
> = {
  commands: "command.register",
  skills: "skill.register",
  views: "view.register",
  mcpServers: "mcp.register",
  settings: "settings.schema",
  subscriptions: "event.subscribe",
  services: "service.register",
  bus: "bus.subscribe",
  telemetry: "telemetry.export",
};

/** 声明的 capability 集 → 授予的权限集合（分片展开 + 直接权限）。 */
export function expandGrantedPermissions(
  capabilities: readonly string[],
): Set<string> {
  const granted = new Set<string>();
  for (const entry of capabilities) {
    const shard = (PLUGIN_CAPABILITY_SHARDS as Record<string, readonly string[]>)[entry];
    if (shard !== undefined) {
      for (const perm of shard) granted.add(perm);
    } else if ((PLUGIN_PERMISSIONS as readonly string[]).includes(entry)) {
      granted.add(entry);
    }
  }
  return granted;
}

/** inject 服务名闭集（dsh 形状——EP-10 注册面的可注入清单）。 */
export const PLUGIN_INJECTABLE_SERVICES = [
  "session",
  "memory",
  "channel",
  "schedule",
  "telemetry",
] as const;

export type PluginInjectableService = (typeof PLUGIN_INJECTABLE_SERVICES)[number];

// ---------------------------------------------------------------------------
// W15b/T9-6 声明式 topic 总线形状（EP-12 契约面——实现在 ext-builtin
// plugin-bus.ts，SDK 经此消费——内核外实现、契约内核持有）
// ---------------------------------------------------------------------------

/** 总线发布载荷（JSON 安全值——与事件面同纪律）。 */
export type BusPayload = Record<string, unknown>;

export interface BusPublishReport {
  readonly ok: boolean;
  readonly topic: string;
  readonly delivered: number;
  readonly error?: string;
}

/** 订阅句柄（退订函数 + 元数据）。 */
export interface BusSubscription {
  readonly topic: string;
  unsubscribe(): void;
}

/**
 * EP-12 常驻服务 contributes 形状（W15/T9-6 接线；contributes.services
 * 声明、宿主管 start/stop/重启 ≤5 次退避）。
 */
export interface PluginServiceContribution {
  /** 服务名（贡献命名空间 `<插件名>/<服务名>`）。 */
  name: string;
  /** 服务入口模块相对路径（插件目录内——路径收敛防任意加载）。 */
  entry: string;
}

/**
 * EP-12 声明式 topic 总线贡献（限流/上限参数化在宿主装配面，W15/T9-6）。
 */
export interface PluginBusContribution {
  /** 可发布的 topic 闭集（声明式——未声明的 topic 发布被网关拒绝）。 */
  topics: readonly string[];
}
