// T-P3-153 C：会话导出三格式 + 脱敏 + JSON 回导幂等（真事件库端到端）。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { SessionEvent } from "../kernel/events.js";
import { SqliteEventStorage } from "../session/db.js";
import {
  extractSessionMessages,
  redactText,
  sessionExportOp,
  sessionImportOp,
} from "./session-export-op.js";

const dirs: string[] = [];
const stores: SqliteEventStorage[] = [];
afterAll(() => {
  for (const s of stores) s.close(); // Windows：先关库再清目录（EBUSY）
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tempDb(): SqliteEventStorage {
  const dir = mkdtempSync(join(tmpdir(), "aegent-sessio-"));
  dirs.push(dir);
  const storage = SqliteEventStorage.open({ path: join(dir, "events.sqlite") });
  stores.push(storage);
  return storage;
}

const SID = "11111111-2222-3333-4444-555555555555";

function seedEvents(): SessionEvent[] {
  return [
    { type: "user/message", seq: 1, ts: 1_700_000_000_000, turn: 1, message: { content: "帮我看看 sk-abc123456789xyz 这个 key" }, source: "user" },
    { type: "assistant/message", seq: 2, ts: 1_700_000_001_000, turn: 1, step: 1, message: { content: "这是密钥，已泄露" }, stream: [] },
    { type: "tool/call", seq: 3, ts: 1_700_000_002_000, turn: 1, step: 2, callId: "c1", name: "bash", arguments: '{"cmd":"echo hi"}' },
    { type: "tool/result", seq: 4, ts: 1_700_000_003_000, turn: 1, step: 2, callId: "c1", message: { content: "hi" } },
  ];
}

describe("extractSessionMessages", () => {
  it("user/assistant/tool 按 callId 配对成消息序列", () => {
    const db = tempDb();
    db.appendBatch(SID, seedEvents());
    const messages = extractSessionMessages(db.readAll(SID));
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ role: "user", text: "帮我看看 sk-abc123456789xyz 这个 key" });
    expect(messages[2]).toMatchObject({ role: "tool", toolName: "bash", toolResult: "hi" });
    expect((messages[2]!.toolArgs as { cmd: string }).cmd).toBe("echo hi");
  });
});

describe("redactText", () => {
  it("密钥形态打码：sk-/github/AWS/Bearer/JSON 键值", () => {
    expect(redactText("key 是 sk-abc123456789xyz 请查收")).toBe("key 是 [redacted] 请查收");
    expect(redactText("ghp_Abcdefgh1234567890AB")).toBe("[redacted]");
    expect(redactText("Bearer abc123._-xyz")).toBe("Bearer [redacted]");
    expect(redactText('{"apiKey":"supersecret123"}')).toBe('{"apiKey": "[redacted]"}');
    expect(redactText("普通文本不动")).toBe("普通文本不动");
  });
});

describe("sessionExportOp", () => {
  it("三格式：md 标题+对话体；html 自包含转义；json kind 包", () => {
    const db = tempDb();
    db.appendBatch(SID, seedEvents());
    db.setTitle(SID, "测试会话", "custom");
    const md = sessionExportOp(db, { sessionId: SID, format: "md", redact: false });
    expect(md.filename).toMatch(/aegent-session-\d{8}-\d{6}\.md$/);
    expect(md.text).toContain("aegent 会话导出：测试会话");
    expect(md.text).toContain("sk-abc123456789xyz"); // 脱敏关 = 原样
    expect(md.text).toContain("### 🔧 工具 bash");
    const html = sessionExportOp(db, { sessionId: SID, format: "html" });
    expect(html.text).toContain("<!DOCTYPE html>");
    expect(html.text).not.toContain("sk-abc123456789xyz"); // 默认脱敏开
    expect(html.text).toContain("[redacted]");
    expect(html.text).toContain("&quot;"); // args JSON 引号经转义进 HTML
    const json = sessionExportOp(db, { sessionId: SID, format: "json" });
    const pkg = JSON.parse(json.text);
    expect(pkg.kind).toBe("aegent-session-export");
    expect(pkg.session.id).toBe(SID);
    expect(pkg.messages).toHaveLength(3);
    expect(json.messageCount).toBe(3);
  });
  it("脱敏开/关：sk- 密钥仅关档原样", () => {
    const db = tempDb();
    db.appendBatch(SID, seedEvents());
    const on = sessionExportOp(db, { sessionId: SID, format: "md" });
    expect(on.text).not.toContain("sk-abc123456789xyz");
  });
  it("空会话/缺库类型化拒绝；归档会话 fail-closed", () => {
    const db = tempDb();
    expect(() => sessionExportOp(db, { sessionId: "nope", format: "md" })).toThrow(/没有可导出的对话内容/);
    expect(() => sessionExportOp(undefined, { sessionId: "x", format: "md" })).toThrow(/SQLite 事件库/);
  });
});

describe("sessionImportOp 回导", () => {
  it("导出 → 回导 → 事件重建 1:1 → 重导 skipped（registry 幂等账）", () => {
    const db = tempDb();
    db.appendBatch(SID, seedEvents());
    db.setTitle(SID, "测试会话", "custom");
    const pkg = sessionExportOp(db, { sessionId: SID, format: "json", redact: false }).text;
    const first = sessionImportOp(db, pkg);
    if (!("imported" in first) || !first.imported) throw new Error("预期 imported");
    expect(first.messageCount).toBe(3);
    const events = db.readAll(first.sessionId);
    expect(events.filter((e) => e.type === "user/message")).toHaveLength(1);
    expect(events.filter((e) => e.type === "tool/call")).toHaveLength(1);
    expect(events.filter((e) => e.type === "tool/result")).toHaveLength(1);
    expect(db.getTitle(first.sessionId)?.title).toBe("测试会话");
    const second = sessionImportOp(db, pkg);
    expect(second).toEqual({ skipped: true, sessionId: first.sessionId });
  });
  it("坏包：kind 不符/空 messages/非 JSON 类型化拒绝", () => {
    const db = tempDb();
    expect(() => sessionImportOp(db, "{broken")).toThrow(/不是合法 JSON/);
    expect(() => sessionImportOp(db, JSON.stringify({ kind: "other" }))).toThrow(/kind 不符/);
    expect(() => sessionImportOp(db, JSON.stringify({ kind: "aegent-session-export", messages: [] }))).toThrow(/messages 须为/);
    expect(() =>
      sessionImportOp(db, JSON.stringify({ kind: "aegent-session-export", messages: [{ role: "system" }] })),
    ).toThrow(/role 非法/);
  });
});
