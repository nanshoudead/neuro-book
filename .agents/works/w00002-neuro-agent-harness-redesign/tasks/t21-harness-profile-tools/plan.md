# t21 实施计划：nb-harness 的 Profile、工具与一次运行

## Context

w00024 t05 要在 nb-harness 上做 nb-story 的内置问答，核对后发现 nb-harness 缺的不少（工具不由 Agent 决定、Profile 只接了一半、一次运行的结果说不清、没有收尾工具、模型只认内置目录）。开发者 2026-10-15 在会话里定了方向，写成[提案](../../../../../docs/proposals/nb-harness-profile-and-tools.md)，经 omp 设计审查（[13 条](evidences/design-review.txt)）修订后接受；行为合同是 [`agent/harness.md`](../../../../../docs/specs/agent/harness.md)（`planned`）。

工作方式：在 worktree `.worktree/w00002-t21-harness`（分支 `feat/w00002-t21-harness`，从 master 起）里由主会话编码；改动限于 `packages/nb-harness`、`packages/nb-profile`、`packages/nb-session` 与 `packages/neuro-book-test-support/src/llm.ts`。OMP 版本不动（18.2.5）。设计审查者留下的四个探针（`.local/agent/works/w00002-neuro-agent-harness-redesign/tasks/t21-harness-profile-tools/reports/probes/`）是现成的实验样板：真实 Agent 循环加脚本化 `streamFn`、真实 provider 加公开 fetch 接缝。

## 关键设计

### `packages/nb-session`（会话日志的条目）

- `src/entries.ts` 加四种条目：`session_snapshot`（`profile: {key, version}`、`initial`、`tools: ToolDeclarationSnapshot[]`）、`agent_message`（`message`：OMP `AgentMessage` 原样，作为 `JsonValue` 存）、`usage`（这条模型消息的用量）、`run_end`（`stopReason`、`error`）。`SessionEntryInput`、`parseEntryLine` 同步。
- 旧的 `message`、`tool_call`、`tool_result` 类型保留供读取，harness 不再写。
- 不变量：一行一条、`seq` 单调，照旧。`agent_message` 的内容必须能 JSON 往返（OMP 消息本来就是 JSON 形状；遇到不能序列化的字段当作 `local` 错误，不静默丢）。

### `packages/nb-profile`（Profile 定义）

- 新 `src/define.ts`：`defineProfile({manifest, initialSchema, tools, context})` 返回 `ProfileDefinition`；`toolRef<TParams>(id)` 造工具引用，`optional(ref)`，`toolset(...)` 收集并检查同一 Profile 内 id 不重复。Profile 自带的工具是 `ProfileTool`（声明加 `execute`），与引用一样放进 `toolset`。
- `src/nodes.ts`：`If` 的 props 改为 `{when?: boolean; tool?: string}`，二者恰给一个；`HistorySet` 渲染原样消息。
- `src/render.ts`：`ProfileRenderInput` 改为 `{history: AgentMessage[]; tools: ReadonlySet<string>; now?}`；输出 `{systemPrompt: string[]; messages: AgentMessage[]}`；`If tool` 按 `tools` 判定，在 `System` 内同样生效（`collectText` 里同一处判断）。
- `src/loader.ts`：默认导出校验改成 `ProfileDefinition`（`isProfileDefinition`）。
- nb-profile 依赖 `@oh-my-pi/pi-agent-core` 的类型（`AgentMessage`）与 TypeBox：只用类型与 `TSchema`，运行时依赖只加 TypeBox（`typebox` ^1.3.6，与 nb-runtime、nb-story 同版本）。

### `packages/nb-harness/src/tools/`（登记表与生效工具集）

- 新 `registry.ts`：`ToolDeclaration = {id, name, description, parameters, provider, version, finish}`；`ToolHandle = {resolve(): ToolImpl | null}`（`null` 即已撤回）；`createToolRegistry()` 提供 `register(declaration, handle)`、`revoke(id)`、`declaration(id)`、`handle(id)`。插件 = `{manifest, tools: {declaration, handle}[]}`，去掉 `readFormats` 与 `harness.use()`。
- 新 `effective.ts`：`resolveEffectiveTools(profile, registry, policy)` 按 Spec 输出 1 计算，抛 `ToolUnavailableError`、`ToolNameConflictError`（带结构化字段，不靠文案）；`restoreEffectiveTools(snapshot, profile, registry)` 按输出 4 校验，抛 `SessionIncompatibleError`。
- 新 `bridge.ts`：把生效工具集转成 OMP `AgentTool[]`。每个 `execute` 先经句柄取实现（撤回则返回 `plugin-unavailable` 工具错误），传入 `{sessionId, initial, signal}`；撤回时中止在途调用、只结算一次（按调用 id 记“已结算”，迟到结果丢弃）。
- `read.ts`、`edit.ts` 改成内置工具的声明加句柄（`builtin.read`、`builtin.edit`），由宿主按需登记；读取格式改成 `createReadTool` 的参数；两者共享的 `EditStore` 按会话建（句柄 `resolve` 时按会话取）。

