---
schema: nbook.task/v2
taskId: t13-history
status: planned
updated: 2026-10-28
---

# nb-history 接入与文件变更感知

## 目标与范围

定 nb-history 的接入：Agent、人、外部程序写入的记账，收件箱的接受与还原，每轮告诉 Agent 文件变化，以及 History 的归属插件。

来源：需求 16（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 归属：`nbook.history`（文件底座提案）还是 `nbook.project`（平台提案 P9）。
- 记账：Agent、人、外部程序三种来源；bash 的写入。
- 收件箱的接受、还原与界面。
- 每轮告诉 Agent 文件变化（旧应用三档）与 diff 预算；会话游标。
- 与编辑器未保存修改的关系（编辑器 Spec 输出 16 已覆盖磁盘变化）。

## 材料

- `packages/nb-history/README.md`
- [调研](../../research/2026-10-28-repo-survey.md)第 5 节 nb-history
- [文件底座提案](../../../../../docs/proposals/project-file-foundation.md)

## 前置

t08、t12。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
