/**
 * task 工具（H1/H4，T-P1-42）——把工作委派给子代理。工具本体只做参数
 * 校验与结算渲染；子循环的起停/子装配/结算提取在 kernel/subagent.ts
 * （装配层职责，工具不触碰 store——ToolContext 封闭键集纪律的延伸）。
 *
 * opencode·task.ts 同构要点：
 *   - task 是普通工具（过注册表/权限链/出口）——派发本身受父会话权限
 *     管辖（默认 ask，用户批准后才起子代理）；
 *   - 参数最小面 {description, prompt}：subagent_type 收敛掉（我方无
 *     agent 类型注册表，P2 H6 后端选择面再开）；background/task_id
 *     不做（P1 前台 only，P2 continuable 面）；
 *   - 结算渲染 `<task_result>/<task_error>` 标签（renderOutput 同构），
 *     lineage（子 sessionId + stopReason）进 result.meta。
 *
 * 深度拒绝语义：runSubagent 入口的 SubagentDepthError 在此转类型化
 * isError（SUBAGENT_DEPTH_EXCEEDED，模型可自修）——H1 验收"子代理不可
 * 再分子代理"的显式失败面（H5 的 deny 规则是第二道，fail-closed 双保险）。
 */

import { toolError } from "./util.js";
import type { ToolDef } from "../registry.js";
import type { ToolExecutionResult } from "../../loop.js";
import { SubagentDepthError, type SubagentRunResult } from "../../subagent.js";

/** task 成功结算的文本（opencode renderOutput 的 `<task_result>` 同构）。 */
function renderTaskOutput(result: SubagentRunResult): string {
  return [
    `<task id="${result.sessionId}" state="${result.stopReason}">`,
    "<task_result>",
    result.output,
    "</task_result>",
    "</task>",
  ].join("\n");
}

export interface TaskToolDeps {
  /**
   * 子代理运行面（kernel/subagent.ts 的 createSubagentRunner 产物，装配
   * 注入）。深度检查/子会话创建/降级装配/结算全在这里。
   */
  readonly runSubagent: (prompt: string, description: string) => Promise<SubagentRunResult>;
}

export function createTaskTool(deps: TaskToolDeps): ToolDef {
  return {
    name: "task",
    // T-P1-15：task 内部串行起子循环并 await 结算——排他（缺省 false）
    parallel: false,
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "任务的简短描述（3-5 个词）",
        },
        prompt: {
          type: "string",
          description: "交给子代理执行的完整任务指令（子代理从全新上下文开始，prompt 即其全部任务背景）",
        },
      },
      required: ["description", "prompt"],
    },
    async execute(args): Promise<ToolExecutionResult> {
      const description = args["description"];
      const prompt = args["prompt"];
      if (typeof description !== "string" || description === "") {
        return toolError(
          "TaskError",
          "INVALID_ARGUMENTS",
          "task 需要 description（非空字符串）",
        );
      }
      if (typeof prompt !== "string" || prompt === "") {
        return toolError(
          "TaskError",
          "INVALID_ARGUMENTS",
          "task 需要 prompt（非空字符串——子代理从全新上下文开始，prompt 是它的全部任务背景）",
        );
      }
      let result: SubagentRunResult;
      try {
        result = await deps.runSubagent(prompt, description);
      } catch (err) {
        if (err instanceof SubagentDepthError) {
          return toolError(
            "TaskError",
            err.code,
            `${err.message}——请直接在当前会话完成该工作，或拆分任务`,
          );
        }
        // 其他异常是装配/基础设施层故障：类型化失败回喂，不上抛炸父 step。
        return toolError(
          "TaskError",
          "SUBAGENT_FAILED",
          err instanceof Error ? err.message : String(err),
        );
      }
      if (result.stopReason !== "completed") {
        return {
          content:
            `<task id="${result.sessionId}" state="${result.stopReason}">\n` +
            `<task_error>\n${result.error ?? "子代理未正常完成"}\n</task_error>\n</task>`,
          isError: true,
          error: {
            name: "TaskError",
            code: result.stopReason === "cancelled" ? "SUBAGENT_CANCELLED" : "SUBAGENT_FAILED",
          },
          meta: {
            subagent: { sessionId: result.sessionId, stopReason: result.stopReason },
          },
        };
      }
      return {
        content: renderTaskOutput(result),
        meta: {
          subagent: { sessionId: result.sessionId, stopReason: result.stopReason },
        },
      };
    },
  };
}
