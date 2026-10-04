/**
 * settings 直答网关（U14）——settings 信封的 host 侧实现：配置读/段级补丁
 * 写/凭据管理；业务域方法委托各域文件（行数纪律拆分位）。快照即规格（U14）。
 */

import {
  loadSettings,
  parseSettingsShape,
  saveSettings,
  type McpServerEntry,
  type SettingsShape,
} from "../session/settings.js";
import { maskToken } from "../models/oauth.js";
import { probeProvider, type HealthCheckResult } from "../models/health.js";
import type { ProviderTestResult } from "./provider-gateway.js";
import {
  providerModelsOp,
  providerTestOp,
  type ProviderModelsPayload,
  type ProviderTestPayload,
} from "./settings-provider-ops.js";
import type { JsonRecord } from "../kernel/events.js";
import type { CredentialStore } from "../session/credentials.js";
import type { SqliteEventStorage } from "../session/db.js";
import { probeServer } from "../mcp/registry-bridge.js";
import { homedir } from "node:os";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { sandboxDoctorOp } from "./settings-sandbox-doctor.js";
import { pluginThemeCss } from "./plugins-gateway.js";
import {
  instructionPaths,
  listInstructions,
  saveInstruction,
  type InstructionTarget,
} from "./instructions-gateway.js";
import { appendInstruction, testInstructionRule } from "./settings-instruction-ops.js";
import { runSttTranscribe } from "./speech-gateway.js";
import {
  assistantLogAppendOp,
  assistantLogReadOp,
  gitCommitOp,
  gitDiffOp,
  gitLogOp,
  gitStageOp,
  gitStatusOp,
} from "./panel-ops.js";
import { terminalCreateOp, terminalInputOp, terminalResizeOp } from "./terminal-ops.js";
import { runTtsSynthesize } from "./tts-gateway.js";
import { fsReadOp, fsShellOp, fsTreeOp, importPreviewOp, importScanOp, importSessionsOp, projectBranchOp, projectCloneOp, projectTasksOp, sessionAttachOp, sessionRenameOp, type MirrorTasksSource } from "./settings-project-ops.js";
import { checkPluginDir, listPlugins } from "./plugins-gateway.js";
import {
  marketOpImpl,
  pluginPackOp,
  pluginScaffoldOp,
  pluginViewHtmlOp,
} from "./settings-plugin-ops.js";
import { mcpImportScan, type McpImportScanResult } from "./mcp-import-op.js";
import { listSkills, saveSkill, deleteSkillDir, revealSkillDir } from "./skills-gateway.js";
import {
  listPrompts,
  savePrompt,
  deletePromptFile,
  revealPromptDir,
  type PromptListView,
} from "./prompts-gateway.js";
import {
  promptImportScan,
  promptImportApply,
  type PromptImportScanResult,
  type PromptImportApplyResult,
  type PromptImportItem,
} from "./prompt-import-op.js";
import {
  skillImportScan,
  skillImportApply,
  type SkillImportScanResult,
  type SkillImportApplyResult,
  type SkillImportItem,
} from "./skill-import-op.js";
import { enhancementTestOp } from "./settings-provider-ops.js";
import { applyImportedSettings, applyPartialImport, backupSettingsFile, resolveImportedPackage, summarizePackage } from "../session/settings-transfer.js";
import { deleteSessionOp } from "./session-export-op.js";
import { reconfigureLogging, channelLogger, defaultLogDir } from "./logging-ops.js";
import { subagentCatalog, type SubagentDefinition } from "../session/subagents-config.js";
import type { McpToolInfo } from "../mcp/client.js";

export type { SettingsGateway, McpCheckResult } from "./settings-gateway-types.js";
import type { McpCheckResult, SettingsGateway, TransferDeps } from "./settings-gateway-types.js";

export { applySettingsPatch, SETTINGS_PATCH_SECTIONS } from "./settings-patch.js";
import { applySettingsPatch } from "./settings-patch.js";

