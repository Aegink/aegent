/**
 * 跨组件因果断言（O30/T-P2-508）——断言"装配动作 → 注册表/协议面可见"的
 * 因果链，不只断言字段值（pi-desktop·plugins/tests.rs 🔴 只学行为——装配
 * 动作后在注册表里查得到，是端到端因果，不是终态快照）。
 * 跨域 import 只读装配面（测试文件出边不受架构检查约束——先例同 check.test）。
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PendingApprovals } from "../policy/pending.js";
import { createPlanModeService } from "../ext-builtin/prompt-defaults/plan-mode.js";
import { ModelNotRegisteredError, ModelSwitchService } from "../core/index.js";
import type { ModelIdentity } from "../models/identity.js";
import type { ModelProvider } from "../models/provider.js";
import { ToolRegistry } from "../core/index.js";
import { BUILTIN_TOOL_NAMES, registerBuiltinTools } from "../../plugins/tools-builtin/index.js";
import { createNetworkGuard } from "../sandbox/network.js";

const providerStub: ModelProvider = {
  // eslint-disable-next-line
  async *streamChat() {
    yield { type: "done" } as const;
  },
};

const identityA: ModelIdentity = { provider: "openai", modelId: "model-a" };
const identityB: ModelIdentity = { provider: "anthropic", modelId: "model-b" };

describe("跨组件因果链（O30）", () => {
  it("①工具注册 → BUILTIN 清单可见：registerBuiltinTools 后每个 BUILTIN 名在注册表可取", () => {
    const registry = new ToolRegistry();
    // W16 B3：BUILTIN_TOOL_NAMES 收敛为"可注册超集"（条件工具族 task_wait/
    // list/stop/send、collab、trace×3、schedule×4 也进名单）——因果断言面
    // 补齐条件工具桩，注册面 = 全清单等价。
    const stubDelegations = {} as never;
    registerBuiltinTools(registry, {
      // 桩 deps 与 builtinToolParamNames 同款（闭包捕获、永不执行——见 15b 记档）
      todoEmit: () => {},
      todosRead: () => [],
      planMode: createPlanModeService(),
      savePlanArtifact: () => ({ path: "stub" }),
      networkGuard: createNetworkGuard({ policy: "deny" }),
      question: { pending: new PendingApprovals(), sessionId: "causal", timeoutMs: 1 },
      task: {
        runSubagent: async () => ({ kind: "foreground", result: { sessionId: "stub", stopReason: "cancelled", output: "" } }),
        delegations: stubDelegations,
      },
      taskWait: { delegations: stubDelegations },
      taskList: { delegations: stubDelegations },
      taskStop: { delegations: stubDelegations },
      taskSend: { delegations: stubDelegations },
      collab: { sessionId: "causal", port: {} as never },
      schedule: { add: async () => ({ id: "x" }), list: async () => [], remove: async () => true, update: async () => true },
      sessionQuery: { dbPath: "stub" },
      sessionTrace: { dbPath: "stub" },
      pluginCreate: { workspaceRoot: "stub" },
      pluginDefine: { toolRegistry: registry, handles: [] },
      // T-P3-174 批次 1：view_image/get_context_remaining 的条件注册桩
      attachments: {
        save: () => ({ attachmentId: "stub", mediaType: "image/png", size: 0 }),
        read: () => null,
      },
      contextUsage: () => null,
    });
    // 因果断言：注册动作的产出 = 清单里每个名字在注册表里可见（而非断言
    // "清单数组等于它自己"这种终态字段复读）
    for (const name of BUILTIN_TOOL_NAMES) {
      expect(registry.has(name), `BUILTIN 工具 ${name} 应注册进 registry`).toBe(true);
    }
  });

  it("②provider 配置 → 换模注册表可见：注册的身份可捕获可切换，未注册即类型化拒绝", () => {
    const sw = new ModelSwitchService({
      initial: identityA,
      models: [
        { identity: identityA, provider: providerStub },
        { identity: identityB, provider: providerStub },
      ],
    });
    // 因果链前半：装配注册 → captureForTurn 捕获到已配置身份
    expect(sw.captureForTurn(1).identity).toEqual(identityA);
    // 因果链后半：switch 到注册表内的另一个身份 → configured 立即可见
    sw.switch(identityB);
    expect(sw.captureForTurn(2).identity).toEqual(identityB);
    // 因果的否定面：注册表外身份 → ModelNotRegisteredError（不在注册表 = 不可见）
    expect(() => sw.switch({ provider: "openai", modelId: "never-registered" })).toThrow(
      ModelNotRegisteredError,
    );
  });

});
