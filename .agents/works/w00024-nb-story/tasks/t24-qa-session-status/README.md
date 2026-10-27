---
schema: nbook.task/v2
taskId: t24-qa-session-status
status: active
updated: 2026-10-27
---

# 问答页的会话状态：状态条与上下文检查器

## 目标与范围

[t21](../t21-usage-feedback/README.md) 反馈 5 的第二条，行为合同：[`story.viewer`](../../../../docs/specs/story/viewer.md) 问答页。开发者在评审板第 3 题选了 A：状态条加点开的右侧抽屉。旧应用的对应物（`packages/neuro-book-legacy/app/components/novel-ide/agent/` 的 `AgentSessionStatusBar` 与 `context-inspector/`）只作参照。

- **状态条**：问答页对话区下方一行，整个会话累积：上下文用量（最近一次请求的提示词 token / 模型上下文窗口 · 百分比）、输入、输出、缓存读、缓存命中率、费用（有单价才显示，不写“未知”）；点它打开检查器；
- **检查器**：右侧抽屉：汇总数字、上下文用量条、逐次请求的缓存条（绿=缓存读、黄=缓存写、灰=新输入，旁写命中率）与逐次明细表。

数据全部来自对话里已有的助手消息用量（`MessageView.usage`：输入、输出、缓存读写、费用），不新增服务端字段。

与评审板示意稿的差别（开发者追认）：

1. 示意稿里的“上下文构成”条（系统提示词 / 工具 / 历史各占多少）和“缓存保留方式”“诊断”没有做：问答记录与会话日志不记各部分的 token 数，要做得先让 harness 报告分项，另立 Task；
2. 状态条放在对话区下方（输入框之后）而不是输入框上方：输入框在 `nb-agent-ui` 的对话视图内部，页面插不进去。

## 当前状态

2026-10-27 开工，分支 `feat/w00024-t24-qa-status`（worktree `.worktree/w00024-t24`）。设计已由开发者定，不另写 plan.md；设计审查并入实现审查。
