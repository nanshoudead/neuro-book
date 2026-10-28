---
schema: nbook.task/v2
taskId: t04-tool-registry
status: planned
updated: 2026-10-28
---

# 工具登记、命名与工具发现

## 目标与范围

定工具 id 与给模型看的名字、工具工厂、工具组、插件给所有 Profile 加工具的方式、工具发现，以及工具变化与提示词缓存的边界。

来源：需求 5、7（工具部分），也是需求 14（MCP）的前提；开发者 2026-10-28 要求工具发现与“插件给所有 Profile 加工具”一起考虑（[报告](../t01-survey/artifacts/report/index.html)第 5、7 条）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- id 与模型名：没写名字时取 id 最后一段还是必须显式写；撞名报错还是自动加前缀；插件工具 id 的换算（分支：`/` 换 `__`、`.` 换 `_`）。
- 工厂函数与按会话的构造参数（nb-story 每轮新建登记表、状态放闭包）。
- 工具组；插件给所有 Profile 加工具；Profile 能否拒绝某些插件工具；w00017 移交的“工具 × Profile 批准”要不要。
- 工具发现：客户端机制（所有服务商可用）与 Anthropic、OpenAI 的原生延迟加载；加载后的工具放进 tools 数组还是经分发工具调用；被加载的工具记进会话日志以便恢复。
- 工具变化与缓存边界：插件启用、禁用、升级时会话内的工具集怎么变（现在：快照不变）。
- 工具声明的字段：等级（t06 用）、并发、严格模式、`loadMode`、`summary`。

## 材料

- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 4 节（工具发现）
- [w00017 移交的调研](../../../w00002-neuro-agent-harness-redesign/research/2026-09-29-plugin-agent-tools-and-profiles.md)
- [`agent/harness.md`](../../../../../docs/specs/agent/harness.md) 输出 1 到 6
- 分支上的 `docs/specs/harness/tools.md`

## 前置

t02。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
