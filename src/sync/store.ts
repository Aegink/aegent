/**
 * 远端存储接口 + 文件系统实现（N9/T-P1-118）——pi-desktop config_sync 的
 * transport.rs 接口化：真实 WebDav 传输不落（无网络基础设施），本机目录
 * 模拟多设备（测试面）；真实远端随部署需求，接口在位。
 *
 * 写入原子性（tmp→rename）——Q7 日志重写与 Q1 迁移链的既有纪律同款：
 * 中途失败旧文件不动。
 */

import { renameSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export interface RemoteStore {
  /** 读远端对象；不存在返回 undefined（首推判定）。 */
  read(key: string): Promise<string | undefined>;
  /** 原子写远端对象。 */
  write(key: string, content: string): Promise<void>;
}

export class FileSystemRemoteStore implements RemoteStore {
  constructor(private readonly root: string) {
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
  }

  private resolve(key: string): string {
    if (key.includes("..") || path.isAbsolute(key)) {
      throw new Error(`非法远端键：${key}`);
    }
    return path.join(this.root, key);
  }

  async read(key: string): Promise<string | undefined> {
    const file = this.resolve(key);
    if (!existsSync(file)) return undefined;
    return readFileSync(file, "utf8");
  }

  async write(key: string, content: string): Promise<void> {
    const file = this.resolve(key);
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, file);
  }
}
