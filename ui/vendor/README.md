# ui/vendor/ —— 前端纯库本地化（U4/T-P3-107）

零构建链约束（P3 §1 全局约束 3）下的渲染增强 vendor：文件直接以 ES module
被 `ui/app.js` → `ui/render.js` import，不走 CDN、不走打包器。

| 文件 | 库 / 版本 | 许可 | 来源 | 构建 |
| --- | --- | --- | --- | --- |
| `marked.esm.js` | marked 16.4.2 | MIT | npm `marked@16.4.2` tarball `lib/marked.esm.js` | 上游原样复制 |
| `highlight.esm.js` | highlight.js 11.12.0 | BSD-3-Clause | npm `highlight.js@11.12.0` tarball `lib/common.js` | esbuild bundle（`--format=esm --minify`，含 36 个 common 语言） |
| `LICENSE.marked.md` | — | MIT | marked tarball `LICENSE.md` | 原样复制 |
| `LICENSE.highlight.js` | — | BSD-3-Clause | highlight.js tarball `LICENSE` | 原样复制 |

## 为什么 highlight.js 要 bundle

highlight.js 11 的 npm 包内 `es/` 目录是 Node 双包互操作面（`es/core.js`
import 的是 CJS `lib/core.js`），浏览器不能直接 import；`lib/common.js`
是 CJS 入口。故用 esbuild 把 `lib/common.js`（core + 36 常用语言）打成
单文件浏览器 ESM，产物入库（本目录），UI 消费端仍零构建链。esbuild 仅
是 devDependency（同时服务 U6/T-P3-113 的 host 单文件 bundle 面）。

## 升级流程

1. `npm pack marked@<v> highlight.js@<v>`
2. marked：复制 `lib/marked.esm.js` 覆盖本目录同名文件
3. highlight.js：解包后 `npx esbuild package/lib/common.js --bundle --format=esm --minify --legal-comments=eof --outfile=ui/vendor/highlight.esm.js`
4. 同步两份 LICENSE 文件 + 更新本表版本 + THIRD_PARTY.md
