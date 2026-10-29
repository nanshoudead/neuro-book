---
schema: nbook.task/v2
taskId: t17-conversation-ui
status: planned
updated: 2026-10-28
---

# 对话界面：Composer、状态栏、待处理区

## 目标与范围

定对话界面在应用里的落位与 Composer（模型、推理档、模式、附件、草稿、触发符）、状态栏与待处理区；与 w00019 t11 合并。

来源：需求 1、2；清单外第 6 项（[报告](../t01-survey/artifacts/report/index.html)）；[w00019 t11 对话视图完整版](../../../w00019-agent-conversation-view/tasks/t11-complete-view/README.md)。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 落位：右栏还是面板。
- Composer：模型选择、推理档、模式、附件（图片进模型的通路）、草稿、触发符 `/`、`$`、`@`。
- 状态栏：上下文占用、用量、缓存命中、费用；上下文检查器。
- 待处理区与提问向导；会话列表、标题、归档。
- 文字按 w00028 的新写法（目录与 `TextResolver`）。
- 有界面设计，按 design-review 出稿评审。

## 材料

- [`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)、[`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md)
- [调研](../../research/2026-10-28-repo-survey.md)第 5 节 Composer

全局“活动”面板（运行中的会话、子代理、后台任务）随 [t22](../t22-background-work/README.md) 搁置（2026-10-28）。

## 前置

t06、t07、t09、t10；w00028 t03 合入。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
