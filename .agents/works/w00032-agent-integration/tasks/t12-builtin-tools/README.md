---
schema: nbook.task/v2
taskId: t12-builtin-tools
status: planned
updated: 2026-10-28
---

# 基础工具与外部命令行依赖

## 目标与范围

定第一批内置工具清单与语义（读写、搜索、bash、网页、待办、提问），bash 与记账和只读模式的关系，以及 rg、git、uv 等外部命令行的依赖策略。

来源：需求 10、15（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 第一批清单：现有 read、edit，加 write、grep、glob、bash、网页搜索与读取、待办、提问；以 omp 为基础、参考 Claude Code。
- 工具经资源地址读写（t08）。
- bash 会绕过 nb-history 记账与只读模式，怎样处理。
- 外部命令行（rg、git、gh、python、uv、jq 等）：安装时装、首次用到时检测还是随应用带；Windows。

## 材料

- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 2、5 节
- [`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)
- [文件工具四种模式的调研](../../../w00002-neuro-agent-harness-redesign/research/2026-09-18-file-tools-four-modes-design.md)

## 前置

t04、t06、t08。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
