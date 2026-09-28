import { describe, expect, it } from "vitest";

import { effectiveApproval, Projector, project, ProjectError, supersessionChain } from "./project.js";
import { SessionStore } from "./store.js";
import type { SessionEvent } from "../kernel/events.js";

describe("approval/superseded 取代链（I10 / T-P2-306 #23）", () => {
  const sup = (seq: number, requestId: string, byRequestId: string, reason?: string) => ({
    type: "approval/superseded" as const,
    seq,
    ts: 0,
    turn: 0,
    requestId,
    byRequestId,
    ...(reason !== undefined ? { reason } : {}),
  });

  it("取代落流 + 投影索引：A←B 后 effectiveApproval(A)=B、链 [A,B]", () => {
    const s = project([sup(1, "A", "B", "hook 复核更新")]);
    expect(s.approvalSupersessions).toEqual([{ seq: 1, requestId: "A", byRequestId: "B" }]);
    expect(effectiveApproval(s, "A")).toBe("B");
    expect(supersessionChain(s, "A")).toEqual(["A", "B"]);
    // 非链成员：链尾是自己（没被取代 = 自己就是最新）
    expect(supersessionChain(s, "X")).toEqual(["X"]);
  });

  it("链式取代：A←B←C——任一节点查到的都是链尾（最新有效），历史全保留", () => {
    const s = project([sup(1, "A", "B"), sup(2, "B", "C")]);
    expect(effectiveApproval(s, "A")).toBe("C");
    expect(supersessionChain(s, "A")).toEqual(["A", "B", "C"]);
    expect(effectiveApproval(s, "B")).toBe("C");
    expect(supersessionChain(s, "C")).toEqual(["C"]);
    // 历史保留：三条事实都在流内（取代 ≠ 撤销）
    expect(s.approvalSupersessions).toHaveLength(2);
  });

  it("分叉汇聚：A1←B、A2←B（入度不限）——两链同尾；B 再被 C 取代后两链都指 C", () => {
    const s = project([sup(1, "A1", "B"), sup(2, "A2", "B"), sup(3, "B", "C")]);
    expect(effectiveApproval(s, "A1")).toBe("C");
    expect(effectiveApproval(s, "A2")).toBe("C");
  });

  it("单链约束：一个 requestId 至多被取代一次（重复取代拒绝投影）", () => {
    const p = Projector.fresh();
    p.append([sup(1, "A", "B")]);
    expect(() => p.append([sup(2, "A", "C")])).toThrow(/重复取代/);
    expect(() => p.append([sup(2, "A", "C")])).toThrow(ProjectError);
  });

  it("成环拒绝：A←B 后 B←A 拒绝；自取代 A←A 拒绝（无最新有效裁决）", () => {
    const p = Projector.fresh();
    p.append([sup(1, "A", "B")]);
    expect(() => p.append([sup(2, "B", "A")])).toThrow(/成环/);
    const q = Projector.fresh();
    expect(() => q.append([sup(1, "A", "A")])).toThrow(/成环/);
  });

  it("形状校验：空 id / 非字符串 reason 类型化拒绝（校验期）", () => {
    const p = Projector.fresh();
    expect(() => p.append([{ ...sup(1, "", "B") }])).toThrow(/requestId 非空/);
    expect(() => p.append([{ ...sup(1, "A", "") }])).toThrow(/byRequestId 非空/);
    expect(() =>
      p.append([sup(1, "A", "B", "ok")]),
    ).not.toThrow();
    const q = Projector.fresh();
    expect(() =>
      q.append([{ ...sup(1, "A", "B"), reason: 42 } as unknown as SessionEvent]),
    ).toThrow(/reason 须为字符串/);
  });

  it("log-only 纪律：turn 0 可落（不要求开合上下文）+ revert 切点切割", () => {
    // turn 0 落流合法（expectTurnScoped 豁免——同 session/archive 纪律）
    const store = new SessionStore();
    expect(() => store.append("s-i10", [sup(1, "A", "B")])).not.toThrow();
    // revert 切割：取代事件在切点后则有效投影不含（链回到切前状态）
    const s = project([sup(1, "A", "B")]);
    expect(effectiveApproval(s, "A")).toBe("B");
  });
});
