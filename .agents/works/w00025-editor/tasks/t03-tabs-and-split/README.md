---
schema: nbook.task/v2
taskId: t03-tabs-and-split
status: active
updated: 2026-10-15
---

# 编辑器区的标签栏与拆分

## 目标与范围

- 修拆分后不能拖动调整大小、看不到分隔线（2026-10-15 在生产构建上复现：两组分界处按下落在编辑器正文上，宽度不变；编辑器区用的是 nb-ui `GridRenderer`，根因待查）。
- 标签栏重新设计：先在 Lab 出静态稿，按 [design-review](../../../../skills/design-review/SKILL.md) 逐轮评审，定了再实现。
- 拖动标签：组内排序、换组、拖到边缘拆分。旧应用的做法在 `neuro-book-legacy/app/components/editor-workbench/`（`editor-tab-drop.ts`、`useEditorTabDrag.ts`），复用 nb-ui 的 `resolveGridEdgeDrop`、`resolveListInsertion` 与 `DropFeedbackOverlay`。
- 固定标签；多行标签（设置项，默认开）；预览标签页开关（设置项，默认开）；标签右键菜单（关闭、关闭其他、关闭右侧、关闭已保存、固定、拆分、复制路径、在资源管理器中显示）；编辑区标题动作与非活动标签的关闭按钮悬停时显示，规则同 [workbench/views.md](../../../../../docs/specs/workbench/views.md) 输出 10。

非目标：自动保存（t04）、Monaco（t05）、Markdown 编辑器的深度打磨。

合同：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（改“不承诺”里的标签拖放、固定、多行与标签右键菜单）。

## 开发者的决定

1. （2026-10-15）编辑器区打磨拆成 t03 标签栏与拆分、t04 自动保存、t05 Monaco 打磨，先做 t03；三者做完后再做 Markdown 深度打磨。
2. （2026-10-15）标签右键菜单放进 t03。
3. （2026-10-15）t02 到 t05 叠在一条线上，打磨完一次性合入 master（见 Work README）。

## 当前状态

2026-10-15 开工。先修拆分调整大小（不涉及设计），同时准备标签栏的第一轮静态稿。

## 下一步

查拆分调整大小的根因并修正；写第一轮静态稿的注意力排序问题给开发者。
