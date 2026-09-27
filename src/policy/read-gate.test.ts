/**
 * C12/C13 编辑前必须先读测试（T-P1-71）——ReadGateService 记账/校验
 * 纯逻辑面（工具级集成在 builtin.test.ts）。
 */
import { describe, expect, it } from "vitest";

import { ReadGateError, ReadGateService } from "./read-gate.js";

describe("C12 · ReadGateService", () => {
  it("验收①面：未读 → EDIT_WITHOUT_READ", () => {
    const gate = new ReadGateService();
    expect(() => gate.requireRead("/a.txt")).toThrowError(ReadGateError);
    try {
      gate.requireRead("/a.txt");
    } catch (e) {
      expect((e as ReadGateError).code).toBe("EDIT_WITHOUT_READ");
    }
  });

  it("验收②面：读后（recordRead）requireRead 放行；验收③面：哈希失配 → EDIT_STALE_READ", () => {
    const gate = new ReadGateService();
    gate.recordRead("/a.txt", "hash1");
    expect(() => gate.requireRead("/a.txt", "hash1")).not.toThrow();
    // 读后外部修改：当前内容哈希 ≠ 记账
    try {
      gate.requireRead("/a.txt", "hash2");
      expect.unreachable("应抛 EDIT_STALE_READ");
    } catch (e) {
      expect((e as ReadGateError).code).toBe("EDIT_STALE_READ");
    }
  });

  it("写后记账更新：edit-then-edit 无需中间读（dsh 同款）；currentHash 缺省只查已读", () => {
    const gate = new ReadGateService();
    gate.recordRead("/a.txt", "hash1");
    gate.recordRead("/a.txt", "hash-after-edit"); // 写成功 = 新基线
    expect(() => gate.requireRead("/a.txt", "hash-after-edit")).not.toThrow();
    expect(() => gate.requireRead("/a.txt", "hash1")).toThrowError(ReadGateError);
    // 不传 currentHash：只查"已读过"不看新鲜度
    expect(() => gate.requireRead("/b.txt")).toThrowError(ReadGateError);
    gate.recordRead("/b.txt", "h");
    expect(() => gate.requireRead("/b.txt")).not.toThrow();
  });

  it("forget：delete 后清记账（后续编辑由文件层 NOT_FOUND 拒）", () => {
    const gate = new ReadGateService();
    gate.recordRead("/a.txt", "h");
    gate.forget("/a.txt");
    expect(() => gate.requireRead("/a.txt")).toThrowError(ReadGateError);
    gate.forget("/never-seen.txt"); // 幂等
  });
});
