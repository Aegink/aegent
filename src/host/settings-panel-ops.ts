/**
 * 面板域 settings op 分发（T-P3-156 R/P/T——Git 管理面板/终端/辅助对话
 * 历史；settings-project-ops 的 dispatch 同构面，载荷形状已由
 * protocol-settings 校验）。
 */
import type {
  gitCommitOp,
  gitDiffOp,
  gitLogOp,
  gitStageOp,
  gitStatusOp,
  assistantLogAppendOp,
  assistantLogReadOp,
} from "./panel-ops.js";
import type {
  terminalCreateOp,
  terminalInputOp,
  terminalResizeOp,
} from "./terminal-ops.js";

/** roots 供给（SettingsGateway 自带 projectRoots——可选依赖，缺省空表）。 */
function resolveRoots(gateway: PanelOpsGateway): Promise<string[]> {
  return gateway.projectRoots !== undefined ? gateway.projectRoots() : Promise.resolve([]);
}

type GitStatusOp = typeof gitStatusOp;
type GitDiffOp = typeof gitDiffOp;
type GitStageOp = typeof gitStageOp;
type GitCommitOp = typeof gitCommitOp;
type GitLogOp = typeof gitLogOp;
type AssistantAppendOp = typeof assistantLogAppendOp;
type AssistantReadOp = typeof assistantLogReadOp;
type TerminalCreateOp = typeof terminalCreateOp;
type TerminalInputOp = typeof terminalInputOp;
type TerminalResizeOp = typeof terminalResizeOp;

export interface PanelOpsGateway {
  projectRoots?(): Promise<string[]>;
  gitStatusOp: GitStatusOp;
  gitDiffOp: GitDiffOp;
  gitStageOp: GitStageOp;
  gitCommitOp: GitCommitOp;
  gitLogOp: GitLogOp;
  assistantLogAppendOp: AssistantAppendOp;
  assistantLogReadOp: AssistantReadOp;
  terminalCreateOp: TerminalCreateOp;
  terminalInputOp: TerminalInputOp;
  terminalResizeOp: TerminalResizeOp;
}

export function tryPanelSettingsOp(
  gateway: PanelOpsGateway,
  call: {
    op: string;
    cwd?: string;
    file?: string;
    staged?: boolean;
    files?: string[];
    unstage?: boolean;
    message?: string;
    amend?: boolean;
    limit?: number;
    role?: string;
    text?: string;
    id?: string;
    data?: string;
    cols?: number;
    rows?: number;
    shell?: string;
  },
): Promise<unknown> | unknown {
  switch (call.op) {
    case "git-status":
      return resolveRoots(gateway).then((roots) => gateway.gitStatusOp(roots, call.cwd!));
    case "git-diff":
      return resolveRoots(gateway).then((roots) => gateway.gitDiffOp(roots, call.cwd!, call.file!, call.staged === true));
    case "git-stage":
      return resolveRoots(gateway).then((roots) => gateway.gitStageOp(roots, call.cwd!, call.files ?? [], call.unstage === true));
    case "git-commit":
      return resolveRoots(gateway).then((roots) => gateway.gitCommitOp(roots, call.cwd!, call.message ?? "", call.amend === true));
    case "git-log":
      return resolveRoots(gateway).then((roots) => gateway.gitLogOp(roots, call.cwd!));
    case "assistant-log-append":
      return gateway.assistantLogAppendOp({ role: (call.role as "user" | "assistant") ?? "user", text: call.text ?? "" });
    case "assistant-log-read":
      return gateway.assistantLogReadOp(call.limit);
    case "terminal-create":
      return resolveRoots(gateway).then((roots) =>
        gateway.terminalCreateOp(roots, {
          id: call.id!,
          cwd: call.cwd!,
          ...(call.shell !== undefined ? { shell: call.shell as "cmd" | "powershell" | "pwsh" | "bash" } : {}),
        }),
      );
    case "terminal-input":
      return gateway.terminalInputOp({ id: call.id!, data: call.data ?? "" });
    case "terminal-resize":
      return gateway.terminalResizeOp({ id: call.id!, cols: call.cols ?? 80, rows: call.rows ?? 24 });
    default:
      return undefined;
  }
}
