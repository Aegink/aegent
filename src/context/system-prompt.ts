/**
 * 系统提示装配（F1/F2，T-7-09）。
 *
 * F1（系统提示管理）：基础提示是**独立可改的文件**（`prompt/base.md`，运行时
 * 读取，已进 copy-assets 清单）——改文件内容即生效，零 .ts diff（pi·packages/ai
 * "提示词独立于内核"包边界的等价落法）。权限段消费 T-6-02 的
 * `renderPermissionsPrompt(tier, {writableRoots})`，可写范围消费
 * `PathGuard.describeWritableRoots()`；**权限档位由装配决定**（on_request =
 * Manual 审批在位 / never = 审批不可用），loop 与内核不感知档位。
 *
 * F2（AGENTS.md 项目指令加载）——**自研语义**（2026-09-25 裁决，非上游照抄）：
 * 从 CWD 向上逐级收集 AGENTS.md 直至 root，按"拼接 + 就近覆盖"合并——
 * Markdown `##` 小节为覆盖单元：同标题小节近层替代远层，其余共存，无标题
 * 前导按远→近拼接。参考回填（执行时定位）：opencode 加载器实现在
 * `oss/opencode/packages/opencode/src/session/instruction.ts`（systemPaths 段的
 * `fs.findUp`），但其语义是"findUp 就近取**一个**、不叠加祖先"（该文件注释：
 * "The first project-level match wins so we don't stack AGENTS.md/CLAUDE.md
 * from every ancestor."）——与本裁决的"收集全部 + 小节覆盖"不同，佐证本文件
 * 是自研语义。
 *
 * 输出顺序：基础提示 → 权限提示 → 项目指令。AGENTS.md 是用户文件：读取失败
 * 的层级跳过（不静默降级主提示面）；基础提示/权限模板是构建产物，缺失即抛
 * （T-6-02 同款纪律）。
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPermissionsPrompt, type ApprovalPromptTier } from "../sandbox/templates.js";

/** 基础提示文件（与模板同款 import.meta.url 定位；dist 下由 copy-assets 保障）。 */
export function basePromptPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "prompt", "base.md");
}

const AGENTS_FILENAME = "AGENTS.md";

// ---------------------------------------------------------------------------
// F2：AGENTS.md 收集与小节合并（自研语义）
// ---------------------------------------------------------------------------

export interface ParsedAgentsDoc {
  /** 无 `##` 标题的前导内容（trim 后；可为空串）。 */
  preamble: string;
  /** 小节：`##` 标题 → 正文（trim 后）。`###` 及更深标题归属其父 `##` 小节。 */
  sections: Map<string, string>;
}

export function parseAgentsDoc(raw: string): ParsedAgentsDoc {
  const lines = raw.split(/\r?\n/);
  const preamble: string[] = [];
  const sections = new Map<string, string>();
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) sections.set(current.title, current.body.join("\n").trim());
      current = { title: m[1]!, body: [] };
      continue;
    }
    if (current) current.body.push(line);
    else preamble.push(line);
  }
  if (current) sections.set(current.title, current.body.join("\n").trim());
  return { preamble: preamble.join("\n").trim(), sections };
}

/**
 * F2 收集器：从 cwd 向上逐级检查 AGENTS.md，返回 [远 → 近] 的文件路径序列
 * （含 root 层）。到 root 即停；cwd 不在 root 之下的越界调用由文件系统根兜底
 * （装配侧负责传对边界）。
 */
export function collectAgentsFiles(
  cwd: string,
  root: string,
  exists: (p: string) => boolean,
): string[] {
  const found: string[] = [];
  let dir = path.resolve(cwd);
  const stop = path.resolve(root);
  for (;;) {
    const candidate = path.join(dir, AGENTS_FILENAME);
    if (exists(candidate)) found.push(candidate);
    if (dir === stop) break;
    const parent = path.dirname(dir);
    if (parent === dir) break; // 文件系统根
    dir = parent;
  }
  return found.reverse();
}

/**
 * F2 合并（就近覆盖）：远 → 近 逐文件解析，同标题小节近层**替代**远层
 * （覆盖单元是小节，不是整个文件——两级的独有小节同时生效）；无标题前导
 * 按远→近顺序拼接。输出纯合并文本（P0 不标注来源层）。
 */
