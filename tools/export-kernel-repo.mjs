/**
 * W19 内核仓导出器：把 aegent 主仓的内核层导出为可独立发布的对外仓库
 * （Apache-2.0）。闭包 = 非宿主域 src 文件 + plugins/ + 治理工具 + 模板。
 *
 * 用法：
 *   node tools/export-kernel-repo.mjs --out ../agenticore [--name agenticore]
 *
 * 导出内容：
 *   - src/ 非宿主域（core/runtime/ext-builtin/session/policy/models/scheduler/
 *     diagnostics/context/attachments/sandbox/mcp/obs/lsp/test-support）+ plugins/
 *     （排除 4 个宿主耦合测试：sessions-cli/fault-server/p15d.snapshot/keymap）
 *   - tools/：architecture-check/read/context + vocabulary-check +
 *     generate-model-catalog + kernel-edges（自 scratch/_tmp_kernel_edges.cjs 迁）
 *   - architecture-policy.json（裁剪：只保留存在的域）
 *   - data/model-catalog.json（目录大数据源——主仓在 ui/）
 *   - tsconfig.json / vitest.config.ts（裁剪 ui 面）/ esbuild 无
 *   - LICENSE(Apache-2.0) / NOTICE / README（模板，{{NAME}} 替换）/
 *     THIRD_PARTY.md（许可声明段替换）/ .gitignore
 *
 * 重复执行安全（覆盖式导出——先清目标 src/plugins/tools/data，再复制）。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- 参数 ----
const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const NAME = argOf("--name") ?? "agenticore";
const OUT = path.resolve(ROOT, argOf("--out") ?? path.join("..", NAME));

// 宿主域（产品外壳——不进内核仓）
const HOST_DOMAINS = ["host", "cli", "acp", "sync", "ui"];
// 宿主耦合测试（非宿主域目录内但依赖宿主面——留主仓）
const EXCLUDED_TESTS = new Set([
  "src/session/sessions-cli.test.ts",
  "src/test-support/fault-server.test.ts",
  "src/scheduler/p15d.snapshot.test.ts",
  "src/diagnostics/keymap.test.ts",
  // W19 复核补：ui/tauri 资产面测试（文件系统级宿主耦合——闭包静态扫描
  // 看不到的依赖，新仓实跑暴露）
  "src/diagnostics/ui-settings.test.ts",
  "src/diagnostics/ui-mainui.test.ts",
  "src/diagnostics/tauri-shell.test.ts",
  "src/diagnostics/ui-render.test.ts",
]);
// 治理工具（随内核仓）
const TOOLS = [
  "architecture-check.mjs",
  "architecture-read.mjs",
  "architecture-context.mjs",
  "vocabulary-check.mjs",
  "generate-model-catalog.mjs",
];

function listFiles(relDir) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(path.relative(ROOT, p).replace(/\\/g, "/"));
    }
  };
  walk(path.join(ROOT, relDir));
  return out;
}

// ---- 1) 清目标骨架（覆盖式）----
for (const rel of ["src", "plugins", "tools", "data"]) {
  rmSync(path.join(OUT, rel), { recursive: true, force: true });
}
mkdirSync(OUT, { recursive: true });

// ---- 2) src：非宿主域全量（含测试——排除清单剔除）----
const SRC_DOMAINS = readdirSync(path.join(ROOT, "src")).filter((d) =>
  statSync(path.join(ROOT, "src", d)).isDirectory(),
);
let copied = 0;
for (const domain of SRC_DOMAINS) {
  if (HOST_DOMAINS.includes(domain)) continue;
  for (const rel of listFiles(`src/${domain}`)) {
    if (EXCLUDED_TESTS.has(rel)) continue;
    const dest = path.join(OUT, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(path.join(ROOT, rel), dest);
    copied += 1;
  }
}
// ---- 3) plugins ----
for (const rel of listFiles("plugins")) {
  const dest = path.join(OUT, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(path.join(ROOT, rel), dest);
  copied += 1;
}

// ---- 4) 治理工具 + kernel-edges（自 scratch 迁正）----
mkdirSync(path.join(OUT, "tools"), { recursive: true });
for (const tool of TOOLS) {
  cpSync(path.join(ROOT, "tools", tool), path.join(OUT, "tools", tool));
}
cpSync(path.join(ROOT, "scratch", "_tmp_kernel_edges.cjs"), path.join(OUT, "tools", "kernel-edges.cjs"));

// ---- 5) architecture-policy.json 裁剪（只保留存在的域）----
const policy = JSON.parse(readFileSync(path.join(ROOT, "architecture-policy.json"), "utf8"));
policy.modules = policy.modules.filter((m) => existsSync(path.join(OUT, m.roots[0])));
// requires 同步过滤：指向已删域（宿主面）的声明剔除——防"策略形状非法"
const keptIds = new Set(policy.modules.map((m) => m.id));
for (const m of policy.modules) m.requires = m.requires.filter((r) => keptIds.has(r));
policy.exceptions = policy.exceptions.filter((e) => existsSync(path.join(OUT, e.path)));
// paths 类字段的剥离：cli/host 专属项自动随 modules 过滤消失
writeFileSync(path.join(OUT, "architecture-policy.json"), JSON.stringify(policy, null, 2) + "\n", "utf8");

// ---- 5b) 内核面文档（测试双载体校验面——path-guard LIMITATIONS 同源）----
mkdirSync(path.join(OUT, "docs"), { recursive: true });
cpSync(path.join(ROOT, "docs", "sandbox-path-limitations.md"), path.join(OUT, "docs", "sandbox-path-limitations.md"));

// ---- 6) 数据源（模型目录大数据——主仓在 ui/）----
mkdirSync(path.join(OUT, "data"), { recursive: true });
cpSync(path.join(ROOT, "ui", "model-catalog.json"), path.join(OUT, "data", "model-catalog.json"));

// ---- 7) 构建配置 ----
cpSync(path.join(ROOT, "tsconfig.json"), path.join(OUT, "tsconfig.json"));
// win32 专属测试（盘符路径 / SendKeys / Job Object / 受限令牌 / pwsh / 账户
// provision 面）：非 win32 平台排除，Windows 全量运行。导出器生成——增删
// 请改主仓 tools/export-kernel-repo.mjs 的 WIN32_ONLY_TESTS 后重导出。
const WIN32_ONLY_TESTS = [
  "src/sandbox/win32-backend.test.ts",
  "src/sandbox/workspace-sid.test.ts",
  "src/sandbox/offline-network.test.ts",
  "src/scheduler/computer-win32.test.ts",
  "src/context/system-prompt.test.ts", // 验收①嵌套收集用 F:/ 盘符路径字面量
  "plugins/tools-builtin/pwsh.test.ts", // ①真命令需 pwsh 可执行
];
const win32Exclude = WIN32_ONLY_TESTS.map((t) => `"${t}"`).join(", ");
writeFileSync(
  path.join(OUT, "vitest.config.ts"),
  `import { defineConfig } from "vitest/config";

// win32 专属测试（盘符路径 / SendKeys / Job Object / 受限令牌 / pwsh / 账户
// provision 面）：非 win32 平台排除（含默认 exclude 两项——vitest 的 exclude
// 是替换语义），Windows 全量运行。导出器生成，勿手改（主仓重导出同步）。
const WIN32_ONLY_TESTS = [${win32Exclude}];

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "plugins/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      ...(process.platform === "win32" ? [] : WIN32_ONLY_TESTS),
    ],
  },
});
`,
  "utf8",
);

// ---- 9) 许可与文档（模板替换）----
const TPL = path.join(ROOT, "tools", "kernel-repo-templates");
cpSync(path.join(TPL, "LICENSE"), path.join(OUT, "LICENSE"));
cpSync(path.join(TPL, "NOTICE"), path.join(OUT, "NOTICE"));
cpSync(path.join(TPL, ".gitignore"), path.join(OUT, ".gitignore"));
cpSync(path.join(TPL, ".gitattributes"), path.join(OUT, ".gitattributes"));
// 免责声明与致谢（{{NAME}} 模板替换）
for (const doc of ["DISCLAIMER.md", "ACKNOWLEDGMENTS.md"]) {
  writeFileSync(
    path.join(OUT, doc),
    readFileSync(path.join(TPL, doc), "utf8").replaceAll("{{NAME}}", NAME),
    "utf8",
  );
}
writeFileSync(
  path.join(OUT, "README.md"),
  readFileSync(path.join(TPL, "README.md"), "utf8").replaceAll("{{NAME}}", NAME),
  "utf8",
);
// THIRD_PARTY：保留主仓登记（改首段许可声明）
const third = readFileSync(path.join(ROOT, "THIRD_PARTY.md"), "utf8");
writeFileSync(
  path.join(OUT, "THIRD_PARTY.md"),
  third.replace(
    /本项目以 AGPL-3\.0-or-later 发布/,
    "本内核仓以 Apache-2.0 发布（主仓 aegent 为 AGPL-3.0）",
  ),
  "utf8",
);
// CI（GitHub Actions：typecheck + tests + 治理三件）
mkdirSync(path.join(OUT, ".github", "workflows"), { recursive: true });
cpSync(path.join(TPL, "ci.yml"), path.join(OUT, ".github", "workflows", "ci.yml"));

// scripts（构建资产拷贝：descriptions）
mkdirSync(path.join(OUT, "scripts"), { recursive: true });
cpSync(path.join(ROOT, "scripts", "copy-assets.mjs"), path.join(OUT, "scripts", "copy-assets.mjs"));

console.log(`内核仓导出完成 → ${OUT}`);
console.log(`  复制 ${copied} 个源码文件 / 域 ${policy.modules.length} / 豁免 ${policy.exceptions.length}`);
console.log(`  name=${NAME} license=Apache-2.0`);
