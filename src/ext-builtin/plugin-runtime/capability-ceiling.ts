/**
 * 插件能力分片装配面（W15a/T9-5——plugin-loader.ts 的行数纪律拆分位）：
 * 宿主可用分片清单 + 热重载"上限快照、变宽即拒"的进程级记账。
 */

/**
 * 宿主装配后的可用分片清单（基线恒在；net/session.read 分片随宿主依赖
 * 注入出现——"声明未装配的片即拒装"的宿主已实现判据源）。
 *
 * W16 排查 F1：services/bus 分片名与 telemetry.export 权限随 T9-6 宿主
 * 装配面（agent-process 恒构造 ServiceBroker/PluginBus/telemetryRouter）
 * 进入可用集——缺席时 contributes.services/bus/telemetry 的绑定权限
 * （service.register/bus.subscribe/telemetry.export）不可授予，三类贡献
 * 装载面永拒、W15b 三特性整体不可用。options 键与 pluginLoadOptions
 * （agent-process 装配传参）对齐——loader 现算 shards 用同一对象。
 */
export function assembledCapabilityShards(options: {
  netFetch?: unknown;
  sessionRead?: unknown;
  injectableServices?: unknown;
  serviceBroker?: unknown;
  bus?: unknown;
}): string[] {
  return [
    "registerTool",
    "subscribe",
    "hooks",
    "settings.read",
    // 贡献绑定权限（宿主恒实现——contributes 装配机制在位）
    "command.register",
    "skill.register",
    "view.register",
    "mcp.register",
    "settings.schema",
    // W15b/T9-6 宿主托管面（serviceBroker/bus 恒装配——装配面传参在位
    // 即展开分片；telemetry router 宿主恒在，export 通道恒可用）
    ...(options.serviceBroker !== undefined ? ["services"] : []),
    ...(options.bus !== undefined ? ["bus"] : []),
    "telemetry.export",
    // inject 服务面（随宿主注入注册表装配——inject 清单的可注入判据）
    ...(options.injectableServices !== undefined ? ["service.invoke"] : []),
    ...(options.netFetch !== undefined ? ["net"] : []),
    ...(options.sessionRead !== undefined ? ["session.read"] : []),
  ];
}

/**
 * 宿主恒装配的基线分片（W16 排查 F2——host 安装预检与子进程装载面的
 * 单一事实源）：ServiceBroker/PluginBus/telemetryRouter 在 agent-process
 * 恒构造，故基线含 services/bus/telemetry.export。两处闭集漂移会造成
 * "装得进市场、装载面拒装"（或反向）——scaffold/claude 兼容产物的绑定
 * 权限据此不再被安装面误拒。条件分片（net/session.read/inject）随子
 * 进程装配出现，host 预检不拒（装载面有最终"声明未装配片即拒装"守卫）。
 */
export function baselineCapabilityShards(): string[] {
  return assembledCapabilityShards({ serviceBroker: {}, bus: {} });
}

/**
 * 能力上限快照（热重载"变宽即拒"——首次装载授予的权限集即本进程内该
 * 插件的上限；重载声明超集 = 类型化拒绝，fail-closed）。进程级 Map
 * （卸载不放宽——pi-desktop 快照语义）。
 */
const capabilityCeilings = new Map<string, ReadonlySet<string>>();

export function capabilityCeilingOf(pluginName: string): ReadonlySet<string> | undefined {
  return capabilityCeilings.get(pluginName);
}

export function recordCapabilityCeiling(pluginName: string, granted: ReadonlySet<string>): void {
  capabilityCeilings.set(pluginName, granted);
}

/** 测试专用清空（生产进程内上限随进程生命周期）。 */
export function resetCapabilityCeilings(): void {
  capabilityCeilings.clear();
}
