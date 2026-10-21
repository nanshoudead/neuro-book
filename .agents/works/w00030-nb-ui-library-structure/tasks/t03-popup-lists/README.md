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

2026-10-21 新建；开发者要求用 autonomous-delivery 推进。实施计划 [plan.md](plan.md) 已写。
- 计划审查（omp 默认模型，11 条：重要 9、建议 2）与处理见 [evidences/design-review.txt](evidences/design-review.txt)：9 条成立、已改计划，1 条半不成立。
- 改前截图：Lab 里 8 个弹出列表组件的打开态，两主题 × 明暗共 68 张（`/tmp/t03/shots/before/`，脚本 `/tmp/t03/shots/popup-shots.mjs` 只截浮层所在区域）；同一提交截两遍逐像素相同。

- worktree：`.worktree/w00030-t03-popup-lists`，分支 `refactor/w00030-t03-popup-lists`

- S1（分支 `b66b68236`）：15 个文件移入 `components/popup/`；`menu-cascade.ts` 拆成 `utils/popup-geometry.ts`（连同 `usePopupScroll` 里不依赖 Vue 的量取函数）与 `useMenuCascade` 里的悬停调度；`option-highlight.ts` 改名 `utils/roving.ts`。nb-ui typecheck、单测 532，neuro-book typecheck、Lab 单测，`docs:check` 通过。
- S2（分支 `997d16fb0`）：级联键盘、父级滚动收起、外部判定收进 `useMenuCascade`。补测试时发现并修了两个原有缺陷：
  - reka 的 `select` 事件只交给监听者、不在元素上派发，`currentTarget` 永远是 null：在 DropdownMenu、Menubar 的一级里点击父项或按 Enter、空格，子菜单拿不到父项，没有定位并抛错（截改前基准图时点父项，子菜单就没出来）。MenuNodes 改为自己记下项元素。
  - `measureCascadePanel` 不换算 CSS `zoom`：`zoom: 0.8` 下子菜单首项比父项偏 23px。
  - nb-ui 单测 537、typecheck 通过；e2e `popup-scroll`、`popup-lists` 16 条通过（新增“点击父项展开”“CSS zoom 下级联”两条）。

## 下一步

按计划 S1 到 S5 实施。
