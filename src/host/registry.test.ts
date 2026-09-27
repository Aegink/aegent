import { describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "../kernel/events.js";
import {
  AgentHost,
  HostCeilingWideningError,
  HostRegistry,
  HostSessionExistsError,
  UnknownHostSessionError,
  chainToolAcquire,
} from "./registry.js";

function ev(seq: number): SessionEvent {
  return { type: "turn/start", turn: 1, seq, ts: 1 } as unknown as SessionEvent;
}

describe("K3/T-P1-112 HostRegistry 多 host 注册", () => {
  it("多 host 注册 + get/list/has + 重复注册类型化拒绝", () => {
    const registry = new HostRegistry();
    const a = registry.register({ sessionId: "s-a" });
    const b = registry.register({ sessionId: "s-b" });
    expect(a.hostId).not.toBe(b.hostId); // hostId 缺省随机生成、互不等
    expect(registry.has("s-a")).toBe(true);
    expect(registry.get("s-a")).toBe(a);
    expect(registry.list()).toHaveLength(2);
    expect(() => registry.register({ sessionId: "s-a" })).toThrowError(
      expect.objectContaining({ code: "HOST_SESSION_EXISTS" }),
    );
  });

  it("非法会话 id 注册拒绝（N1 校验消费）", () => {
    const registry = new HostRegistry();
    expect(() => registry.register({ sessionId: "bad id" })).toThrowError(/不合法/);
  });

  it("事件分发：两会话各自事件路由到订阅端（sessionId 归属可辨）", () => {
    const registry = new HostRegistry();
    const a = registry.register({ sessionId: "s-a" });
    const b = registry.register({ sessionId: "s-b" });
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    a.emit(ev(1));
    b.emit(ev(2));
    a.emit(ev(3));
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls.map((c) => [c[0], (c[1] as SessionEvent).seq])).toEqual([
      ["s-a", 1],
      ["s-b", 2],
      ["s-a", 3],
    ]);
    unsubscribe();
    a.emit(ev(4));
    expect(listener).toHaveBeenCalledTimes(3); // 退订后不再到达
  });

  it("dispose 后事件出口静默 + host 从 registry 摘除（幂等）", () => {
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-a" });
    const listener = vi.fn();
    registry.subscribe(listener);
    host.dispose();
    host.dispose(); // 幂等
    host.emit(ev(1));
    expect(listener).not.toHaveBeenCalled();
    expect(registry.has("s-a")).toBe(false);
    expect(registry.get("s-a")).toBeUndefined();
  });

  it("mustGet：不存在类型化拒绝（协议路由面）", () => {
    const registry = new HostRegistry();
    expect(() => registry.mustGet("nope")).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_HOST_SESSION" }),
    );
  });

  it("registry.dispose 清空全部 host", () => {
    const registry = new HostRegistry();
    registry.register({ sessionId: "s-a" });
    registry.register({ sessionId: "s-b" });
    registry.dispose();
    expect(registry.list()).toHaveLength(0);
  });
});

describe("K3/T-P1-112 权限天花板（isWidening 同构）", () => {
  it("天花板关闭时请求无人值守 → HOST_CEILING_WIDENING；档位不变", () => {
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-a" }); // 缺省 ceiling=false
    expect(() => host.requestUnattended(true)).toThrowError(
      expect.objectContaining({ code: "HOST_CEILING_WIDENING" }),
    );
    expect(host.unattended).toBe(false); // 拒绝后档位未被放宽
  });

  it("天花板开启：放宽受理、收窄照常、再放宽照常", () => {
    const registry = new HostRegistry();
    const host = registry.register({ sessionId: "s-a", unattendedCeiling: true });
    expect(host.requestUnattended(true)).toBe(true);
    expect(host.requestUnattended(false)).toBe(false); // 收窄
    expect(host.requestUnattended(true)).toBe(true); // 再放宽（天花板在）
  });

  it("AgentHost 直构导出面存在（独立于 registry 使用）", () => {
    expect(typeof AgentHost).toBe("function");
  });
});

describe("K3/T-P1-112 M9 两级上限（全局外层 + 会话内层）", () => {
  it("全局限 1 时两会话各持 1 并发 → 第二个会话在全局泳道排队", async () => {
    const registry = new HostRegistry({ globalToolClassLimits: { writeExecuteMax: 1 } });
    const a = registry.register({ sessionId: "s-a", toolClassLimits: { writeExecuteMax: 2 } });
    const b = registry.register({ sessionId: "s-b", toolClassLimits: { writeExecuteMax: 2 } });
    const acquireA = a.toolAcquire()!;
    const acquireB = b.toolAcquire()!;

    const releaseA = await acquireA("bash");
    expect(registry.globalLimiterSnapshot()).toMatchObject({ writeRunning: 1 });
    let bEntered = false;
    const pendingB = acquireB("bash").then((release) => {
      bEntered = true;
      return release;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(bEntered).toBe(false); // 全局泳道满——B 排队（会话 B 自身限额 2 未满）
    expect(registry.globalLimiterSnapshot()).toMatchObject({ writeRunning: 1, writeWaiting: 1 });
    releaseA();
    const releaseB = await pendingB;
    expect(bEntered).toBe(true);
    releaseB();
  });

  it("会话限额独立生效：全局不限时会话限仍拦", async () => {
    const registry = new HostRegistry();
    const a = registry.register({ sessionId: "s-a", toolClassLimits: { writeExecuteMax: 1 } });
    const acquire = a.toolAcquire()!;
    const r1 = await acquire("bash");
    expect(a.sessionLimiterSnapshot()).toMatchObject({ writeRunning: 1 });
    let second = false;
    void acquire("bash").then(() => {
      second = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(second).toBe(false);
    r1();
  });

  it("read 类与 write 类泳道独立（既有语义贯穿两级）", async () => {
    const registry = new HostRegistry({ globalToolClassLimits: { writeExecuteMax: 1 } });
    const a = registry.register({ sessionId: "s-a" });
    const acquire = a.toolAcquire()!;
    const r = await acquire("bash");
    // 写类泳道满，只读类不受影响
    const readRelease = await acquire("grep");
    expect(readRelease).toBeTypeOf("function");
    r();
    readRelease();
  });

  it("chainToolAcquire：两层都缺返回 undefined（直通零行为变化）", () => {
    expect(chainToolAcquire(undefined, undefined)).toBeUndefined();
  });
});
