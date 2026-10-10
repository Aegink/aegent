/**
 * 模型契约（T1-2 自 src/models/{provider,identity}.ts 下沉——原 T2-1 范围
 * 提前：queue.ts（骨架）meta 字段引用 ModelProvider/ModelIdentity，core
 * 出边归零倒逼契约先行；models 域反向实现 + re-export 垫片）。
 *
 * 边界：内核（阶段 3 loop）只见 ModelProvider，不见任何厂商 wire 形状
 * （形状取 pi·packages/ai 的"适配独立目录"边界）。增量词汇直接采用
 * 词汇表 `StreamChunk`（skeleton/events.ts：text-delta / reasoning-delta /
 * tool-call-delta / usage / done），不另设 Delta 类型。
 */

import type { JsonValue, StreamChunk } from "../skeleton/events.js";

/** 模型身份（J4）——身份键永远是 {provider, modelId} 二元组，绝不用裸 model 名
 * （形状取 pi·agent-harness.ts 的 ModelIdentity：同名模型跨厂商可区分）。 */
export interface ModelIdentity {
  provider: string;
  modelId: string;
}

export interface ChatTool {
  name: string;
  description: string;
  /** JSON Schema 形式的参数描述（对内核不透明，原样透传给厂商） */
  parameters: JsonValue;
}

/** 用户消息携带的图片块（P1/T-P1-124——声明性追加于 content 之后；data 为 base64）。 */
export interface ChatImage {
  /** MIME 类型（attachments 域白名单闭集内的值）。 */
  mediaType: string;
  /** 原始字节 base64。 */
  data: string;
}

/** 用户消息携带的音频块（T-P3-149 E1——OpenAI input_audio 语义；仅 wav/mp3
 * 可直读，其余格式在投影层保持占位行降级）。 */
export interface ChatAudio {
  mediaType: string;
  data: string;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | {
      role: "user";
      content: string;
      /** 随消息附上的图片（P1）；无附件时缺省——既有路径零变化。 */
      images?: ChatImage[];
      /** 随消息附上的音频（T-P3-149 E1）；缺省零变化。 */
      audios?: ChatAudio[];
    }
  | {
      role: "assistant";
      content: string;
      /** 上游模型已发出的调用（回传给厂商续话时使用） */
      toolCalls?: { id: string; name: string; arguments: string }[];
    }
  | { role: "tool"; callId: string; content: string; isError?: boolean };

export interface ChatRequest {
  /** 目标模型（provider 段由承载方隐含，modelId 随请求指定） */
  identity: ModelIdentity;
  messages: ChatMessage[];
  tools?: ChatTool[];
  signal?: AbortSignal;
  /**
   * 默认思考档（T-P3-137 三轮真实消费——settings providers 模型级 reasoning
   * 透传；off/缺省 = 请求不带思考参数。各适配层自行映射 wire 形状）。
   */
  reasoningEffort?: string;
  /** 原生联网搜索（anthropic 形态附 web_search server 工具；openai chat 无此能力）。 */
  webSearch?: boolean;
  /**
   * 单次响应输出上限 token（T-P3-145——子代理 maxTokens 消费面；缺省 =
   * 跟随模型/服务端默认。各适配层自行映射 wire 字段）。
   */
  maxTokens?: number;
}

export interface ModelProvider {
  /** 单次流式调用：一次连接、顺序产出 StreamChunk，done 后终止。 */
  streamChat(req: ChatRequest): AsyncIterable<StreamChunk>;
}
