---
schema: nbook.task/v2
taskId: t11-compaction
status: planned
updated: 2026-10-28
---

# 上下文压缩

## 目标与范围

定上下文压缩的触发（手动、溢出、阈值）、摘要模型、压缩条目与恢复。

来源：清单外第 1 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 触发：手动 `/compact`、溢出后、一轮结束超过阈值。
- 摘要用哪个模型（角色，t09）；压缩条目的形状与恢复。
- 与会话树（在某个分支上压缩）、工具发现的缓存边界的关系。
- 插件贡献压缩方法。

## 材料

- 分支上的 `docs/specs/harness/compaction.md`
- [调研](../../research/2026-10-28-repo-survey.md)第 5 节（旧应用的压缩参数）

## 前置

t03、t09。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
