/**
 * 审批第二出口 + 竞速收口（W13a/T9-3——zcode racePermissionResponders
 * 最优评估 §17 同构）。我方决策面已是四层链 + broker 单出口；本模块补
 * "hook 慢/挂死不阻塞用户点击"的韧性：
 *
 *   - **broker 先启动**：decide 入口即调用 primary.decide（同步注册应答
 *     deferred——确认窗一可见用户点击就有归宿，不给 hook 独占窗口）；
 *   - **先到者胜**：首个非弃权应答（broker 或任一 responder）胜出；
 *   - **先兑现后 abort 败者**：胜者答案已 resolve（调用方拿到即兑现——
 *     单线程事件环内"返回即兑现"），败者经 AbortSignal 通知收尾；挂死的
 *     败者 promise 被吞（零 unhandled rejection——"挂死的就是败者本身"）。
 *
 * fail-closed 纪律（G7）不破：全部弃权（responder 全 null）时继续等
 * broker（broker 是 ask 主面——ManualPermissionBroker 等人、Deny 直接拒），
 * 绝不因竞速面静默放行。
 */

import type { ApprovalRequest, ApprovalAnswer } from "./pending.js";
import type { PermissionBrokerPort } from "./broker.js";

/**
 * 审批应答第二出口（竞速参与面——hook/自动化策略通道）。返回 null =
 * 弃权（不参与竞速，继续等 broker）；返回答案 = 参与竞速（先到者胜）。
 * signal 在胜者产生后触发——responder 应尽快收尾（挂死不阻塞主流程）。
 */
export interface ApprovalResponderPort {
  readonly name: string;
  respond(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalAnswer | null>;
  dispose?(): void | Promise<void>;
}

/**
 * 竞速收口装饰器：把 primary broker 与若干 responder 收口为单出口 broker
 * （PermissionBrokerPort 形状不变——gate/装配零改动）。responders 为空 =
 * 原样透传 primary（零行为变化）。
 */
export function racePermissionResponders(
  primary: PermissionBrokerPort,
  responders: readonly ApprovalResponderPort[],
): PermissionBrokerPort {
  if (responders.length === 0) return primary;
  return {
    name: `racing(${primary.name} + ${responders.map((r) => r.name).join(",")})`,
    async decide(request) {
      // broker 先启动（同步注册应答——用户点击窗口立即有归宿）
      const primaryPromise = primary.decide(request);
      const controllers = responders.map(() => new AbortController());
      const racePromises = responders.map(async (responder, i): Promise<ApprovalAnswer> => {
        const answer = await responder.respond(request, controllers[i]!.signal);
        if (answer === null) {
          // 弃权 = 不参与竞速——永不 settle 的挂起（被主流程忽略）
          return new Promise<ApprovalAnswer>(() => {});
        }
        return answer;
      });
      try {
        // 先到者胜：首个非弃权应答（含 broker）
        const winner = await Promise.race([primaryPromise, ...racePromises]);
        return winner;
      } finally {
        // 先兑现后 abort 败者：胜者答案已 resolve（兑现保证），败者收尾
        // ——signal 通知 responder 尽快退出；挂死 promise 吞掉不阻塞。
        for (const c of controllers) c.abort();
        for (const p of racePromises) p.catch(() => {});
        // W16 排查 E：primary 败者 rejection 同样吞（responder 先胜后
        // ManualPermissionBroker 超时/dispose 的 PermissionTimeout rejection
        // 无人接 → unhandled rejection → Node≥15 默认崩进程；primary 胜出
        // 时 rejection 已被 await 消费，此处 catch 为 no-op——幂等）。
        primaryPromise.catch(() => {});
      }
    },
  };
}
