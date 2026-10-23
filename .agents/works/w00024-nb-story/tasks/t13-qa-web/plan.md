# t13 实施计划：网页问答页与设置页

2026-10-23 重写：10-21 的初稿里“对话视图包”“nb-ui 新零件”两节由 w00019 做完（`nb-agent-ui` 的 t10、t13、t14），Markdown 由 w00025 t16 的 `nb-markdown` 提供；本计划只留问答页、设置页、服务端运行与接口、换手写控件。

## Context

开发者要把内置问答接进网页查看器，当作 neuro-book 主应用接入 Agent 对话的预演（[README](README.md) 决定 1、2）。版式与注意力排序已定（决定 6 到 10），对话视图用 `nb-agent-ui`（决定 11），Markdown 显示与输入框用 `nb-markdown`（决定 13）。

现状：

- 问答只有命令行入口：合同里没有 `qa.*` 方法，服务端没有流式接口（抽取进度靠 `ingest.status` 轮询）。
- 引擎 `askQuestion`（`src/qa/engine.ts`）的会话日志在内存里（`createMemorySessionLog`），一轮结束才和记录一起写盘；`onProgress` 只有工具、退回、已答三种简化进度。网页要的 harness 事件与带 `seq` 的日志条目拿不到。
- 新对话的 id 在引擎里生成（`newQaRecordId`），调用方在一轮结束前不知道。
- `nb-agent-ui` 已经有网页要的东西：`AgentSessionList`、`processDisclosure: "live"`（决定 7）、结果节点 `outcome` 与退回一行、附注与条目渲染器、`createHarnessTranscript`（日志为准、事件只作运行中的临时显示）。
- w00019 t14 的静态稿（草稿 worktree `.worktree/w00019-t14-drafts` 的 `src/web/drafts/qa/`）已经用真实记录回放过：工具登记、答案卡片、会话列表的接法可以照搬，接口是合入前的旧版，要按现在的改。

