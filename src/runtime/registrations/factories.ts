/**
 * 六注册工厂（T5-4b/EP-10）：每域一个 entry 工厂——包装现有装配函数为
 * 按 id 寻址的注册项。装配本体不动（行为冻结）；agent-child 的全量接线
 * 迁移列 T5-6 硬闸前完成项（未达即触发停止条件 1，记档）。
 */

import type { RegistrationEntry, RegistrationKind } from "./registry.js";

/** 单域注册项构造（id/kind 由域约定——调用方只给 provides/requires/apply）。 */
export function entryOf(
  kind: RegistrationKind,
  id: string,
  def: { provides: string; requires?: readonly string[]; apply: RegistrationEntry["apply"] },
): RegistrationEntry {
  return { id, kind, provides: def.provides, ...(def.requires !== undefined ? { requires: def.requires } : {}), apply: def.apply };
}

/** EP-10 工具来源注册（apply 内把工具清单提供进能力位——装配本体在 assembly）。 */
export function registerToolSource(id: string, def: { provides: string; requires?: readonly string[]; apply: RegistrationEntry["apply"] }): RegistrationEntry {
  return entryOf("tools", id, def);
}

/** EP-10 渠道注册（W12/T7-3 的注册落点——im-feishu/im-slack 实现态）。 */
export function registerChannel(id: string, def: { provides: string; requires?: readonly string[]; apply: RegistrationEntry["apply"] }): RegistrationEntry {
  return entryOf("channels", id, def);
}

/** EP-10 沙箱后端注册（local/win32/ssh——createLocalBackend 等的注册化落点）。 */
export function registerSandboxBackend(id: string, def: { provides: string; requires?: readonly string[]; apply: RegistrationEntry["apply"] }): RegistrationEntry {
  return entryOf("sandbox", id, def);
}

/** EP-10 调度器注册（W6 scheduler 的注册化落点）。 */
export function registerScheduler(id: string, def: { provides: string; requires?: readonly string[]; apply: RegistrationEntry["apply"] }): RegistrationEntry {
  return entryOf("scheduler", id, def);
}

/** EP-10 LSP 注册。 */
export function registerLsp(id: string, def: { provides: string; requires?: readonly string[]; apply: RegistrationEntry["apply"] }): RegistrationEntry {
  return entryOf("lsp", id, def);
}

/** EP-10 MCP 注册（settings mcp 段装配消费的注册化落点）。 */
export function registerMcp(id: string, def: { provides: string; requires?: readonly string[]; apply: RegistrationEntry["apply"] }): RegistrationEntry {
  return entryOf("mcp", id, def);
}
