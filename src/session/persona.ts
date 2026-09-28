/**
 * 人格 / agent 预设（I8）——可按会话选预设。取 codex·templates/
 * personalities 的行为："预设 = 系统提示模板 + 会话期选择"（模板文件 +
 * 会话期切换可恢复）；不抄其模板内容（内置两例卡内定形）。
 *
 * 卡内定形（与 J6 换模的差异）：
 * - 选择面 = 每会话粒度（agent-child --persona——每个 agent 子进程一个
 *   会话，"按会话选预设"由此满足）；未提供 = 无人格段，装配零变化。
 * - 落流面 = 人格段拼进系统提示**同一条** system/message（assembly 首落
 *   点——system/message 要求开启的 turn+step，启动期无 turn 归属，独立
 *   落流会违反事件归属纪律）；人格随会话流持久，恢复后自动生效——
 *   codex "resume_with_personality_change" 的对应面。
 * - 无 J6 五态事务的必要：换模有"在途 turn 用捕获值跑完"的生效点问题，
 *   人格是流内叠加宣告（流即状态，不变量 1），落流即生效，无中间半态。
 *   会话期动态切换（REPL /persona 级）需 wire 命令扩展，随需要记档。
 */

/** 一条人格预设：id 是选择键（--persona <id>），模板是系统提示追加段。 */
export interface Persona {
    /** 预设 id（内置闭集内选择；未知 id 类型化拒绝）。 */
    readonly id: string;
    /** 人格名（诊断与展示用）。 */
    readonly name: string;
    /**
     * 系统提示模板：支持 `{{key}}` 占位符（渲染时替换）；模板产出的是
     * 追加到系统提示尾部的独立段落。
     */
    readonly systemPromptTemplate: string;
}

/** 内置两例（内容自定——不取 codex 模板原文）。 */
export const BUILTIN_PERSONAS: readonly Persona[] = [
    {
        id: "default",
        name: "平衡协作",
        systemPromptTemplate: [
            "# 人格：平衡协作（{{workspace}}）",
            "",
            "你以清晰、审慎、可验证为第一优先级：先理解再动手，先结论再细节。",
            "沟通简洁直接，不过度展开；对不确定的事实明说不确定，不编造。",
            "重要决策（删数据、改配置、对外发布）先向用户确认再执行。",
        ].join("\n"),
    },
    {
        id: "coder",
        name: "编码专注",
        systemPromptTemplate: [
            "# 人格：编码专注（{{workspace}}）",
            "",
            "你是深度专注的软件工程师：改动前先读上下文，改动最小化（不做无关",
            "重构与风格噪音）。每一步改动对应可运行的验证；测试先行于修复。",
            "解释代码时贴着具体行说，不给泛泛综述。",
        ].join("\n"),
    },
];

/** 未知预设 / 坏模板的类型化拒绝（fail-closed——选择面错误不静默降级）。 */
export class PersonaError extends Error {
    readonly code: "UNKNOWN_PERSONA" | "BAD_TEMPLATE_VARS";
    constructor(code: "UNKNOWN_PERSONA" | "BAD_TEMPLATE_VARS", message: string) {
        super(message);
        this.name = "PersonaError";
        this.code = code;
    }
}

/**
 * 预设选择：undefined = 未选择（返回 undefined——装配零变化，不注入
 * 任何人格段）；内置 id 命中返回预设；未知 id 类型化拒绝。
 */
export function resolvePersona(id: string | undefined): Persona | undefined {
    if (id === undefined) return undefined;
    const found = BUILTIN_PERSONAS.find((p) => p.id === id);
    if (found === undefined) {
        throw new PersonaError(
            "UNKNOWN_PERSONA",
            `未知人格预设：${id}（可用：${BUILTIN_PERSONAS.map((p) => p.id).join(" | ")}）`,
        );
    }
    return found;
}

/**
 * 模板渲染：`{{key}}` 占位符按 vars 替换；vars 缺 key 保留字面（温和
 * 降级——人格段缺一个变量不应炸装配），多余 vars 忽略。key 只允许
 * 字母/数字/下划线（`{{a.b}}` 等形状视为普通文本，不解析）。
 */
export function renderPersona(
    persona: Persona,
    vars: Readonly<Record<string, string>> = {},
): string {
    return persona.systemPromptTemplate.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
        key in vars ? vars[key]! : match,
    );
}
