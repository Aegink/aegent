/**
 * 指令中心追加/测试 op（T-P3-151 B2/B3/B4/C1 共用数据面——settings-gateway
 * 的行数纪律拆分位，settings-project-ops 同款）：
 *   - instruction-append：规则行/文本段追加写回（B2 新建规则、B4 审批反写、
 *     C1 存为规矩三个 UI 入口收敛到同一落盘闸——dryRun 先推导后确认）；
 *   - instruction-test-rule：规则测试器（B3）——两层规则集真实求值，装配
 *     面（agent-child.ts user→project 首匹配胜）逐条复刻。
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PolicyCall } from "../policy/chain.js";
import type { JsonRecord } from "../kernel/events.js";
import { loadedRuleMatch } from "../policy/rule-match.js";
import { builtinRuleMatchers } from "../policy/matchers.js";
import { loadRules, parseRulesText } from "../policy/rule-loader.js";
import {
  instructionTargetPath,
  listInstructions,
  saveInstruction,
  type InstructionPaths,
  type InstructionTarget,
} from "./instructions-gateway.js";

export type AppendRuleTarget = InstructionTarget;
export type AppendRuleKind = "rule" | "text";

/**
 * 指令域 op 一行分发（bridge 收敛位——tryProjectSettingsOp 同款；gateway
 * 结构化类型内联声明，与 SettingsGateway 接口的方法子集对齐）。
 */
export function tryInstructionSettingsOp(
  gateway: {
    instructionsList(): Promise<unknown>;
    instructionSave(target: InstructionTarget, content: string): Promise<{ saved: true; path: string }>;
    instructionAppend(payload: {
      target: AppendRuleTarget;
      kind: AppendRuleKind;
      content: string;
      dryRun?: boolean;
    }): Promise<unknown>;
    testInstructionRule(payload: { tool: string; ruleArgs?: JsonRecord }): Promise<unknown>;
  },
  call: { op: string; target?: string; content?: string; kind?: string; dryRun?: boolean; tool?: string; ruleArgs?: JsonRecord },
): Promise<unknown> | undefined {
  switch (call.op) {
    case "instructions-list":
      return gateway.instructionsList();
    case "instruction-save":
      return gateway.instructionSave(call.target as InstructionTarget, call.content!);
    case "instruction-append":
      return gateway.instructionAppend({
        target: call.target as AppendRuleTarget,
        kind: call.kind as AppendRuleKind,
        content: call.content!,
        ...(call.dryRun !== undefined ? { dryRun: call.dryRun } : {}),
      });
    case "instruction-test-rule":
      return gateway.testInstructionRule({
        tool: call.tool!,
        ...(call.ruleArgs !== undefined ? { ruleArgs: call.ruleArgs } : {}),
      });
    default:
      return undefined;
  }
}

export interface AppendInstructionResult {
  target: AppendRuleTarget;
  path: string;
  /** 归一后的追加内容（rule 形态 = "raw -> action" 单行）。 */
  line: string;
  exists: boolean;
  /** 目标文件已有同 raw 同 action 的规则行——落盘面拒绝（幂等护栏）。 */
  duplicate: boolean;
  saved?: true;
}

function readTarget(paths: InstructionPaths, target: InstructionTarget): { exists: boolean; content: string } {
  const file = instructionTargetPath(paths, target);
  if (!existsSync(file)) return { exists: false, content: "" };
  try {
    return { exists: true, content: readFileSync(file, "utf8") };
  } catch {
    return { exists: true, content: "" };
  }
}

/** 规则行校验闸：content 须为单行 "规则 -> 动作" 且解析零 issue（B2/B4 同闸）。 */
function normalizeRuleLine(content: string): { line: string; action: string; raw: string } {
  const trimmed = content.trim();
  if (trimmed.includes("\n") || trimmed.includes("\r")) {
    throw new Error("规则行必须单行（多条规则请分多次追加）");
  }
  const parsed = parseRulesText(trimmed);
  if (parsed.issues.length > 0 || parsed.sources.length !== 1) {
    throw new Error(`行不合 "<规则> -> <allow|ask|deny>" 形状：${trimmed.slice(0, 80)}`);
  }
  const source = parsed.sources[0]!;
  return { line: `${source.raw} -> ${source.action}`, action: source.action, raw: source.raw };
}

/**
 * 追加写回（kind=rule 时 raw+action 重复即拒绝——重复规则零信息且让
 * 首匹配语义变得含混；kind=text 原样追加，前置空行分隔）。
 */
