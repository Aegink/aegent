/**
 * settings 读-改-写互斥（D 级债务 8 清偿）——loadSettings→merge→saveSettings
 * 的 await 间隙是丢更新窗口：两个并发段级补丁各带对方没有的段，后写整份
 * 覆盖先写（先写的段蒸发）。模块级 promise 链把全部 RMW 事务串行化——
 * saveSettings 本身 tmp+rename 原子单写，缺的是"读-改-写"的事务边界。
 *
 * 防线边界：仅进程内（settings 单一事实源 = 本机单 host 进程，跨进程并发
 * 不在本防线内——双 host 是 HostRegistry 的类型化拒绝面）。
 */

let tail: Promise<unknown> = Promise.resolve();

/** 串行执行一个 settings 读-改-写事务：前序事务（含失败者）完成后再跑。 */
export function withSettingsRmw<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
