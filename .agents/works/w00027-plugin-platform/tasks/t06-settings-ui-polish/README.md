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

一并收口（t07 S3 的 Sonnet 界面审查第 7 条，2026-10-20 记）：nb-ui 的表单控件在只读时与可编辑几乎看不出差别（开关、单选、下拉、文字逐像素相同），需要一种统一的只读外观（例如弱化底色或锁形标记，不用整体变淡，变淡是停用的样子）；`NumberInput` 只读时原来套了停用的变淡，t07 已去掉，与其它控件一致。证据：`../t07-low-code-forms/evidences/impl-review-s3-sonnet.txt`。

一并收口（t07 S5 的 Sonnet 界面审查第 8 条，2026-10-21 记）：设置行里单行输入定宽 320px，标签列 200px 加间距后内容列不到约 544px（改过的行约 580px，多一个“恢复默认”）就整行换到标题下面，同一分区里数字框、下拉仍排在右边，两种对齐混在一起；可以考虑单行输入在 200 到 320px 之间随内容列收窄、放不下才换行。“恢复默认”在窄宽度下也会单独换一行。证据：`../t07-low-code-forms/evidences/impl-review-s5-sonnet.txt`。
