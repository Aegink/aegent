/**
 * settings 直答网关的类型面（T-P3-148——settings-gateway 的行数纪律拆分位，
 * 纯类型零实现；实现体与类在 settings-gateway.ts，域方法实现在各 *-ops.ts）。
 */

import type { JsonRecord } from "../kernel/events.js";
import type { SettingsShape } from "../session/settings.js";
import type { HealthCheckResult } from "../models/health.js";
import type { ProviderTestResult } from "./provider-gateway.js";
import type { McpToolInfo } from "../mcp/client.js";
import type { SqliteEventStorage } from "../session/db.js";
import type { CredentialStore } from "../session/credentials.js";
import type { listPlugins, checkPluginDir } from "./plugins-gateway.js";
import type { sandboxDoctorOp } from "./settings-sandbox-doctor.js";
import type { McpImportScanResult } from "./mcp-import-op.js";
import type {
  SkillImportScanResult,
  SkillImportApplyResult,
  SkillImportItem,
} from "./skill-import-op.js";
import type {
  PromptListView,
} from "./prompts-gateway.js";
import type {
  PromptImportScanResult,
  PromptImportApplyResult,
  PromptImportItem,
} from "./prompt-import-op.js";
import type { SubagentDefinition } from "../session/subagents-config.js";
import type { InstructionTarget } from "./instructions-gateway.js";
import type { McpServerEntry } from "../session/settings.js";
import type { ProviderModelsPayload, ProviderTestPayload } from "./settings-provider-ops.js";

export interface McpCheckResult {
  readonly ok: boolean;
  readonly protocolVersion?: string;
  readonly tools?: McpToolInfo[];
  readonly error?: { code: string; message: string };
}

/** T-P3-153 数据中心域依赖投影（tryTransferSettingsOp 消费——settingsPath/
 * 事件库/凭据为 gateway 私有构造面，不开公开方法逐个穿透）。 */
export interface TransferDeps {
  readonly settingsPath: string;
  readonly sessionDb?: SqliteEventStorage;
  readonly credentials: CredentialStore;
  readonly workspaceRoot?: string;
  getSettings(): Promise<SettingsShape>;
}

