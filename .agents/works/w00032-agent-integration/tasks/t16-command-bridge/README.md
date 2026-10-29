---
schema: nbook.task/v2
taskId: t16-command-bridge
status: planned
updated: 2026-10-28
---

# Agent 操控 NeuroBook 与 nbook project 子命令

## 目标与范围

定 Agent 调用工作台命令的工具与确认通道，以及给外部 Agent 用的 nbook project 子命令。

来源：需求 18、20（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- Agent 调命令的工具（列出、执行）；暴露级别；确认通道复用 t06。
- 命令提案里待决的三项：插件的命名空间、Ctrl+P 搜哪些东西、两种模式动作集的关系。
- `nbook project` 子命令给谁用（外部 Agent 配 Skill，还是应用内也走它）；要不要求应用在运行。

## 材料

- [`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)、[命令提案](../../../../../docs/proposals/workbench-commands.md)
- [`runtime/cli.md`](../../../../../docs/specs/runtime/cli.md)

## 前置

t06、t10。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
