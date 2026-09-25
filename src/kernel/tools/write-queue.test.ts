import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "./registry.js";
import { createEditTool } from "./builtin/edit.js";
import { createWriteTool } from "./builtin/write.js";
import { registerBuiltinTools } from "./builtin/index.js";
import { WriteQueue } from "./write-queue.js";
import { PathGuard } from "../../sandbox/path-guard.js";

const tmpDirs: string[] = [];
afterEach(() => {
  // 测试夹具自清理（mkdtemp 建在 os.tmpdir()，只删本测试建的目录）
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-wq-"));
  tmpDirs.push(dir);
  return dir;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("WriteQueue（B4 同路径 FIFO，异路径并行）", () => {
  it("并发 20 写同一路径：文件内容是某一次写入的完整值（无交错半截）", async () => {
    const queue = new WriteQueue();
    const file = path.join(tempDir(), "shared.txt");
    // 每个任务的"完整值"不同且长度不同（模拟不同 content），任务内带随机延迟
    const jobs = Array.from({ length: 20 }, (_, i) => () =>
      sleep(Math.floor(Math.random() * 8) + 1).then(async () => {
        const full = `FULL-${String(i).padStart(2, "0")}-`.repeat(i + 1);
        await writeFile(file, full, "utf8");
        return full;
      }),
    );
    const results = await Promise.all(jobs.map((t) => queue.run(file, t)));
    const final = readFileSync(file, "utf8");
    // 最终内容必然等于最后一次（FIFO 尾）写入的完整值——单值完整，非拼接
    expect(final).toBe(results[19]);
    expect(results).toContain(final);
  });

  it("并发写 20 个不同路径总耗时明显低于全串行（验收②）", async () => {
    const queue = new WriteQueue();
    const dir = tempDir();
    const taskMs = 30;
    const jobs = Array.from({ length: 20 }, (_, i) => () =>
      sleep(taskMs).then(async () => {
        await writeFile(path.join(dir, `p${String(i).padStart(2, "0")}.txt`), String(i), "utf8");
      }),
    );
    const start = Date.now();
    await Promise.all(jobs.map((t, i) => queue.run(`p${String(i).padStart(2, "0")}`, t)));
    const elapsed = Date.now() - start;
    // 全串行下界 = 20×30ms = 600ms；异路径并行应远低于其一半
    expect(elapsed).toBeLessThan(300);
  });

  it("同 key FIFO：任务按提交顺序开始执行", async () => {
    const queue = new WriteQueue();
    const started: number[] = [];
    const jobs = Array.from({ length: 5 }, (_, i) => () => {
      started.push(i);
      return sleep(1).then(() => i);
    });
    await Promise.all(jobs.map((t) => queue.run("same", t)));
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it("前一任务失败不毒化后一任务；rejection 只归调用方", async () => {
    const queue = new WriteQueue();
    const boom = queue.run("k", async () => {
      throw new Error("第一个失败");
    });
    await expect(boom).rejects.toThrow("第一个失败");
    const ok = await queue.run("k", async () => "第二个正常");
    expect(ok).toBe("第二个正常");
    // 队列仍可用
    expect(await queue.run("k", async () => "第三个")).toBe("第三个");
  });
});

describe("写队列接入 write / edit 工具", () => {
  it("并发 dispatch 多个 write 同一路径，最终内容为某一完整值", async () => {
    const dir = tempDir();
    const file = path.join(dir, "tool.txt");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, { pathGuard: PathGuard.forWorkspace(dir) });
    const writes = Array.from({ length: 12 }, (_, i) => {
      const content = `CONTENT-${String(i).padStart(2, "0")}-`.repeat(i + 1);
      return registry
        .dispatch({ callId: `c${String(i)}`, name: "write", arguments: JSON.stringify({ path: file, content }) })
        .then(() => content);
    });
    const contents = await Promise.all(writes);
    const final = readFileSync(file, "utf8");
    // FIFO 尾任务的完整值 = 文件最终内容（单值完整，非拼接交错）
    expect(final).toBe(contents[11]);
  });

  it("edit 的读改写整体在队列内（并发 edit+write 不产生中间丢失）", async () => {
    const dir = tempDir();
    const file = path.join(dir, "edit.txt");
    writeFileSync(file, "base\n", "utf8");
    const queue = new WriteQueue();
    const registry = new ToolRegistry();
    registry.registerTool(createWriteTool({ writeQueue: queue, pathGuard: PathGuard.forWorkspace(dir) }));
    registry.registerTool(createEditTool({ writeQueue: queue, pathGuard: PathGuard.forWorkspace(dir) }));
    await Promise.all([
      registry.dispatch({
        callId: "e1",
        name: "edit",
        arguments: JSON.stringify({ path: file, oldText: "base", newText: "edited" }),
      }),
      registry.dispatch({
        callId: "w1",
        name: "write",
        arguments: JSON.stringify({ path: file, content: "overwritten-by-write\n" }),
      }),
    ]);
    // 两个操作都成功结算（先后由 FIFO 决定），文件必为其中一方的完整产物
    const final = readFileSync(file, "utf8");
    expect(["edited\n", "overwritten-by-write\n"]).toContain(final);
  });
});
