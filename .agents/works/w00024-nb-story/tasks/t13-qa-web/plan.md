# t13 实施计划：网页问答页与设置页

2026-10-23 第 3 版：按第 2 轮设计审查修订，并对齐审查期间已实施的部分（决定 19）。第 2 版：10-21 的初稿里“对话视图包”“nb-ui 新零件”两节由 w00019 做完（`nb-agent-ui`），Markdown 由 w00025 t16 的 `nb-markdown` 提供，换手写控件拿到搁置的 t14（决定 17）。本计划只做问答页、设置页、服务端运行与接口。

## Context

开发者要把内置问答接进网页查看器，当作 neuro-book 主应用接入 Agent 对话的预演（[README](README.md) 决定 1、2）。版式与注意力排序已定（决定 6 到 10），对话视图用 `nb-agent-ui`（决定 11），Markdown 显示与输入框用 `nb-markdown`（决定 13），三条取舍按推荐（决定 14 到 16）。

现状与它带来的约束：

- 问答只有命令行入口：合同里没有 `qa.*` 方法，服务端没有流式接口（抽取进度靠 `ingest.status` 轮询）。
- 引擎 `askQuestion`（`src/qa/engine.ts`）的会话日志在内存里（`createMemorySessionLog`），一轮结束才与记录成对写盘。新对话的第一轮在结束前磁盘上什么都没有；服务异常退出时这一轮整个丢失（qa 的“强行结束”规则不变）。
- 有的失败轮在写用户消息之前就结束（缺密钥、开始前已取消），日志里只有一条 `run_end`：按“第 N 个用户提问是第 N 轮”对轮次会错位（审查实测）。
- harness 的事件里，provider 回显的密钥只在 `message_end` 被遮盖，原样转发会把密钥推到网络上（审查实测）；`message_update` 每条带两份到当前为止的完整消息，原样推送随长度平方增长。
- 命令行可以同时续问同一个对话（保存时按轮数判冲突，qa 输出 25）：两边各自从同一份日志恢复，新条目的 `seq` 相同、内容不同，不能按 `seq` 合并。
- `saveQaConfig` 的临时文件名只按进程号区分；整份配置的校验不拒绝误贴的密钥（这条在命令行的字段编辑层）。
- `nb-agent-ui` 已有网页要的：`AgentSessionList`、`processDisclosure: "live"`、结果节点 `outcome` 与退回一行、附注与条目渲染器、`createHarnessTranscript`（日志为准，事件只作运行中的临时显示，按 `seq` 去重，没有重置接口）。
- w00019 t14 的静态稿（`.worktree/w00019-t14-drafts` 的 `src/web/drafts/qa/`）可参照工具登记与答案卡片，接口是旧版。

