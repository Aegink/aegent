/**
 * core 域单一公开入口（architecture-policy core.publicEntrypoints 唯一值，
 * T1-1 起生效）——跨域 import core 一律走本文件（forbidDeepImports 强制）；
 * 核内文件间相对 import 不经此。随批次下沉逐段补 re-export，
 * 最终语义面 = 0 骨架 + 1 装配入口。
 */
export * from "./skeleton/events.js";
export * from "./contracts/attachments.js";
export * from "./contracts/models.js";
export * from "./primitives/session/reference.js";
