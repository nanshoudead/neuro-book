---
schema: nbook.task/v2
taskId: t07-markdown-plugins
status: active
updated: 2026-10-16
---

# Markdown 方言插件化与三种 Markdown 界面

## 目标与范围

开发者 2026-10-16 定：先做方言插件化，菜单一类的任务先建好、搁置（t08 编辑命令与菜单、t09 链接与图片的插入、t10 frontmatter 属性面板）。本轮把三种用到 Markdown 的界面一起做好，共用同一套方言与外观：

| 界面 | 开发者的要求 |
|---|---|
| Markdown 编辑器（t06 做的这个） | 方言最全；流式写入的需求不高（流式写入多发生在 Agent 操作时） |
| Composer 输入框 | 支持 `@` 文件引用、`/` Agent 命令、`$` 技能；对排版的需求低（写给 Agent 看，不要表格、列表、标题），但引用、技能这些小块本身是富文本。旧应用里已经调过一轮，效果不错 |
| Markdown 展示器（Agent 流式输出用，通常只读） | 性能、速度与流式渲染是重点（旧应用在约 100 条 AI 消息的对话里拖动改外层宽度时严重卡顿）；支持本方言；开发者提出可以考虑用只读的编辑器来做，但性能没测过 |

另外两件，开发者 2026-10-16 提出：

- 引用小块（`[文字](地址)` 显示成的小块）与图片的**外观规范**要补，三种界面共用。
- 方言要能**由插件贡献**（一种方言连同它的读写与显示），解耦并增加扩展性。

合同：[`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md)（读写规则）、[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（编辑器接入）；贡献点、外观、Composer 与展示器的 Spec 待写。

## 调研

- **现在的方言结构**：每种方言是一个语法模块（`plugins/editor/web/markdown/syntax/types.ts` 的 `MarkdownSyntax`：schema、读法、写法、节点视图都在模块里，编解码器不认识具体语法）。还不是贡献点：`markdownLanguage()` 里列死了八个模块；只有编辑这一面，没有展示用的渲染；字数在 `src/shared/` 里写死了方言标签名（服务端书架统计也用）；模块直接交出 `marked` 的词法单元与 Tiptap 扩展。
- **旧应用的 Composer**：调好的版本在分支 `archive/legacy-ui-tuning`（提交 `865c9f593`，`packages/neuro-book/app/components/common/form/`）：`PromptEditor.vue`（Tiptap，1128 行）、`prompt-editor/` 下的 `PromptTokenChip`（引用、技能、选区、命令、图片、文件、粘贴位置七种小块的外观，编辑器与静态显示共用）、`PromptTextView`（已发送消息的静态显示）、附件条、粘贴块、候选菜单。它有自己的文字写法与解析（`prompt-text.ts`，不经 `marked`），“文字是唯一真相”，读进来的文字原样写回。
- **旧应用的展示器**：`AgentMarkdown.vue` 与更早的 `AgentMarkdownContent.vue` 都是 `marked` 转 HTML 后 `v-html`，流式时节流后整条重转；引用小块是另外拼的 HTML 字符串（`reference-chip.ts` 的 `renderReferenceChipHtml`），与编辑器不是同一份，不认批注等方言。
- **性能测量**（[evidences/display-perf.md](evidences/display-perf.md)）：拖动改宽度的卡顿来自整页布局，三种做法都一样（300 条时每次改宽度 34–45 毫秒）；每条消息加 `content-visibility: auto` 后都降到 3 毫秒左右。只读 Tiptap 的首次显示约是“编解码器读入后静态序列化”的 3 倍（300 条 1.8 秒对 0.5 秒），JS 堆 48 MB 对 7.5 MB；流式追加三种都在 4 毫秒左右。
- **Tiptap 现成的件**：`@tiptap/extension-drag-handle`（及 Vue 3 版）、`bubble-menu`、`floating-menu`、`suggestion` 都有 3.27.3，MIT（t08 用）。

## 当前状态

调研完成，方案要点待开发者确认后再写 `plan.md`。执行位置：worktree `.worktree/w00025-t07-markdown-plugins`，分支 `feat/w00025-t07-markdown-plugins`（从 master `ee9cee973` 拉出）。

## 下一步

把方案要点给开发者确认（展示器的做法、Composer 怎么接入方言、贡献点的形状与开放范围），再写计划。
