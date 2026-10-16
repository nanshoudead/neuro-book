---
schema: nbook.work/v1
workId: w00025-editor
issueId: null
status: active
updated: 2026-10-16
---

# 编辑器

## 目标

在已实现的编辑器区（workbench.editor）之上，与开发者定下下一阶段的编辑器需求，再按评审与计划实施

## 集成分支

t02 之后的 Task 叠在一条线上：t03 从 t02 的分支 `feat/w00025-t02-editor-types` 拉出，之后的 Task 依次从线上最后一个拉出；打磨完一次性合入 master（开发者 2026-10-15 定）。t03 之后先做 t06 Markdown 打磨（开发者 2026-10-15 定），t04 自动保存、t05 Monaco 打磨随后。

2026-10-16 开发者授权先把 t02、t03、t06 合入 master（合并提交 `c948c588a`）；t04、t05 以后从 master 拉分支。
