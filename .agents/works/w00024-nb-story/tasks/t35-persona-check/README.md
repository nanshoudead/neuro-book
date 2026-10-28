---
schema: nbook.task/v2
taskId: t35-persona-check
status: active
updated: 2026-10-28
---

# 抽取管线加“马甲核对”：没连上的马甲问一个窄问题，写候选身份说法

## 目标与范围

按 t34 的结论，在每章提交前对没连上的马甲问窄问题，答出同一个人时在本章草稿里加一条候选身份说法；Spec、配置、进度与测试一起

合同：[`story.ingest`](../../../../docs/specs/story/ingest.md) 新增输出 20（马甲核对）与配置 `ingest.personaCheck`。来源：[t33](../t33-graph-issue-reports/README.md)、[t34](../t34-persona-link-probe/README.md)。计划见 [plan.md](plan.md)。代码在 `.worktree/w00024-t35-persona-check`，分支 `feat/w00024-t35-persona-check`。

## 当前状态

2026-10-28 经 nbdev 新建（autonomous-delivery）。计划已写，交 omp 做计划审查。照推荐做的两条产品取舍（只写候选、默认开）记进了 [待确认清单](../../pending-confirmations.md)。

## 下一步

处理计划审查后按切片 1 开工。
