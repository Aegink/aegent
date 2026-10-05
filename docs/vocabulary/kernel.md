# 领域词汇表 · kernel（事件 / 轮次 / 上下文）

> 限界上下文：事件流、轮次循环、上下文管理与压缩（`src/kernel/`、`src/context/`、`src/session/`）。
> 词条纪律（T2/T-P1-122）：每词条必有 `_Avoid_` 行——命名分歧在词表层解决；
> `node tools/vocabulary-check.mjs` 机检结构。演进文档：新词条随域文档落。

## Language

### 轮次与循环

**Turn（轮）**:
从一条用户输入进入到该输入产生最终终止的完整循环；一轮可含多个 step。轮是恢复、预算与终态（TurnEndReason）的计量单位。
_Avoid_: 会话（session 是多轮的容器）、对话（口语）、一次请求（一轮含多次模型请求）

**Step（步）**:
一轮内的单次模型调用周期（step/start 到 step/end）：组装请求 → 流式产出 → 工具派发。
_Avoid_: 轮（turn）、请求（request/header 记录的是 step 级事实）

**Prompt（用户输入）**:
经队列准入后驱动轮次启动的用户消息；prompt 的应答是"accepted 收执"而非结果（A9 纪律）。
_Avoid_: 提示词模板（那是静态模板资产）、promptId 混用（promptId 是关联键不是完成句柄）

**Steer（转向注入）**:
用户对**在途轮**的中途输入，受理后注入同一轮继续影响模型。
_Avoid_: 排队消息（那是 idle 时的 prompt 队列）、插话（口语）

**Injected（系统注入）**:
系统侧（预算提醒、时间提醒等）放进上下文的消息，`user/message.source = "injected"`。
_Avoid_: 与 steer 混用——steer 是用户行为、injected 是系统行为，二者同走注入通道但来源不同

### 事件流

**Event Stream（事件流）**:
会话的唯一事实源：append-only 的 SessionEvent 序列，状态一律从流重建（流即状态）。
_Avoid_: 日志（日志暗示可丢弃——事件流不可重建性地丢弃）、流水

**Session（会话）**:
一条事件流及其全部派生状态的容器，由 sessionId 寻址；fork 从切点复制出新会话。
_Avoid_: 对话、线程（thread 是 codex 词汇——我方统一 session）

**Log-only Event（log-only 事件）**:
不进入模型历史、仅落流供检视/投影的会话级元事件（如 surface/attach、todo/update）；跨 compaction 保留。
_Avoid_: 隐藏事件（不是隐藏——是"模型可见性"维度的分类）

**Compaction（上下文压缩）**:
上下文超限时对历史做的结构化收缩（E17 三态：started/completed/failed），产出摘要并推进重建基线。
_Avoid_: 总结（总结是压缩的实现手段之一）、清理（清理暗示删除——压缩是派生基线推进，原始事件不删）

**Offload（卸载）**:
把图片从模型上下文移出并**持久化该决策**为 `image/offload` 事件；只进不退，回取是显式动作。
_Avoid_: 删除（附件字节不删）、与 compaction 混用（压缩收文本历史、卸载移图片出请求面——两个容量维度）

**Revert（回退）**:
把有效视窗切回流内某个历史切点（session/revert 事件）；切点后的事件仍在流内、只被视窗排除。
_Avoid_: 删除历史、撤销（undo 是 revert 的 undo 相位——phase 字段区分）

### 运行时与恢复

**Resume / Restore（恢复）**:
进程重启后从事件流重建运行态并继续服务；恢复语义以流为准（如 running → interrupted 对账）。
_Avoid_: 重放（replay 是只读检视——L4 词汇）、回滚（回滚暗示回到过去状态运行）

**Checkpoint（检查点）**:
代码状态快照的引用事件（checkpoint——provider + ref）；与 compaction 检查点（兜底恢复点）分域。
_Avoid_: 快照（snapshot 泛指——checkpoint 专指落流引用事件）

**Thinking Override（思考档覆盖）**:
会话级思考档选择的持久事实（thinking/set——level 整值，流内最新即事实源）——child 启动 restore 扫流重建，重启后档位保持。
_Avoid_: 设置（settings 是全局配置——覆盖是会话级选择）、推理参数（reasoning 是模型档位声明——override 是用户显式覆盖）

**TurnEndReason（轮终态）**:
轮结束原因的闭集枚举（completed / aborted / blocked / max-tokens 等）——落 turn/end。
_Avoid_: 错误码（终态不是错误）、status（泛化词）

### 会话间协作

**Collaboration Message（协作消息）**:
会话 A 派任务/发消息给会话 B 的持久事实（三型 task/message/completion + 生命周期 queued/running/completed/failed/cancelled）——落流内 `session/collab` 事件（单类型 + direction 区分视角：dispatch/receive/update/report，双方流各自落事件）；completion 回投源会话流。**权限上限快照**在派发时固化（后续设置变更双向不影响——防提权）。
_Avoid_: 子代理（subagent 是同进程内的派生执行——H 族；协作是会话对会话）、消息（message 泛指——协作消息专指跨会话往来事实）、引用（session reference 是只读快照注入——E9）
