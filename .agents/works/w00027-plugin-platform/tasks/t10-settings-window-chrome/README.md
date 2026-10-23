---
schema: nbook.task/v2
taskId: t10-settings-window-chrome
status: planned
updated: 2026-10-23
---

# 设置窗口的外框与“本作品”沿用行

## 目标与范围

设置窗口的浮动窗口外框（拖动区域、圆角、标题栏高度）与“本作品”标签下沿用用户设置的行，出静态稿给开发者挑，定稿后实施。来源：开发者 2026-10-23 看 t06 实现后提出（沿用行能否优化；窗口拖不动、圆角太圆、标题栏太高）。

合同：[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md) 输出 12（本作品标签）、输出 16（外框）；nb-ui `Dialog` 的浮动窗口（[`Dialog.md`](../../../../../packages/nb-ui/src/components/feedback/Dialog.md)）。

查明的原因：设置窗口用 nb-ui `Dialog` 的 `modal=false`，外框是对话框那一套（圆角 `--radius-dialog` 26px；上边距 20px、标题、与正文隔 14px）；拖动手柄只绑在标题文字那一块（18px 高），真实应用里实测按在字上能拖、往上 18px 就拖不动。第七轮定稿草稿没有这条标题栏（“设置”在左栏顶上、关闭在右上角、圆角 10px），实现时偏离了。

## 当前状态

- 2026-10-23 第一轮静态稿发到评审板 v1：`r1-chrome`（现状、紧凑标题栏、去掉标题栏，推荐去掉标题栏）、`r1-radius`（26、14、10px，推荐 14）、`r1-inherit`（现状、标题下一行、标题后标签、行上不标页面顶上说一次，推荐行上不标）。草稿在 `.worktree/w00027-t10-drafts`（分支 `t10/drafts`，不提交）的 `plugins/drafts/web/components/settings-window-chrome/SettingsChromeDraft.vue`。

## 下一步

读评审板答复、记决定；定稿后写 Spec 与 `plan.md`，改 nb-ui `Dialog` 浮动窗口与设置窗口。