### `packages/nb-harness/src/harness.ts`（会话与一次运行）

- `createHarness(options)`：读日志 → 空则校验 `initial`、算生效工具集、写 `session_snapshot`；有快照则恢复；否则 `SessionIncompatibleError`。全部在写任何条目前完成校验。
- OMP `Agent` 配置：`sessionId` 取会话 id（缓存键）；`syncContextBeforeModelCall` 里先 `await` 写队列，再从日志读 `agent_message` 渲染 Profile，覆盖本次请求的系统提示词与消息（审查者的 `context-probe.ts` 已证实这道屏障可行）；`beforeToolCall` 做收尾混批的拦截；`afterToolCall` 做收尾成功的结束。
- 事件落盘：`message_end` 与工具结果都写成 `agent_message`（原样），每条助手消息后写 `usage`；出错、取消写 `run_end`。
- 运行锁：`turn()` 第一步同步检查并占用 `running`，已占用抛 `SessionBusyError`；`close()` 置 `closing` → `agent.abort()` → `await agent.waitForIdle()` → 等写队列 → 解除订阅 → `closed`。
- `TurnResult` 组装：`stopReason` 取最后一条助手消息（收尾时为 `finished`）；`error` 经 `errors.ts` 归类；`entries` 用开始时的 `seq` 截取；`usage` 见下。
- 新 `errors.ts`：`classifyProviderError(message)` 按 `errorStatus` 与 OMP 错误标记（`pi-ai/src/error/flags.ts` 的公开导出）的优先级映射 `ErrorKind`；harness 自己的步骤（密钥、渲染、日志）在调用 OMP 之前或钩子里捕获，带上 `auth`、`local`。不出现按 `message` 文字的分支。
- 新 `usage.ts`：逐条 `message_end` 累加；`onResponse` 计数 provider 响应次数，多于助手消息数时 `complete = false`；取消时 `complete = false`；单价未知（`defineModel` 没给 `price`）时 `cost = null`。

### `packages/nb-harness/src/finish.ts`（收尾工具）

- `beforeToolCall`：当前助手消息里收尾工具调用数 ≥ 1 且总调用数 > 1 时，对收尾工具返回 `{block: true, reason: "收尾工具要单独调用"}`。
- `afterToolCall`：收尾工具成功时记下 `finish`，用 OMP 公开的 `TERMINAL_TOOL_RESULT_ABORT_REASON` 中止，循环不再请求模型；工具结果照常落盘。线性化点是该工具结果的 `agent_message` 写入完成：写入失败返回 `error`（`local`）；写入前外部取消返回 `aborted`。
- 审查者的 `runtime-probes.ts` 已证实：普通 abort 会多一次请求，专用 reason 只一次且历史成对；混批时同批的兄弟工具会被中止，所以混批必须在 `beforeToolCall` 拦，而不是事后处理。

### `packages/nb-harness/src/model.ts` 与 `complete.ts`

- `defineModel(options)`：按 Spec 的选项表补缺省，经 `@oh-my-pi/pi-catalog/build` 的 `buildModel` 造模型（`price` 缺省时给 OMP 补零，另记 `priceKnown = false`）；返回 `{model, apiKey}`，`apiKey()` 读 `apiKeyEnv`，缺失或空抛 `MissingModelKeyError`（harness 在发请求前捕获，归为 `auth`），绝不返回 `undefined` 让 OMP 退回默认密钥。`apiKey: "none"` 时返回 OMP 接受的占位并在请求里不带认证头（实现时按 provider 的公开选项核实）。
- 删 `applyBaseUrlOverride`；`resolveModel` 保留，内置目录模型的密钥按 provider 的环境变量取（`getEnvApiKey`），同样缺失即失败。
- `complete()`：检查 Profile 没有工具（否则 `ProfileHasToolsError`），渲染后用 `pi-ai` 的 `streamSimple` 请求一次；错误归类与用量复用 `errors.ts`、`usage.ts`。

### `packages/nb-harness/src/testing/` 与 `neuro-book-test-support`

- `scriptedStreamFn` 改成 `scriptedModel(steps)`：每步给内容块（文字、thinking、工具调用）、`stopReason`、用量，可以挂一个屏障（`await` 一个外部 Promise，用于取消与重叠场景），并记录每次请求收到的上下文供断言。只替换模型输出，Agent 调度、schema 校验、日志都是真的。
- provider 层场景（隐藏重试、密钥不外泄、请求地址）用 OMP 的公开 fetch 接缝，照审查者的 `usage-probe.ts`、`credential-probe.ts`。
- `neuro-book-test-support/src/llm.ts`：`LlmTestConfig` 加 `baseUrl`（来自 `DEEPSEEK_API_BASE`，没有时用目录地址），`harness.llm.test.ts` 改用 `defineModel` 组模型；测试规范里的环境键不变。

