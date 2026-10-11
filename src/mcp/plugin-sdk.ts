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

import {
  expandGrantedPermissions,
  PLUGIN_INJECTABLE_SERVICES,
  type BusPayload,
  type BusPublishReport,
  type BusSubscription,
  type PluginPermission,
} from "../core/index.js";
import { validateManifest, PluginManifestError, type PluginManifest } from "../ext-builtin/plugin-runtime/plugin-manifest.js";
import { EVENT_TYPES, type SessionEvent, type SessionEventType } from "../core/index.js";
import { Deadline, withDeadline } from "../core/index.js";
import type { JsonRecord, JsonValue } from "../core/index.js";

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
    /**
     * 工具描述（T-P3-148 走查实录：插件工具无法写宿主 descriptions/ 目录，
     * 走 ToolDef.descriptionText 内联通道——缺省给兜底文案，不再报
     * MODEL_UNKNOWN_ERROR 缺描述文件）。
     */
    readonly description?: string;
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
/** W15a/T9-5：session.read 分片的查询形状（本会话事件流只读——跨会话面
 * 走 session_query 工具的 EP-3 宿主授权；插件无 cwd 身份不参与跨读）。 */
export interface PluginSessionReadQuery {
    readonly types?: readonly string[];
    readonly fromTs?: number;
    readonly toTs?: number;
    readonly limit?: number;
}

/** session.read 分片的行投影（事件只读快照——内核对象不出借原引用）。 */
export interface PluginSessionRow {
    readonly seq: number;
    readonly type: string;
    readonly ts: number;
    readonly event: SessionEvent;
}

/** session.read 分片的宿主应答（授权拒绝 = ok:false + reason——fail-visible）。 */
export type PluginSessionReadResult =
    | { readonly ok: true; readonly rows: readonly PluginSessionRow[] }
    | { readonly ok: false; readonly reason: string };

/**
 * 受限能力 token（W15a/T9-5 分片能力面）：P0 三方法之外，net/session.read
 * 分片经**网关前置断言**（manifest.capabilities 未声明即抛——权限闭集
 * PLUGIN_PERMISSIONS）；services 经 inject 数据化按名取用（服务名闭集）。
 * 内核句柄依旧不外泄。
 */
