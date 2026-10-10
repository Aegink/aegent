/**
 * agent 进程协议（T9 / Q16）——分层聚合面（T1-4 起）。
 *
 * 消息形状（stdio JSON 行协议：一行一条 JSON，行分隔）：
 *   父 → 子  AgentRequest ：prompt / cancel / revert / approve /
 *                           model/switch（J6）/ dispose
 *   子 → 父  AgentMessage ：ready / accepted / event / approval_requested /
 *                           approval_settled / reverted / idle / error
 *
 * 分层（pi 形状，换传输只动帧层）：
 *   - protocol-framing.ts  ：帧边界（行长上限 / 行分帧）+ EP-9 版本握手；
 *   - protocol-payload.ts  ：业务载荷 schema（AgentRequest / AgentMessage /
 *                            decode* / 型证断言）；
 *   - 本文件                ：聚合 re-export（既有 import 路径零改动），
 *                            批 8 评估是否升格为唯一入口。
 *
 * 完整协议语义注释（idle / A9 收执纪律 / 可序列化两层验证）随载荷层
 * （protocol-payload.ts 头部）与帧层注释走。
 */

export * from "./protocol-framing.js";
export * from "./protocol-payload.js";