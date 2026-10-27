---
schema: nbook.task/v2
taskId: t23-graph-ux-fixes
status: done
updated: 2026-10-27
---

# 关系图操作修正

## 目标与范围

[t21](../t21-usage-feedback/README.md) 第 3 条与第 4 条里的小项，行为合同：[`story.viewer`](../../../../docs/specs/story/viewer.md)、[`story.queries`](../../../../docs/specs/story/queries.md)（图的点带称呼）、示例走读。

1. 关系图和全书图的搜索要能按别名查：`graph.relations` 的点带可见称呼 `names`（不剧透：只含阅读位置之前已出现的称呼），搜索同时匹配显示名和称呼；
2. 右键点节点打开上下文菜单后，移动鼠标节点不再跟着动：只有左键按下才拖，按键状态不是左键时放开；
3. 让用户知道双击节点能打开详情：**这一条还没做，进评审板让开发者看了再定**（现有的提示是工具栏里一行 2xs 的小字，他没注意到；候选见评审板）；
4. 示例走读（`examples/journey-to-the-west/README.md`）不再要求 `--library`，默认书库就行（开发者问“为什么要加 library 参数”）；`--library` 留作换书库的可选项，单列一句。

开发者已确认全部做（2026-10-27）。设计审查并入实现审查（改动小，只给图的点加一个 `names` 字段）。

## 当前状态

2026-10-27 第 1、2、4 项已做完并合入 master，分支 `feat/w00024-t23-graph-ux`；第 3 项等评审板。nb-story 499 个测试、32 个 e2e 通过，`docs:check` 无失败。

- 搜索按别名：`graph.relations` 与 `graph.book`（对象点）的点带 `names`（阅读位置之前已出现的其他称呼，去重，不含显示名）；图上的搜索同时匹配显示名和称呼。测试：`graph.test.ts` 查“心月狐”在第 38 章归属某点、读到第 7 章时哪个点都不带；e2e 用别名“心月狐”搜索。
- 右键不拖点：`downNode` 只认左键；mousemove 时按键已不是左键就收住。e2e 做了变异检查：去掉修复后失败。
- 示例走读去掉 `--library`，单列一句说明可选。
- 实现审查待做（与后面几个 Task 一起交 omp，一次看完）。
