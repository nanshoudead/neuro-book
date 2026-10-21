---
schema: nbook.task/v2
taskId: t13-qa-web
status: planned
updated: 2026-10-21
---

# nb-story 网页问答页与设置页

## 目标与范围

把内置问答接进网页查看器：书内问答页（对话列表、流式对话视图、可停止、可追问）与问答配置的设置页；对话视图做成共享包 nb-agent-view，通用零件（useStreamScroll、可折叠的行与卡片、CodeBlock）收进 nb-ui；顺带把查看器里手写的抽屉、搜索浮层、表格、重试按钮换成 nb-ui 组件。依赖 t08。

合同：改 [`story/viewer.md`](../../../../../docs/specs/story/viewer.md) 的“不做问答”，[`story/qa.md`](../../../../../docs/specs/story/qa.md) 补网页入口；对话视图的合同参照已归档的 [`ui/agent-conversation-view.md`](../../../../../docs/archived/specs/ui/agent-conversation-view.md)（w00019），开工时按搬进来的部分重新确认。

## 决定

开发者 2026-10-21 定：

1. 问答接进网页，当作 neuro-book 主应用接入 Agent 对话的预演；w00019 的对话组件已经调整过一轮，在此基础上做。
2. 要有连续对话与简单的网页配置界面；连续对话与 `answer` 改成可选放在 t08 先做，本 Task 接在 t08 之后。
3. 组件位置：通用零件进 nb-ui（`useStreamScroll`、可折叠的行与卡片、`CodeBlock`）；消息类型、分轮、对话视图与工具渲染的注册表单独建包 `nb-agent-view`，建在 nb-ui 之上。Markdown 显示与输入框编辑器由宿主经注册表注入（nb-story 先用简单实现，以后 neuro-book 接 `nbook.markdown` 的 `MarkdownDisplay`、`PromptEditor`）。
4. 这次只收问答页要用的 nb-ui 零件；其余候选记入 Work README 的“后续安排”，按 w00029、w00030 的顺序另做，避免和 w00030 的结构整理撞车。
5. 查看器里手写了 nb-ui 已有控件的几处（手机与平板的抽屉、搜索浮层、`story-table`、重试与加载中）并进本 Task 一起换。

## 当前状态

2026-10-21 经 nbdev 新建，尚未开工；等 t08 完成。

## 下一步

t08 完成后：读 w00019 的对话视图与归档 Spec、`nbook.markdown` 的展示器与编辑器合同，写 Spec 改动与 `plan.md`，要点先给开发者看。
