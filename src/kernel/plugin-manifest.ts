/**
 * 插件清单安装期校验（I9 / T-P1-09）——"未实现的能力声明即拒绝安装
 * （不是警告不是忽略）"（pi-desktop·validation.rs 的 validate_contributions
 * 同款纪律：安装期全量校验、PLUGIN_INVALID 形状的显式拒绝、重复声明拒绝；
 * 不抄其 Rust manifest 结构）。
 *
 * 校验面（全部收集、一次报全——安装方需要完整的问题清单修一次装好）：
 *   1. 形状：manifest 必须是对象；字段闭集 {name, trust, capabilities, hooks}
 *      ——闭集外字段拒绝（C15 的精神：插件扩展面先经清单声明，不留旁路）；
 *   2. name：非空字符串；trust：闭集枚举 trusted/untrusted；
 *   3. capabilities：字符串数组，每项必须在宿主**已实现**的能力清单内
 *      ——声明未实现能力 → 拒绝且错误列明缺哪项；
 *   4. hooks（可选）：数组，每项 {point, name}——point ∈ CHAIN_POINTS 闭集、
 *      name 非空且清单内不重复（pi 的 duplicate key 先例）。
 *
 * 安装 = 校验通过后把 hooks 贡献注册进 HookRegistry（trust 随清单：插件
 * 默认 untrusted——I6 分轨的注册入口；trusted 插件是宿主显式决定）。
 * 校验失败抛类型化 PluginManifestError（fail-closed 拒绝启动，与
 * intersectAllProfiles 的 opaque 拒绝同款纪律），绝不降级为警告。
 */

import { CHAIN_POINTS, type ChainLayer, type ChainPoint } from "./chain.js";
import type { HookRegistry, HookTrust } from "./hooks.js";

/** 清单字段闭集（闭集外字段拒绝）。 */
export const PLUGIN_MANIFEST_FIELDS = [
  "name",
  "trust",
  "capabilities",
  "hooks",
] as const;

export interface PluginManifest {
  /** 插件名（hook 注册名的前缀，防跨插件冲突）。 */
  readonly name: string;
  /** 信任轨（I6）：决定 hooks 进内核链还是独立观察轨。 */
  readonly trust: HookTrust;
  /** 声明使用的宿主能力（必须在宿主已实现清单内，未实现即拒绝安装）。 */
  readonly capabilities: readonly string[];
  /** hooks 贡献声明（point 闭集 + 每项有对应 handler 才可安装）。 */
  readonly hooks?: readonly { readonly point: ChainPoint; readonly name: string }[];
}

export class PluginManifestError extends Error {
  readonly code = "PLUGIN_MANIFEST_REJECTED";
  /** 全部拒绝理由（安装方一次修完）。 */
  readonly errors: readonly string[];
  constructor(errors: readonly string[]) {
    super(`插件清单被拒绝安装（${String(errors.length)} 项）：${errors.join("；")}`);
    this.name = "PluginManifestError";
    this.errors = errors;
  }
}

type ManifestResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; errors: string[] };

/** 安装期全量校验：返回 ok=false 时 errors 列明每一项问题（含缺哪项能力）。 */
export function validateManifest(
  input: unknown,
  availableCapabilities: readonly string[],
): ManifestResult {
  const errors: string[] = [];
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["清单必须是 JSON 对象"] };
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(PLUGIN_MANIFEST_FIELDS as readonly string[]).includes(key)) {
      errors.push(`闭集外字段：${key}（允许：${PLUGIN_MANIFEST_FIELDS.join(", ")}）`);
    }
  }

  // name
  const name = record.name;
  if (typeof name !== "string" || name.trim() === "") {
    errors.push("name 必须是非空字符串");
  }

  // trust（闭集枚举）
  const trust = record.trust;
  if (trust !== "trusted" && trust !== "untrusted") {
    errors.push(
      `trust 必须是 "trusted" | "untrusted"，收到 ${JSON.stringify(trust) ?? "undefined"}`,
    );
  }

  // capabilities（未实现的能力声明即拒绝——I9 核心）
  const capabilities = record.capabilities;
  if (!Array.isArray(capabilities) || capabilities.some((c) => typeof c !== "string")) {
    errors.push("capabilities 必须是字符串数组");
  } else {
    const caps = capabilities as string[];
    const available = new Set(availableCapabilities);
    const unknown = caps.filter((c) => !available.has(c));
    if (unknown.length > 0) {
      errors.push(
        `声明了宿主未实现的能力：${unknown.join(", ")}（宿主已实现：` +
          `${[...available].sort().join(", ") || "无"}）`,
      );
    }
  }

  // hooks（可选贡献）
  let hooks: { point: ChainPoint; name: string }[] | undefined;
  const rawHooks = record.hooks;
  if (rawHooks !== undefined) {
    if (!Array.isArray(rawHooks)) {
      errors.push("hooks 必须是数组");
    } else {
      const points = new Set<string>(CHAIN_POINTS);
      const seenNames = new Set<string>();
      hooks = [];
      rawHooks.forEach((entry, index) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          errors.push(`hooks[${String(index)}] 必须是对象`);
          return;
        }
        const e = entry as Record<string, unknown>;
        const rawPoint = e.point;
        const rawName = e.name;
        const pointOk = typeof rawPoint === "string" && points.has(rawPoint);
        if (!pointOk) {
          errors.push(
            `hooks[${String(index)}].point 必须是 ${CHAIN_POINTS.join(" | ")}，` +
              `收到 ${JSON.stringify(rawPoint) ?? "undefined"}`,
          );
        }
        const nameOk = typeof rawName === "string" && rawName.trim() !== "";
        if (!nameOk) {
          errors.push(`hooks[${String(index)}].name 必须是非空字符串`);
        } else if (seenNames.has(rawName)) {
          errors.push(`hooks 内重复声明：${rawName}（pi duplicate key 同款拒绝）`);
        } else {
          seenNames.add(rawName);
        }
        if (pointOk && nameOk) {
          hooks!.push({ point: rawPoint as ChainPoint, name: rawName });
        }
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      name: name as string,
      trust: trust as HookTrust,
      capabilities: capabilities as readonly string[],
      ...(hooks !== undefined ? { hooks } : {}),
    },
  };
}

/**
 * 安装：校验 → 每个 hooks 贡献必须有对应 handler（声明了没提供 = 拒绝）
 * → 以 `<插件名>:<hook 名>` 注册进 HookRegistry（trust 随清单）。返回注销
 * 函数（一次性摘除本插件的全部 hooks）。
 */
export function installPlugin<C, E, R>(
  registry: HookRegistry,
  input: unknown,
  handlers: Readonly<Record<string, ChainLayer<C, E, R>>>,
  availableCapabilities: readonly string[],
): { manifest: PluginManifest; uninstall(): void } {
  const result = validateManifest(input, availableCapabilities);
  if (!result.ok) throw new PluginManifestError(result.errors);
  const { manifest } = result;
  const uninstalls: (() => void)[] = [];
  for (const hook of manifest.hooks ?? []) {
    const handler = handlers[hook.name];
    if (handler === undefined) {
      // 校验后再查 handler：声明与实现不对应同样是拒绝（不是忽略）
      uninstalls.forEach((u) => u());
      throw new PluginManifestError([
        `hook「${hook.name}」已声明但未提供 handler（声明了就要实现）`,
      ]);
    }
    uninstalls.push(
      registry.on(hook.point, handler, {
        name: `${manifest.name}:${hook.name}`,
        trust: manifest.trust,
      }),
    );
  }
  return { manifest, uninstall: () => uninstalls.forEach((u) => u()) };
}
