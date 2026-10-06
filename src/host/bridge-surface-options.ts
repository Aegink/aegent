/**
 * surface 协议选项构造（自 bridge.ts 下沉：行数纪律拆分）——connectSurface
 * 的 HostProtocolServerOptions 四个钩子（hello/lease/query/settings）在这里
 * 组装；bridge 侧只传显式依赖。分发逻辑本体不变（host-bridge 的历史注释
 * 随段搬运）。
 */

import { buildPolicyAuditEntries } from "./policy-audit-op.js";
import { handleHostQuery, type HostQuery } from "./query-gateway.js";
import {
  tryTransferSettingsOp,
} from "./settings-transfer-ops.js";
import { trySchedulerSettingsOp } from "./scheduler-ops.js";
import { tryInstructionSettingsOp } from "./settings-instruction-ops.js";
import { tryProjectSettingsOp } from "./settings-project-ops.js";
import { tryPanelSettingsOp } from "./settings-panel-ops.js";
import { tryPluginSettingsOp } from "./settings-plugin-ops.js";
import { localSttStatus } from "./local-stt.js";
import { sttDownloadAll } from "./local-stt-download.js";
import type { AgentHost } from "./registry.js";
import type { SessionStore } from "../session/store.js";
import type { SqliteEventStorage } from "../session/db.js";
import type { SettingsGateway } from "./settings-gateway.js";
import type { AgentRequest } from "../kernel/agent-protocol.js";
import type { HostProtocolServerOptions } from "./protocol.js";

/** buildSurfaceServerOptions 的依赖（bridge 私有面的显式投影）。 */
export interface SurfaceDeps {
  host: AgentHost;
  store?: SessionStore;
  sessionsLibrary?: SqliteEventStorage;
  settingsGateway?: SettingsGateway;
  workspaceRoot?: string;
  contextWindow?: number;
  /** 插件热加载通知器（bridge 持有——闭包取活值）。 */
  reloadNotify: () => void;
  /** ready 捕获的活能力查询（bridge 泵内数据源）。 */
  agentCapabilities: () => import("./query-gateway.js").AgentCapabilities | undefined;
}

