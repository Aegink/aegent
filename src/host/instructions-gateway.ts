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

import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { builtinRuleMatchers } from "../policy/matchers.js";
import { loadRules, parseRulesText } from "../policy/rule-loader.js";
import { INSTRUCTION_TARGETS, type InstructionTarget } from "./protocol-settings.js";
export { INSTRUCTION_TARGETS, type InstructionTarget };

export interface InstructionPaths {
  readonly project: string;
  readonly global: string;
  readonly rules: string;
  /** T-P3-151 A3：项目层规则文件（<workspace>/.aegent/rules.txt）。 */
  readonly projectRules: string;
  /** T-P3-151 C2：记忆索引（~/.aegent/memory/MEMORY.md）。 */
  readonly memory: string;
}

/** 五文件位定位（workspace 缺席时项目层落 home——保存面同闸拒绝）。 */
export function instructionPaths(workspaceRoot: string | undefined, homeDir: string): InstructionPaths {
  return {
    project: path.join(workspaceRoot ?? homeDir, "AGENTS.md"),
    global: path.join(homeDir, ".aegent", "AGENTS.md"),
    rules: path.join(homeDir, ".aegent", "rules.txt"),
    projectRules: path.join(workspaceRoot ?? homeDir, ".aegent", "rules.txt"),
    memory: path.join(homeDir, ".aegent", "memory", "MEMORY.md"),
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
  /** T-P3-151 A3：项目层规则文件（编辑位补齐）。 */
  projectRules: { path: string; exists: boolean; content: string; issues: { line: number; message: string }[] };
  /** T-P3-151 C2：记忆索引文件位。 */
  memory: { path: string; exists: boolean; content: string };
  /**
   * T-P3-151 A2 装配预览：F2 收集链的真实装载顺序（context/system-prompt.ts
   * ——拼接+就近覆盖；规则两层 agent-child.ts 用户层在前首匹配胜）。chars
   * = UTF-16 码元数（与装配面字符预算同口径）。
   */
  assembly: {
    order: { key: string; path: string; exists: boolean; chars: number }[];
    note: string;
  };
  /**
   * T-P3-151 B1 规则解析产物：两层 rules.txt 逐条展开（raw/action/line/
   * invalid/deny 声明面）+ 宿主内置防护只读清单（policy 链独立环节——
   * 不进 rules 集合，锁标展示）。
   */
  ruleSets: {
    layers: {
      layer: "user" | "project";
      path: string;
      exists: boolean;
      rules: { raw: string; action: string; line?: number; invalid: boolean }[];
      issues: { line: number; message: string }[];
    }[];
    hostProtections: { name: string; description: string }[];
  };
}

/** 宿主内置防护清单（policy 链宿主面——装配在 user 规则集之外的独立环节）。 */
const HOST_PROTECTIONS: { name: string; description: string }[] = [
  { name: "危险命令防护", description: "dangerous-commands——高危命令模式独立拦截（链上硬环节）" },
  { name: "保护路径", description: "protected-paths——敏感路径读写护栏（链上硬环节）" },
  { name: "自防护", description: "self-guard——阻止策略自我修改（链上硬环节）" },
  { name: "计划模式闸", description: "plan-guard——plan 模式下编辑类硬拒（出口级）" },
  { name: "读闸", description: "read-gate——读取边界与 project trust 联动" },
  { name: "默认 ask", description: "无规则命中时落 ask 而非 allow（不变量 3——evaluate.ts defaultAskRule）" },
];

/** 规则文本位展开（B1——loadRules 产物：invalid 标记与行号齐全）。 */
function ruleLayerView(layer: "user" | "project", file: string, exists: boolean, content: string) {
  const parsed = parseRulesText(content);
  const loaded = loadRules(parsed.sources, builtinRuleMatchers);
  return {
    layer,
    path: file,
    exists,
    // 行=装配求值序原样（invalid 行保留在集合里永不命中——qwen 同款）。
    rules: loaded.map((r) => ({
      raw: r.raw,
      action: r.action,
      line: r.line,
      invalid: r.invalid,
    })),
    issues: parsed.issues,
  };
}

/** 指令中心数据面（规则位附 parseRulesText 的逐行 lint issues）。 */
export function listInstructions(paths: InstructionPaths): InstructionsView {
  const project = readSlot(paths.project);
  const global = readSlot(paths.global);
  const rules = readSlot(paths.rules);
  const projectRules = readSlot(paths.projectRules);
  const memory = readSlot(paths.memory);
  const invalidOf = (content: string) =>
    parseRulesText(content).issues;
  return {
    project: { path: paths.project, ...project },
    global: { path: paths.global, ...global },
    rules: { path: paths.rules, ...rules, issues: invalidOf(rules.content) },
    projectRules: {
      path: paths.projectRules,
      ...projectRules,
      issues: invalidOf(projectRules.content),
    },
    memory: { path: paths.memory, ...memory },
    assembly: {
      order: [
        { key: "global-agents", path: paths.global, exists: global.exists, chars: global.content.length },
        { key: "project-agents", path: paths.project, exists: project.exists, chars: project.content.length },
        {
          key: "project-rules",
          path: paths.projectRules,
          exists: projectRules.exists,
          chars: projectRules.content.length,
        },
        { key: "user-rules", path: paths.rules, exists: rules.exists, chars: rules.content.length },
        { key: "memory", path: paths.memory, exists: memory.exists, chars: memory.content.length },
      ],
      note: "装配序 = 全局 AGENTS.md → 项目 AGENTS.md（拼接+就近覆盖）→ 项目规则 → 用户规则（首匹配胜）→ 记忆索引（末层追加）；保存后新会话生效。",
    },
    ruleSets: {
      layers: [
        // 展示序=装配求值序（用户层在前首匹配胜）——与 agent-child.ts 一致。
        ruleLayerView("user", paths.rules, rules.exists, rules.content),
        ruleLayerView("project", paths.projectRules, projectRules.exists, projectRules.content),
      ],
      hostProtections: HOST_PROTECTIONS,
    },
  };
}

/** 指令文件写回（tmp 原子替换——settings/skill-save 同纪律）。 */
export async function saveInstruction(
  paths: InstructionPaths,
  target: InstructionTarget,
  content: string,
): Promise<{ saved: true; path: string }> {
  const targetPath = instructionTargetPath(paths, target);
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp`;
  await writeFile(tmp, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  await rename(tmp, targetPath);
  return { saved: true, path: targetPath };
}

/** target → 磁盘路径收敛（保存/追加/测试共用——新档位只改这一处）。 */
export function instructionTargetPath(paths: InstructionPaths, target: InstructionTarget): string {
  switch (target) {
    case "project-agents":
      return paths.project;
    case "global-agents":
      return paths.global;
    case "project-rules":
      return paths.projectRules;
    case "memory":
      return paths.memory;
    default:
      return paths.rules;
  }
}
