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
import type { ToolDef } from "../../src/core/index.js";
import type { ToolExecutionResult } from "../../src/core/index.js";
import { SubagentDepthError, type SubagentRunResult } from "../../src/ext-builtin/subagent-engine/subagent.js";

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
   * 子代理运行面（kernel/subagent.ts 的 runner.run，装配注入）。深度检查/
   * 子会话创建/降级装配/结算全在这里；第三参 signal（T-P1-43）= 本 turn
   * 取消信号，父轮取消联动子轮取消。U23：opts 加 subagentType（预设名）。
   * T-P3-145 G：opts.background = true 时返回后台启动收执（不等待）。
   */
  readonly runSubagent: (
    prompt: string,
    description: string,
    opts?: {
      signal?: AbortSignal;
      backend?: string;
      subagentType?: string;
      background?: boolean;
    },
  ) => Promise<
    | { kind: "foreground"; result: SubagentRunResult }
    | { kind: "background"; delegationId: string; childSessionId: string }
  >;
}

export function createTaskTool(deps: TaskToolDeps): ToolDef {
  return {
    name: "task",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "system",
    destructive: true,
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
        backend: {
          type: "string",
          description:
            "子代理执行后端名（H6/T-P2-309；缺省进程内 fork——装配方按注册表选后端，未知后端会被类型化拒绝）",
        },
        subagent_type: {
          type: "string",
          description:
            "子代理预设名（U23——内置探索者 explorer / 代码审查员 code-reviewer / 测试执行者 test-runner / 修复者 fixer / UI 设计师 ui-designer，或设置页自定义的预设名；缺省 = 通用子代理）",
        },
        run_in_background: {
          type: "boolean",
          description:
            "后台运行（T-P3-145）：true = 立即返回委托 id，父会话继续其他工作，用 task_wait 收割报告 / task_list 查状态 / task_stop 停止；缺省 false = 同步等待完成（结果直接返回）",
        },
      },
      required: ["description", "prompt"],
    },
    async execute(args, ctx): Promise<ToolExecutionResult> {
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
      const backend = args["backend"];
      if (backend !== undefined && (typeof backend !== "string" || backend === "")) {
        return toolError("TaskError", "INVALID_ARGUMENTS", "task 的 backend 须为非空字符串");
      }
      // U23/T-P3-126：预设名（非空字符串校验——未知/停用的解析在 runner）
      const subagentType = args["subagent_type"];
      if (subagentType !== undefined && (typeof subagentType !== "string" || subagentType === "")) {
        return toolError("TaskError", "INVALID_ARGUMENTS", "task 的 subagent_type 须为非空字符串");
      }
      const background = args["run_in_background"] === true;
      let outcome: Awaited<ReturnType<TaskToolDeps["runSubagent"]>>;
      try {
        // T-P1-43 取消联动：ctx.signal（本 turn 取消信号）传给 runner——
        // 父轮取消 → 子轮取消（CancelCause "parent"）；后台委托不受该信号
        // （后台语义——父轮取消不杀后台委托，父会话收尾才是终止点）。
        // H6：backend（可选）随 opts 透传。
        outcome = await deps.runSubagent(prompt, description, {
          ...(ctx.signal ? { signal: ctx.signal } : {}),
          ...(backend !== undefined ? { backend } : {}),
          ...(subagentType !== undefined ? { subagentType } : {}),
          ...(background ? { background: true } : {}),
        });
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
      // T-P3-145 G：后台启动收执——立即返回委托 id（父 step 继续其他工具）。
      if (outcome.kind === "background") {
        return {
          content:
            `<task id="${outcome.childSessionId}" delegation="${outcome.delegationId}" state="started">\n` +
            `后台委托已启动（${outcome.delegationId}）——父会话可继续其他工作。\n` +
            `收割：task_wait（等报告）；状态：task_list；停止：task_stop。\n` +
            `即使不主动收割，本会话结束时也会自动等全部委托完成并把报告注入。\n` +
            `子会话完整过程：${outcome.childSessionId}`,
          meta: {
            subagent: {
              sessionId: outcome.childSessionId,
              delegationId: outcome.delegationId,
              state: "started",
            },
          },
        };
      }
      const result = outcome.result;
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
