---
schema: nbook.task/v2
taskId: t14-qa-vertical-slice
status: done
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

2026-10-22 实施完成，分支 `feat/w00019-nb-agent-ui`，按 [plan.md](plan.md) 切片 0 到 6 提交（切片 0 是主工作区的 Spec，`5464d6b27`）：

| 切片 | 提交 | 内容 |
|---|---|---|
| 1 | `a2e568fe0` | 探查组短语收到这一组的调用 |
| 2 | `f94f50c47` | 思考与信息条目折叠时去掉 Markdown 标记，宿主可注入 `markdownPreview` |
| 3 | `6faabdf8a` | 被退回的结果调用进思维链画成一行；修正回复后接“压缩、提醒”时回复被收进过程 |
| 4 | `1ab92bbfb` | 附注与条目渲染器（`annotations`、`entries` 按 `customType`） |
| 5 | `c0bf10452` | 会话列表 `AgentSessionList` |
| 6 | `9c740bf28` | README、组件文档与包入口 |

- **验证**：各片随做随跑包验证、应用验证与 Lab e2e（`lab-agent-ui`、`lab-scenes`），切片 1 到 5 的关键断言做过变异检查。收口在 `9c740bf28` 上跑：应用 typecheck 通过，`bun run test` 为 bun 1599 通过、Vitest 403 通过，全量 e2e 281 通过（26.5 分钟）；`docs:check`、`governance:check` 没有新增失败与警告。
- **草稿**：静态稿 worktree `.worktree/w00019-t14-drafts`（分支 `t14/drafts`，不提交、不合并）用 book-8576901b 的两条真实问答记录经 `createHarnessTranscript` 回放，评审板已入库；搭稿时发现的属于 nb-story 的五条已转 w00024 t13；草稿没有改成新接口再出一轮图，nb-story 接入（w00024 t13）时以真实页面为准。
- **待确认**：本 Task 按推荐做的六项（实现审查后加两项）记在 [待确认清单](../../pending-confirmations.md)。

## 实现审查

2026-10-22 Claude Sonnet 审 `66ea94de2..9c740bf28`：阻断 0、重要 2、建议 15。15 条成立要改，第 2 条一半成立（路径里的 `__x__` 按 CommonMark 本来就是强调，与 marked 展开一致），第 14 条第 3 点接受取舍、第 4 点不改；修正提交 `3a433a427`，变异检查八处都让测试失败。修正后包验证通过（bun 178、Vitest 44），应用 typecheck 通过，Lab e2e（`lab-agent-ui`、`lab-scenes`）26 通过。逐条处理与报告原文见 [evidences/impl-review.txt](evidences/impl-review.txt)；新增两条待确认（预览按 CommonMark 认强调、下拉里的会话列表材质）。

## 下一步

- 合入 master；nb-story 问答页在 [w00024 t13](../../../w00024-nb-story/tasks/t13-qa-web/README.md) 接入，接入时在真实页面看会话列表放进下拉的材质。其余组件（空状态可替换、隐藏用量、重命名与删除、rewind 等）留在 [t11](../t11-complete-view/README.md)。
