/**
 * question 工具（B8b，T-P1-21）——模型显式向用户提问，答复作为工具结果
 * 回喂（opencode question 的最小面：单问题、自由文本答复）。
 *
 * 结算语义复用（卡面纪律）：挂起走审批基建的**同一个** PendingApprovals
 * （不新增第二套注册表——hermes 迟到通知教训的延伸），id = 本次调用的
 * callId（B9 贯穿，D15：重试即新调用新 id）。答复映射：
 *   - 协议 question/answer 携带非空 answer → pending.reply(allow, reason=答复)；
 *   - 空 answer（用户跳过）→ pending.reply(deny, reason=未作答提示)；
 *   - 超时 → PermissionTimeout（C50），工具按拒结算（isError 回喂）。
 *
 * 语义边界（卡面风险栏）：question 的"答复"不是"批准"——协议消息分型
 * （question/answer ≠ approve，question_asked ≠ approval_requested），链上
 * 由 meta-ops 白名单放行（提问无工作区副作用，走默认 ask 会双挂起）。
 */

import type { PendingApprovals } from "../../src/policy/pending.js";
import { PermissionTimeout } from "../../src/policy/pending.js";
import type { Verdict } from "../../src/policy/decision.js";
import { toolError } from "../../src/kernel/tools/builtin/util.js";
import type { ToolDef } from "../../src/core/index.js";
import type { JsonRecord } from "../../src/kernel/events.js";
import type { ToolExecutionResult } from "../../src/kernel/loop.js";

/** question 成功结算的结果（meta 记录问答事实，isError 缺席 = 正常答复）。 */
function questionOk(content: string, meta: JsonRecord): ToolExecutionResult {
  return { content, meta };
}

export interface QuestionToolDeps {
  /** 与权限审批共用的挂起注册表（装配注入同一实例）。 */
  pending: PendingApprovals;
  sessionId: string;
  /** 答复等待上界（必填——无上界的静默永挂是 C50 要防的事故）。 */
  timeoutMs: number;
  /** C36 有界警告去向（装配注入 logger.warn）；缺省丢弃。 */
  onWarn?: (message: string) => void;
}

/**
 * 模型作者提示文本上界（C36，T-P1-70；qwen
 * MAX_TRUSTED_USER_ANSWER_QUESTION_CHARS=200 同款——question 文本是模型
 * 作者的，按分类器用户提示有界而不是按用户自己的答复有界）。截断只影响
 * 提示面（挂起的审批/问答展示），原始长度留痕 meta。
 */
export const MAX_USER_HINT_LENGTH = 200;

export function createQuestionTool(deps: QuestionToolDeps): ToolDef {
  return {
    name: "question",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "要问用户的问题（具体、可直接回答）",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description:
            "可选的候选项（1~8 项，每项一句话）。提供时 UI 显示选项卡让用户点选，也可自由输入",
        },
        multiple: {
          type: "boolean",
          description: "选项是否可多选（仅在提供 options 时有意义；缺省单选）",
        },
      },
      required: ["question"],
    },
    async execute(args, ctx) {
      const question = args["question"];
      if (typeof question !== "string" || question === "") {
        return toolError(
          "QuestionError",
          "INVALID_ARGUMENTS",
          "question 需要 question（非空字符串）",
        );
      }
      // C36 有界：模型作者的问题文本超上界截断 + warn 留痕（截断只影响
      // 提示与问答展示面，用户看到的问题不失控）
      let hint = question;
      if (question.length > MAX_USER_HINT_LENGTH) {
        hint = question.slice(0, MAX_USER_HINT_LENGTH);
        deps.onWarn?.(
          `question 文本 ${question.length} 字符超上界 ${MAX_USER_HINT_LENGTH}，已截断（C36 有界纪律）`,
        );
      }
      // T-P3-160：候选项规范化（UI 决策卡数据源——选项逐项截断同 hint 的
      // C36 有界纪律；非法形态静默忽略不炸提问）。多选语义随 args 下发，
      // 答复仍是自由文本（多选 = 选中项 join，UI 侧拼接）。
      const rawOptions = Array.isArray(args["options"]) ? args["options"] : [];
      const options = rawOptions
        .filter((o): o is string => typeof o === "string" && o.trim() !== "")
        .slice(0, 8)
        .map((o) => (o.length > MAX_USER_HINT_LENGTH ? o.slice(0, MAX_USER_HINT_LENGTH) : o.trim()));
      const multiple = args["multiple"] === true && options.length > 0;
      let verdict: Verdict;
      try {
        verdict = await deps.pending.ask(
          {
            id: ctx.toolCallId,
            sessionId: deps.sessionId,
            tool: "question",
            args: {
              question: hint,
              ...(options.length > 0 ? { options } : {}),
              ...(multiple ? { multiple: true } : {}),
            },
            // C54：question 是提问发起面（关类时 ask 自动 deny → declined 面）
            category: "question",
          },
          { timeoutMs: deps.timeoutMs },
        );
      } catch (e) {
        if (e instanceof PermissionTimeout) {
          // C50 超时按拒结算：isError 回喂——模型感知"未获答复"后自适应
          return toolError(
            "QuestionError",
            e.code,
            `问题超时（${String(deps.timeoutMs)}ms）未获用户答复：${hint}`,
          );
        }
        throw e; // Duplicate 等 = 编程错误，上抛交 loop 兜底（配平不变量）
      }
      return verdict.action === "allow"
        ? questionOk(`用户答复：${verdict.reason ?? ""}`, {
            question: hint,
            answer: verdict.reason ?? "",
            ...(question.length > MAX_USER_HINT_LENGTH
              ? {
                  questionTruncated: true,
                  questionOriginalLength: question.length,
                }
              : {}),
          })
        : questionOk("用户选择不回答这个问题。请基于已有信息继续，或换一种方式推进。", {
            question: hint,
            declined: true,
            ...(question.length > MAX_USER_HINT_LENGTH
              ? {
                  questionTruncated: true,
                  questionOriginalLength: question.length,
                }
              : {}),
          });
    },
  };
}
