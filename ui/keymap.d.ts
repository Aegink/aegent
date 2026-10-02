/**
 * ui/keymap.js 的类型声明（U25/T-P3-128——src 侧测试直测纯逻辑模块的
 * 声明面；键位注册表行为语义见 keymap.js 头注）。
 */

/** 默认键位表（action → combo 规范串）。 */
export declare const DEFAULT_KEYMAP: Record<string, string>;

/** action 的中文说明（清单展示面）。 */
export declare const ACTION_LABELS: Record<string, string>;

/** 动作注册表元数据（T-P3-152：label/group/default/fixed）。 */
export interface ActionDef {
  label: string;
  group: string;
  default: string;
  fixed?: boolean;
}

export declare const ACTIONS: Record<string, ActionDef>;

/** 动作分组序（清单渲染顺序）。 */
export declare const ACTION_GROUPS: readonly string[];

/** 作用域派生：键位带修饰键或为 Escape → 输入框焦点内可达。 */
export declare function usableInInput(combo: string): boolean;

/** 浏览器/宿主常见保留键（提示不拦截——卡内定形）。 */
export declare const RESERVED_COMBOS: Set<string>;

/** KeyboardEvent 形状子集（纯逻辑只读五字段——测试假件同形状）。 */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** KeyboardEvent → 规范 combo 串；纯修饰键返回 null。 */
export declare function eventToCombo(e: KeyLike): string | null;

/** 组合串解析（修饰键归一排序）。 */
export declare function formatCombo(parts: readonly string[]): string;

/** 冲突检测：注册表内冲突 + 保留键提示（提示不拦截）。 */
export declare function detectConflict(
  combo: string,
  bindings: Readonly<Record<string, string>>,
  selfAction: string,
): { conflict?: string; reserved?: boolean };

/** 键位表合并（settings.shortcuts 部分覆盖；非法覆盖值忽略）。 */
export declare function createKeymap(
  overrides: Readonly<Record<string, string>> | null | undefined,
): Record<string, string>;

/** 事件分发：命中返回 action；输入区语义见实现头注。 */
export declare function resolveAction(
  bindings: Readonly<Record<string, string>>,
  e: KeyLike,
  options?: { inInput?: boolean },
): string | null;
