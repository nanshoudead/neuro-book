---
schema: nbook.task/v2
taskId: t03-popup-lists
status: active
updated: 2026-10-21
---

# 弹出列表零件：搬目录，级联键盘、方向键漫游、行组件各收成一份，浮层材质只走 CSS 类

## 目标与范围

按 t01 总计划的 t03 一节：弹出列表一族移入 components/popup/；useMenuCascade 收进级联键盘、父级滚动收起与外部判定；方向键漫游合成 utils/roving.ts；内部行组件 MenuRow；删 usePopoverLayer 的内联材质（F43）。公开 API 不变。

合同：产品行为合同不变（组件同名 `.md` 与现有测试为准）；只改了两处边界行为，见计划第 2、3 节与待确认清单。

## 当前状态

2026-10-21 新建；开发者要求用 autonomous-delivery 推进。实施计划 [plan.md](plan.md) 已写，交 omp 做计划审查。

- worktree：`.worktree/w00030-t03-popup-lists`，分支 `refactor/w00030-t03-popup-lists`

## 下一步

处理计划审查，然后按计划 S1 到 S5 实施。
