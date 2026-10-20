---
schema: nbook.task/v2
taskId: t08-editing-menus
status: active
updated: 2026-10-20
---

# 编辑命令与菜单

## 目标与范围

编辑命令登记为工作台命令；固定工具栏、选区浮动菜单、块手柄与块菜单、正文右键菜单、斜杠命令。行内 AI 用的编辑器接口拆到 [t12](../t12-inline-ai-editor-api/README.md)，批注界面在 [t13](../t13-comments-ui/README.md)（决定 1、4）

合同：[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)（新增菜单位置）、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)（编辑命令登记）、[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（“不承诺”里的正文右键菜单）。来源：t06 决定 3、13，开发者 2026-10-16 补充块手柄、命令系统与行内 AI。

## 开发者的决定

1. （2026-10-20）行内 AI 用的编辑器接口不在本 Task 做，拆到 t12，等 Agent Work 接入时再做：现在没有使用方，做了没法验收。
2. （2026-10-20）注意力排序：只有固定工具栏常驻，放在标签栏下方，与 720px 的版心同宽居中，可在“视图”菜单里关掉，默认打开；选区浮动菜单、斜杠命令、块手柄、正文右键菜单按需出现。块左侧照 Notion 放两个按钮：拖动手柄与 `+`。
3. （2026-10-20）插件能往这些菜单里加东西：每种菜单一个菜单位置，菜单项照 [`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md) 的规则显示；所有编辑动作登记成工作台命令，按钮的选中状态由编辑器发布成公开状态，Ctrl+B 这类快捷键照旧。
4. （2026-10-20）“加批注”不在本 Task 做，连同批注的编辑与删除归 t13；本 Task 不放这一项。
5. （2026-10-20）块左侧两个按钮照 Notion 分工：点 `+` 在下方插入一个空块并打开斜杠菜单（按住 Alt 插在上方）；点拖动手柄打开块菜单（转换为、复制、删除等），拖动手柄移动块。

不需要开发者定、按新方言处理的：下划线不搬（新方言没有）；缩进只在列表里有；插入链接与图片的做法归 t09，本 Task 只留入口（见 [research.md](research.md) 的“与新应用对不上的地方”）。

## 当前状态

2026-10-16 开发者定：下一个先做本 Task。现状与旧应用的对照见 [research.md](research.md)。2026-10-20 定了范围与注意力排序（决定 1–4）。第 1 轮静态稿已发布到[评审板](artifacts/review/index.html)（工具栏放哪些按钮、样子，块左侧两个按钮）；草稿在 worktree `.worktree/w00025-t08-drafts`（分支 `t08/drafts`，不合并），原图在本地 `.local/agent/works/w00025-editor/tasks/t08-editing-menus/shots/`。

搭稿时发现：Markdown 编辑器与展示器里粗体、斜体、删除线、四到六级标题、分割线都没有样式（计算出的字重 400、无斜体、无删除线、`hr` 边框 0）。原因是 `src/web/boot.ts` 引入的 `the-new-css-reset` 把这些元素的默认样式清掉了，`markdown/web/parts/markdown.css` 没有补回来。

## 下一步

等第 1 轮答复；之后几轮定选区浮动菜单、斜杠菜单、块菜单与正文右键菜单，再写计划。
