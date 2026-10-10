/**
 * notebook_edit 工具（T-P3-174 批次 1，qwen notebook-edit.ts 同构语义）——
 * Jupyter notebook（.ipynb）的单元格级安全编辑：replace（改 source，可顺带
 * 转换类型）/ insert（插新格，默认 code，cell_id 省略插头部）/ delete。
 *
 * 实现纪律（qwen utils/notebook.ts 同款，手写 JSON 不引 nbformat 依赖）：
 *   - 解析剥 BOM → JSON.parse → 校验 cells 数组；序列化保留原缩进与尾随
 *     换行（diff 最小化）；
 *   - 单元格定位：真实 cell.id 优先；旧格式无 id 回退 `cell-N`（0 基显示
 *     id）；重复/歧义 id 类型化报错（不猜目标）；
 *   - 编辑 code cell 一律重置 execution_count=null、outputs=[]（本工具不
 *     执行代码——陈旧输出与编辑后 source 不一致就是谎言）；markdown cell
 *     删除这两个字段；新 cell metadata 置空对象；
 *   - 写面走写队列（与 write/edit 同互斥）+ PathGuard（工作区边界）。
 *
 * 与 qwen 的偏离（记档）：无 prior-read 强制缓存（aegent 无 FileReadCache
 * 基建——TOCTOU 面由写队列串行 + mtime 前后校验兜底）；不支持编辑
 * output/metadata（qwen 同款闭集——只有 source 可编辑）。
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PathGuard, PathGuardError } from "../../src/sandbox/path-guard.js";
import type { WriteQueue } from "../../src/core/index.js";
import type { ToolDef } from "../../src/core/index.js";
import type { ToolExecutionResult } from "../../src/kernel/loop.js";
import { toolError } from "./util.js";

export type NotebookCellType = "code" | "markdown";
export type NotebookEditMode = "replace" | "insert" | "delete";

export interface NotebookEditArgs {
  notebook_path: string;
  cell_id?: string;
  new_source?: string;
  cell_type?: NotebookCellType;
  edit_mode?: NotebookEditMode;
}

interface NotebookCell {
  cell_type: string;
  source: string | string[];
  metadata: Record<string, unknown>;
  id?: string;
  execution_count?: number | null;
  outputs?: unknown[];
  [key: string]: unknown;
}

interface NotebookDoc {
  cells: NotebookCell[];
  [key: string]: unknown;
}

/** 单元格显示 id：真实 id 优先，旧格式回退 cell-N（0 基）。 */
function getCellDisplayId(cell: NotebookCell, index: number): string {
  return typeof cell.id === "string" && cell.id !== "" ? cell.id : `cell-${String(index)}`;
}

/** 解析 ipynb（剥 BOM + 结构校验）。 */
function parseNotebook(raw: string): NotebookDoc {
  const cleaned = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const doc = JSON.parse(cleaned) as unknown;
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("notebook 根节点不是 JSON 对象");
  }
  const cells = (doc as NotebookDoc).cells;
  if (!Array.isArray(cells)) throw new Error("notebook 缺少 cells 数组");
  for (const cell of cells) {
    if (cell === null || typeof cell !== "object" || Array.isArray(cell)) {
      throw new Error("cells 含非对象成员");
    }
  }
  return doc as NotebookDoc;
}

/** 探测原文件缩进（空格数或 tab）与尾随换行——序列化保真（diff 最小化）。 */
function inferJsonFormat(raw: string): { indent: string; trailingNewline: boolean } {
  const match = /\n([ \t]+)"/.exec(raw);
  const indent = match?.[1] ?? "  ";
  return { indent, trailingNewline: raw.endsWith("\n") };
}

function serializeNotebook(doc: NotebookDoc, format: { indent: string; trailingNewline: boolean }): string {
  const text = JSON.stringify(doc, null, format.indent === "\t" ? "\t" : format.indent.length);
  return format.trailingNewline ? `${text}\n` : text;
}

/** 定位目标格：唯一匹配显示 id；找不到/歧义都是类型化错误。 */
function findCellIndex(doc: NotebookDoc, cellId: string): number {
  const exact: number[] = [];
  const fallback: number[] = [];
  doc.cells.forEach((cell, i) => {
    if (typeof cell.id === "string" && cell.id !== "") {
      if (cell.id === cellId) exact.push(i);
    } else if (`cell-${String(i)}` === cellId) {
      fallback.push(i);
    }
  });
  const hits = exact.length > 0 ? exact : fallback;
  if (hits.length === 0) return -1;
  if (hits.length > 1) return -2; // 歧义
  return hits[0] ?? -1;
}

