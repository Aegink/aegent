import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PlainFileCredentialStore } from "../session/credentials.js";
import { loadSettings } from "../session/settings.js";
import { FileSettingsGateway } from "./settings-gateway.js";
import { withSettingsRmw } from "./settings-rmw.js";

const dirs: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "settings-rmw-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("withSettingsRmw（读-改-写互斥）", () => {
  it("串行化：前序事务未完成前后续任务不启动（不交叠）", async () => {
    const events: string[] = [];
    let release1: (() => void) | undefined;
    const gate1 = new Promise<void>((r) => (release1 = r));
    const t1 = withSettingsRmw(async () => {
      events.push("t1-start");
      await gate1;
      events.push("t1-end");
    });
    const t2 = withSettingsRmw(async () => {
      events.push("t2-start");
    });
    // 让微任务排空：t1 已启动，t2 必须仍在等（未交叠）
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["t1-start"]);
    release1!();
    await Promise.all([t1, t2]);
    expect(events).toEqual(["t1-start", "t1-end", "t2-start"]);
  });

  it("前序事务失败不堵后续（失败者错误原样上抛给自己）", async () => {
    const boom = withSettingsRmw(async () => {
      throw new Error("boom");
    });
    let ran = false;
    const next = withSettingsRmw(async () => {
      ran = true;
      return "ok";
    });
    await expect(boom).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
    expect(ran).toBe(true);
  });

  it("gateway 并发段级补丁两段都落盘（无锁时后写覆盖丢段）", async () => {
    const dir = tmpDir();
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ version: 1 }), "utf-8");
    const gateway = new FileSettingsGateway(settingsPath, new PlainFileCredentialStore(path.join(dir, "credentials.json")));

    // 同一 tick 内并发发起两个不同段的补丁——RMW 锁下串行，两段都保留
    const [a, b] = await Promise.all([
      gateway.update({ chat: { sendOnEnter: false } as never }),
      gateway.update({ appearance: { language: "en" } as never }),
    ]);
    expect(a.chat).toBeDefined();
    expect(b.appearance).toBeDefined();
    const onDisk = (await loadSettings(settingsPath)).settings as unknown as Record<string, unknown>;
    expect(onDisk["chat"]).toBeDefined();
    expect(onDisk["appearance"]).toBeDefined();
  });
});
