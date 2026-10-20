---
schema: nbook.task/v2
taskId: t04-popup-lists
status: active
updated: 2026-10-20
---

# 弹出列表收成一套

## 目标与范围

弹出列表的菜单项、分组、分隔线、浮动滑块与截断高度收成共用件，高亮、选中与圆角各定一种，做不抢焦点的候选菜单并让 Composer 的候选菜单换用它；先出静态稿评审

合同：[`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md) 输出 5、13 改写（候选菜单用 `SuggestionMenu`、没有按键提示、选项 id）；其余是 nb-ui 组件的同名 `.md` 与 [`ui-development-spec.md`](../../../../../packages/nb-ui/docs/ui-development-spec.md)、[`design-language.md`](../../../../../packages/nb-ui/docs/design-language.md) 的对应条目。

## 开发者的决定

评审板 [`artifacts/review/`](artifacts/review/index.html)。

1. （2026-10-20，r1-highlight）高亮（悬停项与键盘当前项）统一用中性叠色 `--overlay-item-active`；Menubar 与右键菜单补上高亮，Composer 候选菜单不再用强调色淡底。
2. （2026-10-20，r1-selection）选中统一用左侧勾选列：每行在图标前留一列给勾，底色不变；Select 去掉选中项的强调色淡底与中等字重，DropdownMenu 的 `active` 与勾选项合成一种。
3. （2026-10-20，r2-radius）列表项圆角按同心规则取外框 10px、内边距 4px，项 5px（nbook 主题）；QuickPick 与 Composer 候选菜单不再各写一个外框圆角。
4. （2026-10-20，r2-density）所有弹出列表一档行高：28px、13px 字（带说明的两行项另算）。
5. （2026-10-20，r3-rows）长列表最多显示 8 项半（列表高约 246px），截在第 9 项中间露出半项，之后滚动；空间不够时按可用空间收矮。所有弹出列表共用一份截断计算。
6. （2026-10-20，r3-footer）Composer 候选菜单去掉底部的按键提示，与编辑器的斜杠菜单一致。
7. （2026-10-20，会话里口头定）同一级里只要有一项带图标，每一项都留出图标列，文字对齐；与左侧勾选列同一个做法。六个弹出列表都这样。

## 当前状态

静态稿三轮已定（决定 1 到 6），实施计划 [`plan.md`](plan.md) 开发者 2026-10-20 确认（定位改经 reka 的 Popover 原语也已确认）；omp 计划审查 13 条全部处理（[`evidences/plan-review.txt`](evidences/plan-review.txt)）。

实施在 worktree `.worktree/w00029-t04-popup-lists`（分支 `refactor/w00029-t04-popup-lists`），六片已提交：S1 菜单一族、S2 Select 与 QuickPick、S3 共用滚动、S4 `SuggestionMenu`、S5 Composer 改用它、S6 Spec 与规范。实施中对计划的调整写在 `plan.md` 第 5、6 节的“实施中的调整”。

- Sonnet 前端实现审查 13 条（重要 3、建议 10），逐条处理见 [`evidences/impl-review.txt`](evidences/impl-review.txt)：F05 接受取舍（reka 层级的键盘滚动由浏览器的聚焦规则决定），F12d 从代码推断不成立，其余都已改并补用例。
- 真实浏览器里查到并修掉两处改动前就有的问题：右键菜单与菜单栏的子菜单偏离父项一百多像素（外观层的 `backdrop-filter` 成了它们的包含块）。整套 e2e 查到一处本次引起的回归并修掉：右键菜单改成外层定位后，直角的外层接住了紧挨菜单左上角的按下（原来圆角外的那一点落到页面上），编辑器“拖固定标签到正文中央”因此起不了拖；外层改为不接收指针，nb-ui 验收补了这一点。
- 决定 7 已做：DropdownMenu、Menubar、右键菜单（共用 `MenuNodes`）、Select、QuickPick、`SuggestionMenu` 在同一级有一项带图标时，没有图标的项留出空的图标列；nb-ui 验收逐个比较带图标与不带图标的项名称左边缘，菜单栏没有图标的一级不留这一列。
- 验证：nb-ui 单元 498、e2e 54 通过；neuro-book 整套 e2e 234 条里 233 通过，`lab-scenes` 一条在负载下超时（EditorArea/english 15 秒没挂上），单独重跑通过；图标列改完后相关的五个 e2e 文件 56 条通过；`test:affected --since master --typecheck` 只有 nb-story 一条服务进程收到 SIGTERM 退出码 143 的竞态（与本 Task 无关），单独重跑 223 条通过；`docs:check`、`governance:check` 没有本次范围内的警告。
- 改前改后的对照做成 `report` 产物 [`artifacts/compare/`](artifacts/compare/index.html)（全套截图在本地 `.local/agent/works/w00029-nb-ui-cleanup/tasks/t04-popup-lists/shots/compare/`）。

## 下一步

合入 master；按图标列重拍改后的对照图，发布对照产物。

依赖本 Task 的：[w00027 t07](../../../w00027-plugin-platform/tasks/t07-low-code-forms/README.md) 的 S2 起（新增可搜索下拉 `SearchSelect`，用本 Task 统一后的列表项样式、截断与滚动；改 `Select` 的只读与出错）等本 Task 合入 master 后开始（开发者 2026-10-20 定）。
