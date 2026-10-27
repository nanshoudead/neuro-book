---
schema: nbook.task/v2
taskId: t25-qa-position-change
status: done
updated: 2026-10-27
---

# 问答对话里调整阅读位置

## 目标与范围

[t21](../t21-usage-feedback/README.md) 反馈 5 的第三条，开发者在评审板第 4 题的决定（含评语）。要改的合同：[`story.qa`](../../../../../docs/specs/story/qa.md)（原来写“对话中途不能改阅读位置与做法”，现在位置可以改、做法仍不能改）、[`story.viewer`](../../../../../docs/specs/story/viewer.md) 问答页、[`story.cli`](../../../../../docs/specs/story/cli-skill.md)（`ask --continue` 现在可以带 `--at`）。计划见 [plan.md](plan.md)。

不在本 Task：书没抽完时助手读后续章节原文、图工具不可用——要新开一条读未提交章节原文的路径，单列为 t30。

## 设计审查

omp 一轮（[报告](evidences/design-review.txt)）：阻断 3、重要 4、建议 1，全部成立并附真实运行证据，计划已按它重写（见 plan.md 的“设计审查后的修订”）：旧 `message` 条目不进模型历史、改位置要和追问共用“复制新日志再发布”的写入协议并带位置版本号、需要单一的“当前位置”来源、用结构化来源（meta 紧跟）而不是文字识别提醒、连续两条 user 消息有已知提供方拒绝所以请求里合并而日志里保持独立、Markdown 路径没有交卷硬校验所以要如实写限制并改系统提示词、警告要按整个对话出现过的最高位置。

## 当前状态

2026-10-27 四个切片实现完成并合入 master，分支 `feat/w00024-t25-position-change`。

- 数据与写入：`QaConversation.currentAt`、`positionChanges`、`turns[].at`；`currentPosition`/`highestPosition` 放在 `contract/qa-record.ts`（网页与核心库共用）；`QaRecords.save` 加 `expectChanges`，改位置与追问共用“复制新日志再发布”，冲突判据加位置改动次数。
- 引擎：`changePosition`（`agent_message` 形状的提醒加紧跟的 `meta qa.position`，不发请求）、`startContinued` 用当前位置、已读范围往回调时 `clipRead`、系统提示词加“以最近一条 system-reminder 为准”（不升 Profile 版本）。
- `nb-harness`：`merge-user-messages.ts`，请求前把相邻用户消息合并成一条（日志与页面仍两条）。
- 服务与命令行：`qa.position`、`qa.start` 续问可带 `at`、`qa.list` 的 `currentAt`/`highestAt`、`ask --continue --at`（全读对话退出 2）。
- 网页：`QaPositionControl`（章选择，运行中/全读/不能续问时停用并写原因）；提醒由 `turn-transcripts.ts` 按紧跟的 meta 识别（用户自己提交同样标签的问题不会被当成提醒），显示为 nb-agent-ui 的可展开“系统提醒”行；列表与页头的警告按最高位置。
- Spec：`qa.md` 输出 41、F11、F12，`viewer.md` 输出 53，`agent/harness.md` 输出 21。
- 验证：nb-story 约 515 个测试、nb-harness 92 个测试、e2e 39 个（新增：改位置后出现系统提醒、刷新后仍在、再问时请求里提醒与问题是同一条用户消息）；`docs:check` 无失败。机器负载 18 到 21 时，5 秒默认超时的命令行用例和 1 秒阈值的“长列表”性能用例会失败，加大超时跑命令行用例全过。
- 与评审板的差别：无；与开发者最初的做法差别见下面的待确认清单（提醒作为独立消息、请求里合并）。
- 实现审查待做（t24、t25、t31 一起交 omp）。
