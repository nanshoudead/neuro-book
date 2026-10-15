---
schema: nbook.task/v2
taskId: t03-tabs-and-split
status: active
updated: 2026-10-15
---

# 编辑器区的标签栏与拆分

## 目标与范围

- 修拆分后不能拖动调整大小、看不到分隔线（2026-10-15 在生产构建上复现：两组分界处按下落在编辑器正文上，宽度不变；编辑器区用的是 nb-ui `GridRenderer`，根因待查）。
- 标签栏重新设计：先在 Lab 出静态稿，按 [design-review](../../../../skills/design-review/SKILL.md) 逐轮评审，定了再实现。
- 拖动标签：组内排序、换组、拖到边缘拆分。旧应用的做法在 `neuro-book-legacy/app/components/editor-workbench/`（`editor-tab-drop.ts`、`useEditorTabDrag.ts`），复用 nb-ui 的 `resolveGridEdgeDrop`、`resolveListInsertion` 与 `DropFeedbackOverlay`。
- 固定标签；多行标签（设置项，默认开）；预览标签页开关（设置项，默认开）；标签右键菜单（关闭、关闭其他、关闭右侧、关闭已保存、固定、拆分、复制路径、在资源管理器中显示）；编辑区标题动作与非活动标签的关闭按钮悬停时显示，规则同 [workbench/views.md](../../../../../docs/specs/workbench/views.md) 输出 10。

非目标：自动保存（t04）、Monaco（t05）、Markdown 编辑器的深度打磨。

合同：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（改“不承诺”里的标签拖放、固定、多行与标签右键菜单）。

## 开发者的决定

1. （2026-10-15）编辑器区打磨拆成 t03 标签栏与拆分、t04 自动保存、t05 Monaco 打磨，先做 t03；三者做完后再做 Markdown 深度打磨。
2. （2026-10-15）标签右键菜单放进 t03。
3. （2026-10-15）t02 到 t05 叠在一条线上，打磨完一次性合入 master（见 Work README）。

## 当前状态

执行位置：`.worktree/w00025-t03-tabs-and-split`，分支 `feat/w00025-t03-tabs-and-split`（从 t02 的分支拉出）。开发服务在这个 worktree 起在 http://127.0.0.1:4317/（状态根从 t02 复制）。

- 拆分调整大小：`80d9cdbd5`。根因是编辑组的 grid 没给分隔线宽度（缺省 0），nb-ui 把 0px 的分隔线当作不可交互的接缝：不画线、`aria-disabled`、不接指针。改为 1px（与工作台相同），编辑组最小 220×120（同 VS Code）；editor.md 输出 2 补上。`editor-area.e2e.ts` 的拆分用例加了拖动分隔线与刷新后宽度恢复，宽度改回 0 时失败；“编辑组窄到放不下按钮”一例改用 900px 宽的窗口（最小宽度让 1440px 下的组窄不到放不下按钮）。`test:affected --typecheck` 通过，生产构建上 `editor-area`、`editor-types`、`lab-editor` 共 24 例通过。

## 下一步

标签栏设计：先和开发者确认注意力排序（标签上显示什么、关闭按钮何时出现、宽度、固定标签的样子、标签条与正文的分隔、同名文件的区分），再在草稿 worktree 出第一轮静态稿。
