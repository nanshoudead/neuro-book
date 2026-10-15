---
schema: nbook.task/v2
taskId: t01-requirements
status: planned
updated: 2026-10-15
---

# 需求与调研：现有用法、trellis 与要开放的定制点

## 目标与范围

开发者 2026-10-15 提出：用到布局工具的地方越来越多，要定制的也越来越多，把 Grid、Splitter 这类布局工具拆成单独的包；这个 Work 同时负责用新包优化现有布局。本 Task 先把需求定下来，再拆后续 Task。

- **现状清单**：现在的布局工具都在 nb-ui 的 `packages/nb-ui/src/components/layout/`：Grid（`grid.ts`、`GridRenderer.vue`、`grid-geometry.ts`、`grid-snapshot.ts`）、分隔线手势（`sash-*.ts`、`useSashGesture`）、Splitter（`Splitter.vue`、`splitter-*.ts`）、拖放落点（`grid-drop.ts`，`resolveListInsertion`、`resolveGridEdgeDrop`）与反馈（`DropFeedbackOverlay`、`DropIndicator`、`DropIndicatorLabel`）。列出每个用处：工作台外壳（`plugins/workbench/web/shell/layout.ts`、`views/container-grid.ts`、`views/drop.ts`、`WorkbenchDragFeedback`）、编辑器区（`plugins/editor/web/groups/groups.ts`、`tab-drag.ts`）、资源管理器的拖动（`plugins/explorer/web/tree-drag.ts`），各自自己写了哪些手势与反馈。
- **参照**：[trellis](https://github.com/DanFessler/trellis)：拖动时直接拖着卡片（View）本身，而工作台现在是跟手的小拖影加落点指示。调研它的分层与定制方式；再看 VS Code 的 grid 与拖放。
- **要开放的定制点**（待与开发者定）：拖动反馈（落点指示、拖着源本身、跟手拖影，以及动画）、分隔线外观与命中带、最小尺寸与吸附、序列化。
- **包的边界**：新包与 nb-ui 的关系（反馈组件留在 nb-ui 还是一起搬）、对 Vue 的依赖、包名，按 [`monorepo-boundaries.md`](../../../../../docs/modules/monorepo-boundaries.md) 登记。

合同：[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)、[`workbench/views.md`](../../../../../docs/specs/workbench/views.md)、[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（拖动与拆分）、[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md) 的“拖动”；拆包本身不改行为，换反馈样式时改对应 Spec。

## 与其它 Work 的关系

- 可以与 w00025（编辑器）并行。w00025 的 t02 到 t05 还在分支上、没有合入 master（`feat/w00025-t03-tabs-and-split` 起的一条线），其中 t03 改了 nb-ui grid 的用法（编辑组分隔线 1px）并新写了标签拖动 `plugins/editor/web/tab-drag.ts`。本 Work 从 master 开分支；把编辑器区改用新包的那一步排在 w00025 合入之后，或者到时与 w00025 商定先后。

## 当前状态

2026-10-15 经 nbdev 新建，尚未开工。

## 下一步

按上面的清单调研，把要开放的定制点与包的边界整理成问题交开发者定，再拆后续 Task（拆包、各处改用）。
