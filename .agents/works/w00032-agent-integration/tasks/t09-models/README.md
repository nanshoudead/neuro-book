---
schema: nbook.task/v2
taskId: t09-models
status: planned
updated: 2026-10-28
---

# 模型服务与模型角色

## 目标与范围

定模型服务插件：服务商与模型目录、密钥存法、模型角色合同的落地，以及会话怎样取模型。

来源：清单外第 3 项；需求 1 的模型选择（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 模型服务插件：服务商、模型目录、自定义服务商、模型发现。
- 密钥存法：明文配置项（2026-10-20 定）、环境变量名（nb-story，ADR 0032）、OMP 凭据存储与 OAuth（分支）三选一或组合。
- 模型角色：合同落成 Spec；会话怎样取模型（Profile 指定、角色、用户在 Composer 里选）。
- 推理档、上下文窗口、单价“未知”与“免费”。
- nb-story 接入应用后共用这一套。

## 材料

- [模型角色合同](../../../../../docs/proposals/model-roles-contract.md)、[`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md) 的密钥一节
- [`story/qa.md`](../../../../../docs/specs/story/qa.md) 的配置、[ADR 0032](../../../../../docs/adr/0032-nb-story-keys-from-startup-env.md)
- 分支上的 `docs/specs/harness/models.md`、`config.md`

## 前置

t02。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
