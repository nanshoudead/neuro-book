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

## 开发者的决定

问题与取舍见 [analysis.md](analysis.md)，旧应用的清单见 [legacy-markdown.md](legacy-markdown.md)。

1. （2026-10-15）不另做 Markdown 的源码模式：用默认的文本编辑器（Monaco）打开就是源码模式，那里不做排版菜单与斜杠命令。排版菜单等只需要适配富文本一类的编辑器（一到两套）。
2. （2026-10-15）实时预览用 CodeMirror 6。开发者问：能不能不用 Tiptap、富文本也用 CodeMirror 6 自己做一套。待评估后再定。
3. （2026-10-15）排版菜单：选区浮动菜单与固定工具栏都有。
4. （2026-10-15）粘贴、拖进来的图片存到哪里做成设置，参照 Obsidian。
5. （2026-10-15）音频、视频先不做，以后有需求再做。
6. （2026-10-15）`@` 引用写成普通 Markdown 链接。

## 当前状态

2026-10-15 开工：旧应用调研（`legacy-markdown.md`）与功能分析（`analysis.md`）已完成；开发者定了决定 1–6，富文本用不用 Tiptap 待评估。

## 下一步

调研旧应用 `markdown-studio` 与现在的 `MarkdownControl`，列出候选清单与现状差距，交开发者排优先级与定范围。按集成分支约定从 t03（或当时线上的最后一个 Task）的分支拉出。
