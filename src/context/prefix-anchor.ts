/**
 * 缓存锚与前缀保真（F6/F13/F15，T-P1-19）——openai-compat 无显式
 * cache_control wire，"前缀保真"是**装配纪律**而非 wire 标记（pi-mono
 * anthropic-cache-split.ts 的"Output must remain byte-identical for a given
 * input"纪律按语义落）。
 *
 * 缓存锚 = 稳定前缀的字节序：system 提示 + tools 清单。会话体（user/
 * assistant/tool 消息）是追加序——每次请求在尾部增长，绝不改写既有前缀。
 * 锚变化的三种形态（describeAnchorChange）：
 *   - identical  锚逐字节不变（换模的正确形态——F13"模型/推理档变更不得
 *                作废已缓存前缀"的断言面）；
 *   - appended   旧锚是新月标的字节前缀（位置性追加——F13 允许的变更形态，
 *                已缓存前缀全部存活）；
 *   - rewritten  其余变化（前缀作废——工具 schema 原地加载、system 改写等；
 *                每次发生都是一次真实缓存失效，运维面可见）。
 */

import type { ChatTool } from "../models/provider.js";

/** 缓存锚变化（loop 逐请求检测后的通知载荷）。 */
export interface PrefixChange {
  from: string;
  to: string;
  kind: "appended" | "rewritten";
  /** 本次请求的模型身份相对上次是否变化（F13：换模时锚必须 identical）。 */
  modelSwitched: boolean;
}

/**
 * 计算缓存锚（system + tools 的确定性字节序）。段以固定标签开头、段间以
 * 换行分隔——追加一个工具 = 在末尾追加一段（appended 判定的前提）。只作
 * 内存观测值，不落事件流（C14 面不涉及）。
 */
export function computeCacheAnchor(
  system: string | undefined,
  tools: readonly ChatTool[] | undefined,
): string {
  const parts: string[] = [];
  if (system !== undefined) parts.push(`system: ${system}`);
  for (const t of tools ?? []) {
    parts.push(`tool: ${t.name} ${t.description} ${JSON.stringify(t.parameters)}`);
  }
  return parts.join("\n");
}

/** 变化形态判定：旧锚是新月标的字节前缀 = appended（位置性追加）；否则 rewritten。 */
export function describeAnchorChange(from: string, to: string): "appended" | "rewritten" {
  return to.startsWith(from) ? "appended" : "rewritten";
}