export async function appendInstruction(
  paths: InstructionPaths,
  target: AppendRuleTarget,
  kind: AppendRuleKind,
  content: string,
  dryRun: boolean,
): Promise<AppendInstructionResult> {
  const file = instructionTargetPath(paths, target);
  const current = readTarget(paths, target);
  let line: string;
  let duplicate = false;
  if (kind === "rule") {
    // rule 形态只落规则两层（协议层已校验——此处兜底防任意文件追加）。
    if (target !== "user-rules" && target !== "project-rules") {
      throw new Error("kind=rule 只允许追加到规则两层（user-rules|project-rules）");
    }
    const { line: normalized, action, raw } = normalizeRuleLine(content);
    line = normalized;
    const existing = parseRulesText(current.content);
    duplicate = existing.sources.some((s) => s.raw === raw && s.action === action);
  } else {
    line = content.replace(/\r\n/g, "\n").replace(/\n+$/, "");
    if (line.trim() === "") throw new Error("追加内容不能为空白");
  }
  if (dryRun) {
    return { target, path: file, line, exists: current.exists, duplicate };
  }
  if (duplicate) {
    throw new Error(`目标文件已有等价规则行，拒绝重复追加：${line}`);
  }
  const separator = current.content === "" ? "" : "\n";
  const base = current.content === "" ? "" : current.content.endsWith("\n") ? current.content : `${current.content}\n`;
  const next = `${base}${kind === "rule" ? "" : separator}${line}\n`;
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, next, "utf8");
  await rename(tmp, file);
  return { target, path: file, line, exists: true, duplicate: false, saved: true };
}

export interface TestRuleStep {
  layer: "user" | "project";
  path: string;
  /** 该层规则总数（invalid 行在内——永不命中但占集合位）。 */
  total: number;
  matched: boolean;
}

export interface TestRuleResult {
  action: "allow" | "ask" | "deny";
  /** 命中规则证据（C18 同源——verdict.rule 回显形状）；默认 ask 时缺席。 */
  hit?: {
    layer: "user" | "project";
    raw: string;
    line?: number;
    action: "allow" | "ask" | "deny";
  };
  /** 求值链路（装配序：用户层在前首匹配胜）。 */
  steps: TestRuleStep[];
  note: string;
}

/**
 * 规则测试器（B3）：按装配面同构复刻——user 层在前、project 层在后，
 * loadedRuleMatch 逐条求值首命中即返；两层无命中 = 默认 ask（不变量 3）。
 * 与装配面的已知差异：装配面还有宿主独立环节（危险命令/保护路径/self-guard）
 * 在规则集之外——测试器只测 rules.txt 两层，note 里明示这一边界。
 */
export function testInstructionRule(
  paths: InstructionPaths,
  tool: string,
  ruleArgs: JsonRecord | undefined,
): TestRuleResult {
  const call: PolicyCall = { tool, args: ruleArgs ?? {} };
  const match = loadedRuleMatch();
  const userSlot = readTarget(paths, "user-rules");
  const projectSlot = readTarget(paths, "project-rules");
  const layers: { layer: "user" | "project"; path: string; content: string }[] = [
    { layer: "user", path: paths.rules, content: userSlot.content },
    { layer: "project", path: paths.projectRules, content: projectSlot.content },
  ];
  const steps: TestRuleStep[] = [];
  for (const spec of layers) {
    const parsed = parseRulesText(spec.content);
    const loaded = loadRules(parsed.sources, builtinRuleMatchers);
    for (const rule of loaded) {
      if (rule.invalid) continue;
      if (match(rule, call) !== undefined) {
        steps.push({ layer: spec.layer, path: spec.path, total: loaded.length, matched: true });
        return {
          action: rule.action,
          hit: { layer: spec.layer, raw: rule.raw, ...(rule.line !== undefined ? { line: rule.line } : {}), action: rule.action },
          steps,
          note: `命中${spec.layer === "user" ? "用户" : "项目"}层规则（首匹配胜——用户层在前）。宿主独立环节（危险命令/保护路径等）不在本测试范围。`,
        };
      }
    }
    steps.push({ layer: spec.layer, path: spec.path, total: loaded.length, matched: false });
  }
  return {
    action: "ask",
    steps,
    note: "两层规则均未命中——默认 ask（不变量 3：权限默认 ask，白名单是显式例外）。宿主独立环节（危险命令/保护路径等）不在本测试范围。",
  };
}
