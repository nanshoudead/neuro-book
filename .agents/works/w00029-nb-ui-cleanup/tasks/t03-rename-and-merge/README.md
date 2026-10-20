---
schema: nbook.task/v2
taskId: t03-rename-and-merge
status: active
updated: 2026-10-20
---

# 改名与合并重复的组件

## 目标与范围

去掉 Form 前缀、按“它是什么”命名，整行容器叫 …Field；合并或消歧功能重复的几组；带业务语义的挪回使用它的应用；先出新旧名字对照表给开发者定

合同：行为合同未变（改名不改行为；Spec 里的组件名随之改，见 [`ui/nested-grid.md`](../../../../../docs/specs/ui/nested-grid.md)、[`workbench/quick-open.md`](../../../../../docs/specs/workbench/quick-open.md)、[`workbench/notifications.md`](../../../../../docs/specs/workbench/notifications.md)）。

## 并入的事项

- `Banner`（t02 暂留）：nb-ui 里没人用，但 dev-panel 的 `App.vue` 与编辑器组的 `EditorGroup.vue` 各自手写了一条横幅；定是删掉，还是让两处改用它。

## 开发者的决定

1. （2026-10-20）[`naming.md`](naming.md) 照表执行：十个组件改名、`ToggleGroup` 只留多选、`Tabs` `SegmentedControl` `RadioGroup` 写清各自用途、`Banner` 保留并让两处手写横幅改用它、`DropIndicator` 不再导出、`FileBrowser` 挪进 neuro-book；滚动组件留给 t04；旧名字不留别名。

## 当前状态

执行位置：worktree `.worktree/w00029-t03-rename-and-merge`，分支 `refactor/w00029-t03-rename-and-merge`（从 master `64d7e884e` 拉出）。两笔提交：

- `2753d9a14` 按对照表改名、合并与挪出：
  - 十个组件改名，类型、文件、Lab 场景、测试、组件文档与 Spec 里的名字跟着改；`docs/proposals`、`docs/research` 与 `.agents` 下的历史记录不改，`llmlint` 有自己的同名组件，不动。
  - 和 reka-ui 的 `DropdownMenuItem` 撞名，菜单项类型叫 `DropdownMenuItemData`（与 `MenubarItemData` 一致）。
  - `useDropdownFloating` 等三个浮层 composable 是 `Select`、`DropdownMenu` 共用的，名字留给 t04 一起定。
  - nb-ui 的 `QuickPick` 组件与工作台的 `QuickPick` 服务（`plugins/workbench/shared/contracts.ts`）同名：服务由组件呈现，两者的 `QuickPickItem` 形状不同，目前没有文件同时导入两边。
  - `ToggleGroup` 只留多选；`JsonViewer` 与 Lab 画布宽度条改用 `SegmentedControl`（`label` 改为可选，支持只有图标的选项）。
  - `Banner`：紧凑排版、`actions` 插槽（放几个按钮）、`iconClass` 换图标，去掉单个文字动作按钮；编辑组状态条与 dev-panel 顶栏横幅改用它，冲突、写不出、保存失败等改用 `error` 色调（读屏立即播报）。dev-panel 的“知道了”成了关闭按钮（可访问名称仍是“知道了”）。
  - `DropIndicator` 不再导出，同名文档加 `验证入口: DropFeedbackOverlay`；`FileBrowser` 挪到 `packages/neuro-book/src/plugins/projects/web/components/`，Lab 场景跟到目录选择器旁边。
  - 四个“从一组里选”的零件的分工写进 [`ui-development-spec.md` 的“同类零件的分工”](../../../../../packages/nb-ui/docs/ui-development-spec.md#45-同类零件的分工)，组件文档各写自己一句并链过去。
- `d52b0f263` 审查修正（见下）。

审查：一个 Sonnet 审查（[`evidences/impl-review.txt`](evidences/impl-review.txt)），重要 2、建议 6。
- 改了：横幅按钮在 220px 编辑组里超出（动作区可在区内再换行）；`SegmentedControl` 值不对应任何项时没有 Tab 停靠点（停在第一个启用项，方向键从两端开始）；两处过期说明；分工清单四份重复（收成一份）；补了 `Banner`、`ToggleGroup` 多选、`SegmentedControl` 空值与仅图标选项的测试。补测试时还发现横幅模板根前的注释让它在开发构建里成了多根片段，`role` 与使用方的 data 属性落不到横幅上，已挪进根元素。
- 没改：`DropIndicator` 用 `验证入口` 不完全符合判据（它能独立挂载），取舍是内部件只在覆盖层里看，覆盖层的场景已经画出区域与插入线；dev-panel 文档里“知道了”的说法仍对，不补。

验证：nb-ui 类型检查（含 playground）、单元测试 504 例、Playwright 验收 31 例；neuro-book 类型检查、Bun 1511 例、vitest 367 例；dev-panel 类型检查与 461 例；nb-story 类型检查与 199 例；`docs:check`、`governance:check` 没有失败。neuro-book 整套 e2e 230 例里 5 例失败：Lab 两例单独重跑通过；另外三例（`lab-markdown` 场景 1、`workbench-shell` 拖动边界、`workbench-views` 拖到零后刷新）在 master 上用同样方式跑也失败，是 master 原有的问题。vitest 全量里 `SnippetsPage` 一例失败，单独连跑 3 次都过。Lab 截图（640px 与 220px 的横幅、编辑组状态条、`JsonViewer`、`ToggleGroup`）没有溢出与越界。

## 下一步

合入 master 后接 t04（弹出列表收成一套，先出静态稿）。
