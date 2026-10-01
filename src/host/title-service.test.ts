import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanTitle, createTitleService, TITLE_SYSTEM_PROMPT } from "./title-service.js";
import { SqliteEventStorage } from "../session/db.js";
import type { SessionEvent } from "../kernel/events.js";

const closers: (() => void)[] = [];
const tmpDirs: string[] = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeDb(): { storage: SqliteEventStorage; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-title-svc-"));
  tmpDirs.push(dir);
  const storage = SqliteEventStorage.open({ path: path.join(dir, "t.db") });
  closers.push(() => storage.close());
  return { storage, dir };
}

function userStream(firstText: string): readonly SessionEvent[] {
  return [
    { type: "user/message", turn: 1, message: { content: firstText }, source: "user", seq: 1, ts: 1 } as never,
  ];
}

describe("标题清洗链（T-P3-147 E）", () => {
  it("剥推理前导/Title 前缀/引号/尾标点；超长截断", () => {
    expect(cleanTitle("<think>嗯…</think>\n登录按钮修复")).toBe("登录按钮修复");
    expect(cleanTitle("Title: 修复登录按钮。")).toBe("修复登录按钮");
    expect(cleanTitle("「数据库迁移」")).toBe("数据库迁移");
    expect(cleanTitle("多行\n第二行")).toBe("多行");
    expect(cleanTitle("长".repeat(80)).length).toBeLessThanOrEqual(60);
  });
});

describe("标题服务守卫集（fire-and-forget 全静默）", () => {
  it("首条消息过短 → 不生成", async () => {
    const { storage } = makeDb();
    const service = createTitleService({
      credentials: { getKey: async () => "k" } as never,
      db: storage,
      sessionStream: () => userStream("太短"),
    });
    await service.onTurnSettled("s1");
    expect(storage.getTitle("s1")).toBeUndefined();
  });

  it("链全空（无 providers）→ 不生成、不写表；配置后下轮可再试", async () => {
    const { storage } = makeDb();
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-title-svc-cfg-"));
    tmpDirs.push(dir);
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ version: 1, providers: [] }), "utf8");
    const service = createTitleService({
      settingsPath,
      credentials: { getKey: async () => "k" } as never,
      db: storage,
      sessionStream: () => userStream("帮我修复登录按钮的会话输入足够长吗"),
    });
    await service.onTurnSettled("s2");
    expect(storage.getTitle("s2")).toBeUndefined(); // 无链不虚构
  });

  it("已有标题（持久去重）→ 不再触发", async () => {
    const { storage } = makeDb();
    storage.setTitle("s3", "既有标题", "generated");
    // 无 settings（缺省路径）也会因标题已存在而短路——不抛即守卫生效
    const service = createTitleService({
      credentials: { getKey: async () => "k" } as never,
      db: storage,
      sessionStream: () => userStream("足够长的第一条用户消息文本"),
    });
    await service.onTurnSettled("s3");
    expect(storage.getTitle("s3")?.title).toBe("既有标题");
  });

  it("setTitle：generated 不覆盖 custom（权威级守卫）", () => {
    const { storage } = makeDb();
    storage.setTitle("s4", "用户命名", "custom");
    storage.setTitle("s4", "自动标题", "generated");
    expect(storage.getTitle("s4")?.title).toBe("用户命名");
    expect(storage.getTitle("s4")?.source).toBe("custom");
  });

  it("缺省指令为短具体名约束（提示词锚定）", () => {
    expect(TITLE_SYSTEM_PROMPT).toContain("25");
  });
});
