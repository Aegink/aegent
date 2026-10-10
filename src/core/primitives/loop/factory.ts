/**
 * 驱动可替换槽位（T3-2 / dsh AgentFactory 形状，最优评估 §5）：
 * "the driver stays swappable"——loop 驱动是可注册替换单元，LoopDeps
 * 只留端口。缺省实现 = AgentLoop（本目录）；装配面（agent-process）经
 * createLoop 取驱动，第三方可经 registerLoopImplementation 替换驱动
 * （如无人值守轮驱动/评测驱动——G10 护栏语义由替换实现自行承担）。
 */

import type { AgentLoopDeps } from "./loop.js";
import { AgentLoop } from "./loop.js";

/** 驱动工厂（dsh AgentFactory 同形状：deps 端口 → 驱动实例）。 */
export type LoopImplementation = {
  create(deps: AgentLoopDeps): AgentLoop;
};

let implementation: LoopImplementation = {
  create: (deps) => new AgentLoop(deps),
};

/** 注册驱动实现（替换全局槽位——进程启动装配期调用，运行期不热换）。 */
export function registerLoopImplementation(impl: LoopImplementation): void {
  implementation = impl;
}

/** 创建驱动（装配面唯一入口——槽位的消费点）。 */
export function createLoop(deps: AgentLoopDeps): AgentLoop {
  return implementation.create(deps);
}
