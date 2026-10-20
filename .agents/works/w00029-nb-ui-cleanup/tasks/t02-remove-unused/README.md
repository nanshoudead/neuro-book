---
schema: nbook.task/v2
taskId: t02-remove-unused
status: active
updated: 2026-10-20
---

# 删掉没用的组件

## 目标与范围

按 t01 决定 1：产品里没人用、只有 Lab 夹具在用或谁都没用的组件直接删，连同它们的文档、夹具、测试与只为它们存在的内部件；`Toolbar` 留给 w00025 t08。不改外观。

合同：行为合同未变（删的都是产品里没有使用方的组件；Lab 场景随之减少，见 [`ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md)）。

## 当前状态

执行位置：worktree `.worktree/w00029-t02-remove-unused`，分支 `refactor/w00029-t02-remove-unused`（从 master 拉出）。三笔提交：

- `da68a4f83` 删 33 个组件：`Editable` `Pagination` `Stepper` `SwitchField` `Rating` `Avatar` `HoverCard` `Accordion` `AspectRatio` `CollapsibleSection` `Panel` `FileTree` `NavigationMenu` `Autocomplete` `Combobox` `Listbox` `ColorPicker` `PinInput` `TagInput` 与日期时间一族 14 个，连同 macOS 主题的滚轮时间选择器、time-picker 合同测试套件与 `testing` 子路径，Lab 夹具、单元测试与文档条目（README、`ui-development-spec.md` 的相应小节、`design-language.md` 里带规定性质的几行）。playground 只留 nb-ui 自己 e2e 用的 `/acceptance`，主题对照、工作台、组件画廊、手动导入四个演示页与 Lab 重复，一并删掉。`dist/nb-ui.css` 重新编译，少了 752 行。
- `cfccc8b83` 拆掉主题“替换组件实现”的机制：唯一的可替换组件已删，新应用从没提供过主题组件。去掉 manifest 的 `overrides`、入口的 `components`、组件契约登记表、`useThemeComponent` 与三种装载失败，主题作者指南只讲声明式主题。
- `3dd4db2eb` e2e 修正（见下）。

盘点时的误判与改正：用量统计把路径带 `/lab/` 的文件都当成夹具，漏了 Lab 自己的导航面板在用 `Tree`；类型检查报出后恢复了 `Tree`（组件、导出、夹具与测试）。

暂留待定：`Banner`。它在 nb-ui 里没人用，但 dev-panel（`App.vue`）与编辑器组（`EditorGroup.vue`）各自手写了一条横幅，是功能重复而不是没有需求；留给开发者定是删还是让两处改用它。

测试改动：取色面板的两条用例（`ColorPicker` 里测的是面板行为）改经 `ColorSwatches` 的“自定义”打开面板来测；折叠动画的 e2e 原来测 `Accordion`，改测 `Collapsible`（同一套动画），改写时有两处等待的时序写错（点击后动画要过一帧才开始），已改为先等日志里的动画结束再判静止，连跑 5 次通过，变异检查（让折叠内容一直裁切）失败。

验证：nb-ui 类型检查（含 playground）、单元测试 504 例、playwright 验收 31 例通过；neuro-book 类型检查、Bun 1511 例、vitest 363 例通过；Lab 的 `lab-nb-ui`、`lab-scenes` e2e 11 例通过；`docs:check`、`governance:check` 没有问题。`test:affected --since master` 里 dev-panel 一例超时、nb-story 一例失败，单独重跑都过，是全量并行时的负载问题，这两个包也没用到被删的组件。

## 下一步

已合入 master（合并提交 `cd085308b`，未推送）；`Banner` 的去留等开发者定。
