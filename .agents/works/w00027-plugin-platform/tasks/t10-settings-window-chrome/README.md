---
schema: nbook.task/v2
taskId: t10-settings-window-chrome
status: active
updated: 2026-10-23
---

# 设置窗口的外框与“本作品”沿用行

## 目标与范围

设置窗口的浮动窗口外框（拖动区域、圆角、标题栏高度）与“本作品”标签下沿用用户设置的行，出静态稿给开发者挑，定稿后实施。来源：开发者 2026-10-23 看 t06 实现后提出（沿用行能否优化；窗口拖不动、圆角太圆、标题栏太高）。

合同：[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md) 输出 12（本作品标签）、输出 16（外框）；nb-ui `Dialog` 的浮动窗口（[`Dialog.md`](../../../../../packages/nb-ui/src/components/feedback/Dialog.md)）。

查明的原因：设置窗口用 nb-ui `Dialog` 的 `modal=false`，外框是对话框那一套（圆角 `--radius-dialog` 26px；上边距 20px、标题、与正文隔 14px）；拖动手柄只绑在标题文字那一块（18px 高），真实应用里实测按在字上能拖、往上 18px 就拖不动。第七轮定稿草稿没有这条标题栏（“设置”在左栏顶上、关闭在右上角、圆角 10px），实现时偏离了。

## 设计决定

1. 窗口外框去掉标题栏（第一轮 `r1-chrome` = integrated，开发者 2026-10-23）：关闭在右上角，窗口顶上一条的空白处能拖。附言：左上角的“设置”也可以去掉，不去掉就把高度调小；右边页面标题（“外观”）改小、只加粗。这两点出第二轮比较。
2. 窗口圆角 14px（`r1-radius` = 14），与小确认框同一档；浮动窗口单列一档圆角，模态对话框不动。
3. “本作品”标签里沿用的行：控件一直在、显示生效的值，标题后一枚小标签（`r1-inherit` = tag；推荐的“行上不标”未选）。附言：“沿用”一词是否恰当，改成“继承自 xx”是否更好。用词与标签样子（要和“下次会话生效”分得开）出第二轮比较。
4. 左上角的“设置”去掉（`r2-side` = none，开发者 2026-10-23）：左栏从“用户 | 本作品”起，与右边页面标题齐平；窗口的可访问名称仍是“设置”。
5. 页面标题 20px 界面字体加粗（`r2-title` = xl），即主题的 `--text-xl`，不再用 26px 展示字体。
6. 沿用标签写“来自用户设置”，描边不填色（`r2-inherit-word` = from-user），与填色的生效时机标签分开。

## 当前状态

- 2026-10-23 第一轮静态稿发到评审板 v1：`r1-chrome`（现状、紧凑标题栏、去掉标题栏，推荐去掉标题栏）、`r1-radius`（26、14、10px，推荐 14）、`r1-inherit`（现状、标题下一行、标题后标签、行上不标页面顶上说一次，推荐行上不标）。草稿在 `.worktree/w00027-t10-drafts`（分支 `t10/drafts`，不提交）的 `plugins/drafts/web/components/settings-window-chrome/SettingsChromeDraft.vue`。
- 2026-10-23 第二轮发到评审板 v2（接第一轮的附言）：`r2-side`（左上角“设置”保留、调矮、去掉，推荐去掉）、`r2-title`（页面标题 26px 展示字体、20px 加粗、16px 加粗，推荐 20px）、`r2-inherit-word`（沿用填色、沿用描边、继承自用户设置描边、来自用户设置描边，推荐来自用户设置描边）。同一草稿加了 `sideTitle`、`titleSize`、`inheritWord`、`inheritStyle`。

## 下一步

读评审板答复、记决定；定稿后写 Spec 与 `plan.md`，改 nb-ui `Dialog` 浮动窗口与设置窗口。
