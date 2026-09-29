// U21/T-P3-123：CLI 编辑器增强——kill-ring、模糊历史搜索状态机、反斜杠续行。
import { describe, expect, it } from "vitest";
import {
  createHistorySearcher,
  createKillRing,
  fuzzyMatch,
  fuzzySearchHistory,
  withContinuation,
} from "./editor.js";

async function* lines(...items: string[]): AsyncIterable<string> {
  for (const l of items) yield l;
}

async function collect(gen: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const l of gen) out.push(l);
  return out;
}

describe("kill-ring（剪贴环）", () => {
  it("push/yank 取环顶、yankPop 环内回溯、空环 yank 空串", () => {
    const ring = createKillRing();
    expect(ring.yank()).toBe("");
    ring.push("第一段");
    ring.push("第二段");
    expect(ring.yank()).toBe("第二段"); // 最近剪贴在顶
    expect(ring.yankPop()).toBe("第一段"); // 回溯
    expect(ring.yankPop()).toBe("第二段"); // 环绕
  });

  it("空串不入环、容量 16 滚动", () => {
    const ring = createKillRing();
    ring.push("");
    expect(ring.size).toBe(0);
    for (let i = 0; i < 20; i++) ring.push(`k${i}`);
    expect(ring.size).toBe(16);
    expect(ring.yank()).toBe("k19"); // 最新在顶
    ring.push("x");
    expect(ring.yank()).toBe("x");
  });
});

describe("模糊历史搜索（Ctrl+R 核心）", () => {
  it("fuzzyMatch：子序列语义、大小写不敏感", () => {
    expect(fuzzyMatch("abc", "a1b2c3")).toBe(true);
    expect(fuzzyMatch("abc", "acb")).toBe(false); // 乱序不匹配
    expect(fuzzyMatch("GIT", "git push")).toBe(true);
    expect(fuzzyMatch("", "任意行")).toBe(true);
  });

  it("fuzzySearchHistory：保持历史序（约定 history[0] = 最新——readline rl.history 同约定）", () => {
    const history = ["旧的一行 git", "git push --force", "git status", "/exit"];
    const hits = fuzzySearchHistory(history, "git");
    expect(hits).toEqual(["旧的一行 git", "git push --force", "git status"]);
    // 空查询 = 全历史原序（初始候选面）
    expect(fuzzySearchHistory(history, "")).toEqual(history);
  });

  it("搜索状态机：feed 过滤、Ctrl+R 翻页、Enter 接受、Esc 取消", () => {
    const history = ["write c.ts", "edit b.ts", "write a.ts"]; // history[0] = 最新
    const s = createHistorySearcher(history);
    expect(s.active).toBe(true);
    s.feed("w");
    expect(s.currentMatch()).toBe("write c.ts"); // 最新命中
    s.next();
    expect(s.currentMatch()).toBe("write a.ts"); // 翻到更旧一条
    s.feed("r");
    expect(s.query).toBe("wr");
    s.backspace();
    expect(s.query).toBe("w");
    // Esc 取消：active 退出、不回填
    s.cancel();
    expect(s.active).toBe(false);
    // Enter 接受：返回当前命中
    const s2 = createHistorySearcher(history);
    s2.feed("ed");
    expect(s2.accept()).toBe("edit b.ts");
    expect(s2.active).toBe(false);
    // 无命中 = null（Enter 回空、currentMatch null）
    const s3 = createHistorySearcher(history);
    s3.feed("zzz");
    expect(s3.currentMatch()).toBeNull();
    expect(s3.accept()).toBeNull();
  });
});

describe("反斜杠续行（多行输入）", () => {
  it("行尾 \\ 与下一行拼成一个逻辑输入（换行保留为内容）", async () => {
    const out = await collect(
      withContinuation(lines("第一行 \\\n", "第二行 \\\n", "第三行\n", "独立行\n")),
    );
    expect(out).toEqual(["第一行 \n第二行 \n第三行\n", "独立行\n"]);
  });

  it("EOF 时未闭合续行 flush（不丢输入）", async () => {
    const out = await collect(withContinuation(lines("未闭合 \\\n", "结尾段")));
    expect(out).toEqual(["未闭合 \n结尾段"]);
  });

  it("无续行 = 原样透传（零行为变化）", async () => {
    const out = await collect(withContinuation(lines("a\n", "b\n")));
    expect(out).toEqual(["a\n", "b\n"]);
  });
});
