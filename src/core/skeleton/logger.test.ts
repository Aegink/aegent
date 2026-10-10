/**
 * 日志脱敏测试（T-6-05 · D9）——喂含 sk-… 与用户 prompt 原文的行，落盘
 * 内容两者被掩码（验收①）；开关可控（验收②）；落盘文件过卡面同款
 * sk-[A-Za-z0-9]{20,} 证伪（验收③）。
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { USER_CONTENT_FIELDS, cleanExpiredLogs, createLogger, redactSecrets } from "./logger.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempLogDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-logs-"));
  tmpDirs.push(dir);
  return dir;
}

function readAll(dir: string): string {
  const files = readdirSync(dir);
  expect(files.length).toBeGreaterThan(0);
  return files.map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
}

describe("D9 · 密钥脱敏（恒开）", () => {
  it("sk-… 与 sk-proj-… 变体整段掩码，落盘过卡面证伪模式", () => {
    const line = redactSecrets(
      '调用失败 key=sk-abcdef0123456789abcdef01 proj=sk-proj-0123456789abcdefghij',
    );
    expect(line).not.toMatch(/sk-[A-Za-z0-9]{20,}/); // 卡面验收的证伪模式
    expect(line).not.toContain("sk-abcdef0123456789abcdef01");
    expect(line).toContain("[REDACTED:api-key]");
  });

  it("落盘路径：密钥藏在 data 深层也被掩（先序列化再过正则）", () => {
    const dir = tempLogDir();
    createLogger({
      logDir: dir,
      clock: () => new Date("2026-09-25T08:00:00Z"),
    }).error("上游 401", { detail: { apiKey: "sk-abcdef0123456789abcdef01" } });
    const onDisk = readAll(dir);
    expect(onDisk).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    expect(onDisk).toContain("[REDACTED:api-key]");
  });
});

describe("D9 · 用户原文开关（缺省开）", () => {
  it("缺省：userContent 字段整段掩码，原文不落盘", () => {
    const dir = tempLogDir();
    createLogger({ logDir: dir, clock: () => new Date("2026-09-25T08:00:00Z") }).info(
      "收到消息",
      { userContent: "帮我删掉 F:\\secret\\key.md，我的口令是 hunter2" },
    );
    const onDisk = readAll(dir);
    expect(onDisk).not.toContain("帮我删掉");
    expect(onDisk).not.toContain("hunter2");
    expect(onDisk).toContain("[REDACTED:user-content]");
    // msg（结构性说明）与 ts/level 保留
    expect(onDisk).toContain('"msg":"收到消息"');
    expect(onDisk).toContain('"level":"info"');
  });

  it("开关关闭：原文保留（sk- 仍被恒开正则掩码）", () => {
    const dir = tempLogDir();
    createLogger({
      logDir: dir,
      redactUserContent: false,
      clock: () => new Date("2026-09-25T08:00:00Z"),
    }).info("收到消息", { userContent: "我的 key 是 sk-abcdef0123456789abcdef01" });
    const onDisk = readAll(dir);
    expect(onDisk).toContain("我的 key 是"); // 原文保留
    expect(onDisk).not.toMatch(/sk-[A-Za-z0-9]{20,}/); // 密钥仍掩码
    expect(onDisk).toContain("[REDACTED:api-key]");
  });

  it("约定字段名只有 userContent；其余字段不受开关影响", () => {
    expect(USER_CONTENT_FIELDS).toEqual(["userContent"]);
    const dir = tempLogDir();
    createLogger({ logDir: dir, clock: () => new Date("2026-09-25T08:00:00Z") }).info("x", {
      tool: "bash",
      userContent: "原话",
      args: { command: "ls" },
    });
    const onDisk = readAll(dir);
    expect(onDisk).toContain('"tool":"bash"');
    expect(onDisk).toContain('"args":{"command":"ls"}');
    expect(onDisk).toContain("[REDACTED:user-content]");
  });
});

describe("D9 · 落盘形状", () => {
  it("按日一文件、每行一个 JSON 对象（ts/level/msg/data）", () => {
    const dir = tempLogDir();
    const logger = createLogger({
      logDir: dir,
      clock: () => new Date("2026-09-25T08:00:00Z"),
    });
    logger.debug("调试");
    logger.warn("警告", { code: "E1" });
    const files = readdirSync(dir);
    expect(files).toEqual(["aegent-20260925.log"]);
    const lines = readFileSync(path.join(dir, files[0]!), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const second = JSON.parse(lines[1]!) as { ts: string; level: string; msg: string; data?: unknown };
    expect(second.ts).toBe("2026-09-25T08:00:00.000Z");
    expect(second.level).toBe("warn");
    expect(second.data).toEqual({ code: "E1" });
  });
});
// T-P3-154 日志中心：通道/分类/级别过滤/保留清理
// ---------------------------------------------------------------------------

describe("T-P3-154 · 通道与分类", () => {
  it("channel=host 落 host-日期.log 且行带 channel/category；缺省 aegent 行不带字段", () => {
    const dir = tempLogDir();
    const host = createLogger({ logDir: dir, channel: "host", category: "gateway", clock: () => new Date("2026-10-03T02:00:00Z") });
    host.warn("镜像失败", { code: "E1" });
    const agent = createLogger({ logDir: dir, clock: () => new Date("2026-10-03T02:00:00Z") });
    agent.info("内核行");
    expect(readdirSync(dir).sort()).toEqual(["aegent-20261003.log", "host-20261003.log"]); // 缺省通道名 aegent（零破坏）
    const hostLine = JSON.parse(readFileSync(join(dir, "host-20261003.log"), "utf8"));
    expect(hostLine.channel).toBe("host");
    expect(hostLine.category).toBe("gateway");
    const agentLine = JSON.parse(readFileSync(join(dir, "aegent-20261003.log"), "utf8")); // 缺省通道文件名 aegent-*
    expect(agentLine.channel).toBeUndefined(); // 缺省通道不落字段——旧行兼容
  });
  it("级别过滤：info 起步时 debug 行丢弃；setLevel 热更生效", () => {
    const sinkLines: string[] = [];
    const logger = createLogger({
      sink: { write: (l) => sinkLines.push(l) },
      level: "info",
      clock: () => new Date("2026-10-03T02:00:00Z"),
    });
    logger.debug("丢弃");
    logger.info("保留");
    expect(sinkLines).toHaveLength(1);
    logger.setLevel("debug");
    logger.debug("现在保留");
    expect(sinkLines).toHaveLength(2);
    expect(logger.getLevel()).toBe("debug");
  });
  it("保留清理：过期按日文件被删（retentionDays）且 0=永久", () => {
    const dir = tempLogDir();
    writeFileSync(join(dir, "host-20260901.log"), "x\n", "utf8");
    writeFileSync(join(dir, "ui-20260902.log"), "x\n", "utf8");
    writeFileSync(join(dir, "raw-20260901.jsonl"), "x\n", "utf8");
    writeFileSync(join(dir, "host-20261001.log"), "x\n", "utf8"); // 保留期内
    writeFileSync(join(dir, "unrelated.txt"), "x", "utf8"); // 非按日形状——不碰
    const removed = cleanExpiredLogs(dir, 14, () => new Date("2026-10-03T02:00:00Z"));
    expect(removed).toBe(3);
    expect(readdirSync(dir).sort()).toEqual(["host-20261001.log", "unrelated.txt"]);
    expect(cleanExpiredLogs(dir, 0, () => new Date("2026-10-03T02:00:00Z"))).toBe(0); // 永久=跳过
  });
});
