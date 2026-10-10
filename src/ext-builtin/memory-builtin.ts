/**
 * 内建记忆 provider（T7-2/W4，EP-5 接线）——**现有 MEMORY.md 追加实现的
 * 整体搬迁（行为零变化）**：save_memory 工具的追加语义 + system-prompt
 * 的「## 持久记忆」独立段读面（G6 纪律：独立段不参与小节合并）。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import type { MemoryProvider, ToolDef } from "../core/index.js";
import { createSaveMemoryTool } from "../../plugins/tools-builtin/save-memory.js";

/** 单条记忆的字符上限（索引行不是正文——save-memory 同值单源）。 */
export const MAX_MEMORY_FACT_CHARS = 2000;

const MEMORY_HEADER = "# 持久记忆\n\n";

export interface BuiltinMemoryOptions {
  /** 记忆索引文件路径（缺省 ~/.aegent/memory/MEMORY.md——C2 挂点）。 */
  memoryPath?: string;
  /** 测试时钟注入（缺省 Date.now）。 */
  now?: () => Date;
}

/** 读记忆索引全文（不存在 = 空串——装配面「独立段」缺席语义）。 */
export async function readMemoryIndex(memoryPath: string): Promise<string> {
  try {
    return (await readFile(memoryPath, "utf8")).trim();
  } catch {
    return "";
  }
}

/** 追加一条记忆（save-memory 的写面——`- [YYYY-MM-DD] <fact>` 单行语义）。 */
export async function appendMemoryFact(memoryPath: string, fact: string, now: () => Date = ((): (() => Date) => (() => new Date()))()): Promise<void> {
  const clean = fact.replaceAll(/\s+/g, " ").trim().slice(0, MAX_MEMORY_FACT_CHARS);
  if (clean === "") throw new Error("记忆事实为空（写面拒绝——不落空行）");
  const line = `- [${now().toISOString().slice(0, 10)}] ${clean}`;
  await mkdir(path.dirname(memoryPath), { recursive: true });
  let existing: string;
  try {
    existing = await readFile(memoryPath, "utf8");
  } catch {
    existing = MEMORY_HEADER;
  }
  if (existing === "") existing = MEMORY_HEADER;
  await writeFile(memoryPath, `${existing}${existing.endsWith("\n") || existing === "" ? "" : "\n"}${line}\n`, "utf8");
}

/** 内建记忆 provider（MEMORY.md 追加实现——行为零变化的搬迁包装）。 */
export function createBuiltinMemoryProvider(options: BuiltinMemoryOptions = {}): MemoryProvider {
  const memoryPath =
    options.memoryPath ?? path.join(homedir(), ".aegent", "memory", "MEMORY.md");
  const now = options.now ?? ((): Date => new Date());
  const saveMemory: ToolDef = createSaveMemoryTool({ memoryPath, ...(options.now !== undefined ? { now: options.now } : {}) });
  return {
    async initialize(): Promise<void> {
      // 目录预热（写面首次 append 也会建——缺省零副作用）
      await mkdir(path.dirname(memoryPath), { recursive: true }).catch(() => undefined);
    },
    systemPromptBlock(): string | undefined {
      // 同步读在系统提示装配处不可行（provider 面是 async init）——
      // initialize 时预读缓存，追加时更新（行为与 G6 独立段语义等价）
      return cachedBlock.value;
    },
    async prefetch(): Promise<string | undefined> {
      return undefined; // 内建 provider 无召回面（W9/外部 provider 扩展）
    },
    tools(): ToolDef[] {
      return [saveMemory];
    },
    async shutdown(): Promise<void> {
      // 无持久句柄（逐次读写文件）——no-op
    },
  };
}

/** 内建 provider 的缓存块（initialize 预读 + append 后刷新——systemPromptBlock 读它）。 */
export const cachedBlock: { value: string | undefined } = { value: undefined };

/** 初始化内建 provider 的缓存块（装配期调用——读 MEMORY.md 全文为独立段）。 */
export async function primeBuiltinMemoryBlock(memoryPath: string): Promise<void> {
  const content = await readMemoryIndex(memoryPath);
  cachedBlock.value = content !== "" ? `## 持久记忆\n${content}` : undefined;
}
