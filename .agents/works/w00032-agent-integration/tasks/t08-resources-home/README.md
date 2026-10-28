---
schema: nbook.task/v2
taskId: t08-resources-home
status: planned
updated: 2026-10-28
---

# 资源地址与 home：会话、Profile、Agent 三层与文档

## 目标与范围

定 Agent 可见的资源地址：session、profile、agent 三层 home 与真实目录的映射，附件存放，docs:// 与插件贡献文档，以及 local:// 的歧义。

来源：需求 11、12；清单外第 9 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 三层 home 的方案名与真实目录；每层放项目里还是跨项目。
- `local://` 的歧义：资源 Spec 里是会话工作目录，提示词编辑器 Spec 里是附件短地址。
- 附件：按内容哈希存、能否共享、fork 会话时怎样处理。
- `docs://` 的内容（产品使用文档、SDK 作者文档、插件贡献的文档）与贡献点。
- 插件注册资源方案的接口（资源 Spec 里 planned）。
- 长期记忆落在哪一层；`artifact://` 与工具大结果的溢出（分支 t18）。

## 材料

- [`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)、[`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md)
- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 1 节（omp 的 URI）
- [调研](../../research/2026-10-28-repo-survey.md)第 5 节（旧应用的 profile home 与附件）

## 前置

t03、t05。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
