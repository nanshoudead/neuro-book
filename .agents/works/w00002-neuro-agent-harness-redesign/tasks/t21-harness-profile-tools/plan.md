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

- 新 `registry.ts`：`ToolDeclaration = {id, name, description, parameters, provider, version, finish, concurrency, strict, customFormat?}`（后三项是 OMP 在调用 `execute` 之前就要读的调度与参数协议，例如 edit 的 `exclusive`、hashline 语法，必须在声明里冻结、进快照比对）；`ToolHandle = {resolve(): ToolImpl | null}`（`null` 即已撤回）；`createToolRegistry()` 提供 `register(declaration, handle)`、`revoke(id)`、`declaration(id)`、`handle(id)`。插件 = `{manifest, tools: {declaration, handle}[]}`，去掉 `readFormats` 与 `harness.use()`。
- 新 `effective.ts`：`resolveEffectiveTools(profile, registry, policy)` 按 Spec 输出 1 计算，抛 `ToolUnavailableError`、`ToolNameConflictError`（带结构化字段，不靠文案）；`restoreEffectiveTools(snapshot, profile, registry)` 按输出 4 校验，抛 `SessionIncompatibleError`。
- 新 `bridge.ts`：把生效工具集转成 OMP `AgentTool[]`。每个 `execute` 先经句柄取实现（撤回则返回 `plugin-unavailable` 工具错误），传入 `{sessionId, initial, signal}`；撤回时中止在途调用、只结算一次（按调用 id 记“已结算”，迟到结果丢弃）。
- `read.ts`、`edit.ts` 改成内置工具的声明加句柄（`builtin.read`、`builtin.edit`），由宿主按需登记；读取格式改成 `createReadTool` 的参数。两者共享的 `EditStore` 由内置工具自己按 `ToolExecutionContext.sessionId` 取（句柄 `resolve` 不带会话，只取无会话状态的实现）；`ToolImpl.releaseSession(sessionId)` 对它 `clear()` 并删掉映射，harness 在关闭会话、以及创建失败时对生效工具集逐个调用。

### `packages/nb-harness/src/harness.ts`（会话与一次运行）

- `createHarness(options)`：读日志 → 空则校验 `initial`、算生效工具集、写 `session_snapshot`；有快照则恢复；否则 `SessionIncompatibleError`。全部在写任何条目前完成校验。
- OMP `Agent` 配置：`sessionId` 取会话 id（缓存键）。上下文替换用 Agent 真正提供的两个入口（OMP 的顺序是：先跑 `addBeforeModelCallHook` 注册的钩子，再把 `state.systemPrompt` 同步进本次请求，再调 `transformContext`）：钩子里 `await` 写队列，用已落盘的原样消息渲染 Profile，`setSystemPrompt(渲染结果)` 并暂存渲染出的消息；`transformContext` 返回暂存的消息。只替换送模型的内容，不改 Agent 内部的调度历史。钩子只等已经排进队列的写入，不等之后才会发出的事件（否则环等）。`beforeToolCall` 做收尾混批的拦截；`afterToolCall` 记收尾候选。
- 本轮用户输入：`turn` 拿到运行所有权后先构造这一轮的 `UserMessage` 并写进日志（写失败返回 `local`，不发请求），再把同一个对象交给 `agent.prompt(message)`；它的 `message_end` 按对象身份跳过，保证恰写一次。
- 事件落盘：`message_end` 与工具结果都写成 `agent_message`（原样），每条助手消息后写 `usage`；出错、取消写 `run_end`。
- 运行锁：`turn()` 第一步同步检查并占用，已占用抛 `session_busy`；整次运行（准备、Agent 循环、结算与写入）是一个任务，带自己的取消状态，每个 `await` 之后、进模型之前检查。`close()`：置“关闭中”拒绝新调用（含 `subscribe`）→ 取消在途任务 → 等整个任务结束（不只等 Agent idle：运行可能还在准备或结算）→ 等写队列 → 释放工具的会话资源 → 解除订阅 → “已关闭”；重复 `close()` 共用同一个关闭任务。
- `TurnResult` 组装：`stopReason` 取最后一条助手消息（收尾时为 `finished`）；`error` 经 `errors.ts` 归类；`entries` 用开始时的 `seq` 截取；`usage` 见下。
- 新 `errors.ts`：`classifyProviderError(message)` 按 `errorStatus` 与 OMP 错误标记（公开路径 `@oh-my-pi/pi-ai/error/flags`，计划审查已核实）的优先级映射 `ErrorKind`；harness 自己的步骤（密钥、渲染、日志）在调用 OMP 之前或钩子里捕获，带上 `auth`、`local`。不出现按 `message` 文字的分支。
- 新 `usage.ts`：逐条 `message_end` 累加。重试的察觉：harness 包一层 `streamFn`，给 provider 传入计数的 `fetch`（OMP 公开的流选项），一次运行里实际发出的 HTTP 请求多于助手消息数时 `complete = false`；`onResponse` 只能看到成功响应，数不到 503、响应前断连这类传输层重试（计划审查实测），所以不用它。不支持 `fetch` 选项的 provider 察觉不到重试，这个盲区写进 omp-capabilities.md。取消时 `complete = false`；单价未知（`defineModel` 没给 `price`）时 `cost = null`。

