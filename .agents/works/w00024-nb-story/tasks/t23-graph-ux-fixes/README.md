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
3. 让用户知道双击节点能打开详情：开发者选了方案 A（评审板第 1 题）：选中后图底部出浮条（名字、打开按钮、“双击或按 Enter 也能打开 · 按 F 只看周边”、关闭），右键菜单第一项快捷键写“双击 / Enter”；
4. 示例走读（`examples/journey-to-the-west/README.md`）不再要求 `--library`，默认书库就行（开发者问“为什么要加 library 参数”）；`--library` 留作换书库的可选项，单列一句。

开发者已确认全部做（2026-10-27）。设计审查并入实现审查（改动小，只给图的点加一个 `names` 字段）。

## 当前状态

2026-10-27 第 1、2、4 项已做完并合入 master，分支 `feat/w00024-t23-graph-ux`；第 3 项等评审板。nb-story 499 个测试、32 个 e2e 通过，`docs:check` 无失败。

- 搜索按别名：`graph.relations` 与 `graph.book`（对象点）的点带 `names`（阅读位置之前已出现的其他称呼，去重，不含显示名）；图上的搜索同时匹配显示名和称呼。测试：`graph.test.ts` 查“心月狐”在第 38 章归属某点、读到第 7 章时哪个点都不带；e2e 用别名“心月狐”搜索。
- 右键不拖点：`downNode` 只认左键；mousemove 时按键已不是左键就收住。e2e 做了变异检查：去掉修复后失败。
- 示例走读去掉 `--library`，单列一句说明可选。
- 浮条（提交 `feat(nb-story): 关系图与全书图选中后底部出浮条`，分支 `feat/w00024-t23b-selection-bar`）：新组件 `graph/SelectionBar.vue`（带同名 .md），两个图页共用；e2e 覆盖选点出浮条、按钮打开人物卡、取消选中浮条消失、右键菜单写“双击 / Enter”。页面打开时沿用抽屉里开着的对象，所以抽屉开着时一进页面就有浮条，测试不假设一开始没有。
- 全量 e2e 33 个里，“长列表”一个因 1 秒阈值在机器负载 9 到 12 时多花了 134 毫秒失败（单独跑同样失败，非本改动；t23 合入时它是通过的）。
- 实现审查（omp，t23、t26、t27 合并一轮，[报告](evidences/impl-review.txt)）9 条：重要 4、建议 5，全部成立并已改（提交 `fix(nb-story): t23/t26/t27 实现审查处理`，分支 `fix/w00024-t23-27-review`）：
  - 浮条在全屏里消失：改成 `StoryNetwork` 的 `overlay` 插槽，浮条在全屏根里；
  - 窄屏浮条压住缩放按钮与图例：浮条上移到图的**顶部**居中（偏离评审板写的“底部”，因为底部是图例与缩放，开发者要看效果再说，记入待确认清单）；
  - 全书图隐藏类型后浮条残留：不可见的点不算选中，并清掉选择；
  - `ThemeMenu` 丢 class：`inheritAttrs: false`，class 交给 `DropdownMenu` 的 `rootClass`；
  - `ModeNotice` 取消事件发两次、没有标题栏关闭按钮：只转发 `@cancel`，加 `closable`；偏好存不进浏览器时在本页内只弹一次；
  - `RelationNode.names` 改可选（旧生产者兼容），Spec 类型示例与兼容说明已同步；
  - 组件文档标签与 attrs 落点、`names`、`overlay` 补齐；
  - 测试：别名归属钉死（读者视角心月狐只属于苏天晴 e1-1，南嘉鱼视角苏天晴与狐狐各带），右键用例先关掉抽屉并断言打开的是苏天晴，新增全屏、隐藏类型、设置页按钮在右端的 e2e；对浮条残留与 class 丢失两处做了变异检查，都失败。
  - 验证：nb-story 503 个测试、37 个 e2e 通过。
