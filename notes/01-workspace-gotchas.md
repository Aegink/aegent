# 工作区搭建踩坑记录

搭建 `F:\aegent` 调研工作区过程中实际遇到的问题。记下来避免下轮重犯。

## 1. 运行中编辑 bash 脚本会破坏执行

**现象**：`tools/clone-all.sh` 克隆到第 11 个仓时我在另一个会话里编辑了它
（删掉重复的 opencode-sst 条目）。脚本继续跑完了剩余克隆，但尾部报：

```
tools/clone-all.sh: line 47: syntax error near unexpected token `then'
tools/clone-all.sh: line 47: ` 1 --quiet "https://github.com/$slug.git" "$dest" 2>&1; then'
```

**原因**：bash 不从内存里读整个脚本，而是边执行边按字节偏移从文件读。
文件被改动后偏移错位，解析器读到半行。

**后果**：脚本尾部的 `cloned=/skipped=/failed=` 统计**从未执行**，
我拿不到失败计数。

**教训**：改脚本前先确认没在运行。**并且不要依赖脚本自己汇报成功** ——
必须独立验证产物。本次靠 `tree 文件数 == 实际文件数` 逐仓核对，
确认 16 个克隆其实都完整。

## 2. 判断"命令是否结束"不能靠猜进程

两次错误：

- 第一次等待器用 `ps aux | grep '[g]it clone'`，在两次克隆的间隙误判为已完成，提前退出。
- 后来发现 `ps aux | grep` 在这台 MSYS 机器上**根本看不到** 部分 bash 进程
  （`ps aux | grep -c audit` 返回 0，而 PowerShell 查得到 PID 39388 仍在运行）。

**可靠做法**：
- 查 Windows 进程用 `Get-CimInstance Win32_Process`，看完整 `CommandLine`。
- 判断后台命令结束，用"输出文件出现内容"这类**由命令自身产生的副作用**作信号，
  而不是猜进程名。

## 3. `cmd | tail` 会吞掉全部输出直到结束

`bash script.sh | tail -40` 中，`tail` 要读完整输入才输出。脚本运行期间
日志文件一直是 0 字节，看起来像卡死。改成 `> file 2>&1` 直接落盘。

## 4. `.gitignore` 排除目录会连带吞掉目录内的豁免文件

原来写 `oss/`，想保留 `oss/SOURCES.lock` 并加 `!oss/SOURCES.lock` 豁免 —— **无效**。
git 的规则是：父目录被整体排除时，无法用 `!` 重新包含其中任何文件。

**后果**：锁文件从未进入版本控制，可复现性设计形同虚设，且
`git status` 不报错，静默失败。

**正确写法**：
```
oss/*
!oss/SOURCES.lock
```
排除的是"目录内容"，不是目录本身，git 才会进目录里找豁免。

**验证方式**：`git check-ignore -v <path>` 会显示最后命中的规则；
但注意它**不区分否定规则**，看到 `!` 开头的行反而说明该文件未被忽略 ——
直接用 `git add -A --dry-run` 看实际结果更可靠。

## 5. 许可以字符匹配很危险

`pi-desktop` 的 `LICENSE` 是 **LGPL-3.0**，但我最初的正则 `GNU.*GPL`
命中了 GPL 前言里的 "GNU GPL" 字样，误报成 GPL。

两者对自研的约束差别很大：GPL 传染，LGPL 允许链接调用。
现已在 `tools/license-detect.sh` 中**先判 LESSER 再判 GPL**，并加断言验证。

## 6. 泄露关键词正则过松会产生误报

初版 `LEAK_PAT` 含裸词 `leaked`，结果 `deepseek-harness` 与 `hermes-agent`
命中三处，逐条查证**全是普通技术用语**：

- `a leaked --config/-p/--resume`（CLI 参数在子命令间串味）
- `leaked loop variables` / `a leaked allowlist`

已收紧为必须与 `claude`/`anthropic` 同现。
