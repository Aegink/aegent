// T-P3-154 C1：日志查询纯函数层——枚举映射/坏行跳过/过滤分页/缓存增量。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LogLineCache, listLogFiles, parseLogLine, queryLogs } from "./log-query.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function tempLogDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-logq-"));
  dirs.push(dir);
  return dir;
}

const T1 = "2026-10-03T02:00:00.000Z";
const T2 = "2026-10-03T03:00:00.000Z";

describe("listLogFiles", () => {
  it("通道枚举+日期倒序；旧命名 aegent- 映射为 agent 通道；raw- 不进查看器", () => {
    const dir = tempLogDir();
    for (const name of ["host-20261003.log", "ui-20261002.log", "aegent-20261003.log", "raw-20261003.jsonl", "unrelated.txt"]) {
      writeFileSync(join(dir, name), "{}\n", "utf8");
    }
    const files = listLogFiles(dir);
    expect(files.map((f) => `${f.channel}:${f.date}`)).toEqual(["agent:20261003", "host:20261003", "ui:20261002"]);
  });
  it("目录不存在 = 空清单（不炸）", () => {
    expect(listLogFiles(join(tempLogDir(), "nope"))).toEqual([]);
  });
});

describe("parseLogLine", () => {
  it("合法日志行解析；坏行/缺 ts/msg 行返回 null", () => {
    expect(parseLogLine(`{"ts":"${T1}","level":"warn","msg":"x"}`, "host")?.entry.msg).toBe("x");
    expect(parseLogLine("{broken", "host")).toBeNull();
    expect(parseLogLine(`{"level":"warn","msg":"无ts"}`, "host")).toBeNull();
    expect(parseLogLine("", "host")).toBeNull();
  });
  it("非法 level 降级 info；缺 channel 补文件通道", () => {
    const parsed = parseLogLine(`{"ts":"${T1}","level":"loud","msg":"x"}`, "ui");
    expect(parsed?.entry.level).toBe("info");
    expect(parsed?.entry.channel).toBe("ui");
  });
});

describe("queryLogs", () => {
  function seed(dir: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "host-20261003.log"),
      [
        JSON.stringify({ ts: T1, level: "info", channel: "host", category: "session", msg: "用户消息落流" }),
        JSON.stringify({ ts: T2, level: "error", channel: "host", category: "gateway", msg: "sk-abc123456789xyz 泄漏尝试" }),
      ].join("\n") + "\n",
      "utf8",
    );
    writeFileSync(
      join(dir, "ui-20261003.log"),
      JSON.stringify({ ts: T2, level: "error", channel: "ui", category: "report", msg: "unhandled rejection", data: { stack: "Error: x" } }) + "\n",
      "utf8",
    );
  }
  it("默认最近 3 文件+倒序；日期/级别（≥语义）/category/keyword 过滤；分页", () => {
    const dir = tempLogDir();
    seed(dir);
    const cache = new LogLineCache();
    const all = queryLogs(dir, {}, cache);
    expect(all.total).toBe(3);
    expect(all.rows[0]?.msg).toBe("unhandled rejection"); // 最新在前
    expect(all.categories.sort()).toEqual(["gateway", "report", "session"]);
    const byDate = queryLogs(dir, { date: "20261003", level: "warn" }, cache);
    expect(byDate.total).toBe(2); // error x2（info 被级别下限滤掉）
    const byCat = queryLogs(dir, { category: "session" }, cache);
    expect(byCat.total).toBe(1);
    const byKw = queryLogs(dir, { keyword: "泄漏" }, cache);
    expect(byKw.total).toBe(1);
    const paged = queryLogs(dir, { pageSize: 10, page: 1 }, cache);
    expect(paged.rows).toHaveLength(3);
  });
  it("文件缓存：指纹不变时增量复用（不再读盘）", () => {
    const dir = tempLogDir();
    seed(dir);
    const file = join(dir, "host-20261003.log");
    const cache = new LogLineCache();
    expect(cache.read({ channel: "host", date: "20261003", path: file, sizeBytes: 1 })).toHaveLength(2);
    const spyLines = cache.read({ channel: "host", date: "20261003", path: file, sizeBytes: 1 });
    expect(spyLines).toHaveLength(2); // 命中缓存
    writeFileSync(file, `{"ts":"${T2}","level":"warn","msg":"新行"}` + "\n", "utf8");
    expect(cache.read({ channel: "host", date: "20261003", path: file, sizeBytes: 2 })).toHaveLength(1); // 指纹变——重读
  });
});
