import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mcpImportScan } from "./mcp-import-op.js";
import { parseCodexTomlMcpServers } from "./mcp-toml.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-mcp-import-"));
  tmpDirs.push(dir);
  return dir;
}

describe("外部 MCP 配置扫描（T-P3-143 批次 A）", () => {
  it("Codex TOML：stdio 段产候选 + url 段跳过 + 注释/引号名/内联表 env", async () => {
    const home = makeHome();
    mkdirSync(path.join(home, ".codex"), { recursive: true });
    writeFileSync(
      path.join(home, ".codex", "config.toml"),
      `
model = "gpt-5"
# 注释行
[mcp_servers.memory]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-memory"]
env = { "MY_KEY" = "v#1", EMPTY = "" }   # 行尾注释带引号内 #

[mcp_servers."dotted.name"]
command = "node"
args = [
  "a.js",   # 跨行数组
  "b.js",
]

[mcp_servers.remote_one]
url = "https://example.com/mcp"

[mcp_servers.bad]
args = ["没有 command"]

[mcp.servers.legacy]
command = "node"

[mcp_servers.memory.auth]
client_id = "x"
`,
      "utf8",
    );
    const r = await mcpImportScan({ homeDir: home });
    const codex = r.sources.find((s) => s.label === "Codex CLI");
    expect(codex?.exists).toBe(true);
    const codexCandidates = r.candidates.filter((c) => c.sourceLabel === "Codex CLI");
    expect(codexCandidates.map((c) => c.name).sort()).toEqual(["dotted.name", "legacy", "memory"]);
    const memory = codexCandidates.find((c) => c.name === "memory");
    expect(memory?.config.command).toBe("npx");
    expect(memory?.config.args).toEqual(["-y", "@modelcontextprotocol/server-memory"]);
    expect(memory?.config.env).toEqual({ MY_KEY: "v#1", EMPTY: "" });
    expect(memory?.warning).toContain("超时");
    expect(codex?.skipped).toBe(2); // remote_one + bad
    // 子表 [mcp_servers.memory.auth] 的键不污染 memory 条目
    expect(memory?.config.command).not.toContain("auth");
  });

  it("Claude Code（.claude.json）+ Cursor + 通用（.agents）+ 停用条目跳过", async () => {
    const home = makeHome();
    writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { fs: { command: "npx", args: ["-y", "fs"] } } }),
      "utf8",
    );
    mkdirSync(path.join(home, ".cursor"), { recursive: true });
    writeFileSync(
      path.join(home, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          web: { command: "node", args: ["web.js"], env: { TOKEN: "t" } },
          off: { command: "node", enabled: false },
          remote: { url: "https://x/mcp" },
        },
      }),
      "utf8",
    );
    mkdirSync(path.join(home, ".agents"), { recursive: true });
    writeFileSync(
      path.join(home, ".agents", "mcp.json"),
      JSON.stringify({ mcpServers: { fs: { command: "node", args: ["other.js"] } } }), // 跨源重名——跳过
      "utf8",
    );
    const r = await mcpImportScan({ homeDir: home });
    expect(r.candidates.map((c) => c.name).sort()).toEqual(["fs", "web"]);
    const web = r.candidates.find((c) => c.name === "web");
    expect(web?.sourceLabel).toBe("Cursor");
    expect(web?.config.env).toEqual({ TOKEN: "t" });
    const agentsReport = r.sources.find((s) => s.path.includes(".agents"));
    expect(agentsReport?.skipped).toBe(1); // 重名 fs
  });

  it("OpenCode：command 数组拆分 + environment→env + remote 跳过", async () => {
    const home = makeHome();
    mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
    writeFileSync(
      path.join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({
        mcp: {
          arr: { type: "local", command: ["npx", "-y", "srv"], environment: { K: "V" } },
          plain: { type: "local", command: "node", args: ["x.js"] },
          remote: { type: "remote", url: "https://x/mcp" },
          disabled: { type: "local", command: "node", enabled: false },
        },
      }),
      "utf8",
    );
    const r = await mcpImportScan({ homeDir: home });
    const arr = r.candidates.find((c) => c.name === "arr");
    expect(arr?.config).toEqual({ command: "npx", args: ["-y", "srv"], env: { K: "V" } });
    expect(arr?.warning).toContain("拆");
    const plain = r.candidates.find((c) => c.name === "plain");
    expect(plain?.config.command).toBe("node");
    const opReport = r.sources.find((s) => s.label === "OpenCode");
    expect(opReport?.skipped).toBe(2);
  });

  it("Claude Desktop（注入 APPDATA）+ 工作区 .mcp.json + 坏 JSON 报 error 不静默", async () => {
    const home = makeHome();
    const appData = makeHome();
    mkdirSync(path.join(appData, "Claude"), { recursive: true });
    writeFileSync(
      path.join(appData, "Claude", "claude_desktop_config.json"),
      JSON.stringify({ mcpServers: { desktop: { command: "node", args: ["d.js"] } } }),
      "utf8",
    );
    const ws = makeHome();
    writeFileSync(path.join(ws, ".mcp.json"), JSON.stringify({ mcpServers: { wsx: { command: "node" } } }), "utf8");
    mkdirSync(path.join(home, ".trae"), { recursive: true });
    writeFileSync(path.join(home, ".trae", "settings.json"), "{ 坏 JSON", "utf8");
    const r = await mcpImportScan({ homeDir: home, workspaceRoot: ws, appDataDir: appData });
    expect(r.candidates.map((c) => c.name).sort()).toEqual(["desktop", "wsx"]);
    const trae = r.sources.find((s) => s.label === "Trae");
    expect(trae?.error).toContain("解析失败");
  });

  it("parseCodexTomlMcpServers：坏括号报 error；无 mcp 段返回空", () => {
    expect(parseCodexTomlMcpServers("[mcp_servers.x]\ncommand = [\"unclosed\n").error).toBeDefined();
    expect(parseCodexTomlMcpServers('model = "gpt"\n').servers).toEqual({});
  });
});
