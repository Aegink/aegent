/**
 * `aegent key` 子命令（U2/T-P3-102）——API key 的录入/查看/删除/清单。
 *
 * key **不进命令行**（进程列表对本机其他进程可见——dpapi/index.ts 同款
 * 纪律）：`key set <provider>` 从 stdin 读一行（管道或 TTY 粘贴后回车）；
 * `key get` 只输出掩码与时间（明文只在 getKey 返回值里供装配消费，永不
 * 打印）。存储经 createCredentialStore（Windows DPAPI / 非 Windows 0600）。
 */

import { createInterface } from "node:readline";

import { createCredentialStore, type CredentialStore } from "../session/credentials.js";
import { maskToken } from "../models/oauth.js";

export const KEY_COMMAND_USAGE =
  "用法：aegent key set|get|delete <provider> | aegent key list";

export interface KeyCommandIo {
  /** key 材料输入（key set 用——测试注入管道）。 */
  readonly input?: NodeJS.ReadableStream;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

async function readLine(input: NodeJS.ReadableStream): Promise<string> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  const line = await new Promise<string>((resolve) => {
    rl.once("line", resolve);
  });
  rl.close();
  return line.trim();
}

/** key 子命令入口（argv = "key" 之后的参数）；返回进程退出码。 */
export async function runKeyCommand(
  argv: readonly string[],
  io: KeyCommandIo,
  store: CredentialStore = createCredentialStore(),
): Promise<number> {
  const [action, provider] = argv;
  try {
    if (action === "set" && provider !== undefined) {
      io.out(`为 provider「${provider}」粘贴 API key 后回车（输入不回显不落日志）：`);
      const key = await readLine(io.input ?? process.stdin);
      if (key === "") {
        io.err("key 为空——未录入");
        return 1;
      }
      await store.setKey(provider, key);
      io.out(`已录入 provider「${provider}」的凭据（掩码 ${maskToken(key)}）`);
      return 0;
    }
    if (action === "get" && provider !== undefined) {
      const key = await store.getKey(provider);
      if (key === undefined) {
        io.err(`provider「${provider}」无凭据（用 aegent key set ${provider} 录入）`);
        return 1;
      }
      io.out(`${provider}: ${maskToken(key)}（更新于 ${(await store.listKeys()).find((k) => k.name === provider)?.updatedAt ?? "?"}）`);
      return 0;
    }
    if (action === "delete" && provider !== undefined) {
      const deleted = await store.deleteKey(provider);
      io.out(deleted ? `已删除 provider「${provider}」的凭据` : `provider「${provider}」本来就没有凭据`);
      return 0;
    }
    if (action === "list" && provider === undefined) {
      const keys = await store.listKeys();
      if (keys.length === 0) {
        io.out("（无凭据——用 aegent key set <provider> 录入）");
        return 0;
      }
      for (const meta of keys) io.out(`${meta.name}  (更新于 ${meta.updatedAt})`);
      return 0;
    }
    io.err(KEY_COMMAND_USAGE);
    return 1;
  } catch (e) {
    io.err(`key 命令失败：${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
