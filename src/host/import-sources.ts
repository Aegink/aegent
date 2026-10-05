/**
 * 内置导入来源 spec 集（T-P3-150 A2/A3）——六家 agent 的声明式描述。
 * claude/codex 与旧手写适配器行为逐字等价；opencode 重写为 SQLite v1.x
 * 多候选路径（修 Windows 扫不到的过时缺陷）；workbuddy/pi/gemini 为新增。
 * 自定义来源（~/.aegent/import-sources.json）在 loadImportSpecs 合入。
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { parseCustomSources, type ImportSpec, LIMITS } from "./import-spec.js";

/** claude-code：~/.claude/projects/<编码目录>/*.jsonl——cwd 在每行、
 * sidechain 与 `<` 合成用户行过滤、tool_use/tool_result 块配对。 */
const CLAUDE: ImportSpec = {
  id: "claude",
  label: "Claude Code",
  driver: "jsonl-transcript",
  root: "~/.claude/projects",
  extension: ".jsonl",
  recursive: true,
  session: { titleFrom: "firstUser", projectFrom: "cwd" },
  entry: {
    rolePath: "type",
    roleMap: { user: "user", assistant: "assistant" },
    content: {
      blocks: { path: "message.content", typeField: "type", types: ["text"], textField: "text" },
    },
    tsPath: "timestamp",
    match: { path: "type", in: ["user", "assistant"] },
    skipTypePath: "isSidechain",
    skipTypes: ["true"],
    drop: { startsWith: ["<"], roles: ["user"] },
    toolCall: {
      callBlocks: {
        path: "message.content", typeField: "type", type: "tool_use",
        idPath: "id", namePath: "name", argsPath: "input", roles: ["assistant"],
      },
      resultBlocks: {
        path: "message.content", typeField: "type", type: "tool_result",
        idPath: "tool_use_id", resultPath: "content", statusPath: "is_error", roles: ["user"],
      },
    },
  },
};

/** codex：~/.codex/sessions 递归 .jsonl——{timestamp,type,payload} 信封解包
 * （新旧格式一份 spec 通吃）、cwd 在 payload、id 在 session_meta。 */
const CODEX: ImportSpec = {
  id: "codex",
  label: "Codex",
  driver: "jsonl-transcript",
  root: "~/.codex/sessions",
  extension: ".jsonl",
  recursive: true,
  maxFiles: 250,
  session: {
    // id/cwd 相对 unwrap 后的 payload 内层；idFromEntry 的 type 在外层信封
    idFrom: "id",
    idFromEntry: { path: "type", in: ["session_meta"] },
    titleFrom: "firstUser",
    projectFrom: "cwd",
  },
  entry: {
    unwrapPath: "payload",
    rolePath: "type",
    roleMap: { user_message: "user", agent_message: "assistant" },
    content: "message",
    tsPath: "timestamp",
    drop: { startsWith: ["<", "# AGENTS.md"], roles: ["user"] },
    toolCall: {
      call: {
        typePath: "type", types: ["function_call"], idPath: "call_id",
        namePath: "name", argsPath: "arguments", argsJson: true,
      },
      result: {
        typePath: "type", types: ["function_call_output"], idPath: "call_id",
        resultPath: "output", statusPath: "",
      },
    },
  },
};

/** opencode：SQLite v1.x 三层（session→message→part）——多候选路径按序
 * 探测（Windows %LOCALAPPDATA% / XDG_DATA_HOME / ~/.local/share）。 */
const OPENCODE: ImportSpec = {
  id: "opencode",
  label: "OpenCode",
  driver: "sqlite-session",
  db: [
    "%LOCALAPPDATA%\\opencode\\data\\opencode.db",
    "~/.local/share/opencode/opencode.db",
  ].join("|"),
  session: {
    table: "session", idCol: "id", titleCol: "title",
    pathCol: "directory", createdCol: "time_created", updatedCol: "time_updated",
  },
  message: {
    table: "message", idCol: "id", sessionIdCol: "session_id",
    createdCol: "time_created", dataCol: "data", rolePath: "role",
    tsPath: "time.created",
  },
  part: {
    table: "part", sessionIdCol: "session_id", dataCol: "data",
    createdCol: "time_created", textTypes: ["text"], toolType: "tool",
    toolNamePath: "tool", argsPath: "state.input", resultPath: "state.output",
    statusPath: "state.status",
  },
};

/** workbuddy：~/.workbuddy/projects 递归 .jsonl——system-reminder/cb_summary
 * 注入剥离、function_call 按 callId 配对。 */
