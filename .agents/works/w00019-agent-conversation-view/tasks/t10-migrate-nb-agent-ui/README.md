---
schema: nbook.task/v2
taskId: t10-migrate-nb-agent-ui
status: planned
updated: 2026-10-21
---

# 对话视图迁入 nb-agent-ui

## 目标与范围

把 t03 到 t09 已做的对话视图一次迁进新包 `nb-agent-ui`：来源是归档提交 `865c9f593` 的 `packages/neuro-book/app/components/agent/`（含 t09 的分目录与输入框）。通用零件进 nb-ui，Lab 场景、假数据与时间线回放迁进新应用的 Component Lab（组件树一组 `nb-agent-ui`）。行为不变，只换位置、断开旧应用的依赖（Nuxt 的 `useI18n`、旧 `renderMarkdown`、UnoCSS 图标类名），并加 harness 适配器（harness 的消息与流式事件合成视图消息），供 nb-story 与主应用共用。

合同：归档的 [`ui/agent-conversation-view.md`](../../../../../docs/archived/specs/ui/agent-conversation-view.md) 搬回 `docs/specs/ui/`（planned），owner 改为 `nb-agent-ui`；迁移不改行为。

## 决定

开发者 2026-10-21 定（背景见 [Work README](../../README.md#重新打开开发者2026-10-21)）：

1. 包名 `nb-agent-ui`，单独建包，不进 nb-ui 子路径。
2. 一次迁完已做的全部，不按问答需要裁剪。
3. nb-form、nb-agent-ui 都在新应用的 Lab 里看，做法同 nb-ui。

## 当前状态

2026-10-21 经 nbdev 新建，尚未开工。

## 下一步

写 `plan.md`，要点先给开发者看。
