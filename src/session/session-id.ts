/**
 * 统一会话 ID（N1/T-P1-110）——会话 id 是跨端寻址的规范形状：各端（CLI/
 * 桌面/Web/端间协议路由）用同一 id 串指向同一会话流（store 键寻址的结构性
 * 事实——同 id 即同会话），本模块补的是缺失的**规范生成点**与**wire 校验面**。
 *
 * 生成 = crypto.randomUUID（v4 全局唯一，自研无上游参考）。校验是**形状
 * 安全校验**而非"必须是 UUID"：fork 的 /fork <新会话id> 允许用户指定任意
 * id（既有面），"s0" 是 mock/测试的脚手架缺省——硬性 UUID 会破坏两者。
 * 校验拦截的是 wire 面的注入与路由混乱（空串/空白/超长/路径形字符），
 * 唯一性由生成点保证、不靠校验强制。
 */

const MAX_SESSION_ID_LENGTH = 128;

/** 生成一枚新会话 id（UUID v4——全局唯一，跨端引用安全）。 */
export function createSessionId(): string {
  return crypto.randomUUID();
}

/**
 * 会话 id 形状校验：非空字符串、≤128 字符、不含空白字符、不以 "." 开头
 * （防 "." / ".." 这类路径形串进文件名/路由面）。合法 ⇔ 可安全用作
 * store 键、子进程参数与端间协议路由段。
 */
export function isValidSessionId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.length > MAX_SESSION_ID_LENGTH) return false;
  if (/\s/.test(value)) return false;
  if (value.startsWith(".")) return false;
  return true;
}

/** 校验失败时的类型化错误（wire 面拒绝——CLI 启动与子进程入口共用）。 */
export class InvalidSessionIdError extends Error {
  readonly code = "INVALID_SESSION_ID";
  constructor(readonly received: string) {
    super(
      `会话 id 不合法：${JSON.stringify(received)}（要求：非空、≤${MAX_SESSION_ID_LENGTH} 字符、不含空白、不以 "." 开头）`,
    );
    this.name = "InvalidSessionIdError";
  }
}
