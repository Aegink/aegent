# Shell 语义分析 B 档 —— 静态分析做不到的清单（C29）

> 本文件是 `src/policy/shell-semantics.ts` 头注释 LIMITATIONS 的**同源拷贝**，
> 代码侧载体是导出常量 `SHELL_ANALYSIS_LIMITATIONS`（两处同文，改一处须同步另一处）。
> 依据：`requirements.md` C29——任何"用模式匹配做保护"的设计必须附"静态分析做不到"的清单，承诺强度可审计。
> 范围依据：Q19 裁决 B 档（语义分析，不做完整语法树），只覆盖 `&&` / `;` / 管道 / 重定向 / `cd` 五种构造。

## 清单（8 条）

1. 变量展开的值不可知（$VAR 不求值，只保守标记路径可能依赖 cwd）
2. 命令替换 $(…) 与反引号一律判 uncertain，不做内嵌递归分析
3. eval / source / 点号 sourcing 判 uncertain
4. 不解析 [[ ]]、$(( ))、heredoc、进程替换、别名/函数与 PATH 解析
5. 带文件描述符的重定向（2>、&>）不抽取为文件操作
6. tee/dd/cp 等以参数写文件的命令不识别为写操作
7. 虚拟操作的语义裁决（uncertain/危险模式/cd 保守）在链上受首匹配层序影响，可被用户层 allow 压过；保留名单硬拦已升出口级（protected-paths 消费本扫描器，不可被规则授权）
8. 不模拟 set -e、管道失败与子 shell 语义

## pwsh 方言边界（D11 · T-P1-28，两处同文同步维护）

PowerShell 作为一等 shell（T-P1-28）落地后，`analyzeShellCommand` 对 pwsh
命令命令**只有字面级重定向解析可信**（`>`/`>>`/`2>` 在两种 shell 同形状）。
方言差异的完整清单：

9. pwsh 参数式写 cmdlet（Out-File/Set-Content/Add-Content/New-Item/
   Export-Csv 等）不识别为写操作——与 bash 的 tee/dd（清单第 6 条）同款
   边界；出口级硬拦对其余写手段的覆盖同款收窄。
10. bash 特有构造（`$VAR` 展开、`$(...)`、heredoc）在 pwsh 里语法不同
    （`$env:X`、`$(...)` 恰好同形）——按 bash 规则解析 pwsh 命令可能
    **误报**（保守方向无害），绝不误放行。
11. pwsh 退出码为**宿主语义**（PowerShell 宿主 0/1，原生命令 `$LASTEXITCODE`
    不自动传播）——与 bash 的传播语义不同（dsh pwsh-local 同款决策：对齐
    需尾包装 `exit $LASTEXITCODE`，cmdlet 场景引入残留值误报，比差异更糟）。
12. **msys bash 与受限令牌结构性不兼容**（T-P1-25 真机发现）：msys 运行时
    启动需创建 `\BaseNamedObjects\msys-2.0*` 目录对象，WRITE_RESTRICTED
    令牌下 NtCreateDirectoryObject 被拒 0xC0000022——**bash 的 sandbox 态在
    Windows 不可用**（local 态不受影响）；Windows 沙箱态宿主正路是
    PowerShell（dsh 同款决策："Choose a Bash executor for POSIX, a
    PowerShell executor for Windows"）。

## 消费纪律（C28）

`cwdUnknown` / `uncertain` / `pathMayDependOnCwd` 是保守信号：消费方（`createShellSemanticsModule`）一律按危险处理（升 ask 或对保留路径直接 deny），绝不因"可能无害"放行。

## 已知边界（非限制，是设计取舍）

- 重定向目标带变量时路径不可知，因此不进受保护路径的 deny 检查，只走 uncertain → ask 的保守路径。
- bash 旁路只覆盖重定向写；`tee` 等参数式写文件见清单第 6 条。
