/**
 * console 重定向（T5-5/§18 进程可诊断原语）：console 全族改写 stderr——
 * process.stdout 只承载协议帧（G8 输出面纪律）。child 入口在 main 前安装；
 * 独立导出供单测（vi.spyOn 面）。
 */

export type ConsoleWrite = (line: string) => void;

/** 安装重定向（幂等守卫——重复安装 no-op，返回 true 表示本次安装）。 */
export function installConsoleRedirect(write: ConsoleWrite): boolean {
  const g = globalThis as { __consoleRedirectInstalled?: boolean };
  if (g.__consoleRedirectInstalled === true) return false;
  g.__consoleRedirectInstalled = true;
  const fmt = (args: unknown[]): string =>
    args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  const emit = (line: string): void => {
    write(line.endsWith("\n") ? line : `${line}\n`);
  };
  console.log = (...args: unknown[]): void => emit(fmt(args));
  console.info = console.log;
  console.warn = (...args: unknown[]): void => emit(`WARN ${fmt(args)}`);
  console.error = (...args: unknown[]): void => emit(`ERROR ${fmt(args)}`);
  return true;
}
