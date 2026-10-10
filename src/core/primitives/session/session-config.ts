/**
 * 会话配置分层（B21/T-P1-63）——"可热刷新字段 vs 会话内静态设置"两类
 * 分法（codex session/tests.rs 的 refresh_runtime_config 语义：热刷新更新
 * 白名单字段、**会话内静态设置被保持**）。
 *
 * 两类闭集：
 *   - **可热刷新**（REFRESHABLE_CONFIG_KEYS 白名单）：运行面参数——审批
 *     答复上界、队列上限（均为既有装配可配项的运行时面）。经显式刷新
 *     通道（协议命令 config/refresh）生效，生效即观测（getter 面读取）。
 *   - **静态**：模型身份、权限规则、工具清单、沙箱配置等会话构造时捕获
 *     的决策——**刷新载荷出现任何非白名单键 → 整包类型化拒绝**（fail-
 *     closed：部分应用会让人"以为刷新成功了"；codex 同款断言 model 等
 *     静态字段在刷新后不动）。
 *
 * 生效点语义（与 J7 capturedModel 同构）：refresh 立即更新 store 内部值、
 * **在途 turn 不受影响**（在途消费方持旧值），新构造/新调用读新值。
 */

import type { JsonRecord } from "../../skeleton/events.js";
import type { SandboxMode } from "../../index.js";

/**
 * 权限预设目录（C8，T-P1-73）——**闭集**：readonly / workspace / yolo。
 * 每预设 = 成套 knob 值的命名记录（dsh·permission-presets 同构："预设是
 * 命名记录、切换是逐 knob 写入、执行面读折叠值"）；applyPreset 经既有
 * refresh 通道写入（不新增第二配置来源）。当前预设 knob = sandboxMode
 * （权限预设的语义核心——dsh 同款 knob；其 approvalPolicy 无我方对应
 * 执行面，审批默认 ask 是不变量 3）。sandboxMode 是**观测面 knob**：
 * 预设切换更新 store 值，消费面（bash bashSandbox.defaultMode 构造定死）
 * 的动态读随消费面接线批次落（T-P1-63 偏离③同款记档）。
 */
export const PERMISSION_PRESETS = {
  readonly: { label: "只读（沙箱地板模式）", values: { sandboxMode: "read-only" } },
  workspace: { label: "工作区写入（缺省权限面）", values: { sandboxMode: "workspace-write" } },
  yolo: { label: "全自动（最宽沙箱模式）", values: { sandboxMode: "danger-full-access" } },
} as const satisfies Record<string, { label: string; values: { sandboxMode: SandboxMode } }>;

export type PermissionPresetName = keyof typeof PERMISSION_PRESETS;

export const UNKNOWN_PRESET = "UNKNOWN_PRESET";

export class UnknownPresetError extends Error {
  override readonly name = "UnknownPresetError";
  readonly code = UNKNOWN_PRESET;
  constructor(readonly preset: string) {
    super(
      `未知权限预设 "${preset}"（可用：${Object.keys(PERMISSION_PRESETS).join("/")}）`,
    );
  }
}

/**
 * 权限模式五档（T-P3-137 八轮 A——用户裁决"权限档全面参考参考项目"；参考
 * agentscope 五档/pi-desktop 全局+会话双层/kimi 三档/qwen yolo 归一）。
 * 每模式 = 成套 knob 值（C8 "预设是命名记录、切换是逐 knob 写入"同构），
 * 经既有 refresh 通道写入（applyPermissionMode）——不新增第二配置来源。
 *
 * | 模式 | approvalMode | unattended | sandboxMode | 语义 |
 * | --- | --- | --- | --- | --- |
 * | ask | ask-all | false | — | 每次询问（默认，最安全） |
 * | accept-edits | accept-edits | false | — | 编辑类工具自动放行，其余照问 |
 * | read-only | read-only | false | read-only | 写类调用拒绝（探索/规划） |
 * | auto | auto | false | danger-full-access | 全自动（仍拦 deny 规则与内置保护） |
 * | unattended | ask-all | **true** | — | 无人值守：ask 全转 deny（C33 优先） |
 */