依据：[`story/qa.md`](../../../../../docs/specs/story/qa.md)、[`story/viewer.md`](../../../../../docs/specs/story/viewer.md)、[`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)、[`ui/markdown-display.md`](../../../../../docs/specs/ui/markdown-display.md)、[`ui/forms.md`](../../../../../docs/specs/ui/forms.md)；两个包 README 的宿主接入。

工作方式：代码在新 worktree `.worktree/w00024-t13-qa-web`（分支 `feat/w00024-t13-qa-web`，从 master 拉出）。Spec 与记录在主工作区改。审查：引擎、服务端与配置派 omp，网页派 Sonnet。真实模型只做最后一次冒烟。

## 技术选型

- 流式通道：SSE，经 `StoryClient` 新加的 `subscribe`，页面不直接碰网络（viewer 的边界条款）。只有一种无名事件，`data` 是 `QaFrame` 的 JSON；心跳是注释行。浏览器端用 `fetch` 读流、`eventsource-parser` 切事件（新依赖，记进待确认清单）：`EventSource` 拿不到状态码、出错会自己重连（第 2 轮网页第 20 条）。否决 WebSocket：只要服务端推。
- 配置写入的跨进程互斥：本包已有的 `platform/flock.ts` 的 `tryLock`，配置层异步重试（每 50 毫秒，最多 5 秒），锁文件是同目录常驻的 `.config.json.lock`。
- 设置表单：`@notnotype/nb-form/vue` 的 `SchemaForm`，分组用它的 `layout`，提示用 `x-form` 已有的键。
- 对话视图与 Markdown：`nb-agent-ui`、`nb-markdown`。
- 网页的纯逻辑写成 `src/web/qa/*.ts` 的纯函数，`bun test` 覆盖（nb-story 没有 DOM 测试环境，组件行为靠 e2e）。

## 关键设计

### 引擎：`src/qa/engine.ts`、`src/qa/read-ledger.ts`、`src/core/qa-records.ts`

- `AskInput` 加：
  - `conversationId?: string`：新对话用调用方给的 id（服务端用 `newQaRecordId()` 生成，格式与记录层一致），续问时忽略；
  - `onAgentEvent?: (event: QaAgentEvent) => void`：见下面的“推给网页的事件”；
  - `onLogEntries?: (entries: readonly SessionEntry[]) => void`：会话日志新写入的条目。
- 观察者与运行隔离：`onLogEntries` 由包一层会话日志实现，在底层 `append` 返回已编号条目之后调用，回调抛错只记一条诊断、不让 `append` 失败（否则 harness 会把会话判坏，审查实测）；`onAgentEvent` 同样包在 try 里。
- 每一轮在记录里记下它在日志里的起点：`QaTurn` 加 `logFrom: number`（这一轮开始前日志的长度加一）。附注、轮次与日志的对应都按它，不数用户提问。旧记录没有这个字段，按“第 N 个用户提问”退回，并接受旧形状里的错位（只显示）。
- 推给网页的事件（`QaAgentEvent`）：只转适配器用到的几种（`agent_start`、`agent_end`、`message_start`、`message_update`、`message_end`、`tool_execution_start`、`tool_execution_update`、`tool_execution_end`），`message_update` 去掉 `assistantMessageEvent`、只留当前消息；所有消息快照里的错误正文经 nb-harness 已有的遮盖（`redact.ts`）处理，不带 provider 原始错误字段。合同测试扫描真实 401 回显下每一帧序列化后的文字，不含假密钥。
- 章数上限（决定 14）：`ReadPlan` 的拒绝加稳定的 `code`（`not_found`、`out_of_range`、`reversed`、`beyond_position`、`chapter_limit`），只有 `chapter_limit` 返回正常的工具结果（写明没读、已到上限、可以重读已读的章），其余照旧是工具错误。改 qa 输出 5、场景 2 与 14 的判据与对应测试：断言没有段落、已读集合不变、同一批只有一次真的读到、旧章照常可读、先按 P 裁再算上限、引用被拒的章照旧退回；补“反复超限不绕过上限”。不再写“模型行为不变”（当前 provider 不把 `isError` 送给模型，但没有用真实模型验证）。
- 出处的认法抽到纯模块 `src/contract/refs.ts`（`REF_IN_TEXT`、逐字 NFKC 并记原文位置、范围统一成“—”的标准写法），引擎与网页共用。
- 一轮分两步（第 2 轮 omp 前一段第 6 条）：`prepareQuestion(input)` 读配置、书、位置、全读原文、续问的记录与日志并建好 harness，开始前的错误都从它抛出；返回的 `PreparedQuestion` 带 `id`、`turn`、`logFrom`、`at`、`mode`，之后二选一：`run()` 或 `abandon()`。`askQuestion` 是两步连着调。
- `withoutFullText(entry)`：全读对话的第一条用户消息换成问题加“已附阅读位置以前的全部原文，共 N 段”，网页拿到的日志都经过它；存盘的日志不变。
- 答案与一轮的 schema 搬到不碰 node 的 `src/contract/qa-record.ts`，记录层、接口合同与网页共用。

### 服务端运行：`src/server/qa-service.ts`（新）

一轮问答在服务进程里跑，不绑在 HTTP 连接上。

- **开始**：同步核对门与“这个对话已有一轮”（准备中或运行中，`qa_busy`），登记“准备中”后才 await；读配置、`prepareQuestion`。准备失败作为请求的错误返回，不留运行。准备完发现门已关（删除、停服在准备期间开始）就 `abandon()` 并报 `qa_busy`。准备成功才登记运行（`runId`、`turn`、`baseTurns = turn - 1`、`logFrom`、问题、P、做法、开始时间），后台 `run()`，返回 `{conversation, runId, turn}`。准备期间写下的会话快照条目先留着，登记时交给运行。
- **结束后保留**：`ended` 的运行留在表里，直到这个对话下一轮开始、对话或书被删、或服务停止。保存成功后清掉它的条目（记录里有了）；没保存时它是这一轮唯一的来源（`saved: {ok: false, reason, message?}`）。
- **推送**：订阅同步送出 `snapshot`（运行与已写条目；没有运行时 `run: null`），没有运行或已结束时随即结束这条流。运行中按发生顺序推 `log`、`event`，最后是 `ended`。`message_update` 合并成每 100 毫秒最多一帧，任何别的帧之前先送积着的那一帧，结束时清掉定时器。送帧抛错只退订那一个。
- **门**：删除对话关这个对话的门，删除书（HTTP 层把 `book.remove` 整个包在 `exclusive(book, …)` 里，服务里删书只有这一个入口）关这本书的门，停服关全部；关门后取消并等待范围内准备中、运行中与保存中的轮次，再删、再停。
- **停止**：`qa.stop` 只停已开始运行的（准备中的页面还拿不到），按引擎规则记为中断。
- **停服**：OMP 一被导入就接管 SIGINT、SIGTERM、SIGHUP，`serve` 改经 nb-harness 新加的 `onProcessTermination` 收口：停抽取与问答、等保存完、撤销登记、停监听，退出码照旧 0（第 2 轮 omp 后一段第 1 条）。
- **HTTP**：`GET /api/qa/events?book=&conversation=`，在登录校验之后；`server.timeout(请求, 0)` 关掉 Bun 默认 10 秒的空闲超时，RPC 设 120 秒（测试连接最多等 60 秒）；每 20 秒一条注释心跳；每个连接积压超过 2 MiB 就断开（页面重连补齐）。
- **每次开始重新读配置**：设置页改了，下一轮生效。

```ts
type QaFrame =
    | {type: "snapshot"; run: QaRunView | null; entries: SessionEntry[]}  // 订阅时的第一帧
    | {type: "log"; runId: string; entries: SessionEntry[]}               // 按 seq 递增
    | {type: "event"; runId: string; event: QaAgentEvent}
    | {type: "ended"; run: QaRunView};                                     // result、saved
```

### 合同与路由：`src/contract/contract.ts`、`src/server/http.ts`

独立的 `QA_METHODS`（不进 `STORY_METHODS` 与 `storyContract`），`ViewerMethods` 合并它；HTTP 按方法表分派查询、抽取、问答三类。

| 方法 | 输入 | 输出 |
|---|---|---|
| `qa.list` | `{book}` | `{conversations, broken}`：一行一个对话（id、首问、记录轮数、最后一轮状态、P、做法、开始与更新时间、`run: {runId, state, saved} \| null`），合并只在内存里的首轮；读不成的记录单列（id、原因） |
| `qa.get` | `{book, id}` | `{record, log, continuable, run}`：`record` 只在首轮还没保存时为 null；`log` 是 `{ok: true, entries}` 或 `{ok: false, problem}`；`continuable` 为假时写原因（旧形状、日志读不成、首轮没保存） |
| `qa.start` | `{book, question, conversation?, mode?, at?}` | `{conversation, runId, turn}`；开始前的失败是方法的错误（`qa_unconfigured`、`full_read_unavailable`、`qa_not_continuable`、`qa_record_not_found`、`position_out_of_range`、`qa_busy`） |
| `qa.stop` | `{book, conversation}` | 空 |
| `qa.remove` | `{book, id}` | 空；命中运行先停、等保存再删；只有运行没有记录也算删成功；两者都没有是 `qa_record_not_found`；损坏的记录也能删 |
| `config.get` | 空 | 三态：`absent`（给起始配置）、`valid`（配置）、`invalid`（只给原因，不回原文）；都带 `digest`、`path`、`keys`（变量名到“服务进程里有没有值”） |
| `config.set` | `{config, expect}` | `{digest, path, keys}`；校验不过是 `invalid_params`（说明不带原值），摘要对不上是 `config_conflict` |
| `config.test` | 空 | `{ok, model, thinking, ms, error}`，最多等 60 秒，错误已遮盖 |

- 失败码的 HTTP 状态：`qa_busy`、`config_conflict`、`qa_not_continuable` 为 409。
- 任何响应、任何帧里都没有密钥（qa 输出 17），合同测试逐帧扫描。

### 配置写入：`src/qa/config.ts`、`src/qa/config-schema.ts`（新）、`src/cli/config.ts`

- schema 拆到不碰 node 的 `src/contract/config-schema.ts`（导出 schema 与 `x-form` 提示），`config.ts` 与网页都引它。
- 三处 `apiKeyEnv` 的“只能是变量名、误贴密钥拒绝且不回显”下沉到整份配置的校验，文件读取、命令行与网页共用；不认识的字段拒绝。变量名另外拒绝像密钥的写法（常见前缀、32 字以上无下划线的长串），只防已知形状（第 2 轮 omp 前一段第 7 条）。
- 摘要是文件原字节的 sha256，文件不在是 `absent`；`expect` 为 `absent` 时只能新建。不做规范化：手改空白也算改过，只会提示重新载入（待确认清单）。
- 命令行 `init` 在提示之前记下摘要，写入时带 `expect`；不在提示期间持锁。
- 所有程序写入（命令行 `init`、`set`、`unset` 与网页 `config.set`）共用一把按配置路径的跨进程锁：锁内重读、比对 `expect`（网页）、校验、写带随机后缀的临时文件、改名。手改文件不参与锁，只能尽力发现（写明）。
- `config_conflict`：`expect` 与锁内重读的摘要不同；页面提示重新载入，命令行退出码 1。

### 网页：`src/web`

- **依赖与样式**：`package.json` 加 `nb-agent-ui`、`nb-markdown`、`nb-form`；`app.css` 在 nb-ui 之后导入两个包的 `tailwind.css`；问答页与设置页按需加载，编辑内核与解析器不进其他页面的首屏（看构建分块）。
- **路由**：书里加页面 `qa`（导航在“原文”之后），地址 `/book/<id>/qa?c=<对话 id>`；加 `/settings`，书架右上角与书里顶栏的菜单各一个入口。
- **`StoryClient.subscribe(book, conversation, {frame, end})`**：`fetch` 读流加 `eventsource-parser`；401 走已有的 `onUnauthorized`（viewer F1）；流正常结束报 `closed`，连不上或断开报 `dropped`。重连由数据源决定，客户端不自己重连。
- **`pages/QaPage.vue`**：
  - 版式：按外壳的宽度档（`book.tier`），宽屏时左栏放 `AgentSessionList`，否则收进顶栏的“对话”下拉（`Popover`，内容给 `max-height` 与可滚动的容器；在真实页面看悬停与选中的材质，必要时给 nb-agent-ui 加 `surface`，见 w00019 待确认第 6 条）。下拉在选中或新建后关。列表 `labels` 把“会话”叫“对话”，每分钟更新 `now`。
  - 顶栏：首问、P 与做法；阅读位置两个方向都写（决定 9）：对话的 P 晚于查看器位置时提醒色写“这个对话读到 X，晚于你现在的位置，答案可能含后文”，早于时中性色写读到哪里。运行中有独立的“停止”按钮（输入框有字时它的停止按钮会消失）。删除这个对话的入口见“待确认”。
  - 对话视图：`processDisclosure: "live"`、`header: false`；`ctx.run` 用服务端的运行状态；读对话中、读不到给 `availability`；提示（没配置、没保存、基础不同、只按记录显示、不能续问、开始失败）由页面在视图上方用 nb-ui `Banner` 画（视图的连接状态与可用性横幅还没实现，第 2 轮网页第 2 条）。输入框的模式只在新对话时可选；草稿按对话各存一份，换对话时给新的草稿版本；新对话受理后草稿带到这个对话下。地址里的对话 id 是 `c`，只进地址、不进存下的状态。
  - 页面实现的 action：`composer.submit`、`composer.stop`、`composer.draftChanged`、`mode.set`、`session.select`、`session.create`、`sessions.refresh`、`reference.open`（`paragraph://` 先解码再按标准写法开原文抽屉，`entity://` 开人物卡）、`link.open`、`message.copy`、`tool.copy`（答案卡片复制成文字）；其余忽略。不登记内置输入框登记（没有 `/` 命令）。
  - 列表：看着的一轮结束时重取，有运行时每 5 秒；`now` 每分钟更新。
  - `qa.start` 的失败留在输入框上方一行（草稿不清）；`recordSaved: false` 在对话顶上写“这一轮没有保存”与原因。
- **`qa/source.ts`：一个对话一个数据源**（带 `dispose()`，每个回调先核对自己还是当前这一次加载）：
  1. `qa.get`；运行要接在记录后面时（运行中，或结束了没保存，且 `baseTurns` 等于记录的轮数）订阅；已保存的运行不再管它；基础不同只标 `detached`，页面写明不会保存。
  2. 转录按轮分开（`qa/turn-transcripts.ts`）：记录各轮的 `logFrom` 加运行的 `logFrom` 是各份的起点，条目按 seq 落到它那一轮，事件只给最后一轮；旧记录有一轮没有 `logFrom` 就一份到底（第 2 轮 omp 后一段第 4 条）。
  3. 看着运行结束（`ended`）就重读、换新的转录；订阅时快照里的运行已结束并保存，同样重读一次；已结束没保存的，拿到快照条目就停。
  4. 推送断开或被服务端断开：按 1、2、4…最多 15 秒退避重读；同一个运行还在跑就沿用原转录。
  5. 分轮的补充（补提问、乐观提问、附注、按对象缓存）由 `qa/turns.ts` 做；日志读不成时按记录合成（`qa/record-messages.ts`）。
  6. 一阵子到的帧合到下一次画面才算一次消息。
- **`qa/tools.ts`**：查询工具都归 `explore`，`groupPhrase` 按这一组的调用写（“读了第 33–37 章”）；超出章数上限的读原文现在是正常结果，摘要写“已到章数上限，没读”；`answer` 是 `node` 加 `outcome`，退回时 `summary` 写“退回：原因”。注册表只用 `builtinRolesContribution`、`builtinMessageActionsContribution` 加自己的输入框登记与这份。
- **`AnswerCard.vue`**（决定 8、15）：结论类型徽标、结论、“谁知道什么”的表或分点常显；依据一行分三格：“依据”标签（不收）、出处区（`flex: 1 1 0`，按宽度量出放得下几个，其余换成预留宽度的“等 N 处”）、“详细”按钮（不收），个数只随宽度变；说明、覆盖范围与全部出处收在“详细”里。卡片里各段文字的出处同样改成可点。
- **人名**（决定 16）：去掉括号里的称呼后按名字调 `entity.card`（核心的精确解析，重名报 `entity_ambiguous`），唯一时做成链接；按书、查看器位置、数据版本与名字缓存，同时要的共用请求；“读者”这类固定词不查。问答页经注入（`QA_NAME_LOOKUP`）交给答案卡片。
- **出处**：`StoryMarkdown.vue` 单根，属性原样转给 `MarkdownDisplay`（端口的 `onActivate` 属性接到它的 `activate` 事件；`qa/ports.typecheck.ts` 对照端口），显示前改写“章.段”为 `[38.12](paragraph://38.12)`：用 `contract/refs.ts` 的同一条规则，只改词法器认的纯文字；流式时文末没写完的出处先不改。`DrawerSource` 认跨章的出处（第 2 轮网页第 8 条）。答案卡片里的文字（结论、分点、说明）同样把出处画成可点的。
- **抽屉的位置**：出处与人名的抽屉按查看器的位置打开（现有行为）：对话的 P 晚于查看器位置时，出处得到“还没读到，拨到第 N 章”，人名得到不存在的提示。写进 viewer.md。
- **没核实的出处**：条目渲染器（`customType: "nb-story.unverified-refs"`），提醒色一行，出处可点。
- **`shell/SettingsPage.vue`**：`SchemaForm` 画 `config-schema.ts` 的 schema，分组用 `layout`；密钥变量名旁按 `keys` 表经 `issues` 写“当前没有值”，改了名的写“保存后才知道”；保存带 `expect`，冲突时提示重新载入；“测试连接”调 `config.test`；`configured: false` 时从起始配置开始。可选对象里有必填字段（`ingest.model`、`ingest.recall.model`）的编辑先在 Lab 试一次。

## Spec 与文档改动

- `story/qa.md`：
  - 输出 5、场景 2 与 14：超出章数上限是正常结果；
  - 问答记录：每轮记 `logFrom`；
  - 边界与兼容：网页入口（服务端运行、一个对话一次一轮、离开页面不中断、正常停止记为中断、异常退出丢失本轮、删除先停）；
  - 失败码加 `qa_busy`、`config_conflict`；
  - 密钥：推给网页的事件与帧同样不含密钥；整份配置的校验拒绝误贴的密钥；
  - 配置写入：程序写入共用跨进程锁，手改文件只能尽力发现。
- `story/viewer.md`：删掉“不做问答”；问答页（版式与宽度切换、过程、答案卡片、阅读位置两个方向、出处与人名按查看器位置打开、失败与未配置、全读的第一条消息）与设置页的输出；地址形状加 `qa` 与 `/settings`；边界条款补“查询客户端有订阅”；实现合同的依赖加 nb-agent-ui、nb-markdown、nb-form；验收加问答页与设置页的组合场景。
- `story/cli-skill.md`：`config` 一节写明网页设置页改的是同一份文件，程序写入共用锁，冲突时 `config_conflict`（退出码 1）；`serve` 在 SIGHUP 上也收口，停服务先停问答。
- `story/viewer.md`：“副作用与数据”补问答记录与配置文件两种写入（第 2 轮网页第 18 条）；问答页的失败表。
- `agent/harness.md` 输出 18、19：推给订阅者的事件同样遮盖；`onProcessTermination`。
- `docs/modules/monorepo-boundaries.md`、`packages/AGENTS.md`、nb-story 的 AGENTS.md：nb-story 的依赖；`src/contract/` 是网页与服务端共用的不碰 node 的部分。

## 切片

每片单独提交、自跑验证。

1. **引擎**：三项输入与观察者隔离、`logFrom`、`QaAgentEvent`（脱敏与裁剪）、`refs.ts`、章数上限的 `code` 与正常结果。测试：`engine.test.ts` 补 id、事件与条目转发、回调抛错不影响结果与保存、`logFrom`（含缺密钥的首轮失败）、401 回显下事件不含假密钥；场景 2、14 改判据。验证：nb-story `typecheck`、`test`。
2. **配置**：`config-schema.ts`、整份校验拒绝误贴的密钥、跨进程写锁与随机临时文件，命令行接入。测试：三处变量名、并发写（两个写同时、命令行在网页比对之后提交）返回的摘要与磁盘一致。
3. **服务端**：`QaService`、`qa.*`、`config.*`、SSE 路由。合同测试（脚本端点）：订阅快照与续推、多个订阅者一个先断、`qa.get` 之后才结束的轮次、首轮运行中的 `qa.list` 与 `qa.get`、保存失败的结果可取回、`qa_busy`、停止、正常停服记为中断、删除与新的 `start` 竞争、别的书不受影响、命令行先保存时网页运行的基础不同、逐帧没有密钥、`config_conflict`。
4. **问答页**：依赖与样式、`StoryClient.subscribe`、`qa/` 的纯函数与数据源、登记、答案卡片、`StoryMarkdown`、人名、附注、页面。另写 e2e 用的问答端点子进程 `testing/qa-endpoint-server.ts`（照 `replay-server.ts`：脚本回复序列，按请求序号放行、挂起，读已收请求），`e2e/fixtures.ts` 加启动函数。单测（纯函数）：转录合成与附注挂轮（含首轮失败没有用户消息、停止在用户消息之前、命令行分支）、全读第一条消息、出处改写的排除项与流式、人名解析（找到、找不到、重名、括号）、出处一行的个数计算。e2e（`qa.e2e.ts`）：问一题看过程逐步展开、交卷后收成摘要只露答案、交卷被退回一行、文字回复带没核实出处、点出处开抽屉、点人名开人物卡、出处“等 N 处”与“详细”、追问、页头停止（输入框有字时）、新对话首轮里刷新接上、续问轮里刷新接上、`qa_busy`、未配置、旧记录只能看、对话 P 晚于查看器位置、手机宽度的下拉、宽屏打开抽屉后左栏收成下拉、其他页面首屏不加载编辑内核。
5. **设置页**：页面与入口。e2e：改字段保存、命令行改过后保存报冲突、误贴密钥被拒、测试连接、首次未配置。
6. **收尾**：Spec 的实现合同与证据；nb-story 全量 e2e；真实模型冒烟一次（网页里问一题、追问一题、中途停止一次、刷新接上）；实现审查。

第 3、4 片互相依赖，四片都完成后才合入 master。

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 新对话 id、事件与条目转发、观察者隔离、`logFrom`、事件不含密钥 | `engine.test.ts` |
| 章数上限是正常结果，其余拒绝照旧（qa 场景 2、14） | `engine.test.ts`、`read-ledger` 测试 |
| 配置的变量名校验、并发写、冲突 | `config.test.ts`、`cli/config.test.ts` |
| 服务端运行、快照与续推、一次一轮、停止、停服（SIGINT、SIGTERM）、删除、首轮只在内存、全读去原文、积压上限、空闲超时、逐帧无密钥、配置三态与冲突、测试连接 | `src/server/qa.test.ts`、`server.test.ts` |
| 准备与运行两步、放弃的一轮不写记录 | `engine.test.ts` |
| 数据源（接与不接、结束后重读、断线退避、按轮分开）、转录合成、附注挂轮、出处改写、人名、出处个数、工具短语 | `src/web/qa/*.test.ts` |
| 问答页的完整流程与失败态、阅读位置、宽度切换、首屏分块 | `qa.e2e.ts` |
| 设置页 | `qa.e2e.ts` 或 `settings.e2e.ts` |

## 验证

- 自动：nb-story `typecheck` 与 `test`；nb-story 全量 e2e（先停掉多余的服务）。
- 手动：`nbstory serve` 用真实模型问一题、追问一题、中途停止一次、刷新接上。
- 未验证的边界：异常退出（只写进 Spec，不测）；手机宽度只保证能用（同查看器）。

## 不做与风险

- 不做：主应用接入；换手写控件（t14）；对话改名；分支、编辑历史、附件、命令；多个模型配置；会话列表的筛选与搜索（`nb-agent-ui` t11）。
- 风险：
  - 设置页能改 `baseUrl`，密钥会发到新地址：和命令行改配置的权限相同，服务只听本机、要登录，写进 Spec 的信任边界。
  - 一轮跑几分钟，期间服务异常退出就丢掉这一轮。
  - 命令行与网页同时续问同一个对话时，网页这一轮不保存（已有取舍），页面写明。

## 已定的取舍

开发者 2026-10-23 定（README 决定 14 到 17）：

1. 超出章数上限被拒的读原文不算失败：引擎返回正常的工具结果，只针对这一种拒绝（并入切片 1）。
2. 依据出处常显一行，放不下时换成“等 N 处”，全部出处在“详细”里。
3. 答案里的人名由问答页按名字查，找不到或重名时不做成链接；不改 `answer` 的参数形状。
4. 换手写控件拿到 t14。

## 已定：删除对话的入口

开发者 2026-10-23 定（README 决定 18）：问答页顶栏放“删除这个对话”，点了弹确认框，运行中先停；损坏的记录在列表里单列一行，同样只能删除。

## 设计审查

2026-10-23 第 1 轮：omp 审引擎、服务端与配置（有效 12 条：重要 10、建议 2），Sonnet 审网页（27 条：重要 14、建议 13）。逐条处理见 [evidences/design-review.txt](evidences/design-review.txt)；第 2 版按它们修订。

2026-10-23 第 2 轮（与实施同时进行，决定 19）：Sonnet 审网页 21 条，omp 审服务端与引擎（被时间上限截停，两段共 18 条，全部“重要”）。逐条处理见 [evidences/design-review-2.txt](evidences/design-review-2.txt)；第 3 版按它们修订，照推荐做的取舍记在 [待确认清单](../../pending-confirmations.md)。