export class FileSettingsGateway implements SettingsGateway {
  constructor(
    private readonly settingsPath: string,
    private readonly credentials: CredentialStore,
    private readonly healthProbe: (name: string, baseUrl: string) => Promise<HealthCheckResult> =
      (name, baseUrl) => probeProvider({ provider: name, baseUrl }),
    private readonly sessionDb?: SqliteEventStorage,
    private readonly workspaceRoot?: string,
    private readonly homeDir: string = homedir(),
    private readonly sttFetch: typeof fetch = fetch,
  ) {}

  /** 镜像 store 回注（HostServer 构造后调——project-tasks 的 turn 中内存
   * 权威源，write-behind 库滞后根因修）。 */
  private mirrorTasksSource?: MirrorTasksSource;
  attachMirrorSource(source: MirrorTasksSource): void {
    this.mirrorTasksSource = source;
  }

  async get(): Promise<SettingsShape> {
    return (await loadSettings(this.settingsPath)).settings;
  }
  async update(patch: Record<string, unknown>): Promise<SettingsShape> {
    const merged = applySettingsPatch(await this.get(), patch);
    await saveSettings(this.settingsPath, merged);
    // T-P3-154 E1：logging 段变更热更日志中心（级别/目录/保留期）
    if (patch["logging"] !== undefined) reconfigureLogging(merged.logging, this.homeDir);
    return merged;
  }

  async credentialsSet(provider: string, key: string): Promise<{ masked: string }> {
    await this.credentials.setKey(provider, key);
    return { masked: maskToken(key) };
  }

  async credentialsDelete(provider: string): Promise<{ deleted: boolean }> {
    return { deleted: await this.credentials.deleteKey(provider) };
  }

  async credentialsList(): Promise<{ name: string; updatedAt: string; masked?: string }[]> {
    const metas = await this.credentials.listKeys();
    const out: { name: string; updatedAt: string; masked?: string }[] = [];
    for (const meta of metas) {
      const key = await this.credentials.getKey(meta.name);
      out.push({ ...meta, ...(key !== undefined ? { masked: maskToken(key) } : {}) });
    }
    return out;
  }

  async probeProvider(name: string): Promise<HealthCheckResult> {
    const entry = (await this.get()).providers.find((p) => p.name === name);
    if (entry === undefined || entry.baseUrl === undefined || entry.baseUrl.trim() === "") {
      const missing = entry === undefined;
      const error = new Error(missing ? `provider「${name}」不在配置中` : `provider「${name}」未配置 baseUrl，无法探测`);
      (error as unknown as { code: string }).code = missing ? "PROVIDER_NOT_FOUND" : "PROVIDER_NO_BASE_URL";
      throw error;
    }
    return this.healthProbe(name, entry.baseUrl);
  }
  async sessionDelete(sessionId: string): Promise<{ deleted: boolean }> {
    return deleteSessionOp(this.sessionDb, sessionId); // T-P3-153 下沉会话数据域
  }

  /** T-P3-153：数据中心域依赖投影（settingsPath/事件库/凭据私有面收敛）。 */
  transferDeps(): TransferDeps {
    return {
      settingsPath: this.settingsPath,
      ...(this.sessionDb !== undefined ? { sessionDb: this.sessionDb } : {}),
      credentials: this.credentials,
      ...(this.workspaceRoot !== undefined ? { workspaceRoot: this.workspaceRoot } : {}),
      getSettings: () => this.get(),
    };
  }

  async mcpCheck(entry: McpServerEntry): Promise<McpCheckResult> {
    try {
      // T-P3-143：条目级 timeoutMs 优先（慢启动 server 放宽——缺省 8s 探针档）
      const r = await probeServer(entry, { requestTimeoutMs: entry.timeoutMs ?? 8_000 });
      return { ok: true, protocolVersion: r.protocolVersion, tools: r.tools };
    } catch (e) {
      return {
        ok: false,
        error: {
          code: "MCP_CHECK_FAILED",
          message: e instanceof Error ? e.message : String(e),
        },
      };
    }
  }

