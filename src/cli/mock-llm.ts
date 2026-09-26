/**
 * 故障注入 mock 服务器库面（O16，T-P1-34）——startMockLlmServer 起本机
 * HTTP/SSE 端点按具名故障序列消费（dsh llm-mock-server 的 startMockLlmServer
 * 同构："run it with the CLI or call startMockLlmServer, which returns captured
 * requests for assertions"）；独立入口在 mock-llm-run.ts（stdout JSONL：ready
 * 行 + 每请求一行的行为记录）。仅监听 127.0.0.1、仅供测试使用，不做鉴权。
 */

import { HttpMock } from "../test-support/http-mock.js";
import { FAULT_BEHAVIORS, faultSequence, type FaultBehavior } from "../test-support/fault-server.js";

export interface MockLlmServer {
  baseUrl: string;
  /** 已到达的请求序号（0 起）——对应其消费的行为。 */
  servedCount(): number;
  behaviorAt(index: number): FaultBehavior;
  stop(): Promise<void>;
}

export async function startMockLlmServer(options: {
  sequence: readonly FaultBehavior[];
  stallRecoverMs?: number;
  port?: number;
}): Promise<MockLlmServer> {
  const mock = new HttpMock();
  const baseUrl = await mock.start(options.port ?? 0);
  mock.mountSequence(faultSequence(options.sequence, { stallRecoverMs: options.stallRecoverMs }));
  return {
    baseUrl,
    servedCount: () => mock.calls,
    behaviorAt: (index) => options.sequence[index]!,
    stop: () => mock.stop(),
  };
}

export function parseMockLlmArgs(
  argv: readonly string[],
): { port?: number; sequence: FaultBehavior[] } {
  const args = { sequence: [] as FaultBehavior[] } as { port?: number; sequence: FaultBehavior[] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") {
      args.port = Number(argv[++i]);
      if (!Number.isInteger(args.port) || args.port <= 0) {
        throw new Error(`--port 需要正整数，收到：${argv[i]}`);
      }
      continue;
    }
    if (arg === "--sequence") {
      for (const name of (argv[++i] ?? "").split(",").filter((s) => s.length > 0)) {
        if (!(FAULT_BEHAVIORS as readonly string[]).includes(name)) {
          throw new Error(`未知行为「${name}」——可选闭集：${FAULT_BEHAVIORS.join(" / ")}`);
        }
        args.sequence.push(name as FaultBehavior);
      }
      continue;
    }
    throw new Error(`未知参数「${arg}」——可用：--port <n> --sequence <行为,行为,…>`);
  }
  return args;
}
