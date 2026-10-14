---
schema: nbook.task/v2
taskId: t01-requirements
status: active
updated: 2026-10-14
---

# 编辑器需求讨论：现状、旧应用对照与范围

## 目标与范围

w00017 收尾后开发者定下一个 Work 做“编辑器”（2026-10-14）。本 Task 先和开发者把这一阶段要做哪些、先做哪些、做到什么程度定下来，结论写成 Spec 改动与后续 Task；不改产品代码。

合同：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（`implemented`）；本阶段的新行为在它的“不承诺”一节之上增补，或另开 Spec。

## 当前状态

2026-10-14 开工，先盘现状（从 Spec 与代码目录读出，未在页面上逐条复核）。

**新应用已有**（`nbook.editor`，`workbench/editor.md` 输出 1–35）：编辑组与标签（单击预览、双击固定）、拆分、Markdown 富文本（Tiptap）与源码（Monaco）两种编辑器及“用其它编辑器重新打开”、按磁盘基线保存与冲突处理、外部修改、资源管理器操作前结算未保存、页面终态时取回未保存正文、会话恢复与上次光标、继续写作参数、最近打开、纸面版式与空态提示、页面标签（欢迎页）、编辑区标题动作贡献点、指定编辑组打开（资源管理器拖到编辑区）、状态栏文档项（字数等）。

**Spec 明确不承诺的**（候选范围）：

| 组 | 内容 | 旧应用有没有 |
|---|---|---|
| 标签与组 | 拖动标签换组、拖到边缘拆分、固定标签、多行标签条 | 有标签拖放（`editor-workbench/editor-tab-drop.ts`、`useEditorTabDrag.ts`） |
| 导航 | 面包屑 | 有（`EditorBreadcrumbs.vue`） |
| 菜单 | 标签右键菜单、正文右键菜单 | 部分 |
| 保存 | 自动保存；未保存修改跨刷新保留 | 待查 |
| 写作工具 | 批注侧栏、选区浮动菜单、斜杠命令、frontmatter 面板 | 有（`markdown-studio` 的 `MarkdownCommentFlowPanel`、`MarkdownSelectionMenu`、`TipTapFrontmatterPanel`） |
| Agent | Agent 与 AI 引用、工作区引用标签 | 有（`novel-ide/ai`、`agent`），依赖还没搬的 Agent 插件 |
| 其它 | 差异比较、跨文件撤销、两组共享撤销、预读、性能标准实测 | 差异比较待查 |

旧应用另有编辑器工具栏（`EditorToolbar.vue`）。

## 下一步

请开发者定这一阶段的主线（见会话里的提问），再按选定的组逐项调研旧应用的行为、出评审稿。