  // U20/T-P3-122 → T-P3-153 A2/A3：导入 = 整包上送（kind 校验+版本迁移+
  // replace/merge 分型在 resolveImportedPackage；备份滚动先于任何落盘）。
  async importSettings(
    packageRaw: Record<string, unknown>,
  ): Promise<{ applied: true; summary: string[] }> {
    const current = await this.get();
    const resolved = resolveImportedPackage(packageRaw);
    backupSettingsFile(this.settingsPath);
    const merged =
      resolved.mode === "replace"
        ? applyImportedSettings(current, resolved.settings)
        : applyPartialImport(current, resolved.partial, resolved.domains);
    await saveSettings(this.settingsPath, merged);
    return { applied: true, summary: summarizePackage(merged) };
  }

  private skillsUnavailable(): never {
    const error = new Error("host 未配置 workspace，技能管理面不可用");
    (error as unknown as { code: string }).code = "SKILLS_UNAVAILABLE";
    throw error;
  }

  async skillsList(): Promise<ReturnType<typeof listSkills>> {
    if (this.workspaceRoot === undefined) this.skillsUnavailable();
    return listSkills(await this.get(), this.workspaceRoot!);
  }

  async skillSave(payload: {
    name: string;
    description: string;
    body: string;
    tools?: readonly string[];
  }): Promise<{ saved: true; path: string }> {
    if (this.workspaceRoot === undefined) this.skillsUnavailable();
    return saveSkill(this.workspaceRoot!, payload);
  }

  async subagentsList(): Promise<{
    builtins: (SubagentDefinition & { enabled: boolean; overridden: boolean })[];
    custom: SubagentDefinition[];
  }> {
    const settings = await this.get();
    return subagentCatalog(settings.subagents);
  }

  instructionsList(): Promise<ReturnType<typeof listInstructions>> {
    return Promise.resolve(listInstructions(instructionPaths(this.workspaceRoot, this.homeDir)));
  }

  instructionSave(target: InstructionTarget, content: string): Promise<{ saved: true; path: string }> {
    if (target === "project-agents" && this.workspaceRoot === undefined) this.skillsUnavailable();
    return saveInstruction(instructionPaths(this.workspaceRoot, this.homeDir), target, content);
  }

  // 载荷形状 = AppendInstructionPayload（settings-instruction-ops）
  instructionAppend(payload: { target: string; kind: "rule" | "text"; content: string; dryRun?: boolean }): Promise<unknown> {
    if (payload.target.startsWith("project-") && this.workspaceRoot === undefined) this.skillsUnavailable();
    return appendInstruction(instructionPaths(this.workspaceRoot, this.homeDir), payload.target as InstructionTarget, payload.kind, payload.content, payload.dryRun === true);
  }

  testInstructionRule(payload: { tool: string; ruleArgs?: JsonRecord }): Promise<unknown> {
    return Promise.resolve(testInstructionRule(instructionPaths(this.workspaceRoot, this.homeDir), payload.tool, payload.ruleArgs));
  }

  // U26/T-P3-129 语音转写代理（key 按 "stt" 走 credentials；面 speech-gateway）
  async sttTranscribe(payload: { base64: string; mediaType: string }): Promise<{ text: string; model: string }> {
    return runSttTranscribe(await this.get(), this.credentials, payload, this.sttFetch);
  }

  // T-P3-149 D 语音合成代理（key 走 "tts"；面 tts-gateway；未配置 TTS_NOT_CONFIGURED）
  async ttsSynthesize(payload: { text: string }): Promise<{ audioBase64: string; mediaType: string; model: string }> {
    return runTtsSynthesize(await this.get(), this.credentials, payload, this.sttFetch);
  }

  // —— T-P3-150 项目域（实现面 settings-project-ops；fs 边界归一 fs-gateway）——

  projectRoots(): Promise<string[]> {
    return this.get().then((s) => (s.projects ?? []).flatMap((p) => p.folders));
  }