export const PERMISSION_MODES_DIRECTORY = {
  ask: { label: "每次询问（默认）", values: { approvalMode: "ask-all", unattended: false } },
  "accept-edits": {
    label: "自动批编辑",
    values: { approvalMode: "accept-edits", unattended: false },
  },
  "read-only": {
    label: "只读",
    values: { approvalMode: "read-only", sandboxMode: "read-only", unattended: false },
  },
  auto: {
    label: "全自动",
    values: { approvalMode: "auto", sandboxMode: "danger-full-access", unattended: false },
  },
  unattended: { label: "无人值守（询问转拒绝）", values: { approvalMode: "ask-all", unattended: true } },
} as const satisfies Record<string, { label: string; values: { approvalMode: ApprovalMode; unattended: boolean; sandboxMode?: SandboxMode } }>;

export type PermissionModeName = keyof typeof PERMISSION_MODES_DIRECTORY;

/** 可热刷新字段白名单（闭集，冻结只追加——C10 先例）。 */
export const REFRESHABLE_CONFIG_KEYS = [
  "approvalTimeoutMs",
  "queueMaxSize",
  "sandboxMode",
  "unattended",
  "approvalMode",
] as const;

export type RefreshableConfigKey = (typeof REFRESHABLE_CONFIG_KEYS)[number];

export const STATIC_CONFIG_IMMUTABLE = "STATIC_CONFIG_IMMUTABLE";

export class StaticConfigImmutableError extends Error {
  override readonly name = "StaticConfigImmutableError";
  readonly code = STATIC_CONFIG_IMMUTABLE;
  constructor(readonly key: string) {
    super(
      `配置键 "${key}" 是会话内静态设置，不可热刷新（B21：热刷新只作用于白名单 ${REFRESHABLE_CONFIG_KEYS.join("/")}）`,
    );
  }
}

