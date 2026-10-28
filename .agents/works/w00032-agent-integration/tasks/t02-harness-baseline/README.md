---
schema: nbook.task/v2
taskId: t02-harness-baseline
status: planned
updated: 2026-10-28
---

# harness 底座：两条线对照与移植清单

## 目标与范围

以 master 的 nb-harness 为底座，逐块评估内核分支 `feat/w00002-harness-kernel` 的能力，定移植清单、harness 与 Agent 插件的分工，以及 harness Spec 的状态。

来源：需求 4；[报告](../t01-survey/artifacts/report/index.html)第 4 条；开发者 2026-10-28 定底座：master 为底座、参考内核分支。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 内核分支的能力逐块定“移过来、改了再移、不要”：会话树、审批与提问通道、插话与排队、配置与凭据、模型角色、压缩、资源地址与 artifact 溢出、插件扩展点、上下文槽、运行期更换与 Profile 重载、插件工具名换算。
- master 上 nb-story 实战得出的修正全部保留：密钥遮盖、余额不足归 `quota`、截断识别、相邻 user 消息合并、进程中断与停服收尾、启动环境取密钥。
- harness 与 Agent 插件的分工：报告第 4 条的建议是按“离开 NeuroBook 还能不能用”分。
- 包分不分开：分支并成一个包；master 是三个包，nb-story 依赖它们且已发 npm。
- OMP 版本：仓库锁定 18.2.5，分支 18.4.6，本机 omp 已到 18.12.3。
- Spec：`agent/harness.md` 晋升与实现对齐；分支上的 8 份 `docs/specs/harness/*` 怎样处置。
- 内核分支 t20 的 5 条待确认（插件 Slot、ask 与 yolo、提问后重启回答、插件工具名换算、在 interaction 事件里立即应答）。

## 材料

- [调研](../../research/2026-10-28-repo-survey.md)“harness 的两条线”一节
- [`agent/harness.md`](../../../../../docs/specs/agent/harness.md)、[master 的提案](../../../../../docs/proposals/nb-harness-profile-and-tools.md)
- 分支上的 `docs/proposals/agent-harness-kernel.md` 与 `docs/specs/harness/*`（`git show feat/w00002-harness-kernel:<路径>`）

## 前置

无。t03 到 t11 都建在它上面。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
