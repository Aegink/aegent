/**
 * settings 信封域（U14/T-P3-103；U22/T-P3-125 拆分）——端 → host settings
 * 直答信封的形状与严格校验。独立成域文件是行数纪律的拆分位：settings op
 * 闭集持续扩张（U17 mcp-check / U20 import / U22 技能管理），集中在一处
 * 收拢类型与 parse，protocol.ts 只留回调签名、protocol-parse.ts 只留分派。
 *
 * 分层分工不变：本文件（parse 层）只管信封形状（op 闭集 + 载荷类型）；
 * 业务规则（段白名单、名称冲突、技能字节上限）在 gateway 层。
 */

// 本文件不 import bounded：错误消息的有界转写统一在 protocol.ts 的
// catch 层（parse 层抛原文，转写面单点）。

/** settings 直答 op 闭集（与 bridge 分流一一对应）。 */
export type SettingsOp =
  | "get"
  | "update"
  | "credentials-set"
  | "credentials-delete"
  | "credentials-list"
  | "probe"
  | "session-delete"
  | "mcp-check"
  | "import"
  /** U22/T-P3-125：技能清单（多根扫描 + 停用过滤——管理页数据面）。 */
  | "skills-list"
  /** U22/T-P3-125：技能编辑器写回（新建/编辑——写 workspace 技能目录）。 */
  | "skill-save"
  /** U23/T-P3-126：子代理管理页清单（内置五预设 + 用户自定义分区）。 */
  | "subagents-list";

/** 技能编辑器写回载荷（op=skill-save；frontmatter + 正文的一次性形状）。 */
export interface SkillSavePayload {
  /** 技能名 = 目录名（slug：小写字母数字开头，`. - _` 可内用；防路径穿越）。 */
  readonly name: string;
  readonly description: string;
  /** SKILL.md 正文（frontmatter 之后的部分）。 */
  readonly body: string;
  /** 技能声明的工作工具集（可选——frontmatter `tools:` 行）。 */
  readonly tools?: readonly string[];
}

/** settings 信封 call 形状（HostServerOptions.onSettings 的入参类型）。 */
export type SettingsCall = {
  op: SettingsOp;
  patch?: Record<string, unknown>;
  /** op=import：配置包内的 settings 段（U20——形状校验在 gateway）。 */
  settings?: Record<string, unknown>;
  provider?: string;
  key?: string;
  /** op=session-delete：目标会话 id（U3 删除入口的 wire 面）。 */
  sessionId?: string;
  /** op=mcp-check：连接校验目标（U17——McpServerEntry 形状）。 */
  name?: string;
  command?: string;
  args?: string[];
  /** op=skill-save：技能编辑器写回载荷（U22）。 */
  skill?: SkillSavePayload;
};

