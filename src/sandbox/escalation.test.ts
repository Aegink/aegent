import { describe, expect, it } from "vitest";
import {
  ESCALATION_TARGETS,
  SANDBOX_ESCALATION_INVALID,
  SandboxEscalationError,
  resolveEscalatedMode,
  validateEscalationArgs,
  WIDER_MODES,
} from "./escalation.js";

describe("validateEscalationArgs —— 配对校验（dsh 同构）", () => {
  it("sandboxPermissions 与 justification 同行合法；缺一 / 空白理由均类型化拒绝", () => {
    validateEscalationArgs("danger-full-access", "需要写系统缓存目录");
    validateEscalationArgs(undefined, undefined);
    expect(() => validateEscalationArgs("danger-full-access", undefined)).toThrow(
      SandboxEscalationError,
    );
    expect(() => validateEscalationArgs(undefined, "只有理由没有申请")).toThrow(
      SandboxEscalationError,
    );
    expect(() => validateEscalationArgs("danger-full-access", "   ")).toThrow(
      SandboxEscalationError,
    );
    try {
      validateEscalationArgs("danger-full-access", undefined);
    } catch (e) {
      expect((e as SandboxEscalationError).code).toBe(SANDBOX_ESCALATION_INVALID);
    }
  });
});

describe("resolveEscalatedMode —— 严格更宽执行期校验", () => {
  it("read-only 可升两档；workspace-write 只可升 danger-full-access", () => {
    expect(resolveEscalatedMode("workspace-write", "read-only")).toBe("workspace-write");
    expect(resolveEscalatedMode("danger-full-access", "read-only")).toBe("danger-full-access");
    expect(resolveEscalatedMode("danger-full-access", "workspace-write")).toBe(
      "danger-full-access",
    );
  });

  it("重复当前模式 / 非更宽目标 / 未知目标 → fail-closed 类型化拒绝", () => {
    expect(() => resolveEscalatedMode("read-only", "read-only")).toThrow(SandboxEscalationError);
    expect(() => resolveEscalatedMode("workspace-write", "danger-full-access")).toThrow(
      SandboxEscalationError,
    );
    expect(() => resolveEscalatedMode("stealth-mode", "read-only")).toThrow(
      SandboxEscalationError,
    );
  });

  it("封闭目标词汇不含 read-only（地板不可升级到）且阶梯表覆盖所有合法起点", () => {
    expect(ESCALATION_TARGETS).not.toContain("read-only");
    for (const target of ESCALATION_TARGETS) {
      // 每个目标都从某个更窄模式可达
      const reachable = Object.entries(WIDER_MODES).some(([, targets]) =>
        targets.includes(target),
      );
      expect(reachable).toBe(true);
    }
  });
});