/** 审批模式 knob 闭集（T-P3-137 八轮 A——gate ask 分支映射的消费值）。 */
export const APPROVAL_MODES = ["ask-all", "accept-edits", "read-only", "auto"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export interface SessionConfigValues {
  /** 审批答复上界（毫秒）——question/escalation 等审批通道的等待上界。 */
  approvalTimeoutMs?: number;
  /** 输入队列上限（条）——PromptQueue maxSize 同语义。 */
  queueMaxSize?: number;
  /** 沙箱模式（C8 观测面 knob）——预设切换的目标值；消费面动态读随接线批次。 */
  sandboxMode?: SandboxMode;
  /** C33 无人值守（T-P1-77）：true 时 gate 把每一个 ask/abstain 转为 deny
   * （保留检测只改结局——agentscope DONT_ASK 语义）。缺省 undefined = 零行为变化。 */
  unattended?: boolean;
  /** T-P3-137 八轮 A：审批模式 knob——gate ask 分支映射：auto=放行、
   * read-only=写类拒绝、accept-edits=编辑类放行、ask-all=落 broker。
   * unattended=true 时优先于本值（无人值守最高优先）。 */
  approvalMode?: ApprovalMode;
}

export interface SessionConfigStoreOptions {
  /** C8 预设切换留痕（logger.info）；缺省不留。 */
  onInfo?: (message: string) => void;
}

export class SessionConfigStore {
  private values: {
    approvalTimeoutMs: number | undefined;
    queueMaxSize: number | undefined;
    sandboxMode: SandboxMode | undefined;
    unattended: boolean | undefined;
    approvalMode: ApprovalMode | undefined;
  };

  constructor(
    private readonly sessionId: string,
    initial?: SessionConfigValues,
    private readonly options?: SessionConfigStoreOptions,
  ) {
    this.values = {
      approvalTimeoutMs: initial?.approvalTimeoutMs,
      queueMaxSize: initial?.queueMaxSize,
      sandboxMode: initial?.sandboxMode,
      unattended: initial?.unattended,
      approvalMode: initial?.approvalMode,
    };
  }

  get approvalTimeoutMs(): number | undefined {
    return this.values.approvalTimeoutMs;
  }

  get queueMaxSize(): number | undefined {
    return this.values.queueMaxSize;
  }

  get sandboxMode(): SandboxMode | undefined {
    return this.values.sandboxMode;
  }

  /** C33 无人值守开关（活查询消费面——gate 每调用读当前值）。 */
  get unattended(): boolean | undefined {
    return this.values.unattended;
  }

  /** T-P3-137 八轮 A：审批模式 knob（gate ask 分支活查询消费面）。 */
  get approvalMode(): ApprovalMode | undefined {
    return this.values.approvalMode;
  }

  /**
   * 热刷新（F30/T-P1-105 两段式——fail-safe 方向）：**先全量校验**（键合法
   * 性 + 每键值类型）**后统一应用**——任何错误零应用（"解析失败保留上一份
   * 配置，绝不回退默认"；codex session/tests.rs keeps_previous_config 同构）。
   * 非白名单键整包拒绝；值类型错同样整包拒绝——修复旧实现"按补丁序逐键
   * 应用、前序合法键先落"的顺序依赖部分应用缺口（`{queueMaxSize:5,
   * approvalTimeoutMs:-1}` 曾部分生效，与"零应用"承诺不符）。
   */
  refresh(patch: JsonRecord): { applied: RefreshableConfigKey[] } {
    const keys = Object.keys(patch);
    const illegal = keys.filter(
      (k) => !(REFRESHABLE_CONFIG_KEYS as readonly string[]).includes(k),
    );
    if (illegal.length > 0) {
      throw new StaticConfigImmutableError(illegal[0] as string);
    }
    // 第一段：全量校验（任何键值非法 → 整包拒绝，零写入）
    const validated: Array<[RefreshableConfigKey, unknown]> = [];
    for (const key of keys) {
      const value = patch[key];
      const valid =
        (key === "approvalTimeoutMs" && typeof value === "number" && Number.isFinite(value) && value > 0) ||
        (key === "queueMaxSize" && typeof value === "number" && Number.isInteger(value) && value > 0) ||
        (key === "sandboxMode" &&
          typeof value === "string" &&
          (["read-only", "workspace-write", "danger-full-access"] as const satisfies readonly SandboxMode[]).includes(
            value as SandboxMode,
          )) ||
        (key === "unattended" && typeof value === "boolean") ||
        (key === "approvalMode" && typeof value === "string" && (APPROVAL_MODES as readonly string[]).includes(value));
      if (!valid) {
        throw new StaticConfigImmutableError(key);
      }
      validated.push([key as RefreshableConfigKey, value]);
    }
    // 第二段：统一应用（校验已通过——此段不再有失败路径）
    const applied: RefreshableConfigKey[] = [];
    for (const [key, value] of validated) {
      if (key === "approvalTimeoutMs") {
        this.values.approvalTimeoutMs = value as number;
      } else if (key === "queueMaxSize") {
        this.values.queueMaxSize = value as number;
      } else if (key === "sandboxMode") {
        this.values.sandboxMode = value as SandboxMode;
      } else if (key === "unattended") {
        this.values.unattended = value as boolean;
      } else if (key === "approvalMode") {
        this.values.approvalMode = value as ApprovalMode;
      }
      applied.push(key);
    }
    return { applied };
  }

  /**
   * 权限预设成套切换（C8，T-P1-73）：**经既有 refresh 通道**逐 knob 写入
   * 预设记录的全部 knob 值（不新增第二配置来源；切换是 refresh 语义——
   * 不触碰静态键，在途 turn 不受影响）。未知预设名类型化拒绝（零写入）。
   * 切换经 onInfo 留痕（"预设事件保留用户意图"——两个预设共享同一名值
   * 束时，记录的是用户选择的名字）。
   */
  applyPreset(name: PermissionPresetName | string): { applied: RefreshableConfigKey[] } {
    const preset = (PERMISSION_PRESETS as Record<string, { label: string; values: JsonRecord }>)[
      name
    ];
    if (preset === undefined) {
      throw new UnknownPresetError(name);
    }
    const result = this.refresh({ ...preset.values });
    this.options?.onInfo?.(
      `权限预设切换 [${this.sessionId}]：${String(name)}（${preset.label}）→ 生效 ${result.applied.join("/")}`,
    );
    return result;
  }

  /**
   * 权限模式成套切换（T-P3-137 八轮 A）：语义同 applyPreset（C8 机制——
   * 经既有 refresh 通道逐 knob 写入；在途 turn 不受影响）。未知模式类型化
   * 拒绝（零写入）；切换经 onInfo 留痕。
   */
  applyPermissionMode(name: PermissionModeName | string): { applied: RefreshableConfigKey[] } {
    const mode = (PERMISSION_MODES_DIRECTORY as Record<string, { label: string; values: JsonRecord }>)[
      name
    ];
    if (mode === undefined) {
      throw new UnknownPresetError(name);
    }
    const result = this.refresh({ ...mode.values });
    this.options?.onInfo?.(
      `权限模式切换 [${this.sessionId}]：${String(name)}（${mode.label}）→ 生效 ${result.applied.join("/")}`,
    );
    return result;
  }
}
