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
- 实现审查：t24、t25、t31 一起交 omp，报告 [impl-review-t24-t31-t25.txt](evidences/impl-review-t24-t31-t25.txt)（11 条，另附一条转录器时序脆弱点，审查者自己也未列为缺陷）。处理（分支 `fix/w00024-t24-31-25-review`）：
  1. 续问带 at 准备不原子：成立。位置改动改成只在内存里算（`planPositionChange`），跟这一轮的记录一起保存；放弃或开始前失败，记录与日志不变；期间被别处改了位置，保存得到 conflict，不悄悄换位置。
  2. 网页运行归属没带位置版本：成立。`QaRunView` 加 `baseChanges`，`attachedRun` 同时核对轮数与位置改动次数。
  3. 命令行 `qa` 列表与详情显示初始位置：成立。改用 `currentPosition`，详情注明开始时的位置，每轮在位置变了时标“读到”。
  4. 费用跨币种相加：成立。币种取这个对话用过的模型的目录单价币种，混币种不合计；有请求不知道单价时加“≥”。
  5. 泛称误伤固定专称：部分成立。草稿手工指定的出场（`via: note`）现在照计、对象不是无名；“固定专称”仍靠抽取规则，没有结构化标记，接受取舍（写入待确认清单）。
  6. 无名角色在连线说明、人物卡小图、命令行没带 `includeAnonymous`：成立，已补（命令行 `--include-anonymous true`）。
  7. 章中不能选“读完当前章”：成立，已改。
  8. 亲属白名单漏母亲、父亲：成立，补全词表（带方向的写“亲子”“祖孙”，单字词不收，避免“弟子”）。
  9. Spec 里相反的 `--at` 条款：成立，已改。
  10. 新对话的 @ 候选按查看器位置：成立，改为跟草稿章。
  11. 测试：补了准备放弃、冲突、网页脱离、币种、亲属词、手工归属、忙碌的无条件断言；全图 e2e 的固定等待换成可观察状态。段级往回调与 Markdown 往回调的引擎用例未补（章级往回调已有，变异检查拦得住），记为后续。
