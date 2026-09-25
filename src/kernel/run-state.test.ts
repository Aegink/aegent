import { describe, expect, it } from "vitest";

import { RunState } from "./run-state.js";
import { ScriptedProvider, makeLoop } from "./loop.test-utils.js";

/**
 * A3 运行态独立于 loop —— 服务只靠生命周期通知（markBusy / markIdle），
 * 不读 loop 内部变量；崩溃（异常逃出 runTurn）后 busy 停留，由恢复路径归位。
 */
describe("RunState —— A3 运行态独立于 loop", () => {
  it("验收：loop 崩溃（注入 throw）后仍可判定 busy → 恢复路径归位 idle", async () => {
    const runState = new RunState();
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "x" }, { type: "done" }]);
    // 双重故障注入：决策点抛错（进入错误收尾）+ turnEnd 层抛错（错误收尾
    // 自身再崩）——异常逃出 runTurn，markIdle 到不了
    const { loop } = makeLoop(provider, {
      runState,
      decideTurn: () => {
        throw new Error("决策崩溃");
      },
      layers: {
        turnEnd: [
          async () => {
            throw new Error("收尾层崩溃");
          },
        ],
      },
    });

    await expect(loop.runTurn("会崩")).rejects.toThrow("收尾层崩溃");
    // loop 已经死了，但运行态仍可判定：busy
    expect(runState.get("s1")).toEqual({ state: "busy" });
    // 恢复路径（T-8 resume 的动作）：显式归位
    runState.markIdle("s1");
    expect(runState.get("s1")).toEqual({ state: "idle" });
  });

  it("turn 进行中 busy、成功收轮后 idle（completed 路径）", async () => {
    const runState = new RunState();
    const provider = new ScriptedProvider();
    provider.mount([{ type: "text-delta", text: "答" }, { type: "done" }]);
    const seen: string[] = [];
    const { loop } = makeLoop(provider, {
      runState,
      decideTurn: () => {
        // turn 进行中从"外部"看运行态——busy
        seen.push(runState.get("s1").state);
        return { action: "end" };
      },
    });

    expect(runState.get("s1").state).toBe("idle");
    await loop.runTurn("你好");
    expect(seen).toEqual(["busy"]);
    expect(runState.get("s1").state).toBe("idle");
  });

  it("error / blocked / aborted 路径都经 closeTurn 落盘 → 归位 idle", async () => {
    const runState = new RunState();

    // error：模型调用失败硬退出
    const boomProvider = {
      async *streamChat() {
        throw new Error("boom");
      },
    };
    const { loop: loopErr } = makeLoop(boomProvider, { runState });
    await loopErr.runTurn("失败轮");
    expect(runState.get("s1")).toEqual({ state: "idle" });

    // blocked：modelRequest 层不放行
    const provider2 = new ScriptedProvider();
    const { loop: loopBlocked } = makeLoop(provider2, {
      runState,
      layers: {
        modelRequest: [() => ({ content: "", toolCalls: [], timed: [] })],
      },
    });
    await loopBlocked.runTurn("被拦");
    expect(runState.get("s1")).toEqual({ state: "idle" });

    // aborted：流中途取消
    const ref: { loop?: import("./loop.js").AgentLoop } = {};
    const provider3 = {
      async *streamChat() {
        yield { type: "text-delta" as const, text: "半" };
        ref.loop!.cancel({ kind: "user" });
        yield { type: "text-delta" as const, text: "截" };
      },
    };
    const { loop: loopAbort } = makeLoop(provider3, { runState });
    ref.loop = loopAbort;
    await loopAbort.runTurn("取消轮");
    expect(runState.get("s1")).toEqual({ state: "idle" });
  });

  it("多会话互相独立；未知会话默认 idle", () => {
    const runState = new RunState();
    expect(runState.get("unknown").state).toBe("idle");
    runState.markBusy("s1");
    expect(runState.get("s1")).toEqual({ state: "busy" });
    expect(runState.get("s2")).toEqual({ state: "idle" });
    runState.markIdle("s1");
    expect(runState.get("s1").state).toBe("idle");
  });
});
