---
schema: nbook.task/v2
taskId: t06-markdown-polish
status: active
updated: 2026-10-15
---

# Markdown 编辑器打磨

## 目标与范围

开发者 2026-10-15 定为本 Work 的下一个任务（t01 决定 1 的第二段：深度打磨作者最常用的 Markdown 编辑器）。需求先与开发者定，再写评审稿或计划。

- **正文右键菜单**：现在 Markdown 富文本里右键是浏览器自己的菜单，Spec 把正文右键菜单列在“不承诺”。在这里定义菜单位置 `editor.content-context`（或按菜单 Spec 的命名），用应用的 `ContextMenu`；源码编辑器（Monaco）的那一份在 t05，两边共用同一个菜单位置。
- **候选**（从 t01 的候选表与旧应用 `markdown-studio` 来，待开发者排）：选区浮动菜单、斜杠命令、frontmatter 面板、批注侧栏、工具栏（旧应用 `EditorToolbar.vue`）、大纲与标题导航（t03 已有面包屑的标题段）、排版与纸面细节。

合同：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（“不承诺”里的正文右键菜单与 Markdown 写作工具）、[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)。

## 当前状态

2026-10-15 经 nbdev 新建，尚未开工。

## 下一步

调研旧应用 `markdown-studio` 与现在的 `MarkdownControl`，列出候选清单与现状差距，交开发者排优先级与定范围。按集成分支约定从 t03（或当时线上的最后一个 Task）的分支拉出。
