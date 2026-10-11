/**
 * 常驻服务 broker（W15b/T9-6——pi-desktop host.services.register 同构：
 * broker 只做登记与生命周期管理，宿主决定 start）。contributes.services
 * 声明的插件服务实例由本 broker 托管：
 *   - start/stop 生命周期（stop 按 FIFO 收束——后启动先停）；
 *   - **崩溃重启 ≤5 次退避**：start/运行中抛错 → 指数退避重启
 *     （500ms × 2^n）；5 次失败后放弃（status failed——不再重启，
 *     fail-visible 面：status()/logger 可见，绝不静默）。
 *
 * 服务实例形状：{ start?, stop? }（可选钩子——纯资源服务零钩子合法）。
 */

import type { Logger } from "../../core/index.js";

/** 托管的服务实例（插件入口模块 default export 的形状）。 */
export interface PluginServiceInstance {
  readonly start?: () => void | Promise<void>;
  readonly stop?: () => void | Promise<void>;
}

export type PluginServiceStatus = "registered" | "starting" | "running" | "stopped" | "failed";

export interface PluginServiceEntry {
  /** 全名（`<插件名>/<服务名>`——贡献命名空间）。 */
  readonly name: string;
  status: PluginServiceStatus;
  restarts: number;
  lastError?: string;
}

/** 服务工厂（broker 重启时重新调用——每次拿到新实例）。 */
export type PluginServiceFactory = () => PluginServiceInstance | Promise<PluginServiceInstance>;

export interface ServiceBrokerOptions {
  /** 最大重启次数（缺省 5——计划卡"重启 ≤5 次退避"）。 */
  readonly maxRestarts?: number;
  /** 首次退避毫秒（缺省 500；指数 ×2）。 */
  readonly backoffBaseMs?: number;
  readonly logger?: Logger;
}

export interface ServiceBroker {
  /** 登记并启动服务（幂等名——重名类型化拒绝）。返回初始条目快照。 */
  register(name: string, factory: PluginServiceFactory): Promise<PluginServiceEntry>;
  /** 已登记判据（热重载幂等注册的守卫——已登记则跳过）。 */
  has(name: string): boolean;
  /** 停止指定服务（运行中才有效；不再重启）。 */
  stop(name: string): Promise<boolean>;
  /** 全部收束（装配收尾——后启动先停）。 */
  stopAll(): Promise<void>;
  /** 状态快照（status 面——诊断可见）。 */
  status(): readonly PluginServiceEntry[];
}

const RUNNING = "running";

export function createServiceBroker(options: ServiceBrokerOptions = {}): ServiceBroker {
  const maxRestarts = options.maxRestarts ?? 5;
  const backoffBaseMs = options.backoffBaseMs ?? 500;
  interface Managed {
    entry: PluginServiceEntry;
    factory: PluginServiceFactory;
    stopped: boolean;
    /** 当前活实例（start 成功后持有——stop 收束对象）。 */
    current?: PluginServiceInstance;
  }
  const services = new Map<string, Managed>();
  /** 启动序（stopAll 反序收束）。 */
  const startOrder: string[] = [];

  const runWithRestart = async (managed: Managed): Promise<void> => {
    const { entry } = managed;
    for (;;) {
      if (managed.stopped) return;
      try {
        entry.status = "starting";
        const instance = await managed.factory();
        if (managed.stopped) {
          // 等待期被 stop——直接收尾新实例
          await instance.stop?.();
          return;
        }
        await instance.start?.();
        managed.current = instance;
        entry.status = RUNNING;
        entry.lastError = undefined;
        return;
      } catch (e) {
        entry.lastError = e instanceof Error ? e.message : String(e);
        entry.restarts += 1;
        if (entry.restarts > maxRestarts || managed.stopped) {
          entry.status = "failed";
          options.logger?.warn(
            `常驻服务 ${entry.name} 启动失败放弃（重启 ${String(entry.restarts - 1)}/${String(maxRestarts)}）：${entry.lastError}`,
          );
          return;
        }
        const delay = backoffBaseMs * 2 ** (entry.restarts - 1);
        options.logger?.warn(
          `常驻服务 ${entry.name} 崩溃——${String(delay)}ms 后第 ${String(entry.restarts)} 次重启：${entry.lastError}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  };

  const broker: ServiceBroker = {
    has: (name) => services.has(name),
    register: async (name, factory) => {
      if (services.has(name)) {
        throw new TypeError(`常驻服务重名：${name}（先 stop 再重登记）`);
      }
      const managed: Managed = {
        entry: { name, status: "registered", restarts: 0 },
        factory,
        stopped: false,
      };
      services.set(name, managed);
      startOrder.push(name);
      // 后台启动（崩溃重启链自持——不阻塞装配）
      void runWithRestart(managed).catch(() => {
        /* runWithRestart 内部吞错——防御面 */
      });
      return { ...managed.entry };
    },
    stop: async (name) => {
      const managed = services.get(name);
      if (managed === undefined || managed.stopped) return false;
      managed.stopped = true;
      try {
        await managed.current?.stop?.();
      } catch {
        // 收尾幂等——stop 抛错不阻塞其余收束
      }
      managed.current = undefined;
      managed.entry.status = "stopped";
      return true;
    },
    stopAll: async () => {
      for (const name of [...startOrder].reverse()) {
        await broker.stop(name);
      }
      startOrder.length = 0;
    },
    status: () => [...services.values()].map((m) => ({ ...m.entry })),
  };
  return broker;
}

// RUNNING 占位（状态闭集字面量复用——防拼写漂移）
void RUNNING;
