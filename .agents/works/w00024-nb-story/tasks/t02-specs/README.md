---
schema: nbook.task/v2
taskId: t02-specs
status: active
updated: 2026-10-15
---

# nb-story 第一版的 planned Spec

## 目标与范围

把 t01 定下的设计（决定 1 到 26）与 nb-story 提案写成 docs/specs/story/ 下四份 planned Spec：queries、viewer、qa、cli-skill；先把提案从 w00005 分支搬到 master。要点先给开发者看，确认后再提交。

合同：新建 `docs/specs/story/queries.md`、`story/viewer.md`、`story/qa.md`、`story/cli-skill.md`（`planned`，正文待写）。依据：[nb-story 提案](../../../../../docs/proposals/novel-story-app.md)、[V9 记忆图提案](../../../../../docs/proposals/novel-memory-v9.md)、[t01 的决定](../t01-ui-design/README.md#决定)。

## 当前状态

- 2026-10-15：两份提案从 w00005 分支搬到 master（`docs/proposals/novel-story-app.md`、`novel-memory-v9.md`）：加了提案 frontmatter（accepted），正文开头的“状态”一句去掉，指向 w00005 分支上 Task 记录的链接改写成文字引用（master 上没有这些文件），登记进提案目录的活跃提案。w00005 合并回 master 时这两个文件会冲突，以 master 上的为准。
- 2026-10-15：要点评审板 [artifacts/review/index.html](artifacts/review/index.html) v1：能力地图（`story.queries`、`story.qa`、`story.viewer`、`story.cli`）与各份要点，问四题：能力地图（`capability-map`）、阅读状态存哪里（`reading-state-store`）、知情视角里“没有记录”怎么算（`no-record-perspective`）、位置之后的原文能不能看（`source-beyond`）。

## 决定

（待开发者答复要点评审板。）

## 下一步

1. 等开发者答要点评审板的四题。
2. 按答复写四份 Spec 正文，登记进 `docs/specs/README.md` 的待实现规范，跑 `bun run docs:check`；正文按记忆先给开发者看要点，再交 omp 审查、提交。