依据：[`story/qa.md`](../../../../../docs/specs/story/qa.md)、[`story/viewer.md`](../../../../../docs/specs/story/viewer.md)、[`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)、[`ui/markdown-display.md`](../../../../../docs/specs/ui/markdown-display.md)、[`ui/forms.md`](../../../../../docs/specs/ui/forms.md)；`packages/nb-agent-ui/README.md` 与 `packages/nb-markdown/README.md` 的宿主接入。

工作方式：代码在新 worktree `.worktree/w00024-t13-qa-web`（分支 `feat/w00024-t13-qa-web`，从 master 拉出；`feat/w00024-nb-story` 已全部合入 master）。Spec 与记录在主工作区改。审查：服务端与引擎派 omp，网页派 Sonnet。真实模型只做最后一次冒烟。

## 技术选型

- 流式通道：SSE。服务端已有的 `Request → Response` 路由直接返回 `ReadableStream`，帧用 nb-harness 的 `serializeSseJsonEvent`、`serializeAgentEvent`；浏览器用 `EventSource`（同源、带登录 cookie）。否决 WebSocket：只要服务端推，SSE 够用且断线自动重连。
- 设置表单：`@notnotype/nb-form/vue` 的 `SchemaForm` 画配置的 TypeBox schema，提示写 `x-form`。
- 对话视图与 Markdown：`nb-agent-ui`、`nb-markdown`，不另写。
- 其余无新的通用问题。

## 关键设计

### 引擎：`src/qa/engine.ts`

`AskInput` 加三项，`onProgress` 留给命令行：

```ts
/** 新对话用调用方给的 id（服务端在一轮开始前就要告诉网页）；不给时照旧生成。续问时忽略。 */
conversationId?: string;
/** harness 的事件，原样转发 `Harness.subscribe`。 */
onAgentEvent?: (event: AgentEvent) => void;
/** 会话日志新写入的条目（带 seq），按写入顺序。 */
onLogEntries?: (entries: readonly SessionEntry[]) => void;
```

- `onLogEntries` 由包一层会话日志实现（`append` 返回已编号的条目后通知），引擎其余逻辑不变。
- 续问时先读出的旧条目不经 `onLogEntries` 再发：网页从记录里拿。

### 服务端运行：`src/server/qa-service.ts`（新）

一轮问答在服务进程里跑，不绑在 HTTP 连接上：页面刷新、离开问答页都不打断，回来接着看。写法照 `ingest-service.ts`（启动、收口、服务停止的顺序）。

```ts
interface QaService {
    call<M extends QaMethod>(method: M, params: unknown): Promise<QaOutcome<M>>;   // qa.start、qa.stop 等
    /** 订阅一个对话的运行：先补发这一轮已有的日志条目，再推后面的事件与条目，一轮结束时推 turn_end。没有运行中的轮次时立即推 idle。 */
    subscribe(book: string, conversation: string, listener: (frame: QaFrame) => void): () => void;
    close(): Promise<void>;
}
type QaFrame =
    | {type: "turn_start"; turn: number; question: string}
    | {type: "log"; entries: SessionEntry[]}
    | {type: "event"; event: AgentEvent}
    | {type: "turn_end"; result: QaTurnResult; recordSaved: boolean; notSaved?: {reason: string; message?: string}}
    | {type: "idle"};
```

- 运行中的轮次按 `书/对话 id` 登记在内存里，记下这一轮已写的日志条目（补发用）；事件不留底（流式的半截文字断线后看不到，等下一条日志条目，与 `createHarnessTranscript` 的分工一致）。
- 一个对话同一时间只跑一轮：再发返回 `qa_busy`；不同对话可以同时跑。命令行同时续问同一个对话照旧由保存时核对轮数判冲突（qa 输出 25）。
- 每次 `start` 重新读配置文件：设置页改了，下一轮生效。
- 停止：`qa.stop` 经 `AbortSignal` 取消，按引擎现有规则记为“中断”。服务停止时先关门（新的 `start` 得到 `qa_busy`），再取消全部运行中的轮次、等它们保存完。
- 删除书、删除对话时先停这个对话的运行（同 `ingest-service` 的 `stopLocal`）。

### 合同与路由：`src/contract/contract.ts`、`src/server/http.ts`

新增方法（`effect` 照现有写法）：

| 方法 | 输入 | 输出 |
|---|---|---|
| `qa.list` | `{book}` | 对话一行一个：id、首问、轮数、最后一轮状态、P、做法、开始与更新时间、是否运行中 |
| `qa.get` | `{book, id}` | 记录（各轮的结果、没核实的出处）与会话日志的全部条目 |
| `qa.start` | `{book, question, conversation?, mode?, at?}` | `{conversation, turn}`；`mode`、`at` 只在新对话时用，缺省用查看器传来的阅读位置 |
| `qa.stop` | `{book, conversation}` | 空 |
| `qa.remove` | `{book, id}` | 空；运行中先停 |
| `config.get` | 空 | 配置、文件路径、密钥环境变量在服务启动时有没有值、内容摘要 |
| `config.set` | `{config, expect}` | 新的摘要；文件被命令行改过（摘要不同）返回 `config_conflict` |
| `config.test` | 空 | 复用 `src/qa/probe.ts` 的结果 |

- 流式路由 `GET /api/qa/events?book=&conversation=`：要登录态，帧是 `QaFrame` 的 JSON；连接断开时退订；每 20 秒一条注释帧防代理断开。
- 密钥不出现在任何响应里（qa 输出 17）。

### 网页：`src/web`

- **路由**：书里加页面 `qa`（`host/book.ts` 的 `PAGES`，导航在“原文”之后），地址 `/book/<id>/qa?c=<对话 id>`；加 `/settings`。
- **`pages/QaPage.vue`**：
  - 宽屏左栏 `AgentSessionList`（`labels` 把“会话”叫“对话”，`header` 保留新建），平板与手机收进顶栏的“对话”下拉（nb-ui `Popover`），选中或新建后关下拉；每分钟更新 `now`。
  - 主区顶上写这个对话的 P 与做法；P 早于查看器当前位置时用提醒色写明（决定 9：不拦不藏）。新对话写“按你现在的位置 X 回答”。
  - `AgentConversationView`：`processDisclosure: "live"`、`header: false`；输入框的模式是“图当目录”“全读”，只在新对话时能选；`canMutateHistory: false`（不放 rewind 等按钮）；运行中能停。
  - 页面里 `provideMarkdownHost`：缺省分类，出处是 `paragraph://章.段`。
- **`qa/`（新目录）**：
  - `conversation.ts`：一个对话的数据源。`qa.get` 的日志条目先喂 `createHarnessTranscript`，再连 SSE，`log` 帧喂 `applyLogEntry`、`event` 帧喂 `applyEvent`；断线重连时适配器按 `seq` 去重。运行状态以服务端为准（`qa.list` 的“运行中”与 `turn_start`、`turn_end`、`idle` 帧）。给最终回复加“没核实的出处”附注：第 N 轮对应日志里第 N 个用户提问开始的那一轮，换成新消息对象并按依据缓存。单测覆盖合成、补发不重复、附注挂对轮次。
  - `tools.ts`：工具登记，照草稿的 `story-tools.ts`：查询工具都归 `explore`，`groupPhrase` 按这一组的调用写（“读了第 33–37 章”）；`answer` 是 `node` 加 `outcome`，退回时 `summary` 写“退回：原因”。注册表只用 `builtinRolesContribution`、`builtinComposerContribution`、`builtinMessageActionsContribution` 加这份（内置工具的 `read` 与 nb-story 的同名）。
  - `AnswerCard.vue`：决定 8。结论类型徽标、结论、“谁知道什么”的表或分点、依据出处常显；说明与覆盖范围收起，点“详细”展开。出处与人名经现有的抽屉打开（已定的取舍 2、3）。
  - `StoryMarkdown.vue`：包一层 `nb-markdown` 的 `MarkdownDisplay`，显示前把正文里“章.段”“章.段—章.段”改写成 `[38.12](paragraph://38.12)`（代码与已有链接里不改），点击的 `reference` 打开原文抽屉。
  - 没核实的出处的条目渲染器（`customType: "nb-story.unverified-refs"`）：提醒色一行，出处可点。
- **`shell/SettingsPage.vue`**：`SchemaForm` 画 `src/qa/config.ts` 的 schema（补 `x-form`：字段名、说明、分组）；密钥一项只写变量名，旁边标“已设置”或“没有值”；保存带 `expect`，冲突时提示重新载入；“测试连接”调 `config.test`。书架右上角与书里顶栏的菜单各加一个入口。
- **换手写控件**（决定 5）：`BookFrame.vue` 的浮动抽屉与手机导航换 nb-ui `Drawer`；`SearchBox.vue` 的浮层换 `Popover`；`story-table` 换 `Table`；`PageState`、`PagedList`、`BookShell` 的重试换 `Button`、加载中换 `Spinner`。`Table` 不支持 `RecordsTable` 的吸顶分组时这一处保留并写明原因。外观有变化的地方截图核对。

## Spec 与文档改动

- `story/viewer.md`：删掉“不做问答”；追加问答页（版式、过程、答案卡片、阅读位置不同的对话、出处与人名的打开）与设置页的输出；地址形状加 `qa` 与 `/settings`；验收加问答页与设置页的组合场景。
- `story/qa.md`：边界一节补网页入口（服务端运行、一个对话一次只跑一轮、离开页面不中断、服务停止记为中断）；失败码加 `qa_busy`；问答记录一节补网页的列表、查看与删除和命令行是同一份。
- `story/cli-skill.md`：`config` 一节写明网页设置页改的是同一份文件，冲突时 `config_conflict`。
- `docs/modules/monorepo-boundaries.md`、`packages/AGENTS.md`：nb-story 的依赖加 `nb-agent-ui`、`nb-markdown`、`nb-form`。

## 切片

每片单独提交、自跑验证。

1. **引擎与服务端**：`AskInput` 三项；章数上限改为正常结果（已定的取舍 1）；`QaService`；`qa.*`、`config.*` 方法；SSE 路由。合同测试用 `testing/openai-endpoint.ts` 的脚本端点：订阅补发与去重、停止、`qa_busy`、服务停止时中断并保存、删除时先停、`config_conflict`、密钥不出现在响应里。验证：nb-story `typecheck`、`test`。
2. **问答页**：路由与导航、`QaPage`、`qa/` 下的数据源与登记、答案卡片、`StoryMarkdown`、附注。单测：对话合成与附注；e2e 新加 `qa.e2e.ts`（脚本端点，子进程起服务）：问一题看过程逐步展开、交卷后收成摘要只露答案、点出处开抽屉、追问、停止、刷新后接着看、阅读位置早于当前的对话照常显示、手机宽度的“对话”下拉。验证：加 nb-story 全量 e2e。
3. **设置页**：`x-form` 提示、页面与入口；e2e：改字段保存、命令行改过后保存报冲突、测试连接。
4. **换手写控件**：逐处替换，跑查看器全量 e2e，截图对照。
5. **收尾**：Spec 的实现合同与证据；真实模型冒烟一次（网页里问一题、追问一题、中途停止一次、刷新接上）；实现审查。

第 1、2 片互相依赖（接口与页面），两片都完成后才合入 master。

## 验收映射

切片 1、2 落 Spec 时写入编号。先按能力列：

| 行为 | 覆盖 |
|---|---|
| 新对话 id 由调用方给、事件与日志条目转发 | `engine.test.ts` |
| 服务端运行、一次一轮、停止、服务停止记为中断、删除先停 | `qa-service.test.ts` |
| SSE 补发、去重、登录态 | `server.test.ts` |
| 配置读写、冲突、密钥不出现在响应里 | `server.test.ts` 的 `config.*` |
| 对话合成、附注挂对轮次 | `qa/conversation.test.ts` |
| 问答页的问、过程、答案卡片、出处、追问、停止、刷新接上、阅读位置、窄屏下拉 | `qa.e2e.ts` |
| 设置页的保存、冲突、测试连接 | `qa.e2e.ts` 或 `settings.e2e.ts` |
| 换控件后查看器行为不变 | 现有查看器全量 e2e |

## 验证

- 自动：nb-story `typecheck` 与 `test`；nb-story 全量 e2e（先停掉多余的服务）。
- 手动：`nbstory serve` 用真实模型问一题、追问一题、中途停止一次、刷新接上。
- 未验证的边界：多个标签页同时看一个运行中的对话只做合同测试；手机宽度只保证能用（同查看器）。

## 不做与风险

- 不做：主应用接入；对话改名；分支、编辑历史、附件、命令；多个模型配置；会话列表的筛选与搜索（`nb-agent-ui` t11）。
- 风险：
  - 设置页能改 `baseUrl`，密钥会发到新地址：和命令行改配置的权限相同，服务只听本机、要登录，在 Spec 的信任边界写明。
  - 一轮跑几分钟，期间服务重启丢掉这一轮，按中断记录。
  - `Table` 可能改变现有页面外观：第 4 片逐处截图。

## 已定的取舍

开发者 2026-10-23 按推荐定（README 决定 14 到 16）：

1. 超出章数上限被拒的读原文不算失败：引擎返回正常的工具结果（写明没读、已到上限），qa 输出 5 改写，并入切片 1；摘要不再报失败，模型行为不变。
2. 依据出处常显一行，放不下时截断并写“等 N 处”，全部出处在“详细”展开后的说明里。
3. 答案里的人名由问答页按名字查（`entities.list` 的 `query`，P 以内），找不到或重名时不做成链接；不改 `answer` 的参数形状。
