---
schema: nbook.task/v2
taskId: t23-graph-ux-fixes
status: active
updated: 2026-10-27
---

# 关系图操作修正

## 目标与范围

[t21](../t21-usage-feedback/README.md) 第 3 条与第 4 条里的小项，行为合同：[`story.viewer`](../../../../docs/specs/story/viewer.md)、[`story.queries`](../../../../docs/specs/story/queries.md)（图的点带称呼）、示例走读。

1. 关系图和全书图的搜索要能按别名查：`graph.relations` 的点带可见称呼 `names`（不剧透：只含阅读位置之前已出现的称呼），搜索同时匹配显示名和称呼；
2. 右键点节点打开上下文菜单后，移动鼠标节点不再跟着动：只有左键按下才拖，按键状态不是左键时放开；
3. 让用户知道双击节点能打开详情：右键菜单的第一项显示快捷方式“双击 / Enter”，图的角落常驻一行轻提示“双击节点看详情”（可关）；
4. 示例走读（`examples/journey-to-the-west/README.md`）不再要求 `--library`，默认书库就行（开发者问“为什么要加 library 参数”）；`--library` 留作换书库的可选项，单列一句。

开发者已确认全部做（2026-10-27）；3 的具体形式按推荐做，记在待确认清单。设计审查并入实现审查（改动小、无新接口形状，只给节点加一个字段）。

## 当前状态

2026-10-27 开工，分支 `feat/w00024-t23-graph-ux`（worktree `.worktree/w00024-t23`）。
