---
schema: nbook.task/v2
taskId: t26-qa-mode-notice
status: active
updated: 2026-10-27
---

# 问答“图当目录 / 全读”的首次提示

## 目标与范围

[t21](../t21-usage-feedback/README.md) 反馈 5 的第一条，行为合同：[`story.viewer`](../../../../docs/specs/story/viewer.md) 问答页。开发者在 t21 评审板第 2 题的决定：第一次点切换模式时弹确认窗口，带 3 秒确认时间；示意稿的窗口不好看，要用真实 nb-ui 的对话框把版式认真做。

- 第一次切换（点输入框里的模式按钮，`mode.set`）：不立即切，先弹模态对话框，标题“两种读书方式”，正文是图当目录与全读的对比（做法、优点、弊端）；
- “知道了，切换”按钮先停用 3 秒（按钮上倒计时），到时才能点；点了才切换并记住（以后不再弹）；“先不切换”或关闭：不切、不记住，下次切换仍弹；
- 记住的位置：`host/prefs.ts`（localStorage，浏览器级，同书页其他偏好）。

## 当前状态

2026-10-27 开工，分支 `feat/w00024-t26-mode-notice`（worktree `.worktree/w00024-t26`）。设计已由开发者在评审板定，计划即上面三条，不另写 plan.md；设计审查并入实现审查。
