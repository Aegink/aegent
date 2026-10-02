/**
 * 会话导入驱动测试（T-P3-150 多 Agent 适配）——三种磁盘形状的临时样本
 * 往返（jsonl-transcript 的角色映射/注入过滤/工具配对/unwrapPath 信封/
 * json-tree 的 Gemini 形状）+ spec 纯数据校验器（FORBIDDEN_KEYS/根目录
 * 安全/来源上限）+ A6 事件重建。
 */

import { readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCustomSources, validateSpecShape, type JsonlSpec, type JsonTreeSpec } from "./import-spec.js";
import { jsonlMessages, scanJsonl } from "./import-drivers.js";
import { scanJsonTree, jsonTreeMessages } from "./import-driver-jsontree.js";
import { importedMessagesToEvents as toEvents } from "./settings-project-ops.js";

const dirs: string[] = [];
function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "p150-driver-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

const CLAUDE_LIKE_SPEC: JsonlSpec = {
  id: "claude",
  label: "Claude Code",
  driver: "jsonl-transcript",
  root: "~/.claude/projects",
  session: { titleFrom: "firstUser", projectFrom: "cwd" },
  entry: {
    rolePath: "type",
    content: { blocks: { path: "message.content", typeField: "type", types: ["text"], textField: "text" } },
    tsPath: "timestamp",
    match: { path: "type", in: ["user", "assistant"] },
    skipTypePath: "isSidechain",
    skipTypes: ["true"],
    drop: { startsWith: ["<"], roles: ["user"] },
    toolCall: {
      callBlocks: { path: "message.content", typeField: "type", type: "tool_use", idPath: "id", namePath: "name", argsPath: "input", roles: ["assistant"] },
      resultBlocks: { path: "message.content", typeField: "type", type: "tool_result", idPath: "tool_use_id", resultPath: "content", statusPath: "is_error", roles: ["user"] },
    },
  },
};

describe("jsonl-transcript 驱动（scanJsonl/jsonlMessages）", () => {
  it("claude 形状：cwd 遍历提取 + sidechain 跳过 + 注入丢弃 + tool 配对 + 块/字符串 content 兼容", () => {
    const home = makeHome();
    const projDir = path.join(home, ".claude", "projects", "F--work-demo");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      path.join(projDir, "s1.jsonl"),
      [
        JSON.stringify({ type: "summary", summary: "旧标题行（无 cwd 也无消息）" }),
        JSON.stringify({ type: "user", cwd: "F:/work/demo", timestamp: "2026-09-30T10:00:00Z", message: { content: "帮我看看这个" } }),
        JSON.stringify({ type: "user", timestamp: "2026-09-30T10:00:01Z", message: { content: "<system-reminder>注入块</system-reminder>" } }),
        JSON.stringify({ type: "assistant", isSidechain: true, timestamp: "2026-09-30T10:00:02Z", message: { content: [{ type: "text", text: "sidechain 不应出现" }] } }),
        JSON.stringify({ type: "assistant", timestamp: "2026-09-30T10:00:03Z", message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { path: "a.ts" } }] } }),
        JSON.stringify({ type: "user", timestamp: "2026-09-30T10:00:04Z", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "文件内容" }] } }),
        JSON.stringify({ type: "assistant", timestamp: "2026-09-30T10:00:05Z", message: { content: [{ type: "text", text: "看完了" }] } }),
      ].join("\n"),
    );
    const summaries = scanJsonl(CLAUDE_LIKE_SPEC, home);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.projectPath).toBe("F:/work/demo"); // cwd 从非首行提取
    expect(summaries[0]?.title).toContain("帮我看看这个");
    expect(summaries[0]?.externalId).toBe("s1");

    const entries = require0(path.join(projDir, "s1.jsonl"));
    const messages = jsonlMessages(CLAUDE_LIKE_SPEC, entries);
    expect(messages.map((m: { role: string }) => m.role)).toEqual(["user", "tool", "assistant"]); // 注入行/sidechain/结果条目文本均被抑制
    expect(messages[0]?.text).toBe("帮我看看这个");
    expect(messages[1]?.toolName).toBe("Read");
    expect(messages[1]?.toolResult).toBe("文件内容");
  });

  it("unwrapPath 信封（codex 形状）+ idFromEntry 两段查找", () => {
    const home = makeHome();
    const projDir = path.join(home, ".codex", "sessions", "2026", "09", "30");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      path.join(projDir, "roll-1.jsonl"),
      [
        JSON.stringify({ timestamp: "t", type: "session_meta", payload: { id: "ext-abc", cwd: "D:/proj" } }),
        JSON.stringify({ timestamp: "t", type: "response_item", payload: { type: "user_message", message: "问题" } }),
        JSON.stringify({ timestamp: "t", type: "response_item", payload: { type: "agent_message", message: "答案" } }),
      ].join("\n"),
    );
    const spec: JsonlSpec = {
      id: "codex",
      label: "Codex",
      driver: "jsonl-transcript",
      root: "~/.codex/sessions",
      // unwrap 后所有 path 相对 payload 内层（idFromEntry 的类别在外层信封）
      session: { idFrom: "id", idFromEntry: { path: "type", in: ["session_meta"] }, titleFrom: "firstUser", projectFrom: "cwd" },
      entry: {
        unwrapPath: "payload",
        rolePath: "type",
        roleMap: { user_message: "user", agent_message: "assistant" },
        content: "message",
      },
    };
    const summaries = scanJsonl(spec, home);
    console.log("[dbg] summaries:", JSON.stringify(summaries));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.externalId).toBe("ext-abc"); // session_meta 的 id，而非 response_item 自带 id
    expect(summaries[0]?.projectPath).toBe("D:/proj");
    const messages = jsonlMessages(spec, require0(path.join(projDir, "roll-1.jsonl")));
    expect(messages.map((m: { role: string; text?: string }) => `${m.role}:${m.text}`)).toEqual(["user:问题", "assistant:答案"]);
  });
});

