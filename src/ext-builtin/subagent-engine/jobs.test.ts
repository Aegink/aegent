import { describe, expect, it } from "vitest";
import { isTerminal, JobRegistry, UnknownJobError, type JobRunContext } from "../../kernel/jobs.js";

/** 受控 deferred：测试精确控制执行体何时结束（消固定 sleep 竞态——T-5-05 先例）。 */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 轮询等待（超时抛错），避免固定 sleep 的竞态。 */
async function pollUntil<T>(probe: () => T, matches: (v: T) => boolean, timeoutMs = 1000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (matches(value)) return value;
    if (Date.now() > deadline) throw new Error(`pollUntil 超时：${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("JobRegistry（M1 后台 job + M2 状态可查可取消）", () => {
  it("start 即返回 id、执行体后台跑完——调用路径零阻塞（M1）", async () => {
    const registry = new JobRegistry();
    const gate = deferred();
    let finished = false;
    const id = registry.start({
      kind: "index",
      run: async () => {
        await gate.promise;
        finished = true;
      },
    });
    // start 返回时执行体还没跑完——不阻塞（同步返回后的当下断言）。
    expect(id).toBe("index-1");
    expect(finished).toBe(false);
    gate.resolve();
    await registry.wait(id, 500);
    expect(finished).toBe(true);
  });

  it("list/get 状态可查：running → completed 迁移与视图字段（M2）", async () => {
    const registry = new JobRegistry();
    const gate = deferred();
    const id = registry.start({
      kind: "rebuild",
      run: async () => {
        await gate.promise;
      },
    });
    expect(registry.get(id).status).toBe("running");
    expect(registry.get(id).kind).toBe("rebuild");
    expect(registry.list()).toHaveLength(1);
    gate.resolve();
    const settled = await registry.wait(id, 500);
    expect(settled.status).toBe("completed");
    // 同毫秒内结算合法（settledAt >= createdAt；严格大于会同毫秒 flaky）。
    expect(settled.settledAt).toBeGreaterThanOrEqual(settled.createdAt);
    expect(isTerminal(settled.status)).toBe(true);
  });

  it("read 游标增量消费 + ring 有界 lossy 标记", () => {
    const registry = new JobRegistry({ maxRingBytes: 64 });
    const emitBox: { emit: JobRunContext["emit"] } = { emit: () => {} };
    const id = registry.start({
      kind: "log",
      run: async (ctx) => {
        emitBox.emit = ctx.emit;
      },
    });
    // 产出 10 条 ×16 字节 = 160 字节 > 64 上限 → ring 只保尾部。
    for (let i = 1; i <= 10; i += 1) {
      emitBox.emit("stdout", `chunk-${String(i).padStart(2, "0")}!`);
    }
    const first = registry.read(id);
    expect(first.lossy).toBe(true); // 前缀被有界丢弃
    expect(first.chunks.length).toBeLessThan(10);
    expect(first.chunks.at(-1)?.text).toBe("chunk-10!");
    // 第二次 read：游标已到尾，无增量、无新丢弃。
    const second = registry.read(id);
    expect(second.chunks).toHaveLength(0);
    expect(second.lossy).toBe(false);
  });

  it("kill 活 job：stopping 中间态 → killed（reason 进 detail）+ 二值回执", async () => {
    const registry = new JobRegistry();
    const gate = deferred();
    const id = registry.start({
      kind: "sync",
      run: async (ctx) => {
        await gate.promise;
        if (ctx.signal.aborted) throw new Error("aborted");
      },
    });
    expect(registry.kill(id, "用户取消")).toBe("requested");
    expect(registry.get(id).status).toBe("stopping");
    // 执行体尚未退出：kill 不等，stopping 保持。
    expect(registry.get(id).status).toBe("stopping");
    gate.resolve();
    const settled = await registry.wait(id, 500);
    expect(settled.status).toBe("killed");
    expect(settled.detail).toBe("用户取消");
    expect(registry.kill(id)).toBe("already-finished");
  });

  it("wait 超时路径类型化报错且不改变 job 状态", async () => {
    const registry = new JobRegistry();
    const gate = deferred();
    const id = registry.start({ kind: "slow", run: () => gate.promise });
    await expect(registry.wait(id, 20)).rejects.toThrow("wait 超时（20ms）");
    expect(registry.get(id).status).toBe("running");
    gate.resolve();
    expect((await registry.wait(id, 500)).status).toBe("completed");
  });

  it("执行体抛错 → failed 不毒化注册表（后续 job 照常）", async () => {
    const registry = new JobRegistry();
    const id = registry.start({
      kind: "boom",
      run: async () => {
        throw new Error("内部崩溃");
      },
    });
    const settled = await pollUntil(() => registry.get(id), (v) => v.status === "failed");
    expect(settled.detail).toBe("内部崩溃");
    const next = registry.start({ kind: "ok", run: async () => {} });
    expect((await registry.wait(next, 500)).status).toBe("completed");
  });

  it("onSettled 订阅：结算回调与已终态的立即回调", async () => {
    const registry = new JobRegistry();
    const gate = deferred();
    const id = registry.start({ kind: "notify", run: () => gate.promise });
    const seen: string[] = [];
    registry.onSettled(id, (v) => seen.push(v.status));
    gate.resolve();
    await registry.wait(id, 500);
    await pollUntil(() => seen, (v) => v.length === 1);
    expect(seen).toEqual(["completed"]);
    registry.onSettled(id, (v) => seen.push(`late:${v.status}`));
    expect(seen).toEqual(["completed", "late:completed"]);
  });

  it("未知 id → UnknownJobError；id 按 kind-N 计数器发号", () => {
    const registry = new JobRegistry();
    expect(() => registry.get("ghost-99")).toThrow(UnknownJobError);
    const first = registry.start({ kind: "a", run: async () => {} });
    const second = registry.start({ kind: "a", run: async () => {} });
    expect(first).toBe("a-1");
    expect(second).toBe("a-2");
  });
});

describe("T7-5 jobs owner 会话隔离（dsh §13）", () => {
  it("owner 过滤域：list 只见本会话作业（跨会话不可见）；缺 owner 的 host 面作业保持可见", async () => {
    const { JobRegistry } = await import("./jobs.js");
    const registry = new JobRegistry({ ownerFilter: "session-A" });
    registry.start({ kind: "task", ownerSessionId: "session-A", run: async () => {} });
    registry.start({ kind: "cron", hostOwned: true, run: async () => {} }); // host 面作业（显式声明）
    let threw = false;
    try {
      registry.start({ kind: "smuggled", run: async () => {} }); // owner 域缺 owner = fail-closed
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    const kinds = registry.list().map((v) => v.kind);
    expect(kinds).toContain("task");
    expect(kinds).toContain("cron");
  });

  it("无 owner 过滤域（host 面注册表）：既有行为零变化", async () => {
    const { JobRegistry } = await import("./jobs.js");
    const registry = new JobRegistry();
    registry.start({ kind: "a", run: async () => {} });
    registry.start({ kind: "b", ownerSessionId: "other", run: async () => {} });
    expect(registry.list()).toHaveLength(2);
  });
});
