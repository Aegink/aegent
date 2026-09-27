import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  JobEpochStaleError,
  createExecutionEpoch,
  encodeEpochScopedId,
  parseEpochScopedId,
} from "./epoch.js";
import { JobRegistry, UnknownJobError } from "../kernel/jobs.js";

const thisDir = path.dirname(fileURLToPath(new URL(import.meta.url)));

describe("createExecutionEpoch（M8/T-P1-87）", () => {
  it("每次进程 boot 生成 fresh 值（两次生成互不相等）", () => {
    const values = new Set(Array.from({ length: 32 }, () => createExecutionEpoch()));
    expect(values.size).toBe(32);
  });

  it("epoch 不落库不进事件流：模块入边只有 node:crypto（grep 证伪的机内版）", () => {
    const source = readFileSync(path.join(thisDir, "epoch.ts"), "utf8");
    expect(source).not.toMatch(/from "\.\.?\/(session\/)?store/);
    expect(source).not.toMatch(/from "\.\.?\/kernel\/events/);
    expect(source).not.toMatch(/from "\.\.?\/session\/db/);
  });

  it("分代句柄 encode/parse 往返；无 epoch 段的外来 id 解析为 null", () => {
    const id = encodeEpochScopedId("ab12cd34", "bash-3");
    expect(parseEpochScopedId(id)).toEqual({ epoch: "ab12cd34", localId: "bash-3" });
    expect(parseEpochScopedId("plain-id")).toEqual({ epoch: "plain", localId: "id" });
    expect(parseEpochScopedId("-leading")).toBeNull();
  });
});

describe("JobRegistry × epoch（M8 过期代句柄拒绝）", () => {
  it("注入 epoch 后 id 编码代段；本代句柄全功能正常", async () => {
    const registry = new JobRegistry({ epoch: "ab12cd34" });
    const id = registry.start({ kind: "index", run: async () => {} });
    expect(id).toBe("ab12cd34-index-1");
    expect(registry.get(id).status).toBe("running");
    await registry.wait(id, 500);
    expect(registry.get(id).status).toBe("completed");
    expect(registry.kill(id)).toBe("already-finished");
  });

  it("旧代 job id 的 get/read/kill → JOB_EPOCH_STALE 类型化拒绝（不误命中不存在）", async () => {
    const registry = new JobRegistry({ epoch: "new3p0ch" });
    const staleId = "0ld3p0ch-bash-1";
    const attempts: (() => unknown)[] = [
      () => registry.get(staleId),
      () => registry.read(staleId),
      () => registry.kill(staleId),
      () => registry.wait(staleId, 10),
      () => registry.onSettled(staleId, () => {}),
    ];
    for (const attempt of attempts) {
      try {
        attempt();
        expect.unreachable("过期代句柄应当被拒绝");
      } catch (e) {
        expect(e).toBeInstanceOf(JobEpochStaleError);
        const err = e as JobEpochStaleError;
        expect(err.code).toBe("JOB_EPOCH_STALE");
        expect(err.currentEpoch).toBe("new3p0ch");
        expect(err.handleEpoch).toBe("0ld3p0ch");
      }
    }
  });

  it("不认识的 id 形状（无 epoch 段）→ UnknownJobError（存在性语义不变）", () => {
    const registry = new JobRegistry({ epoch: "ab12cd34" });
    expect(() => registry.get("ghost")).toThrow(UnknownJobError);
  });
});
