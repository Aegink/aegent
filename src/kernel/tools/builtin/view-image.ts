/**
 * view_image 工具（T-P3-174 批次 1，codex view_image 同款）——本地图片
 * 注入模型上下文。OpenAI-compat wire 上 tool 消息只吃字符串正文，图片
 * 内容块只能在 user 消息上——本工具把字节写进 AttachmentStore 并在结果
 * meta 里带 imageAttachment 引用，loop 在 tool/result 落流**之后**追加一
 * 条 source=injected 的 user/message（attachments=[ref]）——投影层经
 * resolveImage 展开为 image_url 块（附件链复用，input_audio 同构纪律）。
 * wire 序：assistant(tool_calls) → tool(result) → user(image) → assistant。
 *
 * 大小上限 20MB（codex 无上限但历史层统一缩放；aegent 无缩放面——超限
 * 类型化拒绝比塞爆请求面诚实）。格式闭集 png/jpeg/gif/webp（魔数嗅探
 * 优先、扩展名兜底；svg 等矢量格式 provider 侧支持参差，显式拒绝）。
 * 只读工具（parallel 声明；事件追加由 loop 做，工具本体零落流）。
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { AttachmentStore } from "../../../attachments/store.js";
import { PathGuard, PathGuardError } from "../../../sandbox/path-guard.js";
import type { ToolDef } from "../registry.js";
import type { ToolExecutionResult } from "../../loop.js";
import { toolError } from "./util.js";

/** 图片字节上限（20MB）。 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** 魔数 → mediaType（嗅探优先于扩展名——内容才是真相）。 */
function sniffImageMime(bytes: Uint8Array): string | null {
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length > 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    (bytes[3] === 0x37 || bytes[3] === 0x39)
  ) {
    return "image/gif";
  }
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

const EXT_MIME: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function createViewImageTool(options: {
  attachments: AttachmentStore;
  pathGuard: PathGuard;
  /** 相对路径的解析基（缺省进程 cwd——与 pathGuard 缺省同纪律）。 */
  workspaceRoot?: string;
}): ToolDef {
  return {
    name: "view_image",
    parallel: true, // B17：纯读（事件追加在 loop，工具本体零落流零副作用）
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Local filesystem path to an image file (png/jpeg/gif/webp).",
        },
      },
      required: ["path"],
    },
    async execute(args): Promise<ToolExecutionResult> {
      const filePath = args["path"];
      if (typeof filePath !== "string" || filePath === "") {
        return toolError("ViewImageError", "INVALID_ARGUMENTS", "view_image 需要 path（非空字符串）");
      }
      const abs = path.isAbsolute(filePath)
        ? path.normalize(filePath)
        : path.resolve(options.workspaceRoot ?? process.cwd(), filePath);
      try {
        await options.pathGuard.assertReadable(abs);
      } catch (e) {
        if (e instanceof PathGuardError) {
          return toolError("ViewImageError", e.code, e.message);
        }
        throw e;
      }
      let info;
      try {
        info = await stat(abs);
      } catch (e) {
        return toolError(
          "ViewImageError",
          (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
          `无法访问图片：${abs} —— ${(e as Error).message}`,
        );
      }
      if (!info.isFile()) {
        return toolError("ViewImageError", "NOT_A_FILE", `图片路径不是文件：${abs}`);
      }
      if (info.size > MAX_IMAGE_BYTES) {
        return toolError(
          "ViewImageError",
          "IMAGE_TOO_LARGE",
          `图片过大（${String(info.size)} 字节 > 上限 ${String(MAX_IMAGE_BYTES)}）：${abs}`,
        );
      }
      let bytes: Buffer;
      try {
        bytes = await readFile(abs);
      } catch (e) {
        return toolError(
          "ViewImageError",
          (e as NodeJS.ErrnoException).code ?? "IO_ERROR",
          `读取图片失败：${abs} —— ${(e as Error).message}`,
        );
      }
      const mime = sniffImageMime(bytes) ?? EXT_MIME[path.extname(abs).toLowerCase()] ?? null;
      if (mime === null) {
        return toolError(
          "ViewImageError",
          "UNSUPPORTED_FORMAT",
          `无法识别为受支持的图片格式（png/jpeg/gif/webp）：${abs}`,
        );
      }
      const ref = options.attachments.save({
        mediaType: mime,
        data: bytes.toString("base64"),
        ...(path.basename(abs) !== "" ? { name: path.basename(abs) } : {}),
      });
      return {
        content:
          `[image loaded: ${ref.name ?? "image"} (${mime}, ${String(info.size)}B, id=${ref.attachmentId})] ` +
          "图片已注入下一次模型请求（作为随后的 user 消息附件）。",
        meta: {
          path: abs,
          mediaType: mime,
          // loop 消费：tool/result 落流后追加 source=injected 的 user/message
          //（attachments=[ref]）——投影层经 resolveImage 展开为 image_url 块
          imageAttachment: { ...ref },
        },
      };
    },
  };
}
