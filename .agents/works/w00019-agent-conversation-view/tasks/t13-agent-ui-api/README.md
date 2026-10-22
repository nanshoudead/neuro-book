---
schema: nbook.task/v2
taskId: t13-agent-ui-api
status: planned
updated: 2026-10-22
---

# nb-agent-ui 接口整理

## 目标与范围

按 t10 质量审查第二类：宿主组件通道、工具渲染器的结果标记、内置工具拆成数据与组件、收窄公开面、宿主起步套件、行为原则、拆分 AgentTurnBlock；先写计划交开发者确认，t11 之前做

合同：[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)。切片 0 先补新条目与验收 20 到 25，再实现。

## 当前状态

2026-10-22 经 nbdev 新建。计划见 [plan.md](plan.md)（Opus 规划子代理起草，逐条对照代码核实过审查意见），开发者同日同意计划末尾的九项决定。设计审查 14 条（Sonnet，重要 5、建议 9）全部成立，已改进计划，处理见计划的“设计审查”一节。执行位置：worktree `.worktree/w00019-nb-agent-ui`，分支 `feat/w00019-nb-agent-ui`，接在 t10 的 `a1a862d4e` 之后。

## 下一步

按切片 0 到 7 实施。