const WORKBUDDY: ImportSpec = {
  id: "workbuddy",
  label: "WorkBuddy",
  driver: "jsonl-transcript",
  root: "~/.workbuddy/projects",
  extension: ".jsonl",
  recursive: true,
  session: { titleFrom: "firstUser", projectFrom: "parentDir" },
  entry: {
    rolePath: "role",
    content: "content",
    tsPath: "timestamp",
    drop: { startsWith: ["<"] },
    textOpsSpecNote: undefined,
    toolCall: {
      call: {
        typePath: "type", types: ["function_call"], idPath: "callId",
        namePath: "name", argsPath: "arguments", argsJson: true,
      },
      result: {
        typePath: "type", types: ["function_call_result"], idPath: "callId",
        resultPath: "output",
      },
    },
  },
} as ImportSpec;

/** pi：~/.pi/agent/sessions 递归 .jsonl——toolCall/toolResult 配对。 */
const PI: ImportSpec = {
  id: "pi",
  label: "Pi",
  driver: "jsonl-transcript",
  root: "~/.pi/agent/sessions",
  extension: ".jsonl",
  recursive: true,
  session: { titleFrom: "firstUser", projectFrom: "parentDir" },
  entry: {
    rolePath: "type",
    roleMap: { user: "user", assistant: "assistant", toolCall: "tool", toolResult: "tool" },
    content: {
      blocks: { path: "message.content", typeField: "type", types: ["text"], textField: "text" },
    },
    match: { path: "type", in: ["user", "assistant"] },
    drop: { startsWith: ["<"] },
  },
};

/** zcode：~/.zcode/cli/db/db.sqlite（sqlite-session 三层 session→message→part）。
 * part 同时挂 message_id/session_id（按 session 直取）；time 列为毫秒整数
 * （toIso 双单位秒/毫秒通吃）；part.textTypes 只取 text（reasoning/step-start/
 * model_change 跳过）；tool part 的 state.input/output 与 opencode 同形状。 */
const ZCODE: ImportSpec = {
  id: "zcode",
  label: "ZCode",
  driver: "sqlite-session",
  db: "~/.zcode/cli/db/db.sqlite",
  session: {
    table: "session", idCol: "id", titleCol: "title",
    pathCol: "directory", createdCol: "time_created", updatedCol: "time_updated",
    // T-P3-174 批次 7：子代理会话过滤（task_type="subagent_child"——本机
    // 278 会话中 175 个是子代理派生，导入页只收用户交互会话 interactive/
    // selection_side_chat；exclude 的 WHERE 等值排除面既有）
    exclude: [{ col: "task_type", equals: "subagent_child" }],
  },
  message: {
    table: "message", idCol: "id", sessionIdCol: "session_id",
    createdCol: "time_created", dataCol: "data", rolePath: "role",
    tsPath: "time.created",
  },
  part: {
    table: "part", sessionIdCol: "session_id", dataCol: "data",
    createdCol: "time_created", textTypes: ["text"], toolType: "tool",
    toolNamePath: "tool", argsPath: "state.input", resultPath: "state.output",
    statusPath: "state.status",
  },
} as ImportSpec;

/** gemini：~/.gemini/tmp 递归 chats 内 session-*.json——一文件一会话（json-tree）；
 * projectHash 无法反解真实目录——projectPath 置空（UI 归未定位组）。 */
const GEMINI: ImportSpec = {
  id: "gemini",
  label: "Gemini CLI",
  driver: "json-tree",
  root: "~/.gemini/tmp",
  extension: ".json",
  recursive: true,
  session: { idPath: "sessionId", tsPath: "lastUpdated", messagesPath: "messages" },
  message: {
    rolePath: "type",
    roleMap: { user: "user", gemini: "assistant", model: "assistant" },
    content: {
      blocks: { path: "content", typeField: "text", types: ["text"], textField: "text" },
    },
    tsPath: "timestamp",
  },
};

/** 内置 spec 顺序即扫描卡片顺序。 */
export const BUILTIN_SPECS: ImportSpec[] = [CLAUDE, CODEX, OPENCODE, WORKBUDDY, PI, GEMINI, ZCODE];

/** 自定义来源配置文件（全局——~/.aegent/import-sources.json）。 */
export function customSourcesPath(home: string = homedir()): string {
  return path.join(home, ".aegent", "import-sources.json");
}

/** 合载内置 + 自定义 spec（坏配置不中断——错误经 customErrors 上抛 UI）。 */
export function loadImportSpecs(home: string = homedir()): {
  specs: ImportSpec[];
  customErrors: string[];
  customCount: number;
} {
  const configPath = customSourcesPath(home);
  let customErrors: string[] = [];
  let customs: ImportSpec[] = [];
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      if (raw.length <= LIMITS.maxSpecBytes) {
        const parsed = parseCustomSources(raw);
        customs = parsed.specs;
        customErrors = parsed.errors;
      } else {
        customErrors = [`自定义来源配置超过 ${String(Math.round(LIMITS.maxSpecBytes / 1024))}KB 上限`];
      }
    } catch (e) {
      customErrors = [`自定义来源配置读取失败：${e instanceof Error ? e.message : String(e)}`];
    }
  }
  return { specs: [...BUILTIN_SPECS, ...customs], customErrors, customCount: customs.length };
}
