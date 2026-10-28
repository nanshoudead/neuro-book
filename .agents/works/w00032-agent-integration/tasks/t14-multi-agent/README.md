---
schema: nbook.task/v2
taskId: t14-multi-agent
status: planned
updated: 2026-10-28
---

# 多 Agent 与 Workflow

## 目标与范围

定子 Agent：派生与授权、前台与后台、结果回流、父子关系与审批冒泡，以及 Workflow 与 Agent 的关系。

来源：需求 8；清单外第 7 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 派生与授权：父会话批准派生就算授权（分支提案的设想）。
- 前台阻塞与后台运行，结果怎样回流；用收尾工具交回结果。
- 父子关系与列表、分离；子代理用的模型。
- 子代理遇到审批：直接失败还是冒泡到父会话的界面。
- Workflow（nb-workflow）与 Agent 的关系。

## 材料

- [调研](../../research/2026-10-28-repo-survey.md)第 5 节多 Agent
- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 3、5 节子代理
- 分支上的 `docs/proposals/agent-harness-kernel.md` 非目标里的子代理设想

## 前置

t05、t06、t07。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
