/**
 * 子进程入口（T9）——被父进程以 `node dist/src/kernel/agent-child.js` 启动。
 * 本文件只做装配：协议循环与调度在 agent-process.ts。
 *
 * P0 内置 echo provider（回声最后一条 user 消息）——本卡验收的是进程边界、
 * stdio JSON 行协议与冷启动，不是模型；真实厂商装配（config.ts + openai-compat
 * + withRetry）在 T-8 CLI 端接线。子进程图不含 better-sqlite3（InMemory
 * store），原生模块不进冷启动路径（Q16 <500ms 的前提）。
 */

import { runAgentChildStdio } from "./agent-process.js";

void runAgentChildStdio();
