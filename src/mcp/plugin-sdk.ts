/**
 * 插件 SDK（I5）——第三方可写插件而不碰内核。experimental（P2 阶段标记，
 * 形状随消费反馈演进；版本化随需要）。
 *
 * 取 opencode·plugin 的行为："SDK = 受限能力面 + 生命周期契约"——插件是
 * 实现固定接口的对象，宿主在激活时发一枚**受限能力 token**（工具登记 +
 * 事件订阅），插件拿到的只有 token 上的窄方法，没有内核句柄（不传
 * ToolRegistry / SessionStore / ExecutionEnv / ToolContext——内核句柄
 * 不外泄是本 SDK 的第一约束）。不抄其 JS API 形状（钩子表 + client 句柄
 * 的工厂形态——我方 P1 plugin-manifest 已有地基，SDK 是其作者面补全）。
 *
 * 作者视角三段式：
 *   1. 声明 manifest（name / trust / capabilities——声明宿主未实现的能力
 *      即拒绝安装，P1 纪律；hooks 贡献声明不归本装载面，走 kernel 的
 *      installPlugin——同一 manifest 两个装载面不重复）；
 *   2. 实现生命周期：onActivate(caps) 领能力 token 并订阅/登记 →
 *      onEvent(快照) 收已订阅类型的事件（只读快照，改它不影响内核）→
 *      onDispose() 收尾（dispose 后工具注销、订阅失效、不再投递）；
 *   3. 交宿主装载：loadPlugin 先全量校验（清单 + 生命周期方法在位），
 *      校验失败类型化拒绝（fail-closed，绝不降级为警告），通过后才激活。
 *
 * 受限细节（为什么插件面比内核工具窄）：
 *   - 插件工具的 execute 只收参数（无 ToolContext——ctx.env 是进程能力，
 *     D4 红线的插件侧兑现：工具拿不到裸进程 API，插件工具更拿不到）；
 *   - 事件是 structuredClone 快照（内核事件对象不出借原引用）；
 *   - 事件回调带超时预算（deadline 原语，M7）——挂死的插件拖不垮投递方；
 *   - untrusted 插件登记的工具带 trust 标记（装配面按 I6 分轨 + C 族审批
 *     消费——不受信来源默认 deny 是策略面的事，本模块只如实登记）。
 */

import { validateManifest, PluginManifestError, type PluginManifest } from "../kernel/plugin-manifest.js";
import { EVENT_TYPES, type SessionEvent, type SessionEventType } from "../kernel/events.js";
import { Deadline, withDeadline } from "../kernel/deadline.js";
import type { JsonRecord, JsonValue } from "../kernel/events.js";

/** 事件回调缺省超时预算：插件回调是宿主代跑的不可信代码——挂死必须可回收。 */
export const PLUGIN_EVENT_TIMEOUT_MS = 5_000;

/** SDK 契约违规（区别于 P1 的清单违规：清单问题抛 PluginManifestError）。 */
export class PluginSdkError extends Error {
    readonly code = "PLUGIN_SDK_REJECTED";
    constructor(message: string) {
        super(message);
        this.name = "PluginSdkError";
    }
}

/** 插件工具定义：内核 ToolDef 的受限投影——execute 无 ToolContext。 */
export interface PluginToolDef {
    /** 工具名（登记表内唯一，`<插件名>:<工具名>` 冲突面由装配决定）。 */
    readonly name: string;
    /** JSON Schema 形状的参数描述（原样透传，缺省空 object schema）。 */
    readonly parameters?: JsonValue;
    /** 执行体：只收参数，不收执行上下文（无内核句柄）。 */
    readonly execute: (args: JsonRecord) =>
        | { content: string; isError?: boolean }
        | Promise<{ content: string; isError?: boolean }>;
}

/** 插件登记的工具条目（trust 随清单——装配面按 I6 分轨 + C 族审批消费）。 */
export interface PluginToolEntry {
    readonly pluginName: string;
    readonly trust: "trusted" | "untrusted";
    readonly def: PluginToolDef;
}

