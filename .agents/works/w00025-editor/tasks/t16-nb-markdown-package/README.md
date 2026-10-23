---
schema: nbook.task/v2
taskId: t16-nb-markdown-package
status: planned
updated: 2026-10-23
---

# 抽出 nb-markdown 包：Markdown 显示、编解码与提示词编辑器

## 目标与范围

把 `nbook.markdown`（`packages/neuro-book/src/plugins/markdown/`）里不绑定应用的部分抽成建在 nb-ui 之上的独立包 `nb-markdown`：Markdown 显示、编解码器与语法扩展点、提示词编辑器与已发送文字的显示。`nbook.markdown` 改为包装：登记 NeuroBook 方言、作品内链接与图片地址的解析、文件图标、字数，以及与编辑器工作台的对接（`MarkdownControl`）。nb-story 直接用 nb-markdown 接 nb-agent-ui 的注入口，不再自写 `StoryMarkdown`。

起因：nb-agent-ui 的 Markdown 显示与输入框由宿主注入，只有 neuro-book 能给出 `nbook.markdown` 的组件；nb-story 接入时只能用纯文字与文本框，原计划另写一份 marked 加 dompurify 的实现，加上 dev-panel 的 `MarkdownView` 与 nb-agent-ui 手写的预览规则，同一件事会有四份。

合同：[`ui/markdown-display`](../../../../../docs/specs/ui/markdown-display.md)、[`ui/prompt-editor`](../../../../../docs/specs/ui/prompt-editor.md)、[`workspace/markdown-dialect`](../../../../../docs/specs/workspace/markdown-dialect.md)、[`workspace/markdown-syntaxes`](../../../../../docs/specs/workspace/markdown-syntaxes.md)；行为不变，改 owner 与宿主接口的写法；包边界登记在 [`monorepo-boundaries`](../../../../../docs/modules/monorepo-boundaries.md)。

## 决定

开发者 2026-10-23 定（会话里）：

1. 建独立包 `nb-markdown`，不放进 nb-ui（nb-ui 只留轻依赖的基础控件，Markdown 要带 marked、dompurify 与 TipTap）。
2. 挂在 w00025，排在 w00024 t13（nb-story 问答页）之前。

## 当前状态

2026-10-23 新建，先写计划交开发者确认。

## 下一步

写 `plan.md`：包的布局与导出、宿主接口（语言、图片地址、链接怎么显示、诊断、界面语言）、`nbook.markdown` 留下的部分、切片与验证；交开发者确认后实施。w00024 t13 的计划随后改成用 nb-markdown。
