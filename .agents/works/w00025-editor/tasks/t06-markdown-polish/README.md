---
schema: nbook.task/v2
taskId: t06-markdown-polish
status: active
updated: 2026-10-15
---

# Markdown 编辑器打磨

## 目标与范围

开发者 2026-10-15 定为本 Work 的下一个任务（t01 决定 1 的第二段：深度打磨作者最常用的 Markdown 编辑器）。需求先与开发者定，再写评审稿或计划。

- **正文右键菜单**：现在 Markdown 富文本里右键是浏览器自己的菜单，Spec 把正文右键菜单列在“不承诺”。在这里定义菜单位置 `editor.content-context`（或按菜单 Spec 的命名），用应用的 `ContextMenu`；源码编辑器（Monaco）的那一份在 t05，两边共用同一个菜单位置。
- **候选**（从 t01 的候选表与旧应用 `markdown-studio` 来，待开发者排）：选区浮动菜单、斜杠命令、frontmatter 面板、批注侧栏、工具栏（旧应用 `EditorToolbar.vue`）、大纲与标题导航（t03 已有面包屑的标题段）、排版与纸面细节。

合同：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（“不承诺”里的正文右键菜单与 Markdown 写作工具）、[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)。

## 开发者的决定

问题与取舍见 [analysis.md](analysis.md)，旧应用的清单见 [legacy-markdown.md](legacy-markdown.md)。

1. （2026-10-15）不另做 Markdown 的源码模式：用默认的文本编辑器（Monaco）打开就是源码模式，那里不做排版菜单与斜杠命令。排版菜单等只需要适配富文本一类的编辑器（一到两套）。
2. （2026-10-15）实时预览将来用 CodeMirror 6，但放到最后、现在不做（开发者：用户看源码的需求不大）。这一期只做一种富文本模式，继续用 Tiptap；不做 CodeMirror 6 的技术验证（[analysis.md](analysis.md) 的“富文本也用 CodeMirror 6 的评估”留作以后的参考）。排版菜单、右键菜单与对外接口只在 Tiptap 上实现。
3. （2026-10-15）排版菜单：选区浮动菜单与固定工具栏都有。
4. （2026-10-15）粘贴、拖进来的图片存到哪里做成设置，参照 Obsidian。
5. （2026-10-15）音频、视频先不做，以后有需求再做。
6. （2026-10-15）`@` 引用写成普通 Markdown 链接。
7. （2026-10-15）转换问题与改进见 [conversion.md](conversion.md)。中文贴着标点的强调放宽解析规则（CJK 友好）；任务列表正式支持，脚注只保证原样保留；段内单换行算换行，写进方言 Spec。
8. （2026-10-15）不换 `@tiptap/markdown`。接下来重做 Markdown 与 ProseMirror 的转换并加上常用方言，可以直接重构或重写、先搭好代码结构；实施中的审查按深入审查（先报审查计划与预算）。
9. （2026-10-15）先设计方言、写方言 Spec，开发者看过再定。
10. （2026-10-15）方言 Spec 草稿（t06 分支 `docs/specs/workspace/markdown-dialect.md`）里主 Agent 替开发者定的八点都同意：只有 `~~` 是删除线；链接相对当前文件、`/` 开头按作品根；写不出读得回来的内容时保存失败；注音里不能有格式；批注、注音、译文与原样内容不计字数；原样保留的范围；颜色的写法；`<html>` 块的相对引用复用 HTML 预览。
11. （2026-10-15）新加方言：提示块 `> [!NOTE]`、`==高亮==`。批注与高亮跨段的写法待讨论：高亮跨段拆成每段一个行内高亮；批注要保证 `body` 只出现一次。
12. （2026-10-15）批注跨段用分截：每段一截行内批注、同一个 `id`，`body` 只在第一截。块级写法与 `id` 的形式开发者没有另说，主 Agent 按推荐定：正好覆盖整块时仍写块；`id` 用文件内最小未用的 `c` 加数字。写进方言 Spec 输出 11（t06 分支 `4b4388477`）。

## 当前状态

2026-10-15 开工：旧应用调研（`legacy-markdown.md`）与功能分析（`analysis.md`）已完成；开发者定了决定 1–9：只做富文本模式，继续用 Tiptap 与 `@tiptap/markdown`；方言 Spec 已写好并提交（t06 分支，`planned`）；实施计划见 [plan.md](plan.md)，待开发者看过后开第 1 轮深入审查（设计）。

## 下一步

调研旧应用 `markdown-studio` 与现在的 `MarkdownControl`，列出候选清单与现状差距，交开发者排优先级与定范围。按集成分支约定从 t03（或当时线上的最后一个 Task）的分支拉出。
