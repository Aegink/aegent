import { describe, expect, it } from "vitest";
import { canonicalize, tempWriteSid, workspaceWriteSid } from "./workspace-sid.js";

describe("workspaceWriteSid / tempWriteSid（dsh 派生公式）", () => {
  it("①确定性：同路径同 SID", () => {
    expect(workspaceWriteSid("C:/aegent")).toBe(workspaceWriteSid("C:/aegent"));
  });

  it("②S-1-4-x-y 形状：两个 30 位子权威", () => {
    const sid = workspaceWriteSid("C:/aegent");
    expect(sid).toMatch(/^S-1-4-\d+-\d+$/);
    const [, , , a, b] = sid.split("-");
    // (2^30 - 1) + 1 = 1073741824 上限（模后 +1，0 不出现）。
    expect(Number(a)).toBeLessThanOrEqual(1_073_741_824);
    expect(Number(b)).toBeLessThanOrEqual(1_073_741_824);
    expect(Number(a)).toBeGreaterThanOrEqual(1);
  });

  it("③tempWriteSid 域分离：第三子权威 = 1（与 workspace 身份可区分）", () => {
    const ws = workspaceWriteSid("C:/aegent");
    const temp = tempWriteSid("C:/aegent");
    expect(temp).toMatch(/^S-1-4-\d+-\d+-1$/);
    // 同一输入的两个身份不冲突（域分离保证 temp 与 workspace 撞形时后缀不同）。
    expect(temp.startsWith(ws)).toBe(false);
  });

  it("④canonical 化：路径归一（大小写不敏感盘符路径收敛）", () => {
    // 同一目录的不同大小写拼写 → 同一 SID（dsh：两套拼写不再生第二个身份）。
    const a = workspaceWriteSid(canonicalize("c:/windows/temp"));
    const b = workspaceWriteSid(canonicalize("C:/WINDOWS/TEMP"));
    expect(a).toBe(b);
  });
});