  fsTree(path: string): Promise<unknown> { return this.projectRoots().then((r) => fsTreeOp(r, path)); }
  fsRead(path: string): Promise<unknown> { return this.projectRoots().then((r) => fsReadOp(r, path)); }
  fsShell(payload: { path: string; action: "reveal" | "open" }): Promise<{ done: true }> { return this.projectRoots().then((r) => fsShellOp(r, payload)); }
  projectGitCloneOp(payload: { url: string; parentDir: string; name?: string }): Promise<{ path: string }> { return projectCloneOp(payload); }
  // T-P3-156 面板域（R/P/T）——panel-ops/terminal-ops 委派（roots 实时取）
  gitStatusOp(roots: string[], cwd: string): Promise<unknown> { return gitStatusOp(roots, cwd); }
  gitDiffOp(roots: string[], cwd: string, file: string, staged: boolean): Promise<unknown> { return gitDiffOp(roots, cwd, file, staged); }
  gitStageOp(roots: string[], cwd: string, files: string[], unstage: boolean): Promise<unknown> { return gitStageOp(roots, cwd, files, unstage); }
  gitCommitOp(roots: string[], cwd: string, message: string, amend: boolean): Promise<unknown> { return gitCommitOp(roots, cwd, message, amend); }
  gitLogOp(roots: string[], cwd: string): Promise<unknown> { return gitLogOp(roots, cwd); }
  assistantLogAppendOp(entry: { role: "user" | "assistant"; text: string }): Promise<{ appended: true }> { return assistantLogAppendOp(entry); }
  assistantLogReadOp(limit?: number): Promise<unknown> { return assistantLogReadOp(limit); }
  terminalCreateOp(roots: string[], payload: { id: string; cwd: string }): unknown { return terminalCreateOp(roots, payload); }
  terminalInputOp(payload: { id: string; data: string }): { written: true } { return terminalInputOp(payload); }
  terminalResizeOp(payload: { id: string; cols: number; rows: number }): { resized: true } { return terminalResizeOp(payload); }
  importScan(): Promise<unknown> { return importScanOp(this.homeDir); }
  projectTasks(projectId: string): Promise<unknown> { return Promise.resolve(projectTasksOp(this.sessionDb, projectId, this.mirrorTasksSource)); }
  sessionAttach(payload: { sessionId: string; projectId: string }): Promise<{ attached: true }> { return Promise.resolve(sessionAttachOp(this.sessionDb, payload)); }
  projectBranch(path: string): Promise<{ branch?: string }> { return Promise.resolve(projectBranchOp(path)); }
  sessionRename(payload: { sessionId: string; title: string }): Promise<{ renamed: true }> { return Promise.resolve(sessionRenameOp(this.sessionDb, payload)); }
  importPreview(source: string, externalId: string): Promise<unknown> { return Promise.resolve(importPreviewOp(source, externalId, this.homeDir)); }
  importSessions(items: { source: string; externalId: string; projectPath?: string }[]): Promise<unknown> {
    return this.get().then((s) => importSessionsOp(this.sessionDb, items, s.projects ?? [], this.homeDir));
  }

  async pluginsList(): Promise<ReturnType<typeof listPlugins>> {
    return listPlugins(await this.get());
  }

  async pluginCheck(dir: string): Promise<ReturnType<typeof checkPluginDir>> {
    return checkPluginDir(dir);
  }

  async pluginViewHtml(call: { name: string; view: string; base: "light" | "dark" }): Promise<unknown> {
    return pluginViewHtmlOp(this.pluginOpsDeps(), call);
  }

  async pluginPack(dir: string): Promise<unknown> {
    return pluginPackOp(dir);
  }

  async marketOp(call: {
    action: string;
    source?: string;
    marketplace?: string;
    name?: string;
  }): Promise<unknown> {
    return marketOpImpl(this.pluginOpsDeps(), call);
  }

