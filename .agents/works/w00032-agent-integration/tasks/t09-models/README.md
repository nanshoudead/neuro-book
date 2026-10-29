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

## 决定（开发者 2026-10-28）

1. 模型服务单独做插件，不放进 Agent 插件：服务商（OMP 内置目录加自定义的 OpenAI 兼容服务商）、模型发现（`/models`）、模型能力（上下文窗口、看图、推理档、工具调用）、密钥、角色绑定。编辑器行内 AI（w00025 t12）、nb-story、以后 nb-memory 的向量模型都用它。设置页用 nb-form 与 w00027 的设置机制。
2. 密钥统一存 OMP 的凭据库 `<状态根>/agent/credentials.db`（API Key 与 OAuth 令牌），配置里不放密钥；同样不加密，只是把 2026-10-20 的“明文配置项”换成“明文凭据库”（OAuth 令牌会刷新，不适合当用户手改的配置项；配置导出与分享不带密钥）。密钥的值可以写成 `env:<变量名>`，启动时读取。nb-story 命令行照 ADR 0032 读环境变量，在应用里改用模型服务的密钥。
3. 模型角色照合同（`docs/proposals/model-roles-contract.md`）做并写成 Spec：梯度四档（tiny、fast、main、deep）加可自定义的专精角色，每个角色绑一个模型，不回退。系统功能各用一个梯度角色（标题 tiny、审批模型 fast；压缩摘要改用 t11 的“压缩”专精角色，2026-10-28），用户在对应功能的设置里可改。自动回退链不做（合同定为另立提案）。
4. 会话取模型：会话里明确选的 → Profile 设置里的角色或模型 → 全局缺省（main）。Profile 声明的能力（t05）不满足时，Composer 提示并不让发送。
5. 模型与推理档的切换是会话级设置，不跟对话路径走（开发者 2026-10-28：旧应用按路径记，用户换了模型再回退，模型也跟着切回去，不符合习惯）。会话级条目不进对话树（同 t03 的标题）；每条助手消息照旧记下是哪个模型、哪个档位生成的，供显示与统计。本条改了 t03 决定 1、t05 第一轮“会话里中途换模型跟着路径走”的说法。
6. 推理档按模型支持的档位夹取（master 的 `clampEffort`），Composer 只显示支持的档位。
7. 上下文窗口：OMP 目录里的模型自带；自定义模型必须填（压缩要用）。单价 `null` 为未知、`0` 为免费，界面分开显示；用量按会话汇总。
8. nb-story 在应用里跑时，模型与密钥从模型服务取；它在应用里的配置页留到 nb-story 接入时再定；命令行不变。

## 当前状态

讨论完成（2026-10-28）。计划与实施切片在本 Work 的讨论全部完成后另定。

## 下一步

实施时按 implementation-planning 写 `plan.md`；把模型角色合同写成 Spec。