function require0(file: string): Record<string, unknown>[] {
  return (readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l)) as Record<string, unknown>[]);
}

describe("json-tree 驱动（scanJsonTree——Gemini 形状）", () => {
  it("一文件一会话：sessionId/块数组 content/无 projectPath 归未定位", () => {
    const home = makeHome();
    const chatDir = path.join(home, ".gemini", "tmp", "hash1", "chats");
    mkdirSync(chatDir, { recursive: true });
    writeFileSync(
      path.join(chatDir, "session-1.json"),
      JSON.stringify({
        sessionId: "g-1",
        lastUpdated: "2026-09-30T12:00:00Z",
        messages: [
          { id: "1", type: "user", timestamp: "2026-09-30T11:00:00Z", content: [{ text: "你好" }] },
          { id: "2", type: "gemini", timestamp: "2026-09-30T11:00:05Z", content: [{ text: "你好！" }] },
        ],
      }),
    );
    const spec: JsonTreeSpec = {
      id: "gemini",
      label: "Gemini CLI",
      driver: "json-tree",
      root: "~/.gemini/tmp",
      session: { idPath: "sessionId", tsPath: "lastUpdated", messagesPath: "messages" },
      message: {
        rolePath: "type",
        roleMap: { user: "user", gemini: "assistant", model: "assistant" },
        content: { blocks: { path: "content", typeField: "text", types: ["text"], textField: "text" } },
        tsPath: "timestamp",
      },
    };
    const summaries = scanJsonTree(spec, home);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.externalId).toBe("g-1");
    expect(summaries[0]?.projectPath).toBeNull(); // projectHash 无法反解——未定位组
    expect(summaries[0]?.messageCount).toBe(2);
  });
});

describe("spec 纯数据校验器（A4 安全边界）", () => {
  it("FORBIDDEN_KEYS 任意层级拒绝", () => {
    const errors = validateSpecShape([{ id: "x", driver: "jsonl-transcript", entry: { deep: { eval: "alert(1)" } } }]);
    expect(errors.some((e) => e.includes("eval"))).toBe(true);
  });
  it("函数值拒绝", () => {
    const errors = validateSpecShape([{ id: "x", transform: () => 1 }]);
    expect(errors.length).toBeGreaterThan(0);
  });
  it("parseCustomSources：坏 id/内置冲突/驱动闭集逐条拒绝不中断", () => {
    const result = parseCustomSources(
      JSON.stringify([
        { id: "claude", driver: "jsonl-transcript", root: "~/.x" }, // 内置冲突
        { id: "bad id!", driver: "jsonl-transcript", root: "~/.x" }, // id 形状
        { id: "ok", label: "OK", driver: "jsonl-transcript", root: "~/.mytool/sessions" },
        { id: "bad2", driver: "grpc", root: "~/.x" }, // 驱动闭集
      ]),
    );
    expect(result.specs.map((s) => s.id)).toEqual(["ok"]);
    expect(result.errors).toHaveLength(3);
  });
});

describe("A6 事件重建（importedMessagesToEvents）", () => {
  it("user 开新 turn / tool 配 callId 成对 / seq 单调", () => {
    const events = toEvents(
      [
        { role: "user", text: "问" },
        { role: "assistant", text: "答" },
        { role: "tool", toolName: "Read", toolArgs: { p: 1 }, toolResult: "ok" },
        { role: "user", text: "继续" },
      ],
      1000,
    );
    expect(events.map((e) => e.type)).toEqual(["user/message", "assistant/message", "tool/call", "tool/result", "user/message"]);
    const turns = events.map((e) => (e as { turn: number }).turn);
    expect(turns).toEqual([1, 1, 1, 1, 2]);
    const seqs = events.map((e) => (e as { seq: number }).seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs); // 单调
    const call = events[2] as unknown as { callId: string; name: string };
    const result = events[3] as unknown as { callId: string; message: { content: string } };
    expect(result.callId).toBe(call.callId); // 配对
    expect(call.name).toBe("Read");
    expect(result.message.content).toBe("ok");
  });
});
