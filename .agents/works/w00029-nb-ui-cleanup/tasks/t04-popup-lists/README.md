---
schema: nbook.task/v2
taskId: t04-popup-lists
status: active
updated: 2026-10-20
---

# 弹出列表收成一套

## 目标与范围

弹出列表的菜单项、分组、分隔线、浮动滑块与截断高度收成共用件，高亮、选中与圆角各定一种，做不抢焦点的候选菜单并让 Composer 的候选菜单换用它；先出静态稿评审

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 开发者的决定

评审板 [`artifacts/review/`](artifacts/review/index.html)。

1. （2026-10-20，r1-highlight）高亮（悬停项与键盘当前项）统一用中性叠色 `--overlay-item-active`；Menubar 与右键菜单补上高亮，Composer 候选菜单不再用强调色淡底。
2. （2026-10-20，r1-selection）选中统一用左侧勾选列：每行在图标前留一列给勾，底色不变；Select 去掉选中项的强调色淡底与中等字重，DropdownMenu 的 `active` 与勾选项合成一种。
3. （2026-10-20，r2-radius）列表项圆角按同心规则取外框 10px、内边距 4px，项 5px（nbook 主题）；QuickPick 与 Composer 候选菜单不再各写一个外框圆角。
4. （2026-10-20，r2-density）所有弹出列表一档行高：28px、13px 字（带说明的两行项另算）。

## 当前状态

第 1 轮已定（见上）。第 1、2 轮已定（见上）。静态稿：草稿 worktree `.worktree/w00029-t04-drafts`（分支 `t04/drafts`，不合并），问列表项的高亮与选中各统一成哪一种；先并排画出六个弹出列表的现状。原图放本地 `.local/agent/works/w00029-nb-ui-cleanup/tasks/t04-popup-lists/shots/`。

## 下一步

第 1 轮图出来后写评审板、发布给开发者；之后几轮问圆角、浮动滑块与截断高度、不抢焦点的候选菜单（含 Composer 候选菜单要不要去掉按键提示的页脚）。