/**
 * 受限能力 token：插件在 onActivate 时领到的唯一宿主面。属性闭集只有
 * 工具登记与事件订阅两个方法——内核句柄不外泄（验收的源码证伪与运行时
 * 断言都锚在这里）。T-P3-148 F：pluginSettings = 本插件设置贡献的合并值
 * （contributes.settings schema + settings.plugins[].options 用户值——
 * 只读投影，写面随需要扩展）。
 */
export interface PluginCapabilities {
    /** 登记工具（重名即类型化拒绝——同名覆盖会让不可信代码静默换掉可信工具）。 */
    readonly registerTool: (def: PluginToolDef) => void;
    /** 订阅事件类型（⊆ EVENT_TYPES 闭集，未知类型类型化拒绝）；返回退订函数。
     * T-P3-148 G：manifest 声明 contributes.subscriptions 时收紧为其子集。 */
    readonly subscribe: (types: readonly SessionEventType[]) => () => void;
    /** 本插件的设置值（合并 default 后的只读快照——类型不符已回退缺省）。 */
    readonly pluginSettings: Readonly<Record<string, unknown>>;
}

/** 插件收到的只读事件快照（内核 SessionEvent 的深拷贝投影）。 */
export type PluginEventSnapshot = SessionEvent;

/** 插件作者实现的接口：manifest 声明 + 三段生命周期。 */
export interface AegentPlugin {
    /** 清单声明（loadPlugin 时经 P1 validateManifest 全量校验）。 */
    readonly manifest: unknown;
    /** 激活：领能力 token，做订阅/登记（缺省必实现——SDK 契约的第一要求）。 */
    readonly onActivate: (caps: PluginCapabilities) => void | Promise<void>;
    /** 事件回调（可选）：只收 onActivate 里订阅过的类型的快照。 */
    readonly onEvent?: (event: PluginEventSnapshot) => void | Promise<void>;
    /** 收尾（可选）：dispose 时调用，此后不再投递、工具已注销。 */
    readonly onDispose?: () => void | Promise<void>;
}

/** 一次投递的报告（插件失败/超时不冒泡——缺席不崩内核）。 */
export interface PluginDeliveryReport {
    readonly pluginName: string;
    readonly ok: boolean;
    readonly error?: string;
}

/** 装载产物：校验与激活完成后的可投递句柄。 */
export interface PluginHandle {
    readonly manifest: PluginManifest;
    /** 本插件已登记的工具（装配面消费——I6 分轨 / C 族审批在此接入）。 */
    readonly tools: readonly PluginToolEntry[];
    /** 向本插件投递一个事件（只投已订阅类型；未实现 onEvent 直接跳过）。 */
    deliver(event: SessionEvent): Promise<PluginDeliveryReport>;
    /** 收摊（幂等）：注销工具 + 退订 + onDispose；此后 deliver 零投递。 */
    dispose(): Promise<void>;
    readonly disposed: boolean;
}

/**
 * 加载面校验 + 激活：清单走 P1 validateManifest（缺字段/未实现能力/
 * 闭集外字段类型化拒绝），生命周期方法在位性独立校验（onActivate 必须是
 * 函数；onEvent/onDispose 若提供必须也是函数——"声明了就要实现"的 SDK
 * 面对应）。校验全过才调 onActivate；激活抛错视为装载失败（已登记面
 * 回滚）。
 */