  async pluginScaffold(call: {
    name: string;
    template: string;
    displayName?: string;
    description?: string;
  }): Promise<unknown> {
    return pluginScaffoldOp(this.pluginOpsDeps(), call);
  }

  /** 域依赖投影（settings-plugin-ops 的入参面）。 */
  private pluginOpsDeps() {
    return {
      settingsPath: this.settingsPath,
      homeDir: this.homeDir,
      ...(this.workspaceRoot !== undefined ? { workspaceRoot: this.workspaceRoot } : {}),
      getSettings: () => this.get(),
    };
  }

  async providerModels(payload: ProviderModelsPayload): Promise<{ models: { id: string }[] }> {
    return providerModelsOp(this.credentials, payload);
  }

  async providerTest(payload: ProviderTestPayload): Promise<ProviderTestResult> {
    return providerTestOp(this.credentials, payload);
  }

  async sandboxDoctor() {
    return sandboxDoctorOp(this.settingsPath, this.workspaceRoot);
  }

  async pluginThemeCss(name: string): Promise<{ css: string; base: "light" | "dark"; displayName: string }> {
    const settings = await this.get();
    return pluginThemeCss(settings, name);
  }

  async mcpImportScan(): Promise<McpImportScanResult> {
    return mcpImportScan({ homeDir: this.homeDir, ...(this.workspaceRoot !== undefined ? { workspaceRoot: this.workspaceRoot } : {}) });
  }

  async skillImportScan(): Promise<SkillImportScanResult> {
    return skillImportScan({ homeDir: this.homeDir, ...(this.workspaceRoot !== undefined ? { workspaceRoot: this.workspaceRoot } : {}) });
  }

  async skillImportApply(items: SkillImportItem[]): Promise<SkillImportApplyResult> {
    if (this.workspaceRoot === undefined) this.skillsUnavailable();
    return skillImportApply({ homeDir: this.homeDir, workspaceRoot: this.workspaceRoot! }, items);
  }

  async skillDelete(skillPath: string): Promise<{ deleted: true; path: string }> {
    if (this.workspaceRoot === undefined) this.skillsUnavailable();
    return deleteSkillDir(await this.get(), this.workspaceRoot!, skillPath);
  }

  async skillReveal(skillPath: string): Promise<{ revealed: true }> {
    return revealSkillDir(skillPath);
  }

  async promptsList(): Promise<PromptListView> {
    return listPrompts(await this.get(), this.workspaceRoot, this.homeDir);
  }

  async promptSave(payload: import("./protocol-settings.js").PromptSavePayload): Promise<{ saved: true; path: string }> {
    return savePrompt(payload, { ...(this.workspaceRoot !== undefined ? { workspaceRoot: this.workspaceRoot } : {}), homeDir: this.homeDir });
  }

  async promptDelete(filePath: string): Promise<{ deleted: true; path: string }> {
    return deletePromptFile(await this.get(), { ...(this.workspaceRoot !== undefined ? { workspaceRoot: this.workspaceRoot } : {}), homeDir: this.homeDir }, filePath);
  }

  async promptReveal(filePath: string): Promise<{ revealed: true }> {
    return revealPromptDir(filePath);
  }

  async promptImportScan(): Promise<PromptImportScanResult> {
    return promptImportScan({ homeDir: this.homeDir, ...(this.workspaceRoot !== undefined ? { workspaceRoot: this.workspaceRoot } : {}) });
  }

  async promptImportApply(items: PromptImportItem[]): Promise<PromptImportApplyResult> {
    if (this.workspaceRoot === undefined) this.skillsUnavailable();
    return promptImportApply({ homeDir: this.homeDir, workspaceRoot: this.workspaceRoot! }, items);
  }

  async enhancementTest(
    task: import("./settings-provider-ops.js").EnhancementTestTask,
  ): Promise<import("./settings-provider-ops.js").EnhancementTestResult> {
    return enhancementTestOp(this.credentials, await this.get(), task);
  }
}