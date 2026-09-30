/**
 * providers models 规格解析测试（T-P3-137 三轮——从 settings.test 拆出，
 * 行数纪律：settings.test 441>400 触顶即拆域文件当场归还）。
 */

import { describe, expect, it } from "vitest";
import { parseSettingsShape } from "./settings.js";

describe("providers models 规格解析（T-P3-137 三轮）", () => {
  it("T-P3-137 三轮：models 新字段（thinkingLevels/能力/联网搜索）parse + 档位闭集 fail-closed", () => {
    const s = parseSettingsShape({
      providers: [
        {
          name: "main",
          baseUrl: "https://x",
          models: [
            {
              id: "m1",
              reasoning: "medium",
              thinkingLevels: ["off", "low", "medium", "high", "max"],
              imageInput: true,
              pdfInput: false,
              forSubagents: true,
              webSearch: false,
            },
          ],
        },
      ],
      defaultProvider: "main",
    });
    expect(s.providers[0]?.models?.[0]).toEqual({
      id: "m1",
      reasoning: "medium",
      thinkingLevels: ["off", "low", "medium", "high", "max"],
      imageInput: true,
      pdfInput: false,
      forSubagents: true,
      webSearch: false,
    });
    // 档位闭集：reasoning/thinkingLevels 出格即拒；能力字段类型错 fail-closed
    expect(() =>
      parseSettingsShape({ providers: [{ name: "m", models: [{ id: "x", reasoning: "ultra" }] }] }),
    ).toThrow(/reasoning 非法/);
    expect(() =>
      parseSettingsShape({ providers: [{ name: "m", models: [{ id: "x", thinkingLevels: ["low", "bogus"] }] }] }),
    ).toThrow(/thinkingLevels 须为档位数组/);
    expect(() =>
      parseSettingsShape({ providers: [{ name: "m", models: [{ id: "x", imageInput: "yes" }] }] }),
    ).toThrow(/imageInput 须为布尔/);
  });
});
