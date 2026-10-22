---
schema: nbook.task/v2
taskId: t14-qa-vertical-slice
status: active
updated: 2026-10-22
---

# 首个垂直切片：nb-story 问答页要的会话列表与条目

## 目标与范围

nb-story 问答页（[w00024 t13](../../../w00024-nb-story/tasks/t13-qa-web/README.md)）是 nb-agent-ui 的第一个使用方。本 Task 补上它接入时 nb-agent-ui 还缺的部分，其余留在 [t11](../t11-complete-view/README.md) 渐进补齐。先出接入后的静态稿，由开发者定本次范围。

合同：[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)。要改：“不包含左侧会话栏”一句（会话列表成为单独导出的组件）、`entries` 的消费；范围定后补具体条目。

## 决定

开发者 2026-10-22 定（会话里）：

1. nb-story 问答页作为 nb-agent-ui 的第一个垂直切片；顶栏、面板、待处理区、状态栏、就地编辑、分支等留在 t11 渐进补齐。
2. rewind、retry、编辑、分支不放占位按钮：宿主给 `canMutateHistory: false`，按钮不出现（现有行为）。
3. 会话列表第一版只做列表、选中、新建。
4. 没核实的出处接扩展点 `entries`，由 nb-story 登记条目渲染器。

开发者 2026-10-22 在评审板答 `slice-scope`：

5. 本次在 nb-agent-ui 里做五项：会话列表组件 `AgentSessionList`；条目渲染器 `entries`；被退回的结果节点在过程里只占一行；思考摘要去掉 Markdown 标记；工具组的短语收到这一组的调用。空状态可替换、隐藏用量、对话重命名与删除不做，留在 t11。

## 当前状态

2026-10-22 静态稿第一轮已发布：[评审板](artifacts/review/index.html)；开发者已答 `slice-scope`（决定 5），范围已定，写计划。

- **草稿**：worktree `.worktree/w00019-t14-drafts`，分支 `t14/drafts`，从 `feat/w00019-nb-agent-ui` 开，不提交、不合并。在 nb-story 查看器里加了“问答”页（`packages/nb-story/src/web/drafts/qa/`），用书库副本起 `nbstory serve`，截图脚本 `packages/nb-story/shoot-qa-drafts.ts`。
- **数据**：book-8576901b 的两条真实问答记录经 `createHarnessTranscript` 原样回放；追问、文字回复与运行中照真实格式合成。
- **搭稿发现，属于 nb-story 的**（转 w00024 t13）：
  - nb-story 的 `read` 与内置文件工具同名，注册表报冲突；nb-story 不用内置的工具登记。
  - 引擎催交卷的话写成了用户消息。
  - 超出读章上限被拒的读原文显示成红色的“12 次失败”。
  - 依据多时折成几行。
  - 答案里的人名要按名字找对象 id。

## 下一步

写 `plan.md`，给开发者确认后实施。