export interface SettingsGateway {
  get(): Promise<SettingsShape>;
  update(patch: Record<string, unknown>): Promise<SettingsShape>;
  credentialsSet(provider: string, key: string): Promise<{ masked: string }>;
  credentialsDelete(provider: string): Promise<{ deleted: boolean }>;
  credentialsList(): Promise<{ name: string; updatedAt: string; masked?: string }[]>;
  probeProvider(name: string): Promise<HealthCheckResult>;
  sessionDelete(sessionId: string): Promise<{ deleted: boolean }>;
  mcpCheck(entry: McpServerEntry): Promise<McpCheckResult>;
  /** T-P3-153：域依赖投影（数据中心族分发器消费面）。 */
  transferDeps(): TransferDeps;
  /** U20/T-P3-122 → T-P3-153：导入改为整包上送（kind/版本/域合并解析在 host）。 */
  importSettings(packageRaw: Record<string, unknown>): Promise<{ applied: true; summary: string[] }>;
  skillsList(): Promise<{
    skills: {
      name: string;
      description: string;
      tools?: readonly string[];
      filePath: string;
      origin: string;
      body: string;
    }[];
    diagnostics: { code: string; message: string; path: string }[];
    roots: string[];
    disabled: string[];
  }>;
  skillSave(payload: {
    name: string;
    description: string;
    body: string;
    tools?: readonly string[];
  }): Promise<{ saved: true; path: string }>;
  subagentsList(): Promise<{
    builtins: (SubagentDefinition & { enabled: boolean; overridden: boolean })[];
    custom: SubagentDefinition[];
  }>;
  instructionsList(): Promise<unknown>;
  instructionSave(
    target: "project-agents" | "global-agents" | "user-rules" | "project-rules" | "memory",
    content: string,
  ): Promise<{ saved: true; path: string }>;
  /** T-P3-151：规则/文本追加（B2/B4/C1 共用落盘闸——dryRun 只推导不落盘）。 */
  instructionAppend(payload: {
    target: "user-rules" | "project-rules";
    kind: "rule" | "text";
    content: string;
    dryRun?: boolean;
  }): Promise<unknown>;
  /** T-P3-151：规则测试器（B3——两层规则集真实求值）。 */
  testInstructionRule(payload: { tool: string; ruleArgs?: JsonRecord }): Promise<unknown>;
  sttTranscribe(payload: { base64: string; mediaType: string }): Promise<{ text: string; model: string }>;
  /** T-P3-149 D：语音合成代理（文本上送 → 音频 base64 回端——朗读/测试共用）。 */
  ttsSynthesize(payload: { text: string }): Promise<{ audioBase64: string; mediaType: string; model: string }>;
  /** T-P3-150 项目域：文件树单层列举 / 文件读取 / shell 集成（边界在 fs-gateway）。 */
  fsTree(path: string): Promise<unknown>;
  fsRead(path: string): Promise<unknown>;
  fsShell(payload: { path: string; action: "reveal" | "open" }): Promise<{ done: true }>;
  projectGitCloneOp(payload: { url: string; parentDir: string; name?: string }): Promise<{ path: string }>;
  gitStatusOp(roots: string[], cwd: string): Promise<unknown>;
  gitDiffOp(roots: string[], cwd: string, file: string, staged: boolean): Promise<unknown>;
  gitStageOp(roots: string[], cwd: string, files: string[], unstage: boolean): Promise<unknown>;
  gitCommitOp(roots: string[], cwd: string, message: string, amend: boolean): Promise<unknown>;
  gitLogOp(roots: string[], cwd: string): Promise<unknown>;
  assistantLogAppendOp(entry: { role: "user" | "assistant"; text: string }): Promise<{ appended: true }>;
  assistantLogReadOp(limit?: number): Promise<unknown>;
  terminalCreateOp(roots: string[], payload: { id: string; cwd: string; shell?: "cmd" | "powershell" | "pwsh" | "bash" }): unknown;
  terminalInputOp(payload: { id: string; data: string }): { written: true };
  terminalResizeOp(payload: { id: string; cols: number; rows: number }): { resized: true };
  importScan(): Promise<unknown>;
  projectTasks(projectId: string): Promise<unknown>;
  /** 镜像 store 回注（T-P3-164——project-tasks 的 turn 中内存权威源；
   * HostServer 构造后调一次。FileSettingsGateway 实现）。 */
  attachMirrorSource?(source: {
    sessionIds(): string[];
    load(sessionId: string): readonly { type: string; ts: number; message?: unknown }[];
  }): void;
  sessionAttach(payload: { sessionId: string; projectId: string }): Promise<{ attached: true }>;
  projectBranch(path: string): Promise<{ branch?: string }>;
  /** T-P3-150 B2：任务重命名（custom 权威级——自动命名永不覆盖手动名）。 */
  sessionRename(payload: { sessionId: string; title: string }): Promise<{ renamed: true }>;
  /** T-P3-150 B1：会话预览（convert 单会话消息还原——勾选前看完整对话）。 */
  importPreview(source: string, externalId: string): Promise<unknown>;
  /** T-P3-150 A6：会话内容导入（幂等账+事件流重建+项目归属）。 */
  importSessions(items: { source: string; externalId: string; projectPath?: string }[]): Promise<unknown>;
  pluginsList(): Promise<ReturnType<typeof listPlugins>>;
  /** T-P3-148 Q：安装前清单校验（审批对话框的真实 manifest 预览）。 */
  pluginCheck(dir: string): Promise<ReturnType<typeof checkPluginDir>>;
  /** T-P3-148 C：视图 HTML 读取（受控 iframe 渲染数据面——CSP 收敛出网）。 */
  pluginViewHtml(call: { name: string; view: string; base: "light" | "dark" }): Promise<unknown>;
  /** T-P3-148 T：插件打包（store-only zip + sha256——pi devkit pack 同语义）。 */
  pluginPack(dir: string): Promise<unknown>;
  /** T-P3-148 K/L/R：市场域动作面（add/remove/list/refresh/plugins/install/uninstall/updates）。 */
  marketOp(call: {
    action: string;
    source?: string;
    marketplace?: string;
    name?: string;
  }): Promise<unknown>;
  /** T-P3-148 H/J：四模板脚手架 + dev 市场登记（生成不自动装载）。 */
  pluginScaffold(call: {
    name: string;
    template: string;
    displayName?: string;
    description?: string;
  }): Promise<unknown>;
  providerModels(payload: ProviderModelsPayload): Promise<{ models: { id: string }[] }>;
  providerTest(payload: ProviderTestPayload): Promise<ProviderTestResult>;
  sandboxDoctor(): ReturnType<typeof sandboxDoctorOp>;
  pluginThemeCss(name: string): Promise<{ css: string; base: "light" | "dark"; displayName: string }>;
  mcpImportScan(): Promise<McpImportScanResult>;
  skillImportScan(): Promise<SkillImportScanResult>;
  skillImportApply(items: SkillImportItem[]): Promise<SkillImportApplyResult>;
  skillDelete(skillPath: string): Promise<{ deleted: true; path: string }>;
  skillReveal(skillPath: string): Promise<{ revealed: true }>;
  promptsList(): Promise<PromptListView>;
  promptSave(payload: import("./protocol-settings.js").PromptSavePayload): Promise<{ saved: true; path: string }>;
  promptDelete(filePath: string): Promise<{ deleted: true; path: string }>;
  promptReveal(filePath: string): Promise<{ revealed: true }>;
  promptImportScan(): Promise<PromptImportScanResult>;
  promptImportApply(items: PromptImportItem[]): Promise<PromptImportApplyResult>;
  /** T-P3-147 D：辅助任务真实测试（1-token 探测——NOT_CONFIGURED 诚实回退）。 */
  enhancementTest(task: import("./settings-provider-ops.js").EnhancementTestTask): Promise<import("./settings-provider-ops.js").EnhancementTestResult>;
}
export interface SkillSavePayload {
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly tools?: readonly string[];
}

/** 模板编辑器写回载荷（op=prompt-save——T-P3-146 C；校验在 gateway）。 */
export interface PromptSavePayload {
  readonly name: string;
  readonly content: string;
  readonly description?: string;
  readonly argumentHint?: string;
  readonly agent?: string;
  readonly model?: string;
  readonly scope?: string;
}
