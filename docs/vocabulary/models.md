# 领域词汇表 · models（模型适配 / 流 / 附件 / 观测）

> 限界上下文：厂商适配、流式协议、附件与观测读面（`src/models/`、`src/attachments/`、`src/obs/`）。
> 词条纪律（T2/T-P1-122）：每词条必有 `_Avoid_` 行——命名分歧在词表层解决；
> `node tools/vocabulary-check.mjs` 机检结构。演进文档：新词条随域文档落。

## Language

### 厂商与流

**Provider（厂商适配器）**:
`ModelProvider` 接口的一个实现（openai-compat / anthropic-messages / echo……）；一个 provider 段可承载多个 modelId。
_Avoid_: 厂商名（vendor 指具体公司——provider 指适配器抽象）、模型（model 是 identity 二元组的一半）

**Model Identity（模型身份二元组）**:
`{provider, modelId}`——寻址一次模型调用的完整身份（J4）；换任一半即换模（J6）。
_Avoid_: 模型名（缺 provider 段）、端点（endpoint 是 URL 概念）

**Stream Chunk（流块）**:
`streamChat` 产出的最小增量单元（text-delta / reasoning-delta / tool-call-delta / usage / done）。
_Avoid_: token（token 是计量单位不是传输单元）、事件（SessionEvent 是事件流词汇——两个流不能混称）

**Usage（用量）**:
一次调用的 token 计量（input/output/cache_read/cache_creation_tokens）；按会话/按轮可查（L3）。
_Avoid_: 花费（cost 是派生计算值——我方不落 cost）、消耗（口语）

**Health（健康探测）**:
对 provider 的主动可达性/降级探测（J16：reachable / degraded / unreachable 三态）。
_Avoid_: 心跳（心跳是租约词汇——host 域）、监控（泛化）

### 附件与多模态

**Attachment（附件）**:
随消息附上的引用 + 存储实体：事件流只落 `AttachmentRef`（id/mediaType/name/size），字节在 `AttachmentStore`（流存引用不存字节）。
_Avoid_: 文件（文件是文件系统概念——附件的 source 可以是 url）、图片（图片是 mediaType 的子集）

**Attachment Source（附件来源）**:
类型化联合：`url` / `file`（本地路径引用）；字节经 store 落地后以 attachmentId 寻址。
_Avoid_: 上传（upload 指动作——source 指形状）、存储位置（存储是 store 的职责）

**Image Offload（图片卸载）**:
`image/offload` 事件承载的持久化决策：被选中的图片出现（seq + 索引）在后续请求面替换为占位文本；**只进不退**。
_Avoid_: 删除（字节保留在 store）、gc（不是垃圾回收——是容量治理）、与 compaction 混用

**ResolveImage（图片解析注入）**:
从流重建请求时把 AttachmentRef 解析为图片块的注入点（store 读取由调用方注入——投影函数保持纯函数）。
_Avoid_: 加载（load 暗示内置 IO——解析是注入的、可选的）

### 观测读面

**Transcript（会话记录检视）**:
E7 读面：事件流 → 人类可读的结构化条目流（回合帧/消息/工具/压缩标记）；与内核零依赖。
_Avoid_: 导出（export 是 E8 的落盘物）、日志（见 kernel.md 事件流词条）

**Replay（轨迹回放）**:
L4 读面：事件流 → 逐轮的模型请求级重放（identity / messages / response）——回答"这轮模型看到了什么、回了什么"；纯读、热路径零改动。
_Avoid_: 恢复（resume 是继续运行）、录制回放（O15/O16 的 llm-replay 是测试基建——另一物）、回放器泛称（replay 专指请求级重放读面）
