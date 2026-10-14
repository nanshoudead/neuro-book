---
schema: nbook.task/v2
taskId: t17-panel-small-fixes
status: active
updated: 2026-10-14
---

# 面板小修：勾选框的根上修法、会话页终端高度、各处显示会话标题

## 目标与范围

处理[后续清单](../../followups.md)第二档（开发者 2026-10-14 定，按 autonomous-delivery 推进）：

1. nb-ui `FormCheckbox` 的 label 加 `relative`，并用 nb-ui 的 Playwright 验收钉住；
2. 1440×650 这类矮窗口下，会话页的终端偏矮；
3. 首页、Task 页、运行页等显示租约的地方带上会话标题。

合同：[面板](../../../../../packages/dev-panel/docs/panel.md)、`packages/nb-ui/src/components/form/FormCheckbox.md`。计划见 [plan.md](plan.md)。

## 当前状态

2026-10-14 经 nbdev 新建；计划已写，待计划审查，排在 t16 之后。

## 下一步

计划审查，处理意见后按切片实施。
