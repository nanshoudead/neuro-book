---
schema: nbook.task/v2
taskId: t06-settings-ui-polish
status: planned
updated: 2026-10-20
---

# 设置界面的样式收口

## 目标与范围

设置窗口与设置组件（左栏、分区标题、行、控件、page 页面的组件）按设计稿重新收口外观；先找回或重出设计稿，经 design-review 由开发者拍板，再实施

合同：[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)（只改外观时行为合同不变）。

来源：开发者 2026-10-20 认为设置界面的组件样式还不好看，之前产出过设计稿但没有很好地执行。已知的设计稿是 w00017 t80 的评审板（[r1–r4](../../../w00017-application-runtime-architecture/tasks/t80-settings-ui/artifacts/review/index.html)），对照时发现现在的实现与 r4 稿的结构基本一致，开发者记得的可能是另一份稿，开工时先找回。

## 当前状态

2026-10-20 经 nbdev 新建，尚未开工；排在 t02 之后。

## 下一步

找回开发者说的设计稿（问开发者在哪），或按 design-review 重出静态稿；与 t02 新增的控件（多行、列表、JSON、密钥、搜索）一起定外观。
