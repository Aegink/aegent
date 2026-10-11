/**
 * W13b/T9-4 验收：配置行级写回（LineEdit/sectionDiff——保注释 + 并发锁 +
 * 校验 + 原子）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyLineEdits,
  createSettingsLineEditWriteback,
  diffRecords,
  planEditsForRecords,
} from "./settings-line-edit.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows 句柄释放竞态：临时目录留给系统回收
    }
  }
});

function makeSettingsPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "aegent-line-edit-"));
  dirs.push(dir);
  return join(dir, "settings.json");
}

/** 含注释样例（JSONC——行级编辑层的保真面；diff/record 面不适用）。 */
const COMMENT_SAMPLE = `{
  // 手写注释（kimi 形状——行级写回必须原样保留）
  "theme": "dark",
  "plugins": {
    "allowTools": true
  },
  "chat": {
    "retryUnlimited": false
  }
}
`;

/** 严格 JSON 样例（diffRecords/planEditsForRecords/applyRecordDiff 输入面）。 */
const STRICT = `{
  "theme": "dark",
  "plugins": {
    "allowTools": true
  },
  "chat": {
    "retryUnlimited": false
  }
}
`;

describe("applyLineEdits（LineEdit 执行器）", () => {
  it("replace/insert/remove 按行号生效，未涉及行零接触（注释原样保留）", () => {
    // 行位：注释 = 2；theme = 3；plugins 段 = 4-6（4 开、5 值、6 收+逗号）；
    // chat 段 = 7-9；收括号 = 10
    const r = applyLineEdits(COMMENT_SAMPLE, [
      { kind: "replace", startLine: 3, endLine: 3, text: '  "theme": "light",' },
      { kind: "insert", afterLine: 6, text: '  "locale": "zh-CN",' },
    ]);
    expect(r.applied).toBe(2);
    expect(r.content).toContain('"theme": "light"');
    expect(r.content).toContain('"locale": "zh-CN"');
    expect(r.content).toContain("// 手写注释");
    // remove：插入 locale 后 chat 段下移到 8-10 行
    const removed = applyLineEdits(r.content, [{ kind: "remove", startLine: 8, endLine: 10 }]);
    expect(removed.content).not.toContain("retryUnlimited");
    expect(removed.content).toContain("// 手写注释");
    expect(removed.content).toContain('"allowTools": true');
  });

  it("越界区间截断记 warning（不抛——容错面）", () => {
    const r = applyLineEdits("{\n}", [{ kind: "remove", startLine: 1, endLine: 99 }]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("diffRecords / planEditsForRecords（sectionDiff）", () => {
  it("diffRecords：added/removed/changed 三分类", () => {
    const before = `{"a": 1, "b": {"x": 1}, "c": true}`;
    const after = `{"a": 2, "b": {"x": 1}, "d": "new"}`;
    expect(diffRecords(before, after)).toEqual({
      added: ["d"],
      removed: ["c"],
      changed: ["a"],
    });
  });

  it("diffRecords：非对象输入类型化拒绝", () => {
    expect(() => diffRecords("not json", "{}")).toThrow(TypeError);
  });

  it("planEditsForRecords → 应用后：改动段更新、未涉及段与格式原样保留", () => {
    const after = STRICT.replace('"retryUnlimited": false', '"retryUnlimited": true')
      .replace('"theme": "dark"', '"theme": "light"');
    const edits = planEditsForRecords(STRICT, STRICT, after);
    const result = applyLineEdits(STRICT, edits);
    expect(result.content).toContain('"retryUnlimited": true');
    expect(result.content).toContain('"theme": "light"');
    // 未涉及的 plugins 段原字节保留
    expect(result.content).toContain('"allowTools": true');
    // 改后仍是合法 JSON
    expect(() => JSON.parse(result.content)).not.toThrow();
  });

  it("planEditsForRecords：added 段（补逗号 + 插入）结果仍是合法 JSON", () => {
    const after = STRICT.replace(/\n}\n$/, ',\n  "locale": "zh-CN"\n}\n');
    const edits = planEditsForRecords(STRICT, STRICT, after);
    const result = applyLineEdits(STRICT, edits);
    const parsed = JSON.parse(result.content) as { locale?: string };
    expect(parsed.locale).toBe("zh-CN");
  });

  it("stale 基线：before 声称的键不在原文件 → 类型化拒绝（防错写）", () => {
    const original = '{\n  "x": 1\n}';
    const before = '{"y": 9, "x": 1}';
    const after = '{"y": 10, "x": 1}';
    // changed 键 "y" 在原文件中无行区间（基线与磁盘不符——stale）
    expect(() => planEditsForRecords(original, before, after)).toThrow(TypeError);
  });
});

describe("createSettingsLineEditWriteback（写回服务）", () => {
  it("原子落盘 + 写后校验通过 + 无 tmp 残留", async () => {
    const path = makeSettingsPath();
    writeFileSync(path, STRICT, "utf-8");
    const wb = createSettingsLineEditWriteback({ settingsPath: path });
    const after = STRICT.replace('"theme": "dark"', '"theme": "light"');
    const r = await wb.applyRecordDiff(after);
    expect(r.applied).toBeGreaterThan(0);
    expect(readFileSync(path, "utf-8")).toContain('"theme": "light"');
    expect(() => readFileSync(`${path}.tmp`, "utf-8")).toThrow();
  });

  it("保注释写回：默认校验器对非 JSON 基线只保真（注释行原样保留）", async () => {
    const path = makeSettingsPath();
    writeFileSync(path, COMMENT_SAMPLE, "utf-8");
    const wb = createSettingsLineEditWriteback({ settingsPath: path });
    await wb.applyEdits([{ kind: "replace", startLine: 3, endLine: 3, text: '  "theme": "light",' }]);
    const text = readFileSync(path, "utf-8");
    expect(text).toContain("// 手写注释");
    expect(text).toContain('"theme": "light"');
  });

  it("写后校验失败 → 类型化拒绝零落盘（原文件完好）", async () => {
    const path = makeSettingsPath();
    writeFileSync(path, STRICT, "utf-8");
    const wb = createSettingsLineEditWriteback({
      settingsPath: path,
      validate: (content) => {
        if (!content.includes("REQUIRED_MARKER")) throw new Error("schema 不合：缺 REQUIRED_MARKER");
      },
    });
    await expect(
      wb.applyEdits([{ kind: "replace", startLine: 2, endLine: 2, text: '  "theme": "light",' }]),
    ).rejects.toThrow("REQUIRED_MARKER");
    expect(readFileSync(path, "utf-8")).toContain('"theme": "dark"');
  });

  it("并发锁：并发 apply 串行落盘（两次编辑都生效）", async () => {
    const path = makeSettingsPath();
    writeFileSync(path, STRICT, "utf-8");
    const wb = createSettingsLineEditWriteback({ settingsPath: path });
    await Promise.all([
      wb.applyEdits([{ kind: "insert", afterLine: 1, text: '  "first": true,' }]),
      wb.applyEdits([{ kind: "insert", afterLine: 1, text: '  "second": true,' }]),
    ]);
    const text = readFileSync(path, "utf-8");
    expect(text).toContain('"first": true');
    expect(text).toContain('"second": true');
  });
});
