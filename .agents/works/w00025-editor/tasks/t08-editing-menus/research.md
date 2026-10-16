# 编辑命令与菜单：现状与参照

2026-10-16 调研，依据新应用 master `14b3cfd92` 的代码与 Spec、旧应用 `packages/neuro-book-legacy`。

## 新应用现在有什么

- **Markdown 编辑器里的编辑动作**只有 Tiptap 自带的快捷键（StarterKit：Ctrl+B 粗体、Ctrl+I 斜体、Ctrl+Shift+S 删除线、Ctrl+E 行内代码、Ctrl+Alt+1–6 标题、Ctrl+Shift+7/8 列表、Ctrl+Shift+B 引用、Ctrl+Alt+C 代码块）和 Markdown 的输入规则（`# `、`- `、`> ` 等）。它们不是工作台命令：命令面板里找不到，菜单不能引用，插件不能贡献。
- **工作台命令**（[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)）：命令表、`when` 读公开状态、默认键位分发、命令面板、Agent 经绑定执行。编辑相关的只有 `nbook.edit.undo`、`nbook.edit.redo`、`nbook.editor.go-to-line`。
- **菜单项贡献**（[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)）：已有五个位置（标题栏菜单、视图标题、资源管理器右键、编辑区标题、编辑器标签右键）。菜单项只引用命令；有分节、排序、勾选（`toggled` 读公开状态的布尔键）、按钮形态与“⋯”收纳、`context` 参数。编辑器正文里还没有任何菜单位置。
- **nb-ui 现成的件**：`Toolbar`、`ToggleGroup`、`ContextMenu`（编辑器标签、资源管理器在用）、`Popover`、`Tooltip`、`ColorSwatches`、`Menubar`、`Dropdown`。
- **Tiptap 现成的件**（3.27.3，MIT，t07 调研）：`@tiptap/extension-bubble-menu`、`floating-menu`、`drag-handle`（及 Vue 3 版）、`suggestion`。Composer 的 `@`、`/`、`$` 菜单已经用过一套自己的触发与候选面板（`PromptMenuPanel`）。
- **编辑器 Spec 的“不承诺”**里列着正文右键菜单、选区浮动菜单、斜杠命令。

## 旧应用有什么

| 界面 | 内容 | 位置 |
|---|---|---|
| 选区浮动菜单 | 块类型下拉（正文、标题 1–3、无序与有序列表、引用、代码块）；粗体、斜体、删除线、下划线、行内代码、链接；上标、下标；文字颜色（10 色）与背景高亮（10 色）的调色板；对齐（左、中、右、两端）；增减缩进；加批注、注音、双语；清除格式；图片 | `markdown-studio/MarkdownSelectionMenu.vue`（758 行） |
| 斜杠命令 | 正文、标题 1–3、无序与有序列表、引用、代码块、分割线、引用文件、批注 | `markdown-studio/tiptap/MarkdownSlashCommand.ts` |
| 正文右键菜单 | 保存、撤销、重做、剪切、复制、粘贴；插入引用、链接、图片；加批注、注音、双语；在批注上时编辑与删除批注 | `TipTapMarkdownEditor.vue` 的 `buildContextMenuItems` |
| 固定工具栏 | 没有排版工具栏。`EditorToolbar.vue` 是工作区顶部的“文件、打开方式、视图”菜单条，不是排版 | `editor-workbench/EditorToolbar.vue` |
| 块手柄 | 没有 | — |

旧应用的这些菜单都直接调 Tiptap 命令，不经命令系统，插件不能往里加东西。

## 与新应用对不上的地方

- **下划线**：新方言没有下划线（t06 决定 14），旧菜单里的下划线不搬。
- **缩进**：Markdown 里只有列表能缩进；旧菜单的增减缩进对普通段落不起作用，新应用只在列表里给“增加、减少缩进”（Tab、Shift+Tab）。
- **背景高亮**：新方言的高亮是 `==文本==` 或 `<mark>`，带颜色时写 `<mark style>`（方言 Spec 输出 24）；文字颜色是 `<span style="color">`。两套调色板都能写回。
- **对齐**：新方言的对齐是块级 `<align value>`（方言 Spec 输出 13），能用。
- **插入引用、链接、图片**：归 t09（链接与图片的插入），本 Task 只留菜单入口的位置。
- **批注的编辑与删除**：批注界面（侧栏、编辑框）在 t06 决定 13 里另起计划，还没有 Task；本 Task 只做“加批注”的入口时，要先有批注的编辑框。

## 开发者已定的

- 选区浮动菜单与固定工具栏都要有（t06 决定 3）。
- 块手柄、命令系统与行内 AI 用的编辑器接口在本 Task（2026-10-16 补充）。
