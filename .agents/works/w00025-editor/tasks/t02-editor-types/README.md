---
schema: nbook.task/v2
taskId: t02-editor-types
status: active
updated: 2026-10-14
---

# 按文件类型选编辑器：编辑器与语言贡献点、图片查看器、HTML 预览

## 目标与范围

编辑器种类与语言模式改为贡献点，按顺序为文件选编辑器；图片只看不改，HTML 可预览；Monaco 内置语言经贡献点登记，状态栏显示并可切换语言

合同：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（改）、[`workspace/files.md`](../../../../../docs/specs/workspace/files.md)（加字节读取）、[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)（HTTP 写请求核对来源），另新建图片查看器与 HTML 预览两份 Spec。实施计划：[plan.md](plan.md)。

## 当前状态

2026-10-14 计划经开发者确认（两个内置编辑器做成独立插件；界面不出评审稿，验收时给截图），走快速审查：Opus 与 omp 同时审计划，Opus 的结论处理完即开工，omp 的报告回来后另行处理。

## 下一步

处理 Opus 的计划审查结论，开 worktree，从 S0（Spec）开始。
