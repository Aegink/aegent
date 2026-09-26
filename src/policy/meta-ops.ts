/**
 * 内核元操作白名单（G2，T-P1-10）——核心层显式放行"会话元状态写入"类
 * 工具。不变量 3"权限默认 ask，白名单是显式例外"：例外不能靠 gate 特判
 * （绕过链的可审计面），必须落成链上模块——首个非 undefined 者胜（C58），
 * 模块名与 reason 进裁决证据（C18）。
 *
 * 为什么 todo_write 在列：它只写会话事件流（元进度），对用户工作区零
 * 副作用——与 read 不同（读用户数据），与 write/edit/bash 不同（改工作区/
 * 执行命令）。若走默认 ask，多步任务的每次清单更新都挂起等审批，G2
 * "进度可见"等于不可用。plan 模式硬关（G7/T-P1-11）在**出口级**（enforce
 * 位置在链裁决之后），本模块的 allow 压不过它——"plan 模式下 todo 不可
 * 写"由出口保证，不依赖链上白名单收口。
 *
 * 清单冻结只追加（C10 先例）；新成员必须论证"对工作区零副作用"。
 */

import type { PolicyModule } from "./chain.js";

/** 内核元操作白名单（注册表名；冻结只追加）。 */
export const META_OPS_TOOLS: ReadonlySet<string> = new Set(["todo_write"]);

export function createMetaOpsModule(): PolicyModule {
  return {
    name: "meta-ops",
    async evaluate(call) {
      if (!META_OPS_TOOLS.has(call.tool)) return undefined;
      return {
        action: "allow",
        reason: `内核元操作白名单（${call.tool} 只写会话元状态，无工作区副作用）`,
      };
    },
  };
}
