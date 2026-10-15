---
schema: nbook.task/v2
taskId: t03-impl
status: planned
updated: 2026-10-15
---

# nb-story 第一版实现

## 目标与范围

按 story.queries、story.viewer、story.cli 三份 Spec 实现 packages/nb-story：核心库、命令行、独立服务、网页查看器与 Skill

合同：[`story/queries.md`](../../../../../docs/specs/story/queries.md)、[`story/viewer.md`](../../../../../docs/specs/story/viewer.md)、[`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)（`planned`）。计划：[plan.md](plan.md)。

## 当前状态

- 2026-10-15：经 nbdev 新建；计划初稿写好，开发者确认（见“决定”）。
- 2026-10-15：omp 审查计划，18 条，处理写进 [plan.md](plan.md) 的“计划审查”一节，报告 [evidences/plan-review.txt](evidences/plan-review.txt)。worktree `.worktree/w00024-t03-impl`（分支 `feat/w00024-nb-story`）：S1 已提交（`003fdc4ad`），并按审查改了一代的固定、导入校验与测试位置；S2 进行中。

## 决定

开发者 2026-10-15 在会话里确认计划，并定：

1. **样例书进 Git**：t34 的 100 章数据 gzip 后放 `packages/nb-story/tests/fixtures/`，测试与验收都用它。
2. **网页组件不在 Component Lab 登记**：照 dev-panel，界面靠真实服务加 Chromium 的 e2e 与截图验证；接成插件时再登记。
3. **S1 到 S5 做完先合入一次**，不等网页。

## 下一步

1. 完成 S2（合同、API、索引与投影、身份合并、人物与秘密查询）及其测试，接着 S3 到 S5，合入一次。
