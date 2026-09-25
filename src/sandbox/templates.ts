/**
 * 权限提示词模板（T-6-02 · D2）——按审批档位渲染注入系统提示的模板。
 * 形态取 codex prompts/templates/permissions（模板文件独立目录 + 按策略
 * 选择档位）；内容是按我方语义重写的（codex 的 sandbox_permissions/
 * prefix_rule 机制不存在于我方），分段说明对齐 T-5-14 B 档的实际行为。
 * 危险命令模式库本体在 T-5-13（模板只举例，不重复实现清单）。
 *
 * 消费方：T-7-05 的系统提示装配（基础提示 + 本模板 + AGENTS.md 收集器）。
 * 两档语义对应审批出口（T-5-10 broker）：on_request = Manual 审批在位，
 * 危险命令会询问用户；never = 审批不可用（如缺省 Deny broker 或用户关闭
 * 审批），会触发询问的命令一律被拒。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ApprovalPromptTier = "on_request" | "never";

/** 档位闭集（C16 同款纪律：新增档位必须同步模板目录与这里）。 */
export const APPROVAL_PROMPT_TIERS: readonly ApprovalPromptTier[] = Object.freeze([
  "on_request",
  "never",
] as const);

export interface PermissionPromptVars {
  /** 可写范围描述（PathGuard.describeWritableRoots 的产出），注入 {{WRITABLE_ROOTS}}。 */
  readonly writableRoots: string;
}

function templateDir(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "templates",
    "permissions",
    "approval_policy",
  );
}

/** 渲染指定档位的权限模板；占位符全量替换。模板文件缺失即抛（提示面不静默降级）。 */
export function renderPermissionsPrompt(
  tier: ApprovalPromptTier,
  vars: PermissionPromptVars,
): string {
  const raw = readFileSync(path.join(templateDir(), `${tier}.md`), "utf8");
  return raw.replaceAll("{{WRITABLE_ROOTS}}", vars.writableRoots);
}
