# 领域词汇表 · policy（权限 / 审批 / 沙箱）

> 限界上下文：权限链、审批、规则与沙箱（`src/policy/`、`src/sandbox/`）。
> 词条纪律（T2/T-P1-122）：每词条必有 `_Avoid_` 行——命名分歧在词表层解决；
> `node tools/vocabulary-check.mjs` 机检结构。演进文档：新词条随域文档落。

## Language

### 权限裁决

**Permission Chain（权限链）**:
按层序串联的裁决管线（Q15 裁决：权限权威是链，规则集只是链中一环；前匹配胜）。
_Avoid_: 规则列表（平列表是 Q14 否决的形态）、策略引擎（policy 指整个域不指某个机制）

**Rule（规则）**:
链中可匹配的授权/拒绝单元（allow/deny + scope + pattern）；规则不匹配时放行给下一环。
_Avoid_: 策略（policy 是域名词）、配置（配置指 settings/providers 等持久面）

**Allow / Ask / Deny（裁决三值）**:
链上模块产出的三值裁决；ask 升级为审批挂起，不是二值的中间态。
_Avoid_: yes/no（二值丢失 ask 的挂起语义）、pending（pending 是审批挂起状态不是裁决值）

**Fail-closed（默认拒绝）**:
不确定/异常路径一律按拒绝处理（如校验失败、判官不可达、规则语义不明）。
_Avoid_: 默认安全（含糊——安全方向必须是"拒绝"）、保守处理（没有说清动作）

### 审批

**Approval（审批）**:
用户（或受权端）对一次工具调用的单次放行/拒绝裁决；有 request/settle 生命周期与 source 审计。
_Avoid_: 授权（authorization 是持久授权——如信任变更；approval 是单次裁决）、确认（口语）

**Pending Approval（审批挂起）**:
工具调用等待裁决的中间状态；挂起可跨端答复、可超时（按拒绝结算）。
_Avoid_: 阻塞（blocked 是轮终态——不是一个可等待的状态）

**Approval Surface（答复端）**:
审批被答复的来源端记录（replySource）——可追溯到"谁在哪个端答复的"（L2）。
_Avoid_: 设备（device 是多端身份词汇——N 域）、客户端

**Judge（判官）**:
模型侧的辅助裁决位（C56）：判官意见是链上的一环输入，不是权威（权威仍是链）。
_Avoid_: AI 审批（暗示权威转移）、自动批准（判官可以 abstain 落回人）

### 信任与隔离

**Trust（信任级别）**:
项目/来源的可信分档（如 project trust），影响默认权限档位；变更走显式授权面。
_Avoid_: 安全级别（泛化）、白名单（白名单是具体机制不是信任本身）

**Sandbox（沙箱）**:
工具执行的可插隔离后端（local / Windows 受限令牌等）；网络隔离与文件系统管辖属其策略面。
_Avoid_: 容器（container 是实现形态之一——我方是后端抽象）、虚拟机

**Protected Path（保护路径）**:
出口级硬拦目标（T-P1-01 起）：不进入链上裁决、不可被用户规则授权的路径/元数据段。
_Avoid_: 黑名单（保护路径是硬拦截面不是规则匹配黑名单）、危险路径（危险判定在 dangerous-commands——另一面）

**Shell Semantics（shell 语义分析）**:
Q19 B 档：把 shell 命令翻译成虚拟工具操作使文件/危险规则可管住 shell 等价物；只做五种构造、不确定判 uncertain。
_Avoid_: 命令解析（不是完整语法树——C 档不做）、静态分析（泛化）
