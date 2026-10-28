---
schema: nbook.task/v2
taskId: t06-approval
status: planned
updated: 2026-10-28
---

# 审批、提问与 Agent 模式

## 目标与范围

定工具审批（等级、模式、持久化与跨重启应答）、Agent 向用户提问，以及 Agent 模式（normal、discuss、plan）与只读模式下哪些工具算写。

来源：需求 9；清单外第 8 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 等级（读、写、执行）与审批模式；用户按工具设 allow、deny、prompt；审批模型（让另一个模型先判）。
- 等待：会话多一个“等用户”的状态；持久化与重启后应答（分支已做）。
- 提问：ask 的形状（标题、问题、选项、自由输入、表单），用 nb-form 的展示态。
- Agent 模式的语义；只读模式下哪些工具算写；bash 怎么办。
- 插件被禁用时，正在等审批的调用怎样结算；子代理的审批（t14 细化）。
- 命令系统的 `confirm` 通道复用这条（t16）。
- 拿例子过：discuss 模式下改一章的审批卡片（显示 diff）；问“这章用第一人称还是第三人称”的提问。

## 材料

- [调研](../../research/2026-10-28-repo-survey.md)第 1、5 节
- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 3、5 节（审批）
- 分支上的 `docs/specs/harness/tools.md`、`runtime.md`
- [`ui/forms.md`](../../../../../docs/specs/ui/forms.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)

## 前置

t03、t04。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
