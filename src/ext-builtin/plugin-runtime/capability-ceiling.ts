/**
 * 插件能力分片装配面（W15a/T9-5——plugin-loader.ts 的行数纪律拆分位）：
 * 宿主可用分片清单 + 热重载"上限快照、变宽即拒"的进程级记账。
 */

/**
 * 宿主装配后的可用分片清单（基线恒在；net/session.read 分片随宿主依赖
 * 注入出现——"声明未装配的片即拒装"的宿主已实现判据源）。
 */
export function assembledCapabilityShards(options: {
  netFetch?: unknown;
  sessionRead?: unknown;
  injectableServices?: unknown;
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
    // inject 服务面（随宿主注入注册表装配——service.register/bus 随 T9-6 实现）
    ...(options.injectableServices !== undefined ? ["service.invoke"] : []),
    ...(options.netFetch !== undefined ? ["net"] : []),
    ...(options.sessionRead !== undefined ? ["session.read"] : []),
  ];
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
