/**
 * 插件常驻服务装载（W15b/T9-6——plugin-loader.ts 的行数纪律拆分位）：
 * contributes.services 声明 → 入口模块动态 import → broker 托管生命周期
 * （热重载幂等——已登记的 full name 跳过，服务不随插件重载重启）。
 */

import { pathToFileURL } from "node:url";
import path from "node:path";

import type { Logger } from "../../core/index.js";
import type { PluginServiceContrib } from "./plugin-manifest-contributes.js";
import type { ServiceBroker } from "./service-broker.js";

/** 服务实例模块形状（入口 default export——start/stop 可选钩子）。 */
interface PluginServiceModule {
  default?: { start?: () => void | Promise<void>; stop?: () => void | Promise<void> };
}

/** 注册插件的全部服务声明（never-fail——单服务失败 warn 跳过）。 */
export async function registerPluginServices(
  pluginName: string,
  services: readonly PluginServiceContrib[],
  dir: string,
  options: { serviceBroker?: ServiceBroker; logger?: Logger },
): Promise<string[]> {
  if (options.serviceBroker === undefined) return [];
  const registered: string[] = [];
  for (const svc of services) {
    const fullName = `${pluginName}/${svc.name}`;
    // 热重载幂等——服务长生命周期，不随插件重载重启（broker 已登记即跳过）
    if (options.serviceBroker.has(fullName)) {
      registered.push(fullName);
      continue;
    }
    try {
      const entryPath = path.join(dir, svc.entry);
      const mod = (await import(pathToFileURL(entryPath).href)) as PluginServiceModule;
      await options.serviceBroker.register(fullName, () => mod.default ?? {});
      registered.push(fullName);
    } catch (e) {
      options.logger?.warn(
        `plugin-service: [${fullName}] 注册失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return registered;
}