export async function loadPlugin(
    plugin: AegentPlugin,
    options: {
        readonly availableCapabilities: readonly string[];
        readonly eventTimeoutMs?: number;
        /** T-P3-148 F：插件设置贡献的用户值（loader 已合并 default——此处只透传）。 */
        readonly settingsValues?: Readonly<Record<string, unknown>>;
        /** T-P3-148 G：订阅声明白名单（manifest.contributes.subscriptions——声明即收紧）。 */
        readonly declaredSubscriptions?: readonly string[];
    },
): Promise<PluginHandle> {
    if (plugin === null || typeof plugin !== "object") {
        throw new PluginSdkError("插件必须是对象");
    }
    if (typeof plugin.onActivate !== "function") {
        throw new PluginSdkError("插件必须实现 onActivate（激活时领取能力 token）");
    }
    if (plugin.onEvent !== undefined && typeof plugin.onEvent !== "function") {
        throw new PluginSdkError("onEvent 提供时必须是函数");
    }
    if (plugin.onDispose !== undefined && typeof plugin.onDispose !== "function") {
        throw new PluginSdkError("onDispose 提供时必须是函数");
    }
    const manifestResult = validateManifest(plugin.manifest, options.availableCapabilities);
    if (!manifestResult.ok) throw new PluginManifestError(manifestResult.errors);
    const manifest = manifestResult.manifest;

    const tools: PluginToolEntry[] = [];
    const subscribed = new Set<SessionEventType>();
    let active = true;
    const caps: PluginCapabilities = {
        registerTool: (def) => {
            if (!active) throw new PluginSdkError(`插件「${manifest.name}」已收摊，不能再登记工具`);
            if (def === null || typeof def !== "object" || typeof def.execute !== "function"
                || typeof def.name !== "string" || def.name.trim() === "") {
                throw new PluginSdkError("工具定义必须是 {name: 非空字符串, execute: 函数}");
            }
            if (tools.some((t) => t.def.name === def.name)) {
                throw new PluginSdkError(`工具重名：${def.name}（同名覆盖被拒绝）`);
            }
            tools.push({ pluginName: manifest.name, trust: manifest.trust, def });
        },
        subscribe: (types) => {
            if (!active) throw new PluginSdkError(`插件「${manifest.name}」已收摊，不能再订阅`);
            const unknown = types.filter((t) => !(EVENT_TYPES as readonly string[]).includes(t));
            if (unknown.length > 0) {
                throw new PluginSdkError(`订阅了未知事件类型：${unknown.join(", ")}`);
            }
            // G：声明收紧——manifest.contributes.subscriptions 在位时，订阅
            // 类型必须 ⊆ 声明（pi bus publish/subscribe 声明制同语义）
            const declared = options.declaredSubscriptions;
            if (declared !== undefined) {
                const outside = types.filter((t) => !declared.includes(t));
                if (outside.length > 0) {
                    throw new PluginSdkError(
                        `订阅了未声明的事件类型：${outside.join(", ")}（contributes.subscriptions 已声明：${declared.join(", ")}）`,
                    );
                }
            }
            for (const t of types) subscribed.add(t);
            return () => {
                for (const t of types) subscribed.delete(t);
            };
        },
        pluginSettings: options.settingsValues ?? {},
    };

    await plugin.onActivate(caps);
    const timeoutMs = options.eventTimeoutMs ?? PLUGIN_EVENT_TIMEOUT_MS;

    return {
        manifest,
        get tools(): readonly PluginToolEntry[] {
            return active ? [...tools] : [];
        },
        get disposed(): boolean {
            return !active;
        },
        deliver: async (event) => {
            if (!active) {
                return { pluginName: manifest.name, ok: false, error: "插件已收摊" };
            }
            if (plugin.onEvent === undefined || !subscribed.has(event.type)) {
                return { pluginName: manifest.name, ok: true };
            }
            // 快照投递：内核事件对象不出借原引用；回调套 deadline（挂死可回收）。
            const snapshot = structuredClone(event) as PluginEventSnapshot;
            try {
                await withDeadline(
                    Deadline.fromTimeoutMs("PLUGIN_EVENT_TIMEOUT", timeoutMs),
                    Promise.resolve(plugin.onEvent(snapshot)),
                );
                return { pluginName: manifest.name, ok: true };
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                return { pluginName: manifest.name, ok: false, error: message };
            }
        },
        dispose: async () => {
            if (!active) return;
            active = false;
            tools.length = 0;
            subscribed.clear();
            if (plugin.onDispose !== undefined) await plugin.onDispose();
        },
    };
}