export function mergeAgentsDocs(
  docs: readonly { filepath: string; content: string }[],
): string {
  const preambles: string[] = [];
  const order: string[] = [];
  const sections = new Map<string, string>();
  for (const { filepath, content } of docs) {
    void filepath; // P0 输出不标来源；filepath 保留在签名上供 P1 展示
    const parsed = parseAgentsDoc(content);
    if (parsed.preamble !== "") preambles.push(parsed.preamble);
    for (const [title, body] of parsed.sections) {
      if (!sections.has(title)) order.push(title);
      sections.set(title, body); // 就近覆盖
    }
  }
  const parts: string[] = [];
  if (preambles.length > 0) parts.push(preambles.join("\n\n"));
  for (const title of order) {
    parts.push(`## ${title}\n${sections.get(title)}`);
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

export interface SystemPromptDeps {
  /** 权限提示档位（T-6-02 两档）——由装配决定，loop 不感知。 */
  approvalTier: ApprovalPromptTier;
  /** 可写范围描述来源（PathGuard.describeWritableRoots 注入）。 */
  describeWritableRoots: () => Promise<string>;
  /** AGENTS.md 收集起点（CWD）。 */
  cwd: string;
  /** AGENTS.md 收集边界（缺省文件系统根；生产装配传工作区根）。 */
  root?: string;
  /**
   * 全局指令文件（U24/T-P3-127——`~/.aegent/AGENTS.md`）：作为最远层参与
   * F2 合并（项目层小节就近覆盖全局——合并语义原样）；缺省 undefined =
   * 不加全局层（既有行为零变化）。
   */
  globalAgentsPath?: string;
  /**
   * 技能清单（I2/T-P1-08）：装配侧经 loadSkills 扫描后传入，渲染为尾段
   * （正文按名经 skill_load 工具读取）；空/缺省 = 不加段（零行为变化）。
   */
  skills?: readonly { name: string; description: string }[];
  /**
   * plan 模式启用（G1/T-P1-11）：渲染计划模式机制说明段（工具用法与硬关
   * 语义——模式状态本身经 tool/result 即时可见，本段只说明机制）；缺省
   * 不加段（零行为变化）。
   */
  planMode?: boolean;
  /**
   * 子代理 delegation 声明（H3/T-P1-44）：渲染降级范围声明段——子代理的
   * 权限范围在派发时定死、不可从内部放宽，需审批的操作被自动拒绝。
   * dsh SUBAGENT_DELEGATION_CONTEXT 同构（文案中文化，语义逐句对应）。
   */
  delegation?: boolean;
  /** fs 注入面（测试假 fs；缺省 node:fs 同步读取）。 */
  existsFile?: (p: string) => boolean;
  readFile?: (p: string) => string;
  /** 基础提示覆盖（缺省读 base.md 文件——F1 的"改文件不改代码"通道）。 */
  basePrompt?: string;
}

export async function assembleSystemPrompt(deps: SystemPromptDeps): Promise<string> {
  const exists = deps.existsFile ?? ((p: string) => existsSync(p));
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"));

  // 1. 基础提示（F1：文件是唯一事实源）
  const base = deps.basePrompt ?? readFileSync(basePromptPath(), "utf8");

  // 2. 权限段（T-6-02 模板 × PathGuard 可写范围描述）
  const writableRoots = await deps.describeWritableRoots();
  const permissions = renderPermissionsPrompt(deps.approvalTier, { writableRoots });

  // 3. 项目指令（F2：收集 + 小节就近覆盖；单文件读取失败跳过——用户文件容错）
  const root = deps.root ?? path.parse(path.resolve(deps.cwd)).root;
  const contents: { filepath: string; content: string }[] = [];
  // U24/T-P3-127：全局层（~/.aegent/AGENTS.md）为最远层——unshift 进
  // 收集结果首位（mergeAgentsDocs 的远→近序：项目小节覆盖全局同名小节）。
  if (deps.globalAgentsPath !== undefined && exists(deps.globalAgentsPath)) {
    try {
      contents.unshift({ filepath: deps.globalAgentsPath, content: readFile(deps.globalAgentsPath) });
    } catch {
      // 读失败跳过（用户文件容错——与项目层同纪律）
    }
  }
  for (const filepath of collectAgentsFiles(deps.cwd, root, exists)) {
    try {
      contents.push({ filepath, content: readFile(filepath) });
    } catch {
      // 读不到的层级跳过（存在性检查与读取之间存在竞态/权限差异）
    }
  }
  const agents = mergeAgentsDocs(contents);

  // 4. 技能清单尾段（I2/T-P1-08）：名+描述列给模型，正文按名经 skill_load
  //    读取；空清单不加段。
  const skillsSection = renderSkillsSection(deps.skills);
  // 5. plan 模式机制段（G1/T-P1-11）：启用才渲染（零行为变化）
  const planSection = deps.planMode ? renderPlanSection() : "";

  // 6. 子代理 delegation 声明段（H3/T-P1-44）：子代理装配才渲染
  const delegationSection = deps.delegation ? renderDelegationSection() : "";

  return [base, permissions, agents, planSection, delegationSection, skillsSection]
    .filter((part) => part.trim() !== "")
    .join("\n\n");
}

/**
 * 子代理 delegation 声明（H3/T-P1-44）——dsh SUBAGENT_DELEGATION_CONTEXT
 * 同构中文化（child-agent.ts:172-176 的三句语义逐句对应：范围定死 /
 * 审批自动拒绝 / 不重试而是上报限制）。
 */
function renderDelegationSection(): string {
  return [
    "## 委派子代理声明",
    "你是一个被委派的子代理：你的权限范围在启动时即已固定，",
    "无法从本会话内部放宽——需要审批的操作会被自动拒绝。",
    "当任务需要超出该范围的访问时，不要重试被拒绝的操作；",
    "在回复中说明该限制，由委派你的 agent 处理。",
  ].join("\n");
}

function renderPlanSection(): string {
  return [
    "## 计划模式",
    "对需要先研究设计的多步任务（多文件改动、架构决策、用户要求先出计划），",
    "可先调 plan_enter 进入计划模式：该状态下 write/edit/bash/todo_write 等",
    "写/执行类工具在策略出口被硬关（任何规则都无法授权），read/glob/grep/",
    "skill_load 不受影响。完成研究并给出计划后，调 plan_exit 退出（需用户批准），",
    "写/执行工具恢复按权限策略裁决。当前是否处于计划模式以最近的",
    "plan_enter / plan_exit 工具结果为准。",
  ].join("\n");
}

function renderSkillsSection(
  skills: readonly { name: string; description: string }[] | undefined,
): string {
  if (!skills || skills.length === 0) return "";
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`);
  return [
    "## 可用技能",
    "以下技能可通过 skill_load 工具按名加载正文，先读后按其指引行事：",
    ...lines,
  ].join("\n");
}