/** 组装一个 surface 的协议服务器选项（onHello/onLease/onQuery/onSettings）。 */
export function buildSurfaceServerOptions(
  deps: SurfaceDeps,
  surfaceId: string,
  write: HostProtocolServerOptions["write"],
): HostProtocolServerOptions {
  return {
    write,
    surfaceId,
    sessionId: deps.host.sessionId,
    onHello: (hello) => {
      // hello 携带的身份与注册不符 = 编程错误（connectSurface 已注册）
      if (hello.surfaceId !== undefined && hello.surfaceId !== surfaceId) {
        throw new Error(`hello 身份 ${hello.surfaceId} 与注册面 ${surfaceId} 不符`);
      }
    },
    // N7 run 租约协议面：acquire/release 直答（不经 agent；code 透传）。
    onLease: async (lease) => {
      if (lease.op === "acquire") {
        const acquired = deps.host.surfaces.acquireRunLease(lease.surfaceId);
        return { held: true, surfaceId: acquired.ownerId };
      }
      const released = deps.host.surfaces.releaseRunLease(lease.surfaceId);
      return { released };
    },
    // K5 恢复视图 + U3/U9/U10/U12 查询——实现拆分至 query-gateway.ts，
    // 本处只做依赖注入（capabilities 是活查询——ready 捕获在泵内）。
    onQuery: (query) =>
      handleHostQuery(
        {
          hostSessionId: () => deps.host.sessionId,
          ...(deps.store !== undefined ? { store: deps.store } : {}),
          ...(deps.sessionsLibrary !== undefined ? { sessionsLibrary: deps.sessionsLibrary } : {}),
          ...(deps.settingsGateway !== undefined ? { settingsGateway: deps.settingsGateway } : {}),
          ...(deps.workspaceRoot !== undefined ? { workspaceRoot: deps.workspaceRoot } : {}),
          ...(deps.contextWindow !== undefined ? { contextWindow: deps.contextWindow } : {}),
          capabilities: deps.agentCapabilities,
        },
        query,
      ),
    // U14/T-P3-103 settings 直答（host 面配置——不经 agent 不落流）。
    onSettings: async (call) => {
      const gateway = deps.settingsGateway;
      if (gateway === undefined) {
        const error = new Error("host 未配置 settings 面");
        (error as unknown as { code: string }).code = "SETTINGS_UNSUPPORTED";
        throw error;
      }
      if (call.op === "policy-audit") {
        // 审批历史（八轮 E——store 在 bridge 手里故此拦截）
        const sessionId = deps.host.sessionId;
        const store = deps.store;
        const all = store === undefined ? [] : store.load(sessionId);
        return { entries: buildPolicyAuditEntries(all) };
      }
      // T-P3-140 自检 / T-P3-141 插件主题 CSS / T-P3-143 外部 MCP 扫描（只读）
      if (call.op === "sandbox-doctor") return gateway.sandboxDoctor();
      if (call.op === "plugin-theme-css") return gateway.pluginThemeCss(call.name!);
      if (call.op === "mcp-import-scan") return gateway.mcpImportScan();
      if (call.op === "get") return { settings: await gateway.get() };
      if (call.op === "credentials-set") {
        return { masked: (await gateway.credentialsSet(call.provider!, call.key!)).masked };
      }
      if (call.op === "credentials-delete") {
        return { deleted: (await gateway.credentialsDelete(call.provider!)).deleted };
      }
      if (call.op === "probe") return { health: await gateway.probeProvider(call.provider!) };
      // U17：MCP 连接校验（向导"测连接"——launch 一次握手+列工具）
      if (call.op === "mcp-check") {
        return {
          check: await gateway.mcpCheck({
            name: call.name!,
            command: call.command!,
            ...(Array.isArray(call.args) ? { args: call.args } : {}),
            ...(call.env !== undefined ? { env: call.env } : {}),
            ...(call.timeoutMs !== undefined ? { timeoutMs: call.timeoutMs } : {}),
          }),
        };
      }
      const transferOp = tryTransferSettingsOp(gateway, call, { store: deps.store, sessionId: deps.host.sessionId, ...(deps.sessionsLibrary !== undefined ? { sessionsLibrary: deps.sessionsLibrary } : {}) }); if (transferOp !== undefined) return transferOp; // T-P3-153/154：数据中心族+日志中心族一行收敛（logging fallback 在域文件内）
      // C1：定时任务管理族（调度域——scheduler-ops 模块级运行时句柄）
      const schedulerOp = trySchedulerSettingsOp(call);
      if (schedulerOp !== undefined) return schedulerOp;
      if (call.op === "skills-list") return gateway.skillsList();
      if (call.op === "skill-save") return gateway.skillSave(call.skill!);
      // T-P3-144：技能导入扫描/执行 + 删除/Reveal（护栏与复制在域文件）
      if (call.op === "skill-import-scan") return gateway.skillImportScan();
      if (call.op === "skill-import-apply") return gateway.skillImportApply(call.items!);
      // T-P3-174 批次 4：技能 ZIP 导入（content = zip 字节 base64）
      if (call.op === "skill-import-zip") return gateway.skillZipImport(call.content!);
      if (call.op === "skill-delete") return gateway.skillDelete(call.path!);
      if (call.op === "skill-reveal") return gateway.skillReveal(call.path!);
      if (call.op === "prompts-list") return gateway.promptsList();
      if (call.op === "prompt-save") return gateway.promptSave(call.prompt!);
      if (call.op === "prompt-delete") return gateway.promptDelete(call.path!);
      if (call.op === "prompt-reveal") return gateway.promptReveal(call.path!);
      if (call.op === "prompt-import-scan") return gateway.promptImportScan();
      if (call.op === "prompt-import-apply") return gateway.promptImportApply(call.items!);
      if (call.op === "enhancement-test") return gateway.enhancementTest(call.task as import("./settings-provider-ops.js").EnhancementTestTask);
      if (call.op === "subagents-list") return gateway.subagentsList();
      const instrOp = tryInstructionSettingsOp(gateway, call); // 指令域四 op 收敛（T-P3-151）
      if (instrOp !== undefined) return instrOp;
      if (call.op === "stt-transcribe") return gateway.sttTranscribe({ base64: call.content!, mediaType: call.mediaType! });
      // T-P3-174 批次 6 G1：本地 SenseVoice 状态/下载（进度经 stt-local-status 轮询）
      if (call.op === "stt-local-status") return localSttStatus();
      if (call.op === "stt-local-download") return sttDownloadAll();
      if (call.op === "tts-synthesize") return gateway.ttsSynthesize({ text: call.text! });
      // T-P3-150 项目域八 op 一行收敛（分发面在 settings-project-ops）
      const projectOp = tryProjectSettingsOp(gateway, call);
      if (projectOp !== undefined) return projectOp;
      // T-P3-156 面板域（R/P/T：git 族/终端族/辅助对话历史）
      const panelOp = tryPanelSettingsOp(gateway, call);
      if (panelOp !== undefined) return panelOp;
      if (call.op === "plugins-list") return gateway.pluginsList();
      // T-P3-148：插件/市场族 op 一行收敛（分发在 settings-plugin-ops）
      const pluginOp = tryPluginSettingsOp(gateway, call, deps.reloadNotify);
      if (pluginOp !== undefined) return pluginOp;
      if (call.op === "provider-models" || call.op === "provider-test") {
        const payload = {
          provider: call.provider!,
          baseUrl: call.baseUrl!,
          adapter: call.adapter as "openai" | "openai-responses" | "anthropic" | "google",
          ...(call.headers !== undefined ? { headers: call.headers } : {}),
          ...(call.apiKey !== undefined ? { apiKey: call.apiKey } : {}),
        };
        if (call.op === "provider-models") return gateway.providerModels(payload);
        return gateway.providerTest({ ...payload, modelId: call.modelId! });
      }
      // credentials-list 的历史分发位（op:get 分家后的遗留形状——返回
      // { credentials: [...] }；op 闭集校验在 parse 层，此处可达 = 闭集内
      // 除本行外全部有显式分支）。
      if (call.op === "credentials-list") {
        return { credentials: await gateway.credentialsList() };
      }
      // B3 补口：真正的分发尾 fail-closed（此前这里是无条件兜底——未来
      // 新增 op 漏分发会静默拿到凭据清单且表现为"成功"）。抛类型化错误，
      // 协议层回 ok:false，漏分发立即暴露。
      const unhandled = new Error(
        `settings op "${call.op}" 未被分发（协议闭集与 bridge 分发不同步）`,
      );
      (unhandled as unknown as { code: string }).code = "SETTINGS_OP_UNDISPATCHED";
      throw unhandled;
    },
  };
}
