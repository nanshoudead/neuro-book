---
schema: nbook.task/v2
taskId: t21-harness-profile-tools
status: active
updated: 2026-10-15
---

# nb-harness：Profile 定义、工具三层与一次运行的结果

## 目标与范围

按 [nb-harness 提案](../../../../../docs/proposals/nb-harness-profile-and-tools.md) 加强 `packages/nb-harness`（连带 `nb-profile`、`nb-session`）：Profile 声明工具与上下文、生效工具集、`turn()` 返回停止原因与用量、收尾工具、单次请求、按配置给模型、缓存键。第一个调用方是 [w00024 t05 内置问答](../../../w00024-nb-story/tasks/t05-qa/README.md)，它等本 Task 完成再接。

合同：新建 `docs/specs/agent/harness.md`（`planned`，提案审查处理完后写）。

## 当前状态

- 2026-10-15：经 nbdev 新建。提案草稿 `7ea121d9a`，开发者确认要点与三个待定项（见提案决策记录）。
- 2026-10-15：omp 设计审查 13 条（阻断 2、重要 10、建议 1），报告 [evidences/design-review.txt](evidences/design-review.txt)；审查者的四个探针（真实 OMP 循环、经公开 fetch 接缝，不调用模型）留在本地 `.local/agent/works/w00002-neuro-agent-harness-redesign/tasks/t21-harness-profile-tools/reports/probes/`，实现时可复用。逐条处理：
  - 成立、已改进提案：1 日志改存 OMP 原样消息（`agent_message`），渲染结果经 `syncContextBeforeModelCall` 交给模型，旧日志只读；2 收尾工具用 OMP 公开的 `TERMINAL_TOOL_RESULT_ABORT_REASON`，定下结束的时刻，去掉“多回传一次”的退路，混批规则交开发者（待定项 1）；3 同一会话同一时刻一次运行，重叠在任何副作用之前拒绝（`session_busy`），关闭的顺序；4 登记表分声明与可撤回句柄，去掉 `harness.use()`，撤回时在途调用按平台 P1、P11 结算；5 会话快照（Profile 版本、`initial`、工具声明），恢复时对不上报 `session_incompatible`；6 Profile 加 `initialSchema`，工具经会话执行上下文取数据，`If` 加 `tool` 参数；8 `apiKeyEnv` 缺失时发请求前就报 `auth`，不退回别的凭据；9 错误归类改为 harness 自己的映射（按 `errorStatus` 与标记的优先级，加 `quota`、`local`），密钥解析与渲染放在能保留错误类型的地方；10 `defineModel` 写全选项与缺省，未知单价对外为 `null`；11 单次请求只收无工具的 Profile，不经会话；问答的全读仍是同一个 Agent（草稿把它写成单次请求，违背 t05 决定 13）；12 `DEEPSEEK_API_BASE` 挪到测试支持；13 脚本化流扩成按步骤的脚本，provider 层用 fetch 接缝测。
  - 7 用量漏计：成立，口径会改变调用方看到的费用含义，交开发者（待定项 2）。
  - 审查用的 worktree `.worktree/w00002-t21-review` 已删。

## 下一步

1. 开发者定提案的两个待定项（收尾工具混批、用量口径），接受提案。
2. 写 `docs/specs/agent/harness.md` 与 `plan.md`。
