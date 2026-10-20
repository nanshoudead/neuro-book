---
schema: nbook.task/v2
taskId: t03-rename-and-merge
status: active
updated: 2026-10-20
---

# 改名与合并重复的组件

## 目标与范围

去掉 Form 前缀、按“它是什么”命名，整行容器叫 …Field；合并或消歧功能重复的几组；带业务语义的挪回使用它的应用；先出新旧名字对照表给开发者定

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 并入的事项

- `Banner`（t02 暂留）：nb-ui 里没人用，但 dev-panel 的 `App.vue` 与编辑器组的 `EditorGroup.vue` 各自手写了一条横幅；定是删掉，还是让两处改用它。

## 开发者的决定

1. （2026-10-20）[`naming.md`](naming.md) 照表执行：十个组件改名、`ToggleGroup` 只留多选、`Tabs` `SegmentedControl` `RadioGroup` 写清各自用途、`Banner` 保留并让两处手写横幅改用它、`DropIndicator` 不再导出、`FileBrowser` 挪进 neuro-book；滚动组件留给 t04；旧名字不留别名。

## 当前状态

执行位置：worktree `.worktree/w00029-t03-rename-and-merge`，分支 `refactor/w00029-t03-rename-and-merge`（从 master `64d7e884e` 拉出）。开工。

## 下一步

按对照表改名，再做合并与挪出；跑 nb-ui、neuro-book、dev-panel、nb-story 的类型检查与测试、Lab e2e。
