import { describe, expect, it } from "vitest";
import {
  hasArgPlaceholders,
  parseCommandArgs,
  parseSlashInvocation,
  substituteArgs,
  templatePlaceholders,
} from "../../../kernel/prompt-args.js";

describe("斜杠调用解析（parseSlashInvocation）", () => {
  it("首 token = 名，其余行并入参数原文", () => {
    expect(parseSlashInvocation("/review 123")).toEqual({ name: "review", argsRaw: "123" });
    expect(parseSlashInvocation("/ci/build a b")).toEqual({ name: "ci/build", argsRaw: "a b" });
    expect(parseSlashInvocation("/g")).toEqual({ name: "g", argsRaw: "" });
    // 多行参数（opencode 语义：首行 = 命令，其余行并入）
    expect(parseSlashInvocation("/deploy api\nsecond line")).toEqual({
      name: "deploy",
      argsRaw: "api\nsecond line",
    });
  });
  it("非斜杠开头 / 裸斜杠 = 普通文本（不展开）", () => {
    expect(parseSlashInvocation("run /review")).toBeNull();
    expect(parseSlashInvocation("普通文本")).toBeNull();
    expect(parseSlashInvocation("/")).toBeNull();
  });
});

describe("参数切分（parseCommandArgs——pi parseCommandArgs 同构）", () => {
  it("空格分词 + 单双引号包词 + 转义；词中撇号是字面量", () => {
    expect(parseCommandArgs("a b c")).toEqual(["a", "b", "c"]);
    expect(parseCommandArgs('/all "x y" b c')).toEqual(["/all", "x y", "b", "c"]);
    expect(parseCommandArgs("it's 'two words'")).toEqual(["it's", "two words"]);
    expect(parseCommandArgs("a'b c'd")).toEqual(["a'b", "c'd"]);
    expect(parseCommandArgs('a\\"b')).toEqual(['a"b']);
    expect(parseCommandArgs("  ")).toEqual([]);
  });
});

describe("参数展开（substituteArgs——发送时求值）", () => {
  it("$ARGUMENTS 整串、$N 位置、缺位空串", () => {
    expect(substituteArgs("审查 $1 的 $2", "123 安全")).toBe("审查 123 的 安全");
    expect(substituteArgs("全部：$ARGUMENTS", "a b c")).toBe("全部：a b c");
    expect(substituteArgs("第一位：[$1]", "")).toBe("第一位：[]");
  });
  it("无占位符 + 非空参数 = 空行追加（pi 追加语义——参数不静默丢失）", () => {
    expect(substituteArgs("固定指令", "附加要求")).toBe("固定指令\n\n附加要求");
    expect(substituteArgs("固定指令", "  ")).toBe("固定指令");
  });
  it("${@:N} 切片语法（pi 家族）", () => {
    expect(substituteArgs("rest=${@:2}", "a b c")).toBe("rest=b c");
    expect(substituteArgs("slice=${@:2:1}", "a b c")).toBe("slice=b");
  });
  it("hasArgPlaceholders / templatePlaceholders（UI 有参模板判定与提示面）", () => {
    expect(hasArgPlaceholders("没有占位")).toBe(false);
    expect(hasArgPlaceholders("第 $1 个")).toBe(true);
    expect(templatePlaceholders("$2 then $ARGUMENTS then $2")).toEqual(["$2", "$ARGUMENTS"]);
    expect(templatePlaceholders("{{var}} 不算")).toEqual([]);
  });
});
