/**
 * plugin_create 工具（T-P3-148 I——zcode plugin-creator 的"agent 调用工具
 * 创建插件"我方位）：agent 按四模板生成插件骨架（scaffoldPlugin 纯函数）
 * + 一键登记本地 dev 市场（upsertDevMarketplace），生成后**不自动装载**——
 * 装载走插件中心审批链（pi pluginCreateFromTemplate 同语义），工具回执里
 * 写明下一步（用户在插件中心确认安装）。
 *
 * 写面收敛：目标目录固定 `<workspaceRoot>/plugins/<slug>`（工作区内、
 * scaffold 拒绝非空目录）——不做任意目录写。
 */

import path from "node:path";

import type { ToolDef } from "../registry.js";
import { toolError } from "./util.js";
import {
  PLUGIN_TEMPLATE_IDS,
  PLUGIN_TEMPLATE_LABELS,
  scaffoldPlugin,
  upsertDevMarketplace,
  type PluginTemplateId,
} from "../../plugin-scaffold.js";

export function createPluginCreateTool(options: { workspaceRoot: string }): ToolDef {
  return {
    name: "plugin_create",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "插件名（slug：小写字母数字开头，. - _ 可内用；同时是目录名）",
        },
        template: {
          type: "string",
          description: `模板：${PLUGIN_TEMPLATE_IDS.join(" | ")}（${Object.values(PLUGIN_TEMPLATE_LABELS).join("；")}）`,
        },
        description: {
          type: "string",
          description: "插件一句话描述（进清单与 README）",
        },
      },
      required: ["name", "template"],
    },
    async execute(args) {
      const name = args.name;
      const template = args.template;
      if (typeof name !== "string" || name === "" || typeof template !== "string") {
        return toolError("PluginCreateError", "INVALID_ARGUMENTS", "plugin_create 需要 name（slug）与 template（非空字符串）");
      }
      if (!(PLUGIN_TEMPLATE_IDS as readonly string[]).includes(template)) {
        return toolError(
          "PluginCreateError",
          "INVALID_ARGUMENTS",
          `template 非法：${template}（合法：${PLUGIN_TEMPLATE_IDS.join(" | ")}）`,
        );
      }
      const targetDir = path.join(options.workspaceRoot, "plugins", name);
      try {
        const scaffolded = scaffoldPlugin({
          slug: name,
          template: template as PluginTemplateId,
          targetDir,
          ...(typeof args.description === "string" ? { description: args.description } : {}),
        });
        const market = upsertDevMarketplace({
          workspaceRoot: options.workspaceRoot,
          name,
          dir: scaffolded.dir,
          version: String(scaffolded.manifest.version ?? "0.0.0"),
          ...(typeof args.description === "string" ? { description: args.description } : {}),
        });
        const lines = [
          `插件骨架已生成：${scaffolded.dir}`,
          `文件：${scaffolded.files.join("、")}`,
          `已登记本地 dev 市场：${market.marketplacePath}（市场名 ${market.marketplaceName}）`,
          "",
          "下一步（不要自行装载）：",
          "1. 按需修改生成的 plugin.json / 入口 / 资源文件（改文件即可——重跑本工具会因目录非空被拒）。",
          "2. 告知用户到「插件中心 → 安装插件」用本目录绝对路径安装（走审批确认）。",
          "3. 未确认安装前插件不生效；如实交付生成路径与待办，不谎报已装。",
        ];
        return { content: lines.join("\n") };
      } catch (e) {
        return toolError(
          "PluginCreateError",
          "SCAFFOLD_REJECTED",
          e instanceof Error ? e.message : String(e),
        );
      }
    },
  };
}
