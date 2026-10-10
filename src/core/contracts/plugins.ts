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
