---
schema: nbook.task/v2
taskId: t06-ingest
status: planned
updated: 2026-10-15
---

# nb-story ingest：命令行与网页导入并抽取

## 目标与范围

把 w00005 t29 v2 抽取管线搬进 nb-story：按章切分、逐章抽取、断点续跑、追加新章；命令行与网页都能导入并看进度

合同：待写 `docs/specs/story/` 下抽取的 Spec（`planned`），并改 queries 里“不做抽取”的非目标。依据：[剧情图谱提案](../../../../../docs/proposals/novel-story-app.md) 2026-10-15 的决策记录；管线设计见 [V9 记忆图提案](../../../../../docs/proposals/novel-memory-v9.md)的“抽取管线”一节，现行做法在 w00005 t29 的 `v2/`。

## 当前状态

- 2026-10-15：经 nbdev 新建（建时 slug 误写成 `t06-ingest`，生成了 `t06-t06-ingest`，已改名）。排在 [t05 问答](../t05-qa/README.md)之后。

## 决定

开发者 2026-10-15 在会话里定：

1. **范围**：命令行加网页导入。`nbstory ingest` 与网页都能导入原文、按章切分、逐章抽取、看进度；断点续跑；能追加新章接着抽。
2. **顺序**：先做 t05 问答，再做本 Task。

## 下一步

t05 做完后开工：读 t29 `v2/` 管线，写抽取 Spec 与 `plan.md`，要点先给开发者看。
