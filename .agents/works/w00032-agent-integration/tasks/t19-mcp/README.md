---
schema: nbook.task/v2
taskId: t19-mcp
status: planned
updated: 2026-10-28
---

# MCP 插件

## 目标与范围

定 MCP 插件：连接 MCP 服务、把它的工具与资源接进工具登记与工具发现。

来源：需求 14（[报告](../t01-survey/artifacts/report/index.html)第 14 条）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 连接与配置：要不要兼容 `.mcp.json`。
- 工具进公共池与工具发现（t04）；整个服务延迟加载。
- 资源接成资源方案（t08）；认证。

## 材料

- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 3、4 节

## 前置

t04、t08、t10。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
