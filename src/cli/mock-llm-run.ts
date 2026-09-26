#!/usr/bin/env node
/**
 * 故障注入 mock 服务器独立入口（O16，T-P1-34）——**不起 agent 循环**：
 * 起本机 HTTP/SSE 端点按 `--sequence` 消费具名故障行为（dsh llm-mock-server
 * 的 `pnpm run mock:llm` 同构），把真实 provider 适配层指向它即可演练恢复
 * 逻辑。stdout 输出 JSONL：ready 行（baseUrl + 序列）+ 每请求一行（行为与
 * 序号）。库面在 mock-llm.ts。
 *
 * 运行：`npm run mock:llm -- --port 8000 --sequence rate-limit,server-error`
 */

import { parseMockLlmArgs, startMockLlmServer } from "./mock-llm.js";

async function main(): Promise<void> {
  const args = parseMockLlmArgs(process.argv.slice(2));
  const server = await startMockLlmServer({ sequence: args.sequence, port: args.port });
  process.stdout.write(
    `${JSON.stringify({ type: "ready", baseUrl: server.baseUrl, sequence: args.sequence })}\n`,
  );
  let reported = 0;
  const report = (): void => {
    while (reported < server.servedCount()) {
      process.stdout.write(
        `${JSON.stringify({ type: "request", index: reported, behavior: server.behaviorAt(reported) })}\n`,
      );
      reported += 1;
    }
  };
  const timer = setInterval(report, 100);
  timer.unref();
  process.on("SIGINT", () => {
    clearInterval(timer);
    void server.stop().then(() => process.exit(0));
  });
}

await main();
