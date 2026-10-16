---
schema: nbook.task/v2
taskId: t21-harness-profile-tools
status: done
updated: 2026-10-16
---

# nb-harness：Profile 定义、工具三层与一次运行的结果

## 目标与范围

按 [nb-harness 提案](../../../../../docs/proposals/nb-harness-profile-and-tools.md) 加强 `packages/nb-harness`（连带 `nb-profile`、`nb-session`）：Profile 声明工具与上下文、生效工具集、`turn()` 返回停止原因与用量、收尾工具、单次请求、按配置给模型、缓存键。第一个调用方是 [w00024 t05 内置问答](../../../w00024-nb-story/tasks/t05-qa/README.md)，它等本 Task 完成再接。

合同：[`agent/harness.md`](../../../../../docs/specs/agent/harness.md)（`planned`）。

## 当前状态

- 2026-10-15：经 nbdev 新建。提案草稿 `7ea121d9a`，开发者确认要点与三个待定项（见提案决策记录）。
- 2026-10-15：omp 设计审查 13 条（阻断 2、重要 10、建议 1），报告 [evidences/design-review.txt](evidences/design-review.txt)；审查者的四个探针（真实 OMP 循环、经公开 fetch 接缝，不调用模型）留在本地 `.local/agent/works/w00002-neuro-agent-harness-redesign/tasks/t21-harness-profile-tools/reports/probes/`，实现时可复用。逐条处理：
  - 成立、已改进提案：1 日志改存 OMP 原样消息（`agent_message`），渲染结果经 `syncContextBeforeModelCall` 交给模型，旧日志只读；2 收尾工具用 OMP 公开的 `TERMINAL_TOOL_RESULT_ABORT_REASON`，定下结束的时刻，去掉“多回传一次”的退路，混批规则交开发者（待定项 1）；3 同一会话同一时刻一次运行，重叠在任何副作用之前拒绝（`session_busy`），关闭的顺序；4 登记表分声明与可撤回句柄，去掉 `harness.use()`，撤回时在途调用按平台 P1、P11 结算；5 会话快照（Profile 版本、`initial`、工具声明），恢复时对不上报 `session_incompatible`；6 Profile 加 `initialSchema`，工具经会话执行上下文取数据，`If` 加 `tool` 参数；8 `apiKeyEnv` 缺失时发请求前就报 `auth`，不退回别的凭据；9 错误归类改为 harness 自己的映射（按 `errorStatus` 与标记的优先级，加 `quota`、`local`），密钥解析与渲染放在能保留错误类型的地方；10 `defineModel` 写全选项与缺省，未知单价对外为 `null`；11 单次请求只收无工具的 Profile，不经会话；问答的全读仍是同一个 Agent（草稿把它写成单次请求，违背 t05 决定 13）；12 `DEEPSEEK_API_BASE` 挪到测试支持；13 脚本化流扩成按步骤的脚本，provider 层用 fetch 接缝测。
  - 7 用量漏计：成立，口径会改变调用方看到的费用含义，交开发者（待定项 2）。
  - 审查用的 worktree `.worktree/w00002-t21-review` 已删。
- 2026-10-15：开发者定两个待定项（收尾工具混批一律退回；用量取可见消息之和加“是否完整”），提案接受。

- 2026-10-15：开发者确认计划。omp 计划审查 9 条（阻断 2、重要 7），全部成立，计划按审查修订（`cf577871c`），报告 [evidences/plan-review.txt](evidences/plan-review.txt)。
- 2026-10-15：实现完成，worktree `.worktree/w00002-t21-harness`（分支 `feat/w00002-t21-harness`）：S1 `f39549f49`；S2–S4 `e8052cc20`（按计划审查第 8 条合成一次提交）；S5–S7 的测试与文档 `e5ee88009`。nb-session 17、nb-profile 15、nb-harness 50 条测试通过，四个包类型检查通过；`test:llm` 两条真实模型 Smoke 通过（DeepSeek）。和计划不同的地方：
  - nb-profile 去掉了 `ToolCall`、`ToolResult` 节点与 `HistorySet` 的 `kind`：它们能把工具调用与结果拆开渲染，违背输出 8，计划审查第 9 条也指出了。
  - 两个会话的已读行隔离没写行为测试：变异检查（让两个会话共用一份 `EditStore`）测试仍通过，OMP 的编辑引擎对没有快照的标签按当前文件内容放行，隔离在行为上观察不到；实现按会话 id 分存储、关闭时 `clear()`。
  - `neuro-book-test-support` 的“Agent 路径解析”那条测试在 master 上同样失败，与本 Task 无关。
  - governance 对 `tests/provider.test.ts` 报 6 条 llm-credential 警告：那里设的密钥都是假的、只发往本机端点，设 `OPENAI_API_KEY` 是为了证明不会退回去用它。
- 2026-10-15：omp 实现审查 19 条（重要 18、建议 1），报告 [evidences/impl-review.txt](evidences/impl-review.txt)，全部成立，修正 `4f7c5f9ab`：
  - 第 1 条：工具结果不能序列化时，这次运行以 local 失败、不再请求模型。
  - 第 2、6 条：工具的会话资源由工具桥记下用过的实现，撤回后关闭照样释放；关闭用 finally 收口，一个释放抛错不影响其余，最后以 AggregateError 报出。
  - 第 3、15 条：登记表按登记代次撤回，`unregister` 幂等，插件先检查再一次性登记。
  - 第 4、11 条：`complete` 只发 input，不混入 Profile 的静态消息；provider 建流抛错时返回 `provider` 错误。
  - 第 5、10、12 条：结果里的 `entries` 改为这次运行写入时收集，不再回读日志；最终结论在全部写入之后定；运行结束标记写失败改报 local。
  - 第 7 条：`defineModel` 在 `buildModel` 之后用宿主的值盖回单价、上限、模态，避免目录修正覆盖。
  - 第 8 条：没有状态码不再一律归 network，内容拦截与模型终态错误归 provider。
  - 第 9 条：`initial` 与工具声明在边界复制并冻结。
  - 第 13 条：工具实现同步抛错也在 try/finally 里收口。
  - 第 14 条：声明比较不看对象属性先后。
  - 第 16 条：每次请求取密钥都在 harness 边界捕获 auth。
  - 第 17 条：Profile 定义带标记，加载与入口处拒绝手写的同形对象。
  - 第 18、19 条：补 `tests/robustness.test.ts` 等行为测试，审查时存活的四个变异（收尾取消、释放、并发、thinking）与 `complete` 的静态消息变异现在都会失败；去掉固定轮询，会话都在 finally 里关闭。
  - 结果：nb-harness 69、nb-profile 17、nb-session 17 条通过，类型检查通过，`test:llm` 两条真实模型 Smoke 通过。审查者的实验脚本留在本地 `reports/impl-probes/`。

## 下一步

1. 请开发者合入 `feat/w00002-t21-harness`；合入后 w00024 t05 接着做问答。