/** 编辑后的归一化：code 重置执行事实；markdown 删除执行字段；metadata 置空。 */
function normalizeEditedCell(cell: NotebookCell, cellType: NotebookCellType): void {
  cell.cell_type = cellType;
  if (cellType === "code") {
    cell.execution_count = null;
    cell.outputs = [];
  } else {
    delete cell.execution_count;
    delete cell.outputs;
  }
  cell.metadata = {};
}

function toSource(value: string, keepArray: boolean): string | string[] {
  // source 风格跟随原 cell（string 或 string[]——qwen toNotebookSource 同构）
  if (!keepArray) return value;
  return value.split("\n").map((line, i, arr) => (i < arr.length - 1 ? `${line}\n` : line));
}

export function createNotebookEditTool(options: {
  pathGuard: PathGuard;
  writeQueue: WriteQueue;
  /** 相对路径解析基（缺省进程 cwd——与 pathGuard 缺省同纪律）。 */
  workspaceRoot?: string;
}): ToolDef {
  return {
    name: "notebook_edit",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        notebook_path: {
          type: "string",
          description: "Path to the Jupyter notebook file to edit. Must end with .ipynb.",
        },
        cell_id: {
          type: "string",
          description:
            "Target cell ID from read output, or cell-N 0-based fallback. Required for replace and delete. " +
            "For insert, the new cell is inserted after this cell; if omitted, inserted at the beginning.",
        },
        new_source: {
          type: "string",
          description: "New source content for replace and insert operations. Not required for delete.",
        },
        cell_type: {
          type: "string",
          enum: ["code", "markdown"],
          description: "Cell type for inserted cells or type conversion on replace.",
        },
        edit_mode: {
          type: "string",
          enum: ["replace", "insert", "delete"],
          description: "Notebook edit operation. Defaults to replace.",
        },
      },
      required: ["notebook_path"],
    },
    async execute(args) {
      const a = args as Partial<NotebookEditArgs>;
      const filePath = a.notebook_path;
      const editMode = a.edit_mode ?? "replace";
      if (typeof filePath !== "string" || filePath === "") {
        return toolError("NotebookEditError", "INVALID_ARGUMENTS", "notebook_edit 需要 notebook_path（非空字符串）");
      }
      if (!filePath.toLowerCase().endsWith(".ipynb")) {
        return toolError(
          "NotebookEditError",
          "INVALID_ARGUMENTS",
          "必须是 .ipynb 文件——其他文件类型用 edit/write 工具",
        );
      }
      if (editMode !== "insert" && editMode !== "delete" && editMode !== "replace") {
        return toolError(
          "NotebookEditError",
          "INVALID_ARGUMENTS",
          `不支持的编辑模式：${String(editMode)}（replace/insert/delete）`,
        );
      }
      if (editMode !== "delete" && (typeof a.new_source !== "string")) {
        return toolError(
          "NotebookEditError",
          "INVALID_ARGUMENTS",
          `edit_mode 为 "${editMode}" 时需要 new_source`,
        );
      }
      if (editMode !== "insert" && typeof a.cell_id !== "string") {
        return toolError(
          "NotebookEditError",
          "INVALID_ARGUMENTS",
          "replace 与 delete 需要 cell_id",
        );
      }
      if (a.cell_type !== undefined && a.cell_type !== "code" && a.cell_type !== "markdown") {
        return toolError(
          "NotebookEditError",
          "INVALID_ARGUMENTS",
          `cell_type 只支持 code | markdown，收到：${String(a.cell_type)}`,
        );
      }
      const abs = path.isAbsolute(filePath)
        ? path.normalize(filePath)
        : path.resolve(options.workspaceRoot ?? process.cwd(), filePath);
      // 工作区边界（写面守卫——与 write/edit 同款出口级硬拦）
      try {
        await options.pathGuard.assertWritable(abs);
      } catch (e) {
        if (e instanceof PathGuardError) {
          return toolError("NotebookEditError", e.code, e.message);
        }
        throw e;
      }
      let before = "";
      try {
        const info = await stat(abs);
        if (!info.isFile()) {
          return toolError("NotebookEditError", "FILE_NOT_FOUND", `notebook 文件不存在：${abs}`);
        }
        before = await readFile(abs, "utf8");
      } catch (e) {
        return toolError(
          "NotebookEditError",
          (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
          `读取 notebook 失败：${(e as Error).message}`,
        );
      }
      let doc: NotebookDoc;
      const format = inferJsonFormat(before);
      try {
        doc = parseNotebook(before);
      } catch (e) {
        return toolError(
          "NotebookEditError",
          "NOTEBOOK_INVALID_JSON",
          `notebook 解析失败：${(e as Error).message}`,
        );
      }
      // 编辑（错误面：目标格缺失/歧义 → 类型化报错，文件不动）
      const cellType = a.cell_type;
      if (editMode === "insert") {
        const source = a.new_source ?? "";
        const newCell: NotebookCell = {
          cell_type: cellType ?? "code",
          source: toSource(source, false),
          metadata: {},
        };
        normalizeEditedCell(newCell, cellType ?? "code");
        let insertAt = 0;
        if (a.cell_id !== undefined) {
          const targetIndex = findCellIndex(doc, a.cell_id);
          if (targetIndex === -1) {
            return toolError(
              "NotebookEditError",
              "NOTEBOOK_CELL_NOT_FOUND",
              `找不到单元格 "${a.cell_id}"（先 read notebook 再按显示 id 编辑）`,
            );
          }
          if (targetIndex === -2) {
            return toolError(
              "NotebookEditError",
              "NOTEBOOK_CELL_AMBIGUOUS",
              `单元格 id "${a.cell_id}" 有歧义——重读 notebook 并以稳定真实 id 为目标`,
            );
          }
          insertAt = targetIndex + 1;
        }
        doc.cells.splice(insertAt, 0, newCell);
      } else {
        const targetIndex = findCellIndex(doc, a.cell_id ?? "");
        if (targetIndex === -1) {
          return toolError(
            "NotebookEditError",
            "NOTEBOOK_CELL_NOT_FOUND",
            `找不到单元格 "${String(a.cell_id)}"（先 read notebook 再按显示 id 编辑）`,
          );
        }
        if (targetIndex === -2) {
          return toolError(
            "NotebookEditError",
            "NOTEBOOK_CELL_AMBIGUOUS",
            `单元格 id "${String(a.cell_id)}" 有歧义——重读 notebook 并以稳定真实 id 为目标`,
          );
        }
        if (editMode === "delete") {
          doc.cells.splice(targetIndex, 1);
        } else {
          const target = doc.cells[targetIndex];
          if (target === undefined) {
            return toolError("NotebookEditError", "NOTEBOOK_CELL_NOT_FOUND", "目标单元格缺失");
          }
          const finalType = cellType ?? (target.cell_type === "markdown" ? "markdown" : "code");
          target.source = toSource(a.new_source ?? "", Array.isArray(target.source));
          normalizeEditedCell(target, finalType);
        }
      }
      // 写面：写队列互斥（与 write/edit 同一队列）+ 读后校验（读后被外部
      // 改动 → 拒绝写，防覆盖）
      const after = serializeNotebook(doc, format);
      const writeOutcome = await options.writeQueue.run(abs, async (): Promise<ToolExecutionResult | null> => {
        let current = "";
        try {
          current = await readFile(abs, "utf8");
        } catch {
          current = "";
        }
        if (current !== before) {
          return toolError(
            "NotebookEditError",
            "FILE_CHANGED_SINCE_READ",
            "notebook 在本次读取后又被修改——重读后再编辑",
          );
        }
        try {
          await writeFile(abs, after, "utf8");
        } catch (e) {
          return toolError(
            "NotebookEditError",
            (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
            `notebook 写入失败：${(e as Error).message}`,
          );
        }
        return null;
      });
      if (writeOutcome !== null) return writeOutcome;
      return {
        content: `notebook 已编辑（${editMode}${a.cell_id !== undefined ? ` @ ${a.cell_id}` : ""}）：${abs}\n受编辑的 code 单元格执行事实已重置（execution_count=null、outputs=[]）。`,
        meta: { path: abs, editMode: editMode, cellCount: doc.cells.length },
      };
    },
  };
}
