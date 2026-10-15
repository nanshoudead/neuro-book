---
schema: nbook.task/v2
taskId: t21-harness-profile-tools
status: active
updated: 2026-10-15
---

# nb-harness：Profile 定义、工具三层与一次运行的结果

## 目标与范围

按 [nb-harness 提案](../../../../../docs/proposals/nb-harness-profile-and-tools.md) 加强 `packages/nb-harness`（连带 `nb-profile`、`nb-session`）：Profile 声明工具与上下文、生效工具集、`turn()` 返回停止原因与用量、收尾工具、单次请求、按配置给模型、缓存键。第一个调用方是 [w00024 t05 内置问答](../../../w00024-nb-story/tasks/t05-qa/README.md)，它等本 Task 完成再接。

合同：新建 `docs/specs/agent/harness.md`（`planned`，提案审查处理完后写）。

## 当前状态

- 2026-10-15：经 nbdev 新建。提案草稿 `7ea121d9a`，开发者确认要点与三个待定项（见提案决策记录）。omp 设计审查进行中，报告写到 `.local/agent/works/w00002-neuro-agent-harness-redesign/tasks/t21-harness-profile-tools/reports/design-review.md`，审查用的 worktree `.worktree/w00002-t21-review`（detached，审完删）。

## 下一步

1. 处理设计审查，报告存为 `evidences/design-review.txt`；修订提案，交开发者接受。
2. 写 `docs/specs/agent/harness.md` 与 `plan.md`。