### `packages/nb-harness/src/finish.ts`（收尾工具）

- `beforeToolCall`：当前助手消息里收尾工具调用数 ≥ 1 且总调用数 > 1 时，对收尾工具返回 `{block: true, reason: "收尾工具要单独调用"}`。
- `afterToolCall`：收尾工具成功时只记“候选”，并用 OMP 公开的 `TERMINAL_TOOL_RESULT_ABORT_REASON` 中止，让循环不再请求模型；这里不确认 `finished`，也不等写入（OMP 的顺序是 `execute` → `afterToolCall` → `tool_execution_end` → 工具结果的 `message_end`，钩子里等后面的事件会环等）。工具结果的 `message_end` 入队、写入成功后才把候选结算为 `finished`；写入失败结算为 `error`（`local`）。外部取消另记一个标记（取消发生在候选写入成功之前就是 `aborted`），不从已被 terminal reason 占用的 `signal.reason` 推断先后。
- 审查者的 `runtime-probes.ts` 已证实：普通 abort 会多一次请求，专用 reason 只一次且历史成对；混批时同批的兄弟工具会被中止，所以混批必须在 `beforeToolCall` 拦，而不是事后处理。

### `packages/nb-harness/src/model.ts` 与 `complete.ts`

- `defineModel(options)`：按 Spec 的选项表补缺省，经 `@oh-my-pi/pi-catalog/build` 的 `buildModel` 造模型（`price` 缺省时给 OMP 补零，另记 `priceKnown = false`）；返回 `{model, apiKey}`，`apiKey()` 读 `apiKeyEnv`，缺失或空抛 `MissingModelKeyError`（harness 在发请求前捕获，归为 `auth`），绝不返回 `undefined` 让 OMP 退回默认密钥。`apiKey: "none"` 时返回 OMP 公开的 `NO_AUTH_SENTINEL`（`@oh-my-pi/pi-ai/providers/openai-shared`，值 `"N/A"`），OpenAI 兼容端点据此不带认证头、也不退回默认密钥（计划审查实测）。
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
| S2–S4 | nb-profile 的 `defineProfile`、工具引用、`If tool`、渲染原样消息；登记表、生效工具集、快照与恢复、工具桥（含撤回）；会话与一次运行（上下文替换、本轮输入、落盘、运行锁、关闭、`TurnResult`、错误归类、用量、缓存键）；nb-harness 旧测试与 `harness.llm.test.ts` 的类型装配同步迁移 | 一次（S2 改了 nb-profile 的公开接口，消费方 nb-harness 要到 S4 才能迁完，分开提交会留下编译不过的提交） | nb-profile、nb-harness 的 `bun test`、`typecheck` |
| S5 | 收尾工具 | 一次 | 同上 |
| S6 | `defineModel`、`complete()`、测试支持迁移、删特例 | 一次 | 同上，加 `test:llm`（有凭据时） |
| S7 | Spec 验收场景 1 到 7 的组合测试、文档、实现审查（omp）与处理 | 各一次 | 三包 `bun test`、`typecheck`；`governance:check`、`docs:check` |

