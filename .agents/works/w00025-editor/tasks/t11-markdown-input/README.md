---
schema: nbook.task/v2
taskId: t11-markdown-input
status: done
updated: 2026-10-16
---

# Markdown 富文本的输入行为

## 目标与范围

开发者 2026-10-16 报告：源码编辑器里写 `[123](project://123)`，换回富文本后随便打字，字都并进链接文字（`[123后](project://123)`）。开发者指出：编解码器的转换测得很全，但用户怎样输入会导致什么没有测，所以没发现。

本 Task 修这个 bug，并补“用户在光标处打字、按键”这一层的测试。合同：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 62（新增）、验收 34。

## 开发者的决定

1. （2026-10-16）同意：格式边界的规则用组件测试逐条测（经编辑内核的输入入口，快、在 `test:affected` 里），真实 Chrome 只留组件测试测不到的几例（输入法、方向键与小块图标、源码与富文本来回换）。
2. （2026-10-16）同意格式边界的分法：粗体、斜体、删除线、文字颜色、上下标在末尾接着打仍带格式；链接、行内代码、高亮、批注、注音不带。

## 调研

真实 Chrome 里 18 个输入用例，修之前 8 个失败，问题分三类，都出在 Tiptap 链接扩展的默认值（`autolink: true`，而链接的“包含边界”跟着它）：

- 光标在链接（引用小块与外部链接）的开头或末尾打字、用输入法打字，字并进链接；
- 退格删光链接文字再打字，链接复活（编辑内核删字时记下被删文字的格式，链接包含边界时这个格式一直带着）；
- 打网址再打空格自动变成链接，违反方言 Spec 输出 4（网址打进去是文字、写回时转义）。

问题从 t06 就有（`ee9cee973` 上的 `Link.configure` 同样没关），引用小块让它看得见。之前的测试都用 `insertContentAt` 或直接拼文档改正文，不按光标处的格式插入，测不到这一层。

## 当前状态

执行位置：worktree `.worktree/w00025-t11-markdown-input`，分支 `fix/w00025-t11-markdown-input`（从 master `f3cda8295` 拉出）。

- 提交 `dfde36d2b`。修复：链接关掉自动链接、显式不包含边界（`syntax/core/index.ts` 的 `MarkdownLink`）。
- 测试：`MarkdownControl.dom.test.ts` 加“在格式的边界打字”一组 16 例（打字经 `handleTextInput` 与 `insertText`，按键经按键处理，没人接手的退格照 prosemirror-view 的做法记下格式）；变异检查：去掉修复时 5 例失败。新增 `e2e/markdown-input.e2e.ts` 4 例（行尾打字、方向键越过图标、输入法组字、源码写链接后换回富文本打字），修之前同类用例都失败。
- Spec：编辑器 Spec 加输出 62 与验收 34，Smoke 与证据随之补上。
- 验证：`test:affected --typecheck` 通过（bun 1511 条、vitest 363 条）；`docs:check`、`governance:check` 没有本次的问题。生产构建上 `markdown-input`、`editor-area`、`editor-types`、`lab-editor`、`lab-markdown` 的 e2e 43 个，两次合跑各有一例失败，都是点进正文后马上按键的用例（第一次是本 Task 新加的方向键一例，第二次是 `editor-area` 的“重新打开回到上次的光标”），单独重复跑都过（前者 20 次、后者 5 次）。新加的用例改为等正文拿到焦点再按键；`editor-area` 那一例不在本 Task 范围，没改。

## 下一步

已合入 master（合并提交 `502f8eb55`，未推送）。留下：`editor-area` 的“重新打开回到上次的光标”在负载下偶发失败（点进正文后马上按键），未查。
