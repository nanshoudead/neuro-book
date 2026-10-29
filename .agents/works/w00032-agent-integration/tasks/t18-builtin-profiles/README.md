---
schema: nbook.task/v2
taskId: t18-builtin-profiles
status: planned
updated: 2026-10-28
---

# 内置 Profile、提示词规范与评测

## 目标与范围

定第一批内置 Profile 与 Skill、提示词写作规范与评测方法（含真实模型的预算与授权）。

来源：需求 19；清单外第 10 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 第一批：建议很少几个（一个主创，加一个生成会话标题的摘要）。
- 提示词写作规范：结构、版本、语言（ADR 0034）。
- 评测方法、真实模型的预算与授权（nb-story 的经验：推理档影响大、渠道不稳）。
- 旧应用的资产（14 个 Profile、17 个 Skill、53 个文风预设）怎样取舍。

## 材料

- [`story/qa.md`](../../../../../docs/specs/story/qa.md)；w00024 t05 的评测
- 旧应用 `packages/neuro-book-legacy/assets/workspace/.nbook/agent/`

## 前置

t05、t12、t15。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