从 S2–S4 起每片都跑受影响的消费方（nb-harness）的类型检查与测试；nb-harness 的旧测试（`harness.e2e.test.ts` 依赖内置 read/edit）随接口一起改写，不保留旧装配路径。

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
| F3、F4 | `nb-profile/tests/define.test.ts`（`initialSchema` 不合、重复工具 id、manifest 缺字段、`If` 的 when 与 tool 都给或都不给）；`tests/session-resume.test.ts`（新会话缺 `initial` 或不合、恢复时又给 `initial`，都不写任何条目） |
| 输出 1 到 4 补充 | 报错时日志仍为空；已有会话不受后来登记表与禁用策略的变化影响；恢复时 Profile key、提供方版本、`concurrency`/`strict`/`customFormat` 变化都拒绝 |
| 输出 7 到 9 补充 | 第一次、第二次与恢复后的第一次请求都恰好含 1 条本轮输入；工具调用与结果总成组（渲染层已去掉能只取工具结果的 `HistorySet kind` 与 `ToolResult` 节点） |
| 输出 12、F10 补充 | 渲染 Profile 抛错归为 `local`；状态码与错误标记同时存在时按优先级归类 |
| 输出 17、18 补充 | `complete` 的 `input` 是唯一用户消息；`apiKey: "none"` 不带认证头；指定变量为空字符串也不退回 |
| 状态补充 | 关闭中与已关闭时 `subscribe` 也拒绝；重复 `close()` 幂等；解除订阅后不再收到事件；准备阶段、模型阶段、结算写入阶段各关闭一次 |
| 内置工具 | 同一批两个 edit 不重叠执行；hashline 的参数协议经桥接后仍生效；两个会话对同一文件的已读行与寄存器隔离；关闭后会话资源释放 |
| Smoke | `tests/harness.llm.test.ts`：自定义端点一次 `turn`；收尾工具 `finished` |

## 验证

- 三包 `bun run typecheck`、`bun test`；nb-harness `bun run test:llm`（`NBOOK_LLM_TESTS=1`，缺凭据记未验证）。
- 仓库门禁：`bun run governance:check`、`bun run docs:check`。
- 不在真实浏览器或服务里验证：本 Task 没有界面与服务；真实端到端在 w00024 t05 的问答回归里。

## 计划审查

omp 9 条（阻断 2、重要 7），报告 [evidences/plan-review.txt](evidences/plan-review.txt)，全部成立，已改进上文：1 上下文替换改用 `addBeforeModelCallHook` 加 `transformContext`（`syncContextBeforeModelCall` 不是 Agent 的公开配置）；2 收尾工具在 `afterToolCall` 只记候选，落盘后才结算；3 重试改用计数 `fetch` 察觉，写明盲区；4 本轮用户输入先落盘再交给 `prompt`；5 `close()` 等整次运行任务；6 `EditStore` 由内置工具按会话取、关闭时清；7 声明加 `concurrency`、`strict`、`customFormat`；8 S2 到 S4 合成一次提交；9 验收映射补全。审查者的探针（真实 OMP 循环、公开 fetch 接缝）存在本地 `reports/probes/`。

## 不做与风险

- 不做工具发现、公共工具、追加工具、审批、步数上限、上下文压缩（Spec 非目标）。
- 风险：送模型的内容以渲染为准，Agent 内部仍维护调度历史；两者在一次运行内应当一致（都来自同一批原样消息），用“模型实际收到的上下文”断言钉住。
- 风险：`apiKey: "none"` 只在 OpenAI 兼容端点验证过（`NO_AUTH_SENTINEL`）；其他 provider 的实际认证失败照常按错误归类。
- 已核实、不再是风险：`typebox` 1.3.6 的常见 schema 直接被 OMP 接受；错误标记有公开路径。