## Spec 与文档改动

- `docs/specs/agent/harness.md`：实现后补“实现合同”与证据，晋升由开发者批准。
- `packages/nb-harness/docs/omp-capabilities.md`：新用到的 OMP 公开面（`syncContextBeforeModelCall`、`beforeToolCall`、`TERMINAL_TOOL_RESULT_ABORT_REASON`、`onResponse`、`pi-catalog/build`）与两条陷阱（provider 层重试的用量不交出、`getApiKey` 为空时退回默认密钥）。
- `packages/nb-harness/AGENTS.md`：删“领域工具通过插件缝接入、内置 read/edit”的旧说法，改为“工具只来自 Profile 声明”；完成门禁里的测试文件名随新测试更新。

## 切片

| 切片 | 内容 | 提交 | 自跑 |
|---|---|---|---|
| S1 | nb-session 新条目 | 一次 | `bun test`、`typecheck`（nb-session） |
| S2 | nb-profile：`defineProfile`、工具引用、`If tool`、渲染原样消息 | 一次 | nb-profile 的 `bun test`、`typecheck` |
| S3 | 登记表、生效工具集、快照与恢复、工具桥（含撤回） | 一次 | nb-harness 单测 |
| S4 | 会话与一次运行：上下文屏障、落盘、运行锁、关闭、`TurnResult`、错误归类、用量、缓存键 | 一次 | nb-harness 单测 |
| S5 | 收尾工具 | 一次 | 同上 |
| S6 | `defineModel`、`complete()`、测试支持迁移、删特例 | 一次 | 同上，加 `test:llm`（有凭据时） |
| S7 | Spec 验收场景 1 到 7 的组合测试、文档、实现审查（omp）与处理 | 各一次 | 三包 `bun test`、`typecheck`；`governance:check`、`docs:check` |

S3 起 nb-harness 的旧测试（`harness.e2e.test.ts` 依赖内置 read/edit）随接口一起改写，不保留旧装配路径。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| 输出 1、2 | `tests/effective-tools.test.ts`：必需缺失、被禁用、撞名、可选未登记；模型请求里的工具名单 |
| 输出 3、4 | `tests/session-resume.test.ts`：快照内容；关闭再恢复；改 schema、改 Profile 版本、旧日志 |
| 输出 5 | 验收 5：两个会话并行 |
| 输出 6 | 验收 4：撤回在途调用 |
| 输出 7、8、9 | `tests/context.test.ts`：每次请求前日志已写完；关闭重开后历史逐字段相同（含 thinking 与签名）；两次请求之间前缀不变；请求带 `sessionId` |
| 输出 10、12 | `tests/turn-result.test.ts`：五种停止原因；provider 错误（经 fetch 接缝给出 401、402 余额、429、上下文超长、断连）与 harness 自己的错误（密钥缺失、日志写失败）各一例 |
| 输出 11 | 验收 6：隐藏重试；取消；单价未知 |
| 输出 13 到 16 | `tests/finish.test.ts`：成功后无模型请求；退回再交；混批；两个收尾；取消早于、晚于写入；写入失败 |
| 输出 17 | `tests/complete.test.ts`：无工具 Profile；带工具报错；不写日志 |
| 输出 18 | 验收 7：密钥缺失不外泄；请求地址取自模型配置 |
| 状态与转换 | 验收 3：重叠、关闭在途运行、关闭后调用 |
| Smoke | `tests/harness.llm.test.ts`：自定义端点一次 `turn`；收尾工具 `finished` |

## 验证

- 三包 `bun run typecheck`、`bun test`；nb-harness `bun run test:llm`（`NBOOK_LLM_TESTS=1`，缺凭据记未验证）。
- 仓库门禁：`bun run governance:check`、`bun run docs:check`。
- 不在真实浏览器或服务里验证：本 Task 没有界面与服务；真实端到端在 w00024 t05 的问答回归里。

## 不做与风险

- 不做工具发现、公共工具、追加工具、审批、步数上限、上下文压缩（Spec 非目标）。
- 风险：`syncContextBeforeModelCall` 覆盖消息后，OMP Agent 内部状态与渲染结果的关系要按审查者的提醒处理（Agent 仍维护调度状态，只是送模型的内容以渲染为准）；S4 先用探针式测试钉住再写其余部分。
- 风险：`apiKey: "none"` 的无认证端点在 OMP 各 provider 的写法不一；只保证 OpenAI 兼容端点，其他 provider 遇到时报 `auth`。
- 风险：OMP 工具参数的 `TSchema` 来自 `@oh-my-pi/pi-ai`，与 `typebox` 1.x 的 schema 是否直接兼容要在 S2 先实测；不兼容时在 nb-profile 里转成 OMP 接受的 JSON Schema，不换 TypeBox 版本。
- 风险：OMP 错误标记的公开导出路径要实测；导不出时只用 `errorStatus` 加 `errorId`，并在 omp-capabilities.md 记下。
