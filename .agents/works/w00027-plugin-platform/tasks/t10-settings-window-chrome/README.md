---
schema: nbook.task/v2
taskId: t10-settings-window-chrome
status: done
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
- 2026-10-23 两轮定稿；Spec 输出 3、12、16 按决定改写（标 planned），实施计划见 [`plan.md`](plan.md)，开发者确认后开始实施。
- 2026-10-23 实施完成并合入 master（Work 分支 `feat/w00027-plugin-platform`）。提交：`629e7afc0` nb-ui 浮动窗口圆角 `--radius-window`、拖动区域（留白、整条标题栏、`data-dialog-drag`）、没有标题栏时角上的关闭按钮；`e244f18c9` 正文留白也能拖；`15f759423` 设置窗口去掉标题栏、关闭按钮按需让位、左栏顶上与标题区可拖、页面标题 20px 加粗；`4ff7d4e3c` 沿用的行照常画控件、标“来自用户设置”、去掉“单独设置”，常用片段示例同步；`b99b5fab6`、`4f674d615` 实现审查的修正。Spec 输出 3、12、16、18 去掉 planned。
- 与计划的出入：正文（`data-dialog-body`）为焦点光环留的一圈压在面板内边距上，只算面板自己时顶上只剩 8px 能拖，正文不滚动时它自己的留白也算拖动区域；拖动改为移过 3px 才开始、按下时不拦默认动作（审查第 1、2 条）。计划里“`SettingsListSection` 的比较让点一下不写本作品层”实际靠的是控件与 `scope.update` 在值没变时不发改值，列表照旧比较；没加新的比较。
- 验证：nb-ui 单元 565 条、neuro-book vitest 455 条与 bun 1610 条、类型检查全过（`test:affected` 并发跑时 dev-panel、nb-story、files-explorer 各有几条超时，单独重跑全过，与本次改动无关）；全量 e2e 284 条通过（审查修正之前）；修正后 `settings`、`plugins`、`lab-scenes`、`lab-nb-ui` 31 条通过；Lab 截图核对 960、900、560 宽与 fill 视图、深色、滚动条不被关闭按钮盖住，完整截图在本地 `shots/impl1`–`impl4`。
- 实现审查（Sonnet，[`evidences/impl-review-sonnet.txt`](evidences/impl-review-sonnet.txt)）：11 条，全是建议级。改了 1（按下不拦默认动作，输入框照常失焦）、2（移过 3px 才捕获，补 `role=button`）、3（正文会滚动时留白不起拖，不再按滚动条位置猜）、4（内容列滚动条从关闭按钮下面开始）、5（e2e 补几种宽度与 fill 视图的几何检查）、6（补只写本作品层的项与沿用加层无效的用例）、7（`SettingsRow.md` 与 Spec 输出 9、18 的旧画法）、8（场景 06 注释）、9（沿用标签不折行）、10（Lab 加没有标题栏的窗口场景）、11（可点元素的 `closest` 限在面板里）。没有不改的条目。
