---
schema: nbook.task/v2
taskId: t14-markdown-inline-styles
status: done
updated: 2026-10-20
---

# Markdown 正文的格式样式

## 目标与范围

t08 搭稿时发现：Markdown 编辑器与展示器里粗体、斜体、删除线显示成普通文字，四到六级标题与正文一样，表头不加粗，分割线看不见。原因是应用入口（`packages/neuro-book/src/web/boot.ts`）引入的 `the-new-css-reset` 把这些元素的默认样式清掉了，共用的 `markdown/web/parts/markdown.css` 没补回来。开发者 2026-10-20 同意从 master 拉小修复先修。

合同：行为合同未变（[`ui/markdown-display.md`](../../../../../docs/specs/ui/markdown-display.md) 输出 2 的“共用同一份样式”与编辑器的正文本来就该有这些样子），只补 Smoke 与证据。

## 当前状态

执行位置：worktree `.worktree/w00025-t14-markdown-inline-styles`，分支 `fix/w00025-t14-markdown-inline-styles`（从 master `ea30312a4` 拉出），提交 `1e2afbff4`。

- 修复：`markdown.css` 补回 `strong`/`b`/`th` 字重、`em`/`i` 斜体、`s`/`del` 删除线、`h4`–`h6` 字重、`hr` 上边线，注释写明是全局重置的缘故、新元素要在这里给样子。
- 测试：`e2e/markdown-input.e2e.ts` 加一例（真实键盘按 Ctrl+B、Ctrl+I、Ctrl+Shift+S 打字，断言写回 `看**粗***斜*~~删~~` 与计算样式）；`e2e/lab-markdown.e2e.ts` 加一例（展示器 `plain` 场景，断言粗体、斜体、删除线、四级标题与分割线的计算样式；场景正文补了这几种写法）。变异检查：撤掉 CSS 修复时这两例都失败（字重 400）。
- Spec：编辑器与展示器 Spec 的 Smoke 行补上这两例。
- 验证：`markdown-input`、`lab-markdown` 两个 e2e 文件 11 例在生产构建与开发服务上通过；`lab:shot` 的 `MarkdownDisplay/plain` 手机与 1400 宽、明暗两态问题 0 条；`docs:check`、`governance:check` 没有本次的问题；`test:affected --typecheck` 只有 neuro-book 的 Bun 测试失败 3 例，与本次无关，master 上同样失败：
  - `files/backend/entry-ops.test.ts` 的“移动：目标已存在为 conflict…”、`files/changes.test.ts` 的“一批编码后装不进一条 RPC 消息”：断言默认了 `readdir` 的返回顺序；2026-10-20 起 `/tmp` 从 tmpfs 换到 btrfs，顺序变了。
  - `files/changes.test.ts` 的“合并：最后一次事件后静止 50 毫秒才重读”：负载下等待超时，单独跑时时过时不过。

## 下一步

已合入 master（合并提交 `8bc6d289f`，未推送）。上面三例的测试问题另行处理（没修）。
