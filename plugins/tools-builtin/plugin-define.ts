/**
 * plugin_define 工具（T-P3-148 X——dsh 动态 cordis 插件的我方位，最小闭环）：
 * agent 现场定义插件（ESM 源码字符串）→ data URL import → loadPlugin（SDK
 * 全量校验）→ 工具登记进 ToolRegistry（`<名>__<工具>` 命名空间）→ 句柄挂
 * 进程收尾。**重启即失**（不落盘——dsh 同语义）；
 * **进程内执行 = 与宿主同等权限，非沙箱**——dsh "API discipline, not a
 * security boundary" 同语义：审批面（C 族，工具调用经权限模式）是唯一闸。
 *
 * 注册条件：装配面在位（agent-process 传 toolRegistry + 动态句柄汇）。
 */

import type { ToolDef } from "../../src/core/index.js";
import { toolError } from "./util.js";
import { loadPlugin, PluginSdkError, type PluginHandle } from "../../src/mcp/plugin-sdk.js";
import { PLUGIN_RUNTIME_CAPABILITIES, registerPluginTools } from "../../src/kernel/plugin-loader.js";
import { PLUGIN_NAME_SHAPE } from "../../src/ext-builtin/plugin-runtime/plugin-manifest-contributes.js";

/** 动态插件源码上限（256KB——现场定义不是应用分发）。 */
const MAX_CODE_BYTES = 256 * 1024;

export function createPluginDefineTool(options: {
  toolRegistry: import("../../src/core/index.js").ToolRegistry;
  handles: { dispose(): Promise<void> }[];
}): ToolDef {
  return {
    name: "plugin_define",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "动态插件名（slug：小写字母数字开头，. - _ 可内用；工具登记名前缀）",
        },
        code: {
          type: "string",
          description:
            "ESM 模块源码（default 导出 AegentPlugin：{ onActivate(caps), onEvent?, onDispose? }）——caps.registerTool 登记、caps.subscribe 订阅、caps.pluginSettings 为空对象",
        },
      },
      required: ["name", "code"],
    },
    async execute(args) {
      const name = args.name;
      const code = args.code;
      if (typeof name !== "string" || !PLUGIN_NAME_SHAPE.test(name)) {
        return toolError("PluginDefineError", "INVALID_ARGUMENTS", `name 须为 slug 形状：${String(name)}`);
      }
      if (typeof code !== "string" || code.trim() === "") {
        return toolError("PluginDefineError", "INVALID_ARGUMENTS", "code 须为非空 ESM 源码字符串");
      }
      if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
        return toolError("PluginDefineError", "TOO_LARGE", `源码超过 ${String(MAX_CODE_BYTES)} 字节上限`);
      }
      const prefix = `${name}__`;
      if (options.toolRegistry.names().some((n) => n.startsWith(prefix))) {
        return toolError("PluginDefineError", "NAME_TAKEN", `动态插件名已被占用：${name}（换名或先重启会话）`);
      }
      let handle: PluginHandle;
      try {
        const module = await import(`data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`);
        const plugin = (module as { default?: unknown }).default;
        if (plugin === null || typeof plugin !== "object") {
          return toolError("PluginDefineError", "BAD_MODULE", "源码必须 default 导出 AegentPlugin 对象");
        }
        // 动态插件清单由工具注入（untrusted + 受控能力闭集——源码不自带清单）
        const manifest = { name, trust: "untrusted", capabilities: ["registerTool", "subscribe"] };
        handle = await loadPlugin(
          { ...(plugin as object), manifest } as Parameters<typeof loadPlugin>[0],
          { availableCapabilities: PLUGIN_RUNTIME_CAPABILITIES },
        );
      } catch (e) {
        const message = e instanceof PluginSdkError || e instanceof Error ? e.message : String(e);
        return toolError("PluginDefineError", "LOAD_REJECTED", `动态插件装载被拒（fail-closed）：${message}`);
      }
      const count = registerPluginTools(options.toolRegistry, name, handle.tools);
      const registeredNames = handle.tools.map((t) => `${name}__${t.def.name}`);
      // dispose 同时回收登记面（unregisterTool——注销面与 SDK 收尾组合）
      options.handles.push({
        dispose: async () => {
          await handle.dispose();
          for (const toolName of registeredNames) options.toolRegistry.unregisterTool(toolName);
        },
      });
      const tools = handle.tools.map((t) => `${name}__${t.def.name}`).join("、");
      return {
        content: [
          `动态插件「${name}」已在本进程内激活（登记 ${String(count)} 个工具：${tools || "无"}）。`,
          "纪律：①重启即失（不落盘、不进 settings.plugins）——需要持久化请用 plugin_create 生成骨架后走插件中心安装；",
          "②代码在本进程内运行（与宿主同等权限，非沙箱）——不要在此定义不受信任来源的代码；",
          "③工具执行照常走会话审批（权限模式面）。",
        ].join("\n"),
      };
    },
  };
}
