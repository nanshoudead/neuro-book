---
schema: nbook.task/v2
taskId: t25-qa-position-change
status: active
updated: 2026-10-27
---

# 问答对话里调整阅读位置

## 目标与范围

[t21](../t21-usage-feedback/README.md) 反馈 5 的第三条，开发者在评审板第 4 题的决定（含评语）。要改的合同：[`story.qa`](../../../../docs/specs/story/qa.md)（原来写“对话中途不能改阅读位置与做法”，现在位置可以改、做法仍不能改）、[`story.viewer`](../../../../docs/specs/story/viewer.md) 问答页、[`story.cli`](../../../../docs/specs/story/cli-skill.md)（`ask --continue` 现在可以带 `--at`）。计划见 [plan.md](plan.md)。

不在本 Task：书没抽完时助手读后续章节原文、图工具不可用——要新开一条读未提交章节原文的路径，单列为 t30。

## 当前状态

2026-10-27 开工，分支 `feat/w00024-t25-position-change`（worktree `.worktree/w00024-t25`）。先写计划、交 omp 设计审查（阻塞）。
