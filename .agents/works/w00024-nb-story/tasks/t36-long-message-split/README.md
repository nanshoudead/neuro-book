---
schema: nbook.task/v2
taskId: t36-long-message-split
status: active
updated: 2026-10-28
---

# 抽取请求的长消息分段：单条消息超过网关上限前拆成几条

## 目标与范围

网关限制单条消息约 70 到 80 KB（t33 实测）；抽取的用户消息超过阈值时在段落边界拆成几条用户消息，阈值以下的请求逐字不变；413 给出明确的错误说明

合同：[`story.ingest`](../../../../docs/specs/story/ingest.md) 输出 4 加一句长消息分段。来源：[t33](../t33-graph-issue-reports/README.md) 的网关实测。计划见 [plan.md](plan.md)。代码在 `.worktree/w00024-t36-long-message-split`，分支 `feat/w00024-t36-long-message-split`。

## 当前状态

2026-10-28 经 nbdev 新建（autonomous-delivery）。实测魔女学院图上写草稿的用户消息第 100 章约 67 KB、第 164 章约 77 KB，已越过网关单条上限；四条各 60 KB 的请求没有被 413 拒。计划已写；任务小，计划审查按 reviewing 的降级交 Claude Sonnet。

## 下一步

计划审查后实施。
