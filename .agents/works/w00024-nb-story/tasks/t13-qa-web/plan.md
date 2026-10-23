# t13 实施计划：网页问答页与设置页

> 初稿，未经开发者确认。“对话视图包”“nb-ui 新零件”两节与切片 1、2 已作废（README 决定 11：对话视图改为 w00019 的 `nb-agent-ui`）；其余部分等 w00019 t10、t11 完成后按那时的包接口改写。

## Context

开发者要把问答接进网页（[README](README.md) 决定 1 到 10），当作 neuro-book 主应用接入 Agent 对话的预演；t08 已经让引擎支持连续对话与可选的 `answer`。现状：

- 问答只有命令行入口：契约里没有 `qa.*` 方法，服务端没有任何流式接口（抽取进度是轮询的）。
- 引擎的 `onProgress` 只有工具、退回、已答三种粗粒度事件，网页要的逐字输出与思考过程拿不到。
- w00019 的对话视图在旧应用里（`packages/neuro-book-legacy/app/components/agent/`）。类型、注册表、分轮规则与滚动跟随都是纯逻辑；要断开的依赖只有 Nuxt 的 `useI18n`、旧应用的 `renderMarkdown`，以及 UnoCSS 图标类名。

依据：[`story/qa.md`](../../../../../docs/specs/story/qa.md)、[`story/viewer.md`](../../../../../docs/specs/story/viewer.md)、[`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)，归档的 [`ui/agent-conversation-view.md`](../../../../../docs/archived/specs/ui/agent-conversation-view.md)，表单合同 [`ui/forms.md`](../../../../../docs/specs/ui/forms.md)。

工作方式：代码在 worktree `.worktree/w00024-nb-story`，Spec 与记录在主工作区 master 上改。前端审查派 Sonnet，后端审查用 omp。真实模型只做冒烟。

## 关键设计

### 问答运行放在服务端：`src/server/qa-service.ts`（新）

一轮问答在服务进程里跑，不绑在某个 HTTP 连接上。页面刷新、离开问答页都不打断它，回来时接着看。写法照 `ingest-service.ts`，主应用以后的 Agent 运行也是这个形状。

- `QaService`
  - `start({book, conversation?, question, mode?, at?})`：返回 `{conversationId, turn}`；`at` 与 `mode` 只在新对话时用。
  - `stop(conversationId)`
  - `subscribe(conversationId, listener)`：订阅时先补发这一轮已有的事件，再接着推新事件。
  - 运行中的轮次按对话 id 登记在内存里。
- 一个对话同一时间只跑一轮：再发返回 `qa_busy`。不同对话可以同时跑。命令行同时续问同一个对话，由 t08 的 `expectTurns` 判成冲突。
- 每次 `start` 都重新读配置文件。设置页改了配置，下一轮就生效；正在跑的一轮不受影响。
- 服务退出时中断所有运行中的轮次（`AbortSignal`），按引擎现有的规则记为“中断”。

### 引擎多给一路原始事件：`src/qa/engine.ts`

`AskInput` 加 `onAgentEvent?: (event: AgentEvent) => void`，原样转发 `Harness.subscribe` 的事件。`onProgress` 保留给命令行。轮次开始与结束另发两种问答自己的事件：

- `turn_start {conversationId, turn, question, at, mode}`
- `turn_end {result: QaTurnResult, recordSaved, notSaved?}`

### 接口：`src/contract/contract.ts`、`src/server/http.ts`

- 新增 RPC：
  - `qa.list {book}` → 对话一行一个，字段同 `conversationLine`；
  - `qa.get {book, id}` → 记录加历史消息：从会话日志的 `agent_message` 条目取出，用 `parseEntryLine` 解析；
  - `qa.start`、`qa.stop`、`qa.remove`；
  - `config.get` → 配置、文件路径、`apiKeyEnv` 指的环境变量在服务启动时有没有值；
  - `config.set {config, expect}`：`expect` 是读取时的内容摘要，文件被命令行改过就返回 `config_conflict`；
  - `config.test`：复用 `src/qa/probe.ts`。
- 新增流式路由 `GET /api/qa/events?book=&conversation=`：用 nb-harness 的 `writeSseStream`，帧格式用 `serializeAgentEvent` 与 `serializeSseJsonEvent`。需要登录态，断开时退订。

### 对话视图包：`packages/nb-agent-view`（新）

形状照 `nb-form`：

- `package.json` 的 `exports` 分两个入口：`.` 是纯逻辑，`./vue` 是组件。
- 只依赖 `vue` 与 `@notnotype/nb-ui`。
- 用 `boundary.test.ts` 核对导入。
- 样式写 scoped CSS、用 nb-ui 的 token，不用原子类。
- 图标沿用 nb-ui 的 `iconClass` 字符串。

**从旧应用搬，只搬问答用得到的部分：**

- 纯逻辑：
  - `agent-view.types.ts`：裁掉 `branches`、`editing`、`pendingInputs`、`workflows`、`workspaceChanges` 和 `composer` 的附件部分；
  - `agent-view-registry.ts`：只留角色、工具渲染器、条目渲染器、消息操作；
  - `conversation-turns.ts`、`process-summary.ts`、`tool-args.ts`、`tool-detail-lines.ts`；
  - 各自的测试一起搬。
- 组件：`AgentConversationView`、`AgentConversationTurn`、`AgentTurnBlock`、`AgentChainSummary`、`AgentStepLine`、`AgentCard`、`AgentToolDetail`、`AgentRawView`、`AgentMessageActions`。

**不搬：** 输入框的触发菜单、命令、附件、提问向导、面板、分支、就地编辑、待处理区、任务清单、文件改动条。等主应用接入时再搬，搬法同这次。

**和旧版的不同：**

1. **本地化**：去掉 `useI18n`，改成包内的文字表，加 `locale` prop，写法照 nb-form。
2. **注入点**：Markdown 显示与输入框通过注册表的 `markdown` 与 `composer` 两个扩展点注入（README 决定 3）。视图不再自带 textarea。
3. **结果类工具**：工具渲染器的呈现层级加一种 `result`。轮次里这种工具的最后一次成功调用算作结果：常显，整轮收起后仍然露出，地位同最终回复。失败的调用（被退回）照常留在过程里，算一次失败。`conversation-turns.ts` 判断“最终回复”时一起认它。
4. **运行中的过程**：新增 prop `runningProcess: "collapsed" | "expanded"`，默认 `collapsed`（旧规则）。问答传 `expanded`（README 决定 7）：运行中思维链逐步展开，结束后整轮照旧收起。

### nb-ui 新零件：`packages/nb-ui`

- `composables/useStreamScroll.ts`：从旧应用的 `use-stream-scroll.ts` 搬来，接口不变。
- `display/CodeBlock.vue`：从 `AgentCodeBlock` 来，提成通用的带行号文本块，支持增删色调、最大高度和截断说明。
- `display/DisclosureRow.vue` 与 `display/DisclosureCard.vue`：从 `AgentStepLine` 与 `AgentCard` 提出来，是可折叠的一行和一张卡。包在现有的 `Collapsible` 上，内容收起时不渲染。

每个都写同名 `.md`、导出，并在应用 Component Lab 的 nb-ui 场景里登记（`packages/neuro-book/src/plugins/lab/web/fixtures/nb-ui/`）。

### nb-story 网页：`src/web`

- **路由**：
  - 书里新加页面 `qa`（`host/book.ts` 的 `PAGES`），导航放在“原文”之后。地址 `/book/<id>/qa?c=<对话 id>`。
  - 新加 `/settings`。
- **`pages/QaPage.vue`**：
  - 宽屏时左侧是对话列表：新对话、每行写首问、轮数、状态和读到哪里；
  - 右侧是 `AgentConversationView`，顶上写对话的阅读位置与做法（决定 9：不拦、不藏）；
  - 平板与手机把列表收进顶部的“对话”下拉；
  - 新对话用查看器当前的阅读位置，输入框旁可以选“图当目录”或“全读”。
- **`qa/`（网页侧，新目录）**：
  - `conversation-store.ts`：把 `qa.get` 的历史消息与 SSE 事件合成视图要的 `MessageView[]`；把 harness 的 `AgentMessage` 转成 `MessageView` 的函数写在这里，配单测；
  - `registry.ts`：登记问答的工具渲染器。查询工具都归 `explore`，摘要写成“读了第 12–14 章”“查了人物卡”；`answer` 用 `result` 层级；
  - `AnswerCard.vue`：按决定 8，结论类型徽标、结论、表或分点、出处一行常显，展开说明与覆盖范围点“详细”展开。出处与人名经现有的抽屉打开；
  - `StoryMarkdown.vue`（作废，README 决定 13：改用 nb-markdown 的 `MarkdownDisplay`，出处先改写成链接）：用 `marked` 加 `dompurify`，版本同 dev-panel。文字里“章.段”形状的出处转成可点的出处；没核实的出处按 `unverifiedRefs` 在回复下面列出；
  - `QaComposer.vue`：nb-ui 的 `Textarea` 加发送与停止按钮。回车发送，Shift+回车换行；运行中按钮变成停止。
- **`shell/SettingsPage.vue`**：
  - 用 `@notnotype/nb-form/vue` 的 `SchemaForm` 画 `QaConfig` 的 TypeBox schema，在 `src/qa/config.ts` 的 schema 上补 `x-form` 提示（字段名、说明、分组）；
  - 密钥那一项只写变量名，旁边标“已设置”或“没有值”；
  - 保存时带 `expect`；
  - “测试连接”调用 `config.test`；
  - 书架右上角与书里顶栏的菜单各加一个入口。
- **换掉手写控件**（README 决定 5）：
  - `BookFrame.vue` 的浮动抽屉与手机导航换成 nb-ui `Drawer`；
  - `SearchBox.vue` 的浮层换成 `Popover`；
  - `story-table` 换成 `Table`；
  - `PageState`、`PagedList`、`BookShell` 的重试换成 `Button`，加载中换成 `Spinner`。

  外观有变化的地方先截图核对。`Table` 不支持 `RecordsTable` 的吸顶分组时，这一处保留，并写明原因。

## Spec 与文档改动

- 新建 `docs/specs/ui/agent-conversation-view.md`（planned，owner `nb-agent-view`）：只收这次搬过来的部分，以及 `result` 层级、`runningProcess`、Markdown 与输入框的注入。其余条目仍留在归档里，写明“主应用接入时再搬”。
- `story/viewer.md`：
  - 删掉“不做问答”；
  - 追加输出：问答页的版式、过程、答案卡片、阅读位置不同的对话、设置页；
  - 地址形状加 `qa` 与 `/settings`；
  - 验收里加问答页与设置页的组合场景。
- `story/qa.md`：
  - 边界一节补网页入口：服务端运行、一个对话一次只跑一轮、离开页面不中断、服务退出记为中断；
  - 失败码加 `qa_busy`。
- `story/cli-skill.md`：`config` 一节写明网页设置页改的是同一份文件，冲突时返回 `config_conflict`。
- `docs/modules/monorepo-boundaries.md` 与 `packages/AGENTS.md`：登记 `nb-agent-view`；nb-story 的依赖加上 `nb-agent-view` 与 `nb-form`。

## 切片

1. **nb-ui 零件**：`useStreamScroll`、`CodeBlock`、`DisclosureRow`、`DisclosureCard`，以及 `.md`、Lab 场景和组件测试。自跑 nb-ui 的 typecheck 与 test，跑 Lab smoke。
2. **nb-agent-view**：
   - 搬纯逻辑与测试，去掉 i18n，加 `result` 层级、`runningProcess`、注入点；
   - 组件与 Lab 场景用旧 fixture 数据改成问答的消息：运行中、已答、文字回复、退回后再交、出错、中断。
   - **视觉检查点**：把问答的几个场景截图（390 与 1200 宽、明暗）给开发者看，确认后再接服务端。这一步代替 design-review 流程里单独的草稿 worktree：版式在 w00019 已经确认过，这次新的只有答案卡片和运行中展开，直接用真组件看。
3. **服务端**：`onAgentEvent`、`QaService`、`qa.*` 与 `config.*` 的 RPC、SSE 路由。合同测试用 `testing/openai-endpoint.ts` 的脚本端点，覆盖：订阅补发、停止、`qa_busy`、刷新后重订、服务退出时中断、`config_conflict`。
4. **问答页与设置页**：`QaPage`、对话合成、答案卡片、Markdown、输入框、设置页、路由与入口。e2e 新加 `qa.e2e.ts`，用 `testing/replay-server.ts` 一类的子进程端点，加一个问答脚本。
5. **换手写控件**：逐处替换，跑查看器全量 e2e，截图对照。
6. **收尾**：Spec 补实现合同与证据；真实模型冒烟一次（网页里问一题、追问一题、中途停止一次）。

每片单独提交。切片 3 的接口和切片 4 的页面互相依赖：两片都完成后再合入 master。

## 验收映射

切片 2 落 Spec 时把条目编号写进来。先按能力列出：

| 行为 | 覆盖 |
|---|---|
| 分轮、`result` 层级、`runningProcess` | `conversation-turns.test.ts`（nb-agent-view） |
| 消息合成：历史加流式事件、断线重订不重复 | `conversation-store.test.ts`（nb-story web） |
| 运行在服务端、一次一轮、停止、服务退出记为中断 | `qa-service.test.ts` |
| SSE 补发与登录态 | `server.test.ts` |
| 设置读写、冲突、密钥不出现在响应里 | `config` RPC 测试 |
| 页面：问、看过程、答案卡片、点出处开抽屉、追问、停止、刷新后接着看 | `qa.e2e.ts` |
| 设置页：改字段保存、命令行改过后保存报冲突、测试连接 | `qa.e2e.ts` 或 `settings.e2e.ts` |
| 换控件后查看器行为不变 | 现有 `viewer.e2e.ts` 全量 |
| 390 与 1200 宽、明暗 | Lab 截图与 e2e 截图 |

## 验证

- 自动：nb-ui、nb-agent-view、nb-story 的 typecheck 与 test；Lab smoke；nb-story 全量 e2e。按记忆的做法，先构建三份产物，跑之前停掉多余的服务。
- 手动：`nbstory serve` 打开问答页，用真实模型问一题、追问一题、中途停止一次，刷新页面看运行中的轮次能不能接上。
- 未验证的边界：多个浏览器标签同时看同一个运行中的对话只做合同测试，不做 e2e；手机宽度只保证能用（同查看器）。

## 不做与风险

- **不做**：
  - 主应用接入；
  - 对话视图里的分支、编辑历史、附件、命令；
  - 对话改名；
  - 多个模型配置。
- **风险**：
  - 设置页能改 `baseUrl`，密钥会发到新地址。这和命令行改配置的权限相同，服务只听本机、要登录。在 Spec 的信任边界里写明。
  - 一轮跑几分钟，期间服务重启会丢掉这一轮，按中断记录。
  - 换 `Table` 可能改变现有页面的外观，切片 5 逐处截图核对。
  - 旧组件搬家时，scoped CSS 替换原子类的工作量不确定。切片 2 先搬一个组件估一下，再定是否拆片。