/** 技能名 slug 规则（U22——目录名安全面：小写字母数字开头，禁 `..`）。 */
const SKILL_SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** 解析 settings 信封（op 闭集 + 各 op 载荷形状——坏形状整信封拒绝）。 */
export function parseSettingsEnvelope(record: Record<string, unknown>): SettingsCall {
  const unknownKey = rejectUnknownKeys(record, [
    "type",
    "requestId",
    "op",
    "patch",
    "provider",
    "key",
    "sessionId",
    "name",
    "command",
    "args",
    "settings",
    "skill",
  ]);
  if (unknownKey) throw new Error(`settings 信封${unknownKey}`);
  if (typeof record["requestId"] !== "string" || record["requestId"] === "") {
    throw new Error("settings 需要 requestId 非空字符串");
  }
  const op = record["op"];
  if (
    op !== "get" &&
    op !== "update" &&
    op !== "credentials-set" &&
    op !== "credentials-delete" &&
    op !== "credentials-list" &&
    op !== "probe" &&
    op !== "session-delete" &&
    op !== "mcp-check" &&
    op !== "import" &&
    op !== "skills-list" &&
    op !== "skill-save" &&
    op !== "subagents-list"
  ) {
    throw new Error(
      `settings 的 op 非法：${String(op)}（合法：get|update|credentials-set|credentials-delete|credentials-list|probe|session-delete|mcp-check|import|skills-list|skill-save|subagents-list）`,
    );
  }
  if (op === "update") {
    if (record["patch"] === null || typeof record["patch"] !== "object" || Array.isArray(record["patch"])) {
      throw new Error("settings op=update 需要 patch 对象");
    }
    // 段白名单在 gateway 层（applySettingsPatch——业务规则回类型化
    // SETTINGS_PATCH_SECTION_UNKNOWN；parse 层只管信封形状）
  }
  if (op === "credentials-set") {
    if (typeof record["provider"] !== "string" || record["provider"] === "") {
      throw new Error("settings op=credentials-set 需要 provider 非空字符串");
    }
    if (typeof record["key"] !== "string" || record["key"] === "") {
      throw new Error("settings op=credentials-set 需要 key 非空字符串");
    }
  }
  if (op === "credentials-delete" || op === "probe") {
    if (typeof record["provider"] !== "string" || record["provider"] === "") {
      throw new Error(`settings op=${op} 需要 provider 非空字符串`);
    }
  }
  if (op === "session-delete") {
    if (typeof record["sessionId"] !== "string" || record["sessionId"] === "") {
      throw new Error("settings op=session-delete 需要 sessionId 非空字符串");
    }
  }
  // U17/T-P3-119：mcp-check 的载荷 = name/command/args（McpServerEntry 形状
  // ——名字规则与 args 类型在 parse 层即校验，连接失败在 gateway 层转回执）
  if (op === "mcp-check") {
    if (typeof record["name"] !== "string" || record["name"] === "" || record["name"].includes("__")) {
      throw new Error("settings op=mcp-check 需要 name（非空且不含 \"__\"）");
    }
    if (typeof record["command"] !== "string" || record["command"] === "") {
      throw new Error("settings op=mcp-check 需要 command 非空字符串");
    }
    if (
      record["args"] !== undefined &&
      (!Array.isArray(record["args"]) || record["args"].some((a) => typeof a !== "string"))
    ) {
      throw new Error("settings op=mcp-check 的 args 须为字符串数组");
    }
  }
  // U20/T-P3-122：import 的载荷 = 配置包内 settings 对象（形状校验在
  // gateway 落盘前——parse 层只管"必须是对象"）
  if (op === "import") {
    const st = record["settings"];
    if (st === null || typeof st !== "object" || Array.isArray(st)) {
      throw new Error("settings op=import 需要 settings 对象（配置包内的 settings 段）");
    }
  }
  // U22/T-P3-125：skill-save 的载荷 = skill 对象（编辑器四字段——slug 与
  // 字节上限的业务校验在 gateway 层，parse 层只管形状）
  if (op === "skill-save") {
    const sk = record["skill"];
    if (sk === null || typeof sk !== "object" || Array.isArray(sk)) {
      throw new Error("settings op=skill-save 需要 skill 对象");
    }
    const s = sk as Record<string, unknown>;
    if (typeof s["name"] !== "string" || !SKILL_SLUG_RE.test(s["name"]) || s["name"].includes("..")) {
      throw new Error("settings op=skill-save 的 skill.name 须为 slug 形状（小写字母数字开头，. - _ 可内用）");
    }
    if (typeof s["description"] !== "string" || s["description"].trim() === "") {
      throw new Error("settings op=skill-save 的 skill.description 须为非空字符串");
    }
    if (typeof s["body"] !== "string" || s["body"].trim() === "") {
      throw new Error("settings op=skill-save 的 skill.body 须为非空字符串");
    }
    if (
      s["tools"] !== undefined &&
      (!Array.isArray(s["tools"]) || s["tools"].some((t) => typeof t !== "string" || t === ""))
    ) {
      throw new Error("settings op=skill-save 的 skill.tools 须为非空字符串数组");
    }
  }
  return {
    op,
    ...(record["patch"] !== undefined ? { patch: record["patch"] as Record<string, unknown> } : {}),
    ...(record["settings"] !== undefined && typeof record["settings"] === "object" && !Array.isArray(record["settings"])
      ? { settings: record["settings"] as Record<string, unknown> }
      : {}),
    ...(typeof record["provider"] === "string" ? { provider: record["provider"] } : {}),
    ...(typeof record["key"] === "string" ? { key: record["key"] } : {}),
    ...(typeof record["sessionId"] === "string" ? { sessionId: record["sessionId"] } : {}),
    ...(typeof record["name"] === "string" ? { name: record["name"] } : {}),
    ...(typeof record["command"] === "string" ? { command: record["command"] } : {}),
    ...(Array.isArray(record["args"]) ? { args: record["args"] as string[] } : {}),
    ...(record["skill"] !== undefined && typeof record["skill"] === "object" && !Array.isArray(record["skill"])
      ? { skill: record["skill"] as unknown as SkillSavePayload }
      : {}),
  };
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return `未知属性 "${key}"`;
  }
  return null;
}
