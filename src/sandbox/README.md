# sandbox —— 网络策略（D3 / T-6-03）

> ## ⚠️ P0 弱承诺（务必先读）
>
> **网络策略只在工具层生效：它只拦经由 `NetworkGuard.fetch` 发起的请求。**
> 它**不承诺**管住任意子进程的网络行为（bash 里 `curl` 一切照旧）、不承诺
> 管住模型接入层（provider 直连厂商）的流量、也不承诺管住本守卫之外的
> 其他网络入口。OS 级强制（WFP / 受限令牌）在 P1（D6/D16）——在此之前，
> **不要把 deny 档当成网络隔离的承诺**（Q17 纪律：不假装已管住）。

## 是什么

- `NetworkPolicy = "allow" | "deny"`——网络是**独立的一档**，与路径守卫
  （[C7/D1](./path-guard.ts)，见 `docs/sandbox-path-limitations.md`）、权限链
  （C 层）互不依赖、互不影响：可以单独禁网而不禁进程、不禁文件。
- `createNetworkGuard({ policy })` 返回 `{ policy, fetch }`；`fetch` 与全局
  fetch 同形状（drop-in），deny 档在**任何真实 I/O 之前**抛
  `NETWORK_DENIED`（错误含目标 URL），allow 档原样透传。

## 怎么接线

- 装配处创建 guard，把 `guard.fetch` 注入给需要网络的工具（D4 纪律：能力
  经注入面拿）。
- **网络类工具不得直接使用全局 fetch**——这是约定面（P0 无网络类工具，
  B8 webfetch 等 P1 工具落地时必须经此入口）。
- P0 的模型接入层（`src/models/`）不走本守卫：J 层是内核自身的厂商流量，
  不属于"工具层 fetch"；禁网档不断模型连接。

## 验收对照

- deny 档工具内 fetch 被拦且错误码 `NETWORK_DENIED` ✓（`network.test.ts`）
- allow 档放行（对 localhost 真端口）✓
- 本 README 含弱承诺声明 ✓（人工确认清单 D3 行的核对对象）
