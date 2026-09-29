/**
 * 指令文件面（U24/T-P3-127——settings-gateway 的行数纪律拆分位）：
 * C22 指令/规则文件位的读、写、lint。
 *
 * 三文件位（host 侧路径收敛——写回 target 白名单，防任意文件写）：
 *   - project：`<workspaceRoot>/AGENTS.md`（F2 收集链的项目层）；
 *   - global：`~/.aegent/AGENTS.md`（F2 合并的最远层——装配消费在
 *     context/system-prompt 的 globalAgentsPath）；
 *   - rules：`~/.aegent/rules.txt`（C22 user 档规则——装配消费在
 *     kernel/agent-child-config 的 loadUserRuleSources）。
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseRulesText } from "../policy/rule-loader.js";
import { INSTRUCTION_TARGETS, type InstructionTarget } from "./protocol-settings.js";
export { INSTRUCTION_TARGETS, type InstructionTarget };

export interface InstructionPaths {
  readonly project: string;
  readonly global: string;
  readonly rules: string;
}

/** 三文件位定位（workspace 缺席时项目层落 home——保存面同闸拒绝）。 */
export function instructionPaths(workspaceRoot: string | undefined, homeDir: string): InstructionPaths {
  return {
    project: path.join(workspaceRoot ?? homeDir, "AGENTS.md"),
    global: path.join(homeDir, ".aegent", "AGENTS.md"),
    rules: path.join(homeDir, ".aegent", "rules.txt"),
  };
}

/** 读单个文件位（缺失 = exists:false；读失败如实空串——保存整体覆盖）。 */
function readSlot(file: string): { exists: boolean; content: string } {
  if (!existsSync(file)) return { exists: false, content: "" };
  try {
    return { exists: true, content: readFileSync(file, "utf8") };
  } catch {
    return { exists: true, content: "" };
  }
}

export interface InstructionsView {
  project: { path: string; exists: boolean; content: string };
  global: { path: string; exists: boolean; content: string };
  rules: { path: string; exists: boolean; content: string; issues: { line: number; message: string }[] };
}

/** 指令中心数据面（规则位附 parseRulesText 的逐行 lint issues）。 */
export function listInstructions(paths: InstructionPaths): InstructionsView {
  const project = readSlot(paths.project);
  const global = readSlot(paths.global);
  const rules = readSlot(paths.rules);
  return {
    project: { path: paths.project, ...project },
    global: { path: paths.global, ...global },
    rules: { path: paths.rules, ...rules, issues: parseRulesText(rules.content).issues },
  };
}

/** 指令文件写回（tmp 原子替换——settings/skill-save 同纪律）。 */
export async function saveInstruction(
  paths: InstructionPaths,
  target: InstructionTarget,
  content: string,
): Promise<{ saved: true; path: string }> {
  const targetPath =
    target === "project-agents" ? paths.project : target === "global-agents" ? paths.global : paths.rules;
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp`;
  await writeFile(tmp, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  await rename(tmp, targetPath);
  return { saved: true, path: targetPath };
}
