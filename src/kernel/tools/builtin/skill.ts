/**
 * skill_load 工具（I2 / T-P1-08）——模型按名索要技能正文。清单（名+描述）
 * 在系统提示尾段；正文在模型按名调用本工具时读取（按需加载最小面，不引入
 * F12 检索式延迟加载）。
 *
 * 每次执行重新扫描不缓存——改 SKILL.md 即时生效（registry 描述同纪律）。
 * 读取经 PathGuard（不变量 2：工具不绕过沙箱——技能文件在 workspaceRoot
 * 内，守卫边界覆盖）；未知名返回类型化 SKILL_NOT_FOUND（isError 回喂可自修，
 * 不上抛——注册表错误分层）。
 */

import { PathGuard, PathGuardError } from "../../../sandbox/path-guard.js";
import type { ToolDef } from "../registry.js";
import { toolError } from "./util.js";
import {
  formatSkillInvocation,
  loadSkills,
  skillBody,
} from "../../skills.js";

export function createSkillLoadTool(options: {
  pathGuard: PathGuard;
  skillsRoot: string;
}): ToolDef {
  return {
    name: "skill_load",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "技能名（系统提示「可用技能」清单中的名称）",
        },
      },
      required: ["name"],
    },
    parallel: true, // B17：纯读，声明可并行（parallel 模式持读锁）
    async execute(args) {
      const name = args.name;
      if (typeof name !== "string" || name === "") {
        return toolError(
          "SkillError",
          "INVALID_ARGUMENTS",
          "skill_load 需要 name（非空字符串）",
        );
      }
      const { skills } = loadSkills(options.skillsRoot);
      const skill = skills.find((s) => s.name === name);
      if (!skill) {
        const available = skills.map((s) => s.name).join(", ");
        return toolError(
          "SkillError",
          "SKILL_NOT_FOUND",
          available
            ? `未知技能：${name}（可用：${available}）`
            : `未知技能：${name}（当前无可用技能）`,
        );
      }
      let raw: string;
      try {
        raw = await options.pathGuard.read(skill.filePath);
      } catch (e) {
        if (e instanceof PathGuardError) {
          return toolError("SkillError", e.code, e.message);
        }
        return toolError(
          "SkillError",
          (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
          `读取技能 ${name} 失败：${e instanceof Error ? e.message : String(e)}`,
        );
      }
      return { content: formatSkillInvocation(skill, skillBody(raw)) };
    },
  };
}
