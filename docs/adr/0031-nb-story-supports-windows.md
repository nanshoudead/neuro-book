---
schema: nbook.adr/v1
status: accepted
decided: 2026-10-24
superseded-by: null
---

# ADR 0031：nb-story 支持 Windows，去掉安装包的平台限制

- 日期：2026-10-24
- 决策者：开发者
- 关联工作：[w00024 t18](../../.agents/works/w00024-nb-story/tasks/t18-windows-support/README.md)
- 部分取代：[ADR 0029](0029-workspace-packages-publish-source-to-npm.md) 决策 2 里的“nb-story 另写 `os: ["linux", "darwin"]`”与后果里的“Windows 上装不上 nb-story”；0029 的其余决定不变

## 背景

nb-story 0.1.0 的书库锁经 `bun:ffi` 调 libc 的 `flock`，只实现了 Linux 与 macOS，所以 ADR 0029 让它在 `package.json` 里写 `os: ["linux", "darwin"]`，理由是“Windows 上装不上比装上后才报错好”。

发布后开发者在 Windows 上 `bun add @notnotype/nb-story`，命令找不到。实测 Bun（1.3.14 与 1.4.2）遇到 `os` 不匹配的包会静默跳过，直接依赖也一样：照样打印“installed @notnotype/nb-story@0.1.0 with binaries: nbstory”，`node_modules` 里却没有这个包（npm 会报 `EBADPLATFORM` 拒绝）。所以写 `os` 得到的既不是“装不上”，也不是“装上后报错”，而是“装成功了、命令却不在”。0029 的那条理由不成立。

## 决策

1. nb-story 支持 Windows：书库锁在 Windows 上经 kernel32 的 `CreateFileW` 与 `LockFileEx`（独占、立即失败）实现，进程结束时由系统放锁，与 `flock` 的语义相同。`serve --open` 在 Windows 上用 `cmd /c start`；`skill install` 的用户目录在 Windows 上取 `USERPROFILE`。
2. 去掉 nb-story 的 `os` 字段。以后某个包确实不能在某个平台运行时，不写 `os`，而在运行时一开始就报清楚原因：Bun 不会因为 `os` 拒绝安装。
3. Windows 由开发者的 Windows 机器实测（从打好的包安装、命令行、配置锁、`serve` 与服务独占），仓库的自动测试与 `release:smoke` 仍只在 Linux 上跑。

## 后果

- nb-story 在 Linux、macOS 与 Windows 上都能装、能用。Windows 上没有自动测试守着，改到平台相关的代码（锁、打开浏览器、路径、信号）时要在 Windows 上再实测一遍。
- 在 Windows 上停服务只能靠控制台的 Ctrl-C 或结束进程；结束进程时服务登记留下，下一次 `serve` 判它无效后覆盖（[`story.cli`](../specs/story/cli-skill.md) 的“副作用与数据”）。
