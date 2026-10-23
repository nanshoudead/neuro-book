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

2026-10-23 开发者要求按 autonomous-delivery 推进（主会话实施，Sonnet 只做前端审查）。计划见 [plan.md](plan.md)，设计审查（Sonnet，重要 7、建议 5，全部成立）已处理，证据 [evidences/design-review.txt](evidences/design-review.txt)。代码在 `.worktree/w00025-t16-nb-markdown`（分支 `feat/w00025-t16-nb-markdown`）：

| 切片 | 提交 | 验证 |
|---|---|---|
| 1 包与纯 TS 核心 | `f154421d2` | 包 typecheck、test；neuro-book typecheck、test:affected（无关失败：llmlint 缺 tsconfig、dev-panel herdr、nb-history 性能、test-support 路径） |
| 2 语言与编解码器 | `e6bc0e40d` | 包 165 + 26；neuro-book typecheck 与 markdown 测试；e2e editor-area、markdown-input 35 通过；ProseMirror 只有一份 |
| 3 宿主、小块与显示 | `1f493d62d` | 包 165 + 37；neuro-book typecheck、vitest 34 文件 238；接线测试的变异检查；build 与 check:dist；e2e lab-markdown、lab-agent-ui、lab-scenes、markdown-input 41 通过；Lab 截图核对图标 |
| 4 提示词编辑器 | `ac9dbe789` | 包 261 + 110；节点视图拿到宿主的测试；e2e lab-markdown、lab-agent-ui、lab-scenes 36 通过 |
| 5 编辑器扩展 | `befe8fd9f` | 包与 neuro-book 测试；e2e editor-area、files-explorer、lab-markdown 58 通过 |
| 6 文档与收口 | `942706a8e` | `docs:check` 只剩四份 Spec 的旧路径（Spec 在主工作区改好，合入后提交）；收口：neuro-book `bun run test` 1354 + 353 通过，全量 e2e 283 通过（24.3 分钟），check:dist 通过 |

实现审查：2026-10-23 派 Claude Sonnet 审 `8bb280f7b..942706a8e`，进行中。

不 push：分支从 master 拉出，master 领先 origin 960 多个提交（含别的 Work），push 分支会一并发布，留给开发者决定。

## 下一步

计划交 omp 做设计审查，处理后按切片 1 到 6 实施。合入后把 w00024 t13 的计划改成用 nb-markdown。
