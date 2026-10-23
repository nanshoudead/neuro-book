---
schema: nbook.task/v2
taskId: t15-qa-reasoning-and-mentions
status: active
updated: 2026-10-23
---

# 问答的思考摘要（Responses 接口）与输入框的 @ 引用

## 目标与范围

配置可选 Responses 接口，让 GPT 系列回思考摘要；问答页输入框支持 @ 引用人物、对象与章节、段落，模型看到带 id 的引用。来自开发者试用 [t13](../t13-qa-web/README.md) 后的反馈。计划见 [plan.md](plan.md)。

合同：改 [`story/qa.md`](../../../../../docs/specs/story/qa.md)（配置的接口、问答规则里的引用）与 [`story/viewer.md`](../../../../../docs/specs/story/viewer.md)（问答页的 `@` 菜单与引用的打开）。

## 决定

开发者 2026-10-23 在会话里定：

1. 问答模型的配置可以选走 Responses 接口，让 GPT 系列回思考摘要；之后用真实模型冒烟一次（jiji 余额恢复后）。
2. `@` 引用人物与对象、章节与段落两样都要；模型看到的是带 id 的引用。
3. 章节引用点开后打开这一章开头的原文。
4. 输入 `@` 还没打字时，列出提及最多的几个人物与当前这一章。
5. 不做设计审查，直接实施；做完做一次实现审查（前端 Sonnet，后端 omp）。

## 当前状态

- 2026-10-23 计划经开发者确认，开工。

## 下一步

1. 切片 1：Responses 接口。
2. 切片 2：`@` 引用。
3. 实现审查；jiji 余额恢复后真实模型冒烟。
