---
schema: nbook.task/v2
taskId: t16-qa-composer-models-markdown
status: active
updated: 2026-10-24
---

# 问答输入框单行与控件、模型目录设置页、Markdown 作答

## 目标与范围

输入框收成一行并加推理档、模型、上下文大小与插入引用；设置页按 OMP 目录选模型并能自定义服务商（选择界面做进 nb-agent-ui）；作答默认 Markdown、结构化可选

来自开发者试用 [t15](../t15-qa-reasoning-and-mentions/README.md) 后的反馈（2026-10-24）。

合同：会改 [`story/qa.md`](../../../../../docs/specs/story/qa.md)（配置的模型与候选、作答方式）、[`story/viewer.md`](../../../../../docs/specs/story/viewer.md)（问答页输入框、设置页）、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)（单行输入框、上下文大小、模型选择界面），可能还有 [`agent/harness.md`](../../../../../docs/specs/agent/harness.md)（检查文字回复、不通过再跑一次）；静态稿定了再写。

## 决定

开发者 2026-10-24 在会话里定：

1. 输入框加推理档、模型选择、上下文大小；`+` 号打开引用菜单（与 `@` 相同），不做附件；模式照旧只在新对话可选。
2. 模型目录用 OMP 包自带的那一份，另外可以自定义服务商；要出静态稿。
3. 作答默认 Markdown，结构化可选。Markdown 回复里出处不对时自动让模型改一次：待开发者定（会话里已说明做法与代价）。
4. 单行输入框与模型选择界面先出静态稿。

## 当前状态

- 2026-10-24 开草稿 worktree `.worktree/w00024-t16-drafts`（分支 `t16/drafts`，不提交），第 1 轮静态稿发在评审板 [review](artifacts/review/index.html) v1，5 道题：输入框版式、模型目录版式、设置页结构、目录列哪些服务商、Markdown 出处自动改一次。草稿场地是 nb-story 包里的 `drafts-t16-stage.ts` 与 `drafts-t16-shoot.ts`（只在草稿 worktree）。
- 搭稿时发现：问答页没有设 `interaction.canChangeRuntime`，模式按钮一直禁用，网页上新对话切不到全读，e2e 没覆盖；本 Task 一起修并补 e2e。

## 下一步

1. 等开发者答评审板，决定写进本文件，再写计划。
