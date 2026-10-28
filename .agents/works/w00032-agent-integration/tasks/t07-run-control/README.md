---
schema: nbook.task/v2
taskId: t07-run-control
status: planned
updated: 2026-10-28
---

# 运行控制：插话、排队与中止

## 目标与范围

定运行中插话、追加排队、中止与会话状态机，与审批等待的关系。

来源：清单外第 2 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- steer（插进当前运行）与 followup（排队），语义沿用旧应用的黑盒合同；中止与清空队列。
- 与审批等待（t06）组合后的状态机；现在重叠的 `turn` 报 `session_busy`。
- 旧应用 w00004 的中止合同（强制中止经写入队列结算、宽限 150 毫秒）。
- nb-agent-ui 已有的排队界面怎样接。

## 材料

- [调研](../../research/2026-10-28-repo-survey.md)第 5 节
- [`archived/specs/agent/session-abort.md`](../../../../../docs/archived/specs/agent/session-abort.md)
- 分支上的 `docs/specs/harness/runtime.md`
- [`agent/harness.md`](../../../../../docs/specs/agent/harness.md)“状态与转换”

## 前置

t03、t06。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