export interface PluginCapabilities {
    /** 登记工具（重名即类型化拒绝——同名覆盖会让不可信代码静默换掉可信工具）。 */
    readonly registerTool: (def: PluginToolDef) => void;
    /** 订阅事件类型（⊆ EVENT_TYPES 闭集，未知类型类型化拒绝）；返回退订函数。
     * T-P3-148 G：manifest 声明 contributes.subscriptions 时收紧为其子集。 */
    readonly subscribe: (types: readonly SessionEventType[]) => () => void;
    /** 本插件的设置值（合并 default 后的只读快照——类型不符已回退缺省）。
     * W15a：网关前置断言——capabilities 需声明 "settings.read"。 */
    readonly pluginSettings: Readonly<Record<string, unknown>>;
    /** net 分片：NetworkGuard 守卫的受限 fetch（需 "net.fetch" + 宿主装配）。 */
    readonly net: {
        readonly fetch: (
            url: string,
            init?: { readonly timeoutMs?: number; readonly headers?: Readonly<Record<string, string>> },
        ) => Promise<{ readonly status: number; readonly body: string; readonly contentType?: string }>;
    };
    /** session.read 分片：本会话事件流只读（需 "session.read" + 宿主装配；
     * 跨会话面走 session_query 工具的 EP-3 宿主授权——插件不参与跨读）。 */
    readonly session: {
        readonly read: (query: PluginSessionReadQuery) => Promise<PluginSessionReadResult>;
    };
    /** inject 数据化服务（dsh 形状）：按名取宿主装配的服务实例。 */
    readonly services: {
        readonly get: (name: string) => unknown;
    };
    /** W15b/T9-6：声明式 topic 总线（需 bus.publish/bus.subscribe 权限 +
     * contributes.bus.topics 声明——限流/上限在宿主装配面参数化）。 */
    readonly bus: {
        readonly publish: (topic: string, payload: BusPayload) => Promise<BusPublishReport>;
        readonly subscribe: (topic: string, handler: (payload: BusPayload) => void | Promise<void>) => BusSubscription;
    };
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
        /** W15a/T9-5：net 分片宿主实现（NetworkGuard.fetch——缺省未装配 =
         * 声明即拒装：availableCapabilities 不含 "net"）。 */
        readonly netFetch?: (
            url: string,
            init?: { readonly timeoutMs?: number; readonly headers?: Readonly<Record<string, string>> },
        ) => Promise<{ readonly status: number; readonly body: string; readonly contentType?: string }>;
        /** W15a/T9-5：session.read 分片宿主实现（本会话事件流只读闭包）。 */
        readonly sessionRead?: (query: PluginSessionReadQuery) => Promise<PluginSessionReadResult>;
        /** W15a/T9-5：inject 服务的宿主注册表（服务名 → 实例）。 */
        readonly injectableServices?: Readonly<Record<string, unknown>>;
        /** W15b/T9-6：宿主总线（声明式 topic——缺省 undefined = bus 面
         * 类型化拒绝；权限 + topic 声明双闸）。 */
        readonly bus?: {
            readonly publish: (topic: string, payload: BusPayload, opts?: { source?: string }) => Promise<BusPublishReport>;
            readonly subscribe: (topic: string, handler: (payload: BusPayload) => void | Promise<void>, opts?: { subscriber?: string }) => BusSubscription;
        };
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
    // W15a/T9-5：网关前置断言（每片一组权限名——调用前查声明集）
    const granted = expandGrantedPermissions(manifest.capabilities);
    const assertPermission = (permission: PluginPermission, what: string): void => {
        if (!granted.has(permission)) {
            throw new PluginSdkError(
                `权限未声明：${permission}（${what}——manifest.capabilities 显式声明后方可使用）`,
            );
        }
    };
    const settingsValues = options.settingsValues ?? {};
    // W15b/T9-6：声明式 topic 闭集（contributes.bus.topics——未声明拒绝）
    const declaredTopics = new Set<string>((manifest.contributes as { bus?: { topics?: readonly string[] } } | undefined)?.bus?.topics ?? []);
    const assertBusTopic = (topic: string): void => {
        if (!declaredTopics.has(topic)) {
            throw new PluginSdkError(
                `topic 未声明：${topic}（contributes.bus.topics 先声明后用——声明式总线纪律）`,
            );
        }
    };
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
        get pluginSettings() {
            // W15a：settings.read 分片网关前置断言（声明未声明即拒）
            assertPermission("settings.read", "读取本插件设置值");
            return settingsValues;
        },
        net: {
            fetch: async (url, init) => {
                assertPermission("net.fetch", "网络访问");
                if (options.netFetch === undefined) {
                    throw new PluginSdkError("宿主未装配 net 分片（NetworkGuard 缺席）");
                }
                return options.netFetch(url, init);
            },
        },
        session: {
            read: async (query) => {
                assertPermission("session.read", "跨会话读");
                if (options.sessionRead === undefined) {
                    throw new PluginSdkError("宿主未装配 session.read 分片（会话查询面缺席）");
                }
                return options.sessionRead(query);
            },
        },
        bus: {
            publish: async (topic, payload) => {
                assertPermission("bus.publish", "总线发布");
                assertBusTopic(topic);
                if (options.bus === undefined) {
                    throw new PluginSdkError("宿主未装配总线（bus 面缺席）");
                }
                return options.bus.publish(topic, payload, { source: manifest.name });
            },
            subscribe: (topic, handler) => {
                assertPermission("bus.subscribe", "总线订阅");
                assertBusTopic(topic);
                if (options.bus === undefined) {
                    throw new PluginSdkError("宿主未装配总线（bus 面缺席）");
                }
                return options.bus.subscribe(topic, handler, { subscriber: manifest.name });
            },
        },
        services: {
            get: (name) => {
                // inject 数据化：声明面（manifest.inject）+ 服务名闭集双闸
                if (!(manifest.inject ?? []).includes(name)) {
                    throw new PluginSdkError(
                        `服务 "${name}" 未在 manifest.inject 声明（声明后方可注入）`,
                    );
                }
                if (!(PLUGIN_INJECTABLE_SERVICES as readonly string[]).includes(name)) {
                    throw new PluginSdkError(
                        `服务名闭集外：${name}（合法：${PLUGIN_INJECTABLE_SERVICES.join(", ")}）`,
                    );
                }
                const service = options.injectableServices?.[name];
                if (service === undefined) {
                    throw new PluginSdkError(`服务 "${name}" 宿主未装配（注入注册表缺席）`);
                }
                return service;
            },
        },
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
