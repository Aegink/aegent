/**
 * 进程全局状态隔离（O25，T-P1-38）——"进程全局状态必须有隔离机制，且
 * 注释写明故障机制"（pi-desktop·plugins/tests.rs：`MARKET_ENV_LOCK` 静态锁
 * + RAII 守卫 + `unwrap_or_else(|e| e.into_inner())` 中毒处理 + "The
 * marketplace source is process-global, so two tests … read each other's
 * value" 故障机制注释）。
 *
 * **故障机制**（谁在什么条件下互踩）：`process.env` 与模块级可变缓存是
 * 进程全局——vitest 每文件独立 worker（跨文件天然隔离），但**同一文件内
 * 的测试串行共享同一进程**：测试 A 修改 env（或触热模块级缓存）后测试 B
 * 读到 A 的残留，测试顺序耦合 → 单跑绿全跑红（或反之）。
 *
 * **隔离机制**（四件，pi-desktop 同构）：
 * 1. 串行化锁：`serializeGlobal(name, fn)` 用 promise 链排队——需要独占
 *    全局状态的测试段经它串行，同锁名的段互不重叠；
 * 2. RAII 守卫：`withEnv(vars, fn)` 设置 → fn → finally 恢复快照，fn 崩溃
 *    环境照样还原；
 * 3. 中毒不扩散：锁持有人抛错只影响自己的测试——promise 链在 finally 中
 *    推进下一位，绝不毒化后续测试（对应 pi-desktop 的
 *    `unwrap_or_else(|e| e.into_inner())`：锁中毒取回内部数据继续，不 panic）;
 * 4. 显式重置：模块级缓存暴露 `resetXxxForTests()`（env.ts 的
 *    pwshHostCache 是本仓唯一的进程级可变全局，盘点见 T-P1-38 卡面）。
 *
 * 与单进程假设的冲突面：agent 架构本就多进程（T9 helper/agent-child），
 * 子进程不共享模块状态（天然隔离）；本文件只管"同 worker 进程内"的共享面。
 */

/**
 * 同名锁串行化：promise 链排队（JS 单线程无真并发，链式 enqueue 即串行
 * 语义）。fn 抛错/拒绝时等待中的后续调用照常推进——中毒不扩散。
 */
export function serializeGlobal<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  const chains = (globalChainLocks ??= new Map<string, Promise<unknown>>());
  const prev = chains.get(name) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  // 无论 run 成败，下一个排队者从 undefined 链起步（prev 的失败不再传递）
  chains.set(
    name,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/** 模块级锁表（test-support 自身的状态——键是锁名，值是尾 promise）。 */
let globalChainLocks: Map<string, Promise<unknown>> | undefined;

/**
 * env 段的 RAII 守卫：设置 vars → await fn → finally 恢复原值（未声明的
 * 既有键还原原值，新键删除）。fn 崩溃环境照样还原（中毒不扩散）。
 */
export async function withEnv<T>(
  vars: Readonly<Record<string, string | undefined>>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

/** 串行化 + env 守卫的组合（最常用形态：独占进程环境的测试段）。 */
export function withEnvSerialized<T>(
  vars: Readonly<Record<string, string | undefined>>,
  fn: () => T | Promise<T>,
): Promise<T> {
  return serializeGlobal("process.env", () => withEnv(vars, fn));
}
