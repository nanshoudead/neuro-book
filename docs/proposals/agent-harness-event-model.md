---
schema: nbook.proposal/v1
status: draft
created: 2026-10-28
decided: null
supersedes: []
superseded-by: null
specs: []
adrs: []
---

# Agent harness 的事件模型：日志、状态、视图与拦截

本稿给 `nb-harness` 定一个基本模式：日志是事件，状态由日志归约（reduce）而来，请求是状态的视图，调用模型与执行工具是副作用，结果写回日志。Profile 与插件都是“扩展”，只做四件事：归约、反应、视图、拦截。它取代 [w00032 t20](../../.agents/works/w00032-agent-integration/tasks/t20-hooks/README.md) 讨论中按钩子点逐个定义的做法，也改写 [w00032 t05](../../.agents/works/w00032-agent-integration/tasks/t05-profile/README.md) 里 Profile 的上下文机制。

## 问题

接入 Agent 的讨论（w00032 t05、t20，2026-10-28）走到钩子时暴露出几处别扭：

- **同一件事两套机制。** Profile 的 TSX 里有种子、`Appending`、`Reminder`、按请求刷新的数据源、`<Slot>`，钩子也能在同样的时刻往上下文里加东西。规则要写两遍，作者也不知道该用哪个。
- **`Appending` 一边排版一边写日志。** 它既决定消息排在哪，又在每次调用开始时把消息写进日志，Profile 的“组装”与“往历史里加东西”搅在一起。
- **钩子点越加越多，每个点各有一套合并规则。** 第二版方案有十几个点，拦下、改参数、追加内容、继续运行各有字段与合并方式，生命周期却没有说清：钩子挂在哪个状态转换上、状态放在哪、跨点怎样共享。
- **输入的来源很杂。** 一次请求里除了用户的话，还有插件的数据（记忆、文件变更）与程序状态（阅读位置、字数、剩余额度）。它们哪些要写进历史、哪些只对这一次请求有效、回退之后应该是什么样，没有统一的回答。
- **回退、重启、预览要处处对。** 会话是树（t03），回退之后每个扩展的状态都要跟着回去；服务端重启之后要能照日志重建；预览要能不调模型就算出请求。

## 目标与非目标

目标：

- 一个基本模式解释整个 harness：一次运行就是反复地“由状态算出请求 → 调用 → 把结果写回日志 → 归约出新状态”。
- Profile 与插件用同一套扩展接口，Profile 排在最后、地位最高。
- 所有会影响模型所见的状态都由日志归约而来，回退、fork、重启、预览自动正确。
- 请求在发出之前可以被任意修改，但谁改了什么查得到。
- 扩展的状态可以跨生命周期共享，共享经显式导出的只读选择器。

非目标：

- 工具发现与 CodeAct（[t21](../../.agents/works/w00032-agent-integration/tasks/t21-eval-codeact/README.md)）、后台任务与协作（[t22](../../.agents/works/w00032-agent-integration/tasks/t22-background-work/README.md)）。
- 安全加固（t12：第一版的挡板是只读命令白名单与审批模型）。
- 用户级的 shell 命令钩子（类似 Claude Code 的 `hooks.json`），以后再做。
- 多进程扩展：扩展在服务端实例的进程内运行。

## 当前行为与证据

- **master 的 `nb-harness`**：Profile 用 `ProfilePrompt`、`System`、`HistorySet`、`<If tool>` 写成，每次请求前渲染一次；没有钩子（[`agent/harness.md`](../specs/agent/harness.md)）。
- **内核分支 `feat/w00002-harness-kernel`**（按 t02 的决定，代码以它为主体搬到 master）：
  - Profile 宿主可以登记节点、数据源（调用时取一次或每次请求前取一次）与字段，有 `Appending`、`Input`、`Reminder`（when、every、watch、once）、有状态的节点（状态记在 `harness/profile-state` 条目）、种子、`<Slot>`；
  - 会话模块已经是事件溯源的一半：`fold(entries, defineProjection({initial, reduce}))` 做自定义回放，`sessionStatus`、`sessionSettings` 都由日志归约而来；
  - 运行时有工具拦截器、宿主审批回调、运行时级订阅。
- **两条线的循环都套在 OMP 的 `Agent` 上**（`pi-agent-core`；master 的 `packages/nb-harness/src/harness.ts`，分支的 `runtime/session.ts`）。`Agent` 自己维护一份上下文，harness 经 `transformContext` 每次请求前按日志重新渲染、经 `streamFn` 与 `beforeToolCall`、`afterToolCall` 接入。master 的模块头注释写了为此做的等待：OMP 把事件推进流里就往下走，上一批工具结果的 `message_end` 可能还没投递，渲染前要先等它们写进日志。
- **omp**（源码核实，[外部参照](../research/agent-runtime-references.md)的“钩子”一节）：事件钩子 `pi.on(事件, 处理函数)`，处理函数返回结果，没有 `next`；能改写用户输入、替换本次请求的消息、改原始请求体、改写回复、拦下或改写工具调用与结果、让会话继续、取消或接管压缩；处理函数还有一套主动接口（发消息、写自定义条目、换工具集与模型、不进会话的模型调用等）。
- **Claude Code**（官方文档）：33 种钩子事件，只返回声明式的结果；用户提交时不能改写用户的话；只有工具调用前等少数事件能放行。注入的上下文以 `<system-reminder>` 附在用户消息里。
- **LangChain v1** 的 `createAgent` 中间件：节点式（`beforeModel` 等，返回状态更新、由 reducer 合并）与包裹式（`wrapModelCall`、`wrapToolCall`，拿到下一层处理函数）并存。**Vercel AI SDK** 用 `wrapGenerate`、`wrapStream` 加 `transformParams`。
- **Elm 架构**（Model、Update、View、Cmd）与 **LangGraph**（状态、reducer、节点）是同一类思路：状态由事件更新，界面或请求是状态的视图，副作用在边界上执行。

## 方案

本节是第三稿：第二稿经过一个原型（spike）与两位审查者的审查后改写，改动的来由见“原型与审查”一节。接口的写法以 spike 里跑过的为准（`.agents/works/w00032-agent-integration/tasks/t20-hooks/spike/`，`api.ts` 是公开接口）。

### 1. 基本循环

```text
日志（事件） ──归约──▶ 状态 ──视图──▶ 请求 ──调用──▶ 响应 ──追加──▶ 日志
                ▲                                         │
                └────────────── 反应：新的事件 ◀────────────┘
```

循环由内核自己写，不再套 OMP 的 `Agent`；与服务商通信只用 OMP 的 `streamSimple`，由 `nbook.models` 的模型适配器调用（t09，第 5 节）。理由：本稿要求“一条事件的反应全部完成后才算下一次请求”“模型调用可以重试与换模型”“日志是唯一的上下文”，`Agent` 自己的上下文与异步投递的事件和这几条都要对着干，现有的等待逻辑就是证据。代价是内核自己实现并行工具、插话、中止与收口；spike 已把这几样做出最小版本。

一次运行：

1. 用户输入经输入拦截链，作为事件写进日志；全部扩展归约、再反应（可能追加新的事件）。
2. **边界**：运行中到达的外部事实、设置变化、插话，在这里按到达顺序写进日志（第 2 节“单写者”）。
3. 由当前状态算出请求（视图），经模型拦截链；最里层先写 `model_started`，再发给服务商。
4. 回复作为事件写进日志，归约、反应。失败写 `model_failed`，运行以 `error` 收口。
5. 回复里有工具调用时，这些调用是一批：写 `tool_started`，按工具声明的并发执行，全部完成后按调用顺序写结果，再对这一批结果派发反应；回到第 2 步。
6. 没有工具调用时是最终回复：有没送达的插话就回到第 2 步；有扩展显式要求“接着做”就回到第 2 步（连续最多 3 次）；否则写 `run_ended` 结束。

任何一步出错、被中止，运行都写 `run_ended`（`error`、`aborted`）收口；进程崩溃留下的半截运行，重新打开时由 `recover()` 结算（第 2 节）。

### 2. 事件与日志

日志只追加（t03），已经写下的条目谁都不能改。日志记的是事实，模型看到什么由投影决定（第 4 节）：日志里有的不一定进请求，请求里的也不一定原样来自日志。

**事件分三类**，类别只决定缺省投影，Profile 可以改：

| 类 | 例子 | 缺省投影 |
|---|---|---|
| 对话 | 用户消息、助手回复、工具结果、插话、扩展注入的消息（种子、提醒、通知、检索结果） | 按顺序变成消息 |
| 控制 | 运行开始与结束、模型请求开始与失败、工具开始、审批与提问、设置变化、叶子变化、Profile 变化、压缩 | 不变成消息；压缩让历史把它之前的内容换成摘要 |
| 扩展 | 扩展的状态变化、外部事实（“第 3 章被改了”）、插件的自定义记录 | 不变成消息；扩展归约它们，再决定要不要经反应或槽带给模型 |

**内核事件**是固定的一组，导出为常量 `K`（`K.user`、`K.runStarted`……），每种的 `data` 有类型；扩展写不出内核事件。**扩展事件**由 `defineExtension` 的 `events` 声明，类型自动带上扩展 id 前缀（`nbook.history/fileChanged`），带版本（缺省 1）：扩展改了事件含义就升版本，`reduce` 对旧版本按旧含义处理。内核拒绝扩展写不以自己 id 开头的类型（spike 场景 18）。

**因果与幂等**：反应写的事件带 `cause`（引出它的那条事件）与 `depth`（在反应链里第几层）。事件可以带幂等键 `key`：同一来源同一个键只写一次，用于文件监听的重复通知、重连后重发的外部事实、父子会话的结果回流（spike 场景 39）。一个扩展对一条事件的输出是一个整体：有一条不合规矩，这次的全部不写。

**什么时候写进日志**（由内核写，时间不开放）：

| 东西 | 写入时刻 |
|---|---|
| 用户输入 | 输入拦截链走完立刻写；改写过的原文记在 `original` |
| 模型请求 | 发出之前写 `model_started`：请求序号与哈希、视图的输入（`now`、`samples`）、修改记录；失败写 `model_failed` |
| 助手回复 | 流结束时写完整回复 |
| 工具 | 执行之前写 `tool_started`；完成后写结果，拦截改过参数时记实际执行的 `args`，改过结果时记工具原本的 `raw` |
| 插话、外部事实、设置变化 | 运行中到达的，在下一个边界写（见下） |
| 持久的动态内容（提醒、通知、检索结果） | 扩展的反应返回时 |
| 回退、切分支 | 写 `leaf_changed`（session 作用域），重启后照它恢复当前叶子 |
| 临时的动态内容（槽） | 从不写；请求哈希与视图输入在 `model_started` 里 |
| 流式输出的增量 | 从不写；只推给界面（待定项 11） |

**单写者**：一个会话的写入只有一个顺序。运行中，`external()`、`changeSettings()`、`steer()` 不直接写，而是排进队列，在下一个边界（下一次模型请求之前）按到达顺序写入，所以不会插进正在算的请求或正在执行的工具批次（spike 场景 33、34）。

**打开与恢复**：`load()` 先校验日志（id 唯一、seq 递增、父节点在前，版本与格式），再照日志归约，不跑反应；当前叶子取最后一个“path 事件或 `leaf_changed`”指向的节点，不取数组末尾。`recover()` 处理崩溃留下的半截运行：开始执行但没有结果的工具调用写成“结果未知”（工具可能执行了也可能没有），发出但没有回复的模型请求写 `model_failed`，最后写 `run_ended`（`interrupted`）；之后的请求合乎协议（spike 场景 24、28）。

### 3. 状态与归约

为什么用“日志加 reduce”：扩展的状态必须跟着对话路径走（回退到第 3 次发言，提醒计数也回到 3），重启后要恢复，预览与运行要看到同一份。存在内存里，回退与重启都不对；另存状态文件，要给树上每个节点存一份才回得去（那就是又一份日志），日志写成了、状态没写成时两边还会对不上。由日志归约，只有一个真相源，换一片叶子重新归约就对。

**片**：一个扩展可以有多片状态，每片一个作用域：`path(initial)` 跟着对话路径走，`session(initial)` 在树外（会话设置、人设、库结构、工作区焦点这类不随回退变的）。工作区焦点这样“值在树外、送达到哪了跟路径走”的，一个扩展两片就够（spike 场景 15）。

```ts
export const fileNotice = defineExtension({
    id: "nbook.history",
    state: {pending: path<string[]>([])},
    events: {fileChanged: ext<{path: string}>(), notice: conv(), delivered: ext()},
    reduce: {
        // 每片一个归约函数：自己那片、这条事件、自己的事件守卫、同一作用域的兄弟片；返回 undefined 表示不变
        pending: (p, e, ev) => (ev.fileChanged.is(e) ? [...p, e.data.path] : ev.delivered.is(e) ? [] : undefined),
    },
    exports: {pendingChanges: (m) => m.pending},
    react(e, ctx) { /* 第 6 节 */ },
});
```

- **归约只看自己**：归约函数看得到自己那片与同一扩展里同一作用域的兄弟片，看不到别的扩展，也看不到另一个作用域（path 的片若依赖 session 的值，回退时会用到“现在”的值，归约就不确定了）。各扩展的归约互不依赖，谁先谁后结果都一样。
- **返回 undefined 表示不变**：不必写“不认识的事件原样返回”，也就不会因为漏写而把状态变成 undefined。
- **简单的值用 `ctx.set(片, 值)`**：生成一条内核认识的设置事件，归约由内核处理，作者不写归约函数。
- **默认私有，经选择器共享**：别的扩展只能读 `exports` 导出的选择器；插件经声明合并登记它导出了什么，读的一方得到类型，名字拼错是编译错误（spike `typetest.ts`）。同一个 Profile 自带的扩展之间可以读原样（`ctx.own(id)`）。
- **只读**：状态、选择器的结果都是只读的，类型上是 `Readonly`，开发模式下冻结，原地修改直接失败（spike 场景 30）。所有状态变化都经事件。
- **状态不另外存**：总是由日志归约而来。每条事件写入时记下它之后的 path 与 session 状态这一对，反应读的就是这一对（批量写入时每条各有自己的一对，spike 场景 27）。回退、fork 时归约到当前叶子为止的路径；重启后照日志重建；换 Profile 或插件清单时照新的扩展从日志从头重新归约（第 8 节）。
- 扩展在内存里可以有缓存（连接、索引句柄），但缓存不是真相，丢了要能从状态重算。

### 4. 视图：请求怎样算出来

“视图”指整个“状态 → 请求”这一步，只在要发请求和预览时算。它由三样东西一起完成：`core.history` 把日志投影成消息并按时间切成三段，扩展的 `contribute` 往有名字的槽里交内容，Profile 的 `prompt` 是模板，决定这些东西摆在哪。布局只能有一个拥有者，否则谁先谁后会影响结果；要改整个请求的，用模型拦截（第 5 节）。

**请求的形状**与服务商无关，内容是块：

```ts
interface ModelRequest {
    model: string;
    params: {temperature?: number; topP?: number; maxTokens?: number; stop?: string[]};
    headers: Record<string, string>;
    system: Block[];
    messages: {role: "user" | "assistant" | "tool"; content: Block[]; toolCalls?: ToolCall[]; callId?: string}[];
    tools: ToolInfo[];      // spike 里只有名字；产品里带参数 schema 与并发声明（t04，待定项 13）
}
interface Block {text: string; origin: string}   // origin：事件 id、`slot:<名字>` 或 `fixed`
```

块保留来源：模板写的固定文字、扩展交的槽、用户的原话分在不同的块里，相邻的 user 消息不在内核里拼接（服务商要求时由适配器合成一条多块消息），所以缓存比对能按块定位，模型也分得清哪句是用户说的。

**模板的四个节点**，它们取日志的哪一段：

| 节点 | 取什么 | 本轮第一次请求 | ReAct 中途的请求 |
|---|---|---|---|
| `<History />` | 本轮开始之前的全部对话事件（处理过压缩） | 以前各轮 | 不变 |
| `<Input />` | 本轮的用户输入；没有新输入的“继续”运行为空 | 有值 | 仍是同一条 |
| `<Transcript />` | 本轮里除输入之外的对话事件，按日志顺序：持久的提醒、助手回复、工具结果、插话 | 只有持久的提醒 | 越来越长 |
| `<Slot name>` | 扩展交的内容，每次请求现算 | 当前值 | 当前值；上一次的值不留下 |

本轮结束时，这一轮的输入与记录并进历史，下一轮的 `<History />` 里它们的顺序与样子和这一轮相同。

**Profile 的 `prompt`** 签名是 `(input) => TSX`，可选。参数里有 `state`（`own(id)` 读自己扩展的原样、`read(id, 选择器)` 读别人的）、`settings`、`tools`、`model`（能力，t05）、`now`。不写时用缺省布局：

```tsx
<System>{声明里的 system}<Slot name="*" stable /></System>
<History /><Input /><Transcript />
<Slot name="*" volatile />
```

- 只写了 `<History />` 时，`<Input />` 接在它后面、`<Transcript />` 接在 `<Input />`（或包含它的固定消息）后面。
- 单轮模板式的 Profile 可以不放 `<History />`，把 `<Input />` 放进一条固定消息里；输入带的结构化数据（`payload`，例如选区）从 `read("core.history", "input")` 读（spike 场景 5）。
- **文字的拼法**：容器 `<System>`、`<User>`、`<Assistant>` 里每个子节点是一段，段与段空一行；行内 `<P>`、`<Tag>` 里的文字与表达式直接相连（spike 场景 20）。
- **渲染写在 Profile 上**：`render: {事件类型: (e) => 文字 | null}`，对 `<History>`、`<Input>`、`<Transcript>` 一律生效，覆盖扩展给的缺省渲染。节点上只接受 `filter`；写在节点上的 `render` 是模板错误（同一条事件从本轮挪进历史时会变样，缓存失效，spike 场景 22）。

**扩展的 `contribute`** 声明槽与内容写在一起：

```ts
contribute: {
    "word-count": {volatile: true, value: (mine, view) => `本章当前字数：${mine.words}`},
    "sql-schema": {value: (mine) => `<sql_schema>${mine.schema}</sql_schema>`},   // 没写 volatile 是稳定的
}
```

- `<Slot name="*" stable />`、`<Slot name="*" volatile />` 按声明收没有按名字摆的槽；`*` 不写档位是模板错误。
- 同一个槽有几个扩展交内容时按扩展顺序拼接；它们对稳定还是会变说法不一致时写诊断。
- Profile 没摆某个槽：内容丢弃并写诊断；会变的槽被放进系统提示词：写诊断“整段缓存失效”（spike 场景 13）。

**每次请求现取的数据**（剩余额度、阅读位置、选区、当前时间）：

- 扩展声明 `sample: {名字: async (ctx) => 值}`，内核在每次算视图前并发调用一次，值记进 `model_started`，`contribute` 从 `view.sample` 读；`sample` 可以 I/O，不能有副作用。
- 当前时间由内核取，`view.now`，同样记进 `model_started`。
- 预览过去的请求（包括重启之后）用记下的值，不再去取（spike 场景 12、36）。
- 数据要跟着对话路径走、要能回退的（例如本章字数在某次编辑之后是多少），仍在反应里读、写成事件。

**扩展的事件渲染**：扩展给自己的对话事件提供缺省渲染（`render`），例如检索结果在日志里存结构化数据，渲染成 `<memory>…</memory>`；没有渲染的扩展对话事件缺省包成 `<system-reminder>`。

**缓存靠检查，不靠结构**：服务商的提示词缓存按前缀命中。每次请求与同一条路径上最近的那次请求比（回退到别的分支后，另一分支的请求不算），比对的序列从模型、参数、header、工具集开始，再到每个块；找出第一处不同，换算成要重算的 token，超过阈值写诊断并指出是哪个来源变了。

| 写法 | 同一轮里 | 下一轮 |
|---|---|---|
| 会变的槽放在最末尾（缺省布局） | 只丢最末尾的槽 | 只丢最末尾的槽 |
| 会变的内容由反应写成事件（持久的提醒） | 全部命中 | 全部命中 |
| 会变的槽放在 `<Input />` 前面 | 从槽开始往后全部失效，本轮的工具记录每次重算 | 上一轮整段失效一次 |
| 会变的槽放在系统提示词里 | 全部失效 | 全部失效 |

spike 里三轮对话：缺省布局有工具、没工具的轮次重算都是 0；槽放在输入前重算约 4,300 token 并给出诊断（场景 4）。模板写成什么样由 Profile 决定，内核不禁止；单轮任务没有下一轮，把动态内容紧挨着输入放是合理的。token 数是估算，产品里用服务商的分词或明确标为近似。

### 5. 副作用与拦截

有副作用的步骤只有这几样：接受用户输入、调用模型、执行工具、压缩。每样都可以被拦截，形状是包裹式的：

```ts
interface Interceptors<Ctx> {
    input?(input: UserInput, next: (i: UserInput) => Promise<void>, ctx: Ctx): Promise<void | {reject: string}>;
    model?(request: ModelRequest, next: (r: ModelRequest) => Promise<ModelResponse>, ctx: Ctx): Promise<ModelResponse>;
    tool?(call: ToolCall, next: (c: ToolCall) => Promise<ToolResult>, ctx: Ctx): Promise<ToolResult>;
    compaction?(job: CompactionJob, next: (j: CompactionJob) => Promise<CompactionResult>, ctx: Ctx): Promise<CompactionResult>;
}
interface UserInput {text: string; payload?: unknown; attachments?: Attachment[]}
```

- **改**：调 `next` 之前改输入，之后改输出；请求里的模型、参数、header、系统提示词、消息都可以改。改的是上面这个与服务商无关的请求对象，按各家格式转换后的原始请求体不开放（主动接口的收窄）。请求对象是只读的，改要返回新对象，原地修改绕不过修改记录。
- **拦**：不调 `next`。输入拦截返回 `{reject: 理由}`，本轮以 `input-rejected` 结束并记下理由；工具被拦下时返回一个错误结果；模型调用被拦下时可以直接给出一条回复。
- **重试、换做法**：调两次 `next`，或换个参数再调；每一次真实的模型调用与工具执行都进日志。
- **审批**（t06）在工具拦截链的最里层、执行之前判定；扩展的放行只能免掉审批模式本来要弹的询问，盖不过用户配置的拒绝、工具按参数声明的拒绝与只读模式（spike 场景 8）。
- **顺序**：一层套一层，外层是插件，最里层是 Profile（待定项 2）。插件按 `dependsOn` 排序，同一层按 id，结果与插件的激活顺序无关；依赖缺失或成环在装配时拒绝（spike 场景 40）。最终顺序与清单哈希写进 `profile_changed`，重放时同一份日志得到同样的顺序。这个顺序也决定反应追加事件的顺序与同一个槽的拼接顺序。
- **各入口读到的是哪一刻的状态**：

  | 入口 | 状态 |
  |---|---|
  | `reduce` | 这条事件之前的自己那片 |
  | `react` | 这条事件写入之后（path 与 session 这一对） |
  | `sample`、`contribute`、`prompt`、模型拦截 | 这次请求所在的叶子；预览时就是被预览的叶子 |
  | 工具拦截 | 发出这批调用的助手回复所在的叶子；同一批调用看到的世界相同 |
  | 输入拦截 | 运行开始时的叶子 |

- **工具批次与并发**：一个助手回复里的工具调用是一批。工具声明并发（t04）：`shared` 的并行，`exclusive` 的等前面都完成再单独跑；结果按调用顺序写入，反应在整批结果写入之后对每条结果派发（spike 场景 25：3 个读并行、1 个写独占，约 124 ms，串行约 190 ms）。
- **失败**：扩展的反应、`sample`、拦截有时限（缺省 30 秒，可设 `timeoutMs`）。反应与 `sample` 出错或超时：这次结果丢弃，写带扩展 id 的诊断，运行继续；工具拦截出错缺省拒绝这次调用（`onFailure.tool: "ignore"` 改为跳过这一层）（spike 场景 19）。
- **中止**：`ctx.signal` 贯穿反应、`sample`、拦截、模型调用与工具。中止后模型请求写 `model_failed`，没完成的工具调用写“已中止，结果未知”，运行以 `aborted` 收口；之后迟到的结果不写日志（spike 场景 35）。t07 定的宽限期由内核计时。
- **模型适配器**：模型拦截链的最里层是 `nbook.models` 的适配器。它把 `ModelRequest` 转成 OMP 的 `Context` 与 `SimpleStreamOptions`（`signal`、`maxTokens`、`temperature`、`headers`、推理档），调 `streamSimple(model, context, options)`，消费它返回的事件流：文字、思考、工具调用的增量推给界面；`done` 得到完整的助手消息与用量，作为 `ModelResponse` 交回拦截链；`error` 与中止交回失败（带已产生的部分内容）。工具名的 `.` 换成 `__`（t04）在这里做。OMP 内部的重试算同一次逻辑请求，适配器把每次尝试记进诊断（待定项 12）。
- **修改记录**：每次模型调用的 `model_started` 记下哪些扩展改了请求的哪几项与最终请求的哈希；可选的请求录制把真正发出的请求整个另存（待定项 5）。
- **预览也跑模型拦截链**：最里层不发请求，只把请求截下来，所以预览看到的是最终请求；拦截前要做 I/O 的扩展用 `preview: "skip"` 跳过（spike 场景 11）。
- **压缩**（t11）：经压缩拦截链，最里层是压缩方法（就地、摘要模型、shake）。结果是一条压缩事件 `{method, summary, firstKept, tokensBefore, tokensAfter}`；`core.history` 把 `firstKept` 之前的换成摘要、之后的原样保留，种子由 Profile 对压缩事件的反应重写（spike 场景 29）。运行中触发的压缩在边界上做。

### 6. 反应：在事件之后追加新的事件

```ts
react?(e: Entry, ctx): Reaction | Promise<Reaction>;
type Reaction = EventOut[] | {events?: EventOut[]; continue?: boolean} | void;
```

- 反应可以做 I/O（读文件、检索记忆、调一次不进会话的模型），返回要追加的事件：自己的事件用 `ctx.ev.<名字>(data)` 生成，普通的注入消息用 `ctx.message(text)`，改自己的一片用 `ctx.set(片, 值)`。
- 要影响重放的外部输入都经反应变成事件：检索结果写进日志之后，重放与预览不用再去检索。
- **同一条事件的反应看同一份状态**，可以并发执行；全部完成后，追加的事件按扩展顺序写入。一个扩展看不到另一个扩展这一轮刚追加的事件，要等那条事件自己归约、反应时才看到（spike 场景 3：检索耗时随机，8 次写入顺序都一样）。
- **反应全部完成后，才算下一次请求。**
- **“接着做”要显式写**：对最终回复的反应返回 `{events, continue: true}` 才会再请求一次；只写了事件、没写 `continue` 的（例如回复后补一张角色卡），下一次用户发言时才被看到，不会多调模型（spike 场景 17）。连续最多 3 次，每次写诊断“某某要求接着做（第 n/3 次）”。
- **深度上限**：根事件是第 0 层，反应写的是第 1 层，最多写到第 3 层；第 3 层的反应还要写事件时不写，留一条 `reaction_limit` 控制事件（spike 场景 26）。
- 用途：会话创建时写种子；用户发言后追加提醒或文件变更通知；最终回复后追加“接着做”；工具结果之后追加说明。

### 7. 一次运行的数据流

以用户在对话框里说“你好”为例，从点“发送”到收到回复（数据形状是示意）：

1. **浏览器**：Composer 先显示一条“发送中”的用户消息，经远程服务（ADR 0024，WebSocket 上的 RPC，t10）发出 `agent.send({sessionId, text: "你好", clientId})`。
2. **运行控制**（t07）：会话还没加载时，读日志、校验、沿当前叶子归约出状态；空闲就开始一次运行，写 `run_started`；正在运行就按插话或排队处理。
3. **输入**：经输入拦截链，写入 `{type: "user", data: {text: "你好"}}`；全部扩展归约、反应；推给订阅的窗口，界面按 `clientId` 把“发送中”换成正式消息。
4. **边界**：排队的外部事实、设置变化、插话写入。
5. **视图**：并发取 `sample`；`core.history` 投影；各扩展 `contribute`；Profile 的模板摆好位置，得到 `ModelRequest`。
6. **模型拦截链**：从外到里；最里层写 `model_started`（哈希、`now`、`samples`、修改记录），适配器取密钥、调 `streamSimple`；`pi-ai` 按服务商协议转换并发出 HTTP 请求。
7. **流式回复**：适配器消费事件流，增量推给窗口，同一条消息每 100 毫秒最多推一次（t10）；`done` 得到完整回复。
8. **写回**：完整回复由内往外穿过拦截链，写成 `assistant`（带模型、用量）；归约、反应。有工具调用就按批执行，结果写日志后回到第 4 步。
9. **结束**：没有工具调用、没有插话、没有扩展要求接着做，写 `run_ended`，推给窗口；界面用日志里的正式版本替换流式显示的文字。第二句话的请求前缀与第一次相同，服务商的缓存命中。

### 8. 扩展的形状与生命周期

```ts
export const x = defineExtension({
    id: "nbook.history",                 // 稳定的点分名字；装配时检查重复（与来源一起报错）
    tags: ["history"],                   // Profile 按标签排除
    state: {pending: path<string[]>([]), seen: session(0)},
    events: {fileChanged: ext<{path: string}>(), notice: conv()},
    reduce: {pending: (p, e, ev, siblings) => /* 新值或 undefined */ undefined},
    exports: {pendingChanges: (m) => m.pending},
    react(e, ctx) { /* 返回事件，或 {events, continue} */ },
    sample: {/* 每次请求前现取 */},
    contribute: {/* 槽名: {volatile?, value} */},
    render: {notice: (e) => e.data.text},
    intercept: {/* input、model、tool、compaction */},
    timeoutMs: 30_000,
    onFailure: {tool: "deny"},
    preview: "run",
});
```

除了 `id`，其余都可选，扩展用到哪个写哪个。类型从定义里推断：`ctx.mine` 是自己各片的值，`e.data` 在 `is(e, K.user)`、`ctx.ev.notice.is(e)` 之后收窄，`ctx.read` 的选择器名与返回类型来自声明合并（spike `typetest.ts` 里七种写错的地方都是编译错误）。

内核维护的状态（会话设置、工具集、运行状态）经 `ctx.settings`、`ctx.tools`、`ctx.run` 给出，历史经 `core.history` 的选择器（`read("core.history", "input")` 等）给出；不存在“读别人的原样”的通道。

`ctx` 给：自己的片（`mine`）、自己的事件（`ev`）、`set`、`message`、`read`（别人导出的选择器）、`own`（同一 Profile 的兄弟扩展）、`settings`、`tools`、`preview`、`signal`、`file(uri)`（读资源，t08）；主动接口 `complete`（不进会话的模型调用，经 `nbook.models`）、`invokeTool`（走审批）、`ask`（t06）、`compact` 待实现时定（待定项 8）。不给：改工具绑定（t04 归用户）、改会话设置（t09 归用户；按请求换模型经模型拦截做）、定时器与界面（插件自己的入口与贡献点能做）。

生命周期：

```text
扩展：插件激活 → 声明登记 → [每个会话] 装配（检查 id 重复与 replaces 权限）→ 换 Profile 或插件停用时摘下
会话：创建（一次，session_created 带 initial）→ 打开（每次加载进内存，含重启后：校验、归约、recover）⇄ 空闲 / 运行中 / 等用户 → 关闭
运行：受理 → 输入 → 循环[边界 → 请求 → 回复 → 工具批次] → 准备结束 → 结束；出错、中止都收口
一条事件：写进日志 → 全部扩展归约 → 全部扩展反应（追加的事件各自再走一遍，最多 3 层）
```

“会话已创建”“会话已打开”“运行开始”“最终回复”“压缩完成”“运行结束”都是事件，扩展在 `react` 里按类型处理，不另设钩子点。“会话已打开”不进日志，只交给反应。

**换 Profile 或插件清单**（t04 方案 D）：运行收口后，内核换上新的扩展，照日志从头重新归约（新扩展的片也从日志得到，例如中途加一个数发言的扩展，它立刻知道已经发言几次），写 `profile_changed`（新的清单与内容哈希）并派发。旧扩展写的事件留在日志里，没有扩展认它们就不起作用；改了含义的事件靠版本区分（spike 场景 31）。

插件经 `agent.extensions` 贡献点登记（取代 t10 的 `agent.hooks`），按需激活。Profile 用 `globalExtensions: {exclude: [标签]}` 或 `"none"` 排除全局扩展，用户在 Profile 设置里还能单独开关（t20 已定）；单轮模板式的 Profile 应写 `"none"`，否则别的插件的持久消息会进它的请求（spike 场景 5）。

**内核与内置扩展**：缺省行为尽量做成和插件同一个形状的内置扩展；内核只留下必须固定的部分。

| 内核（不可替换） | 为什么固定 |
|---|---|
| 把事实写进日志，单写者与边界 | 崩溃恢复（t07 的收口）、界面显示、回退与审查都要求事实在发生时、按确定的顺序落盘 |
| 循环、运行控制（t07）、事件派发顺序、拦截链的机制、工具批次与并发 | 这是所有扩展共同依赖的时序 |
| 审批在工具链最里层，只读模式 | 用户的安全决定，Profile 与插件都不能绕过（t06） |
| 校验最终请求：工具调用与结果成对、角色顺序、工具名合乎服务商规则 | 投影可以被替换，校验兜底；不合法时预览与运行都报错并指出是哪一条（spike 场景 7） |
| 上限：反应链深度、“接着做”的连续次数、时限 | 防循环、防卡死 |

| 内置扩展 | 做什么 | 怎样定制 |
|---|---|---|
| `core.history` | 历史投影：切成本轮之前、本轮输入、本轮记录三段，处理压缩；状态用持久链表（追加 O(1)），给用户、助手、工具事件缺省渲染 | Profile 用 `render`、`filter`；确实需要时整个替换（`replaces: "core.history"`，必须导出 `before`、`input`、`transcript`，产出的请求照样过内核校验） |
| `core.compaction` | 压缩的触发（对用量的反应）、方法的顺序与失败换下一个、压缩后的公共恢复流程（t11） | 不能替换；方法经 `agent.compactionMethods` 贡献（t10），要求经 Profile 的压缩声明（t05），单次经压缩拦截 |
| `core.title` | 用小模型生成会话标题 | 用户设置里关掉；不能替换 |

`replaces` 只接受 `core.history`，而且只有 Profile 自带的扩展能写；插件写 `replaces` 在装配时被拒绝（spike 场景 9）。替换的只是投影，触发、日志提交、恢复、校验仍在内核与 `core.compaction` 里（spike 场景 6）。

### 9. Profile 在其中

```ts
export const writer = defineProfile({
    id: "writer",
    system: "你是本书的写手，只改正文目录。",       // 不写 prompt 时进缺省布局
    tools: {required: ["read", "edit"], optional: ["grep"]},   // 只声明（t04）
    globalExtensions: {exclude: []},
    render: {/* 事件类型: 渲染 */},
    prompt: undefined,                          // 可选，见第 4 节
    extensions: [seed({...}), writerCore],      // 自带的扩展，排在全局扩展之后，拦截链里在最里层
});
```

- **声明**：身份、`initialSchema`、要哪些工具（必需、可选，t04）、需要的模型能力（t05）、压缩要求（t11）、设置。
- **`prompt`**：模板，可选；TSX 只写组装（`<System>`、`<User>`、`<Assistant>`、`<P>`、`<Tag>`、`<If tool>`、`<Slot>`、`<History>`、`<Input>`、`<Transcript>`），条件与数据从参数里的状态取。
- **`render`**：事件给模型看的样子，Profile 级，对历史、本轮输入、本轮记录一律生效。
- **`extensions`**：Profile 自带的扩展列表，每一项与插件的扩展同一个形状；辅助函数 `seed()`、`reminder()`、`historyExtension()` 各返回一个扩展。

旧节点的去处：

| 旧节点 | 新设计 |
|---|---|
| `System`、`<Slot>`、`History` 布局、`History as="text"`、固定消息 | `prompt` 里 |
| 种子（`HistorySet`） | `seed({on: [K.sessionCreated, K.compaction], messages})`；`messages` 拿到触发它的事件，会话创建时能读调用方给的 `initial`（旧版写手的 `inputContext`） |
| `Appending` | 不需要：输入前后的持久消息是对用户消息的反应，出现在 `<Transcript>` 里 |
| `Input` | `<Input />`，含义是“本轮的用户输入”；结构化数据随 `payload` 来 |
| `Reminder`（when、every、watch） | `reminder({every, watch, render})`；覆盖措辞用它返回的 `ev.reminder.type` |
| `ModelContext`（不落盘、插在本轮之前） | 稳定的放系统提示词里的槽；每次请求现取的用 `sample` 加会变的槽放末尾 |
| 有状态的节点 | 扩展的片 |

### 10. 例子

**每 5 次用户发言提醒一次文风。** `reminder({id, every: 5, render})`；计数与上次提醒的位置由日志归约，回退到第 3 次发言时计数自然回到 3。

**文件变更感知（t13）。** 见第 3 节的 `nbook.history`：外部事实写成扩展事件，下一次用户发言之后送达，写“已送达”；回退到用户发言之前，“已送达”不在路径上，未送达的改动自动恢复（spike 场景 2）。

**记忆检索。** 对用户消息反应：检索，结果作为结构化的对话事件写进日志，经自己的 `render` 渲染成 `<memory>` 块；Profile 排除 `memory` 标签时没有这一步。

**字数不够就接着写。** 写手的扩展在用户发言后与 `edit` 的结果之后重新读字数（`ctx.set`）；对最终回复反应，不到 3000 字就返回 `{events: [请接着写完], continue: true}`（spike 场景 1）。

**剩余额度。** `sample: {balance}` 每次请求前向服务取一次，`contribute` 交到会变的槽，缺省放在请求末尾；预览过去的请求用记下的值。

**写手只能改正文目录。** 工具拦截：`edit` 的路径不在 `project://正文/` 下就不调 `next`，返回错误结果。

**路由插件按问题难易换模型。** 模型拦截：从 `ctx.read("core.history", "input")` 读本轮输入，简单的换成便宜的模型再调 `next`；修改记录写明“model 被 demo.router 改了”（spike 场景 10）。

**审批。** 工具拦截链的最里层判定；要询问时写审批请求事件，运行进入等用户；应答事件写入后继续执行或返回拒绝结果（t06）。

**压缩、Profile 改版、崩溃恢复、中止、插话。** 见第 2、5、8 节。

### 11. 验证：改写旧应用的 `leader.default`

用旧应用的默认主创 Profile（`packages/neuro-book-legacy/assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`）检验本稿。旧版的 `context(ctx)` 每次渲染都读人设文件，返回 `System`（置顶、人设、三项设置、主提示词）、`HistorySet`（只在历史为空时写入的 14 条：11 个 `Import` 与 3 个目录）、`ModelContext`（库结构摘要，不落盘，每次请求插在本轮之前）、`AppendingSet`（七种提醒，每轮写进日志）；另有每 16 次调用跑一次 summarizer。

| 旧机制 | 新设计 | 变化 |
|---|---|---|
| 七种提醒写在 `AppendingSet` 里，每个 Profile 各列一遍（`WorkspaceFocusReminder` 出现在 9 个内置 Profile 里） | 各自归拥有那份数据的插件，作为全局扩展：工作区焦点归宿主、文件变更归 `nbook.history`、模式归 `nbook.agent`、任务归 `todo` 工具所在的插件、已关联 Agent 归多 Agent、提到的 Skill 归 Skill | Profile 里这部分是零行；插件不改 Profile 就能给它加上下文 |
| `TaskReminder` 靠 `stateKey: "agent.tasks"` 字符串读 `customState` | 任务清单由 `todo` 工具的结果归约，提醒和工具在同一个插件里 | 没有跨模块的字符串约定 |
| `ModelContext` 每次请求插在本轮之前，下一轮挪位置，上一轮那段缓存失效（从 `prompt-order.ts` 推断） | `nbook.sql` 交稳定的槽 `sql-schema`，库结构变了才变 | 每轮不再丢一段缓存 |
| `context()` 每次渲染读人设文件 | 人设是 session 的片，会话打开、设置变化、文件被改时读一次 | `prompt` 是纯函数 |
| `HistorySet` 只在历史为空时写 | `seed()` 在会话创建与压缩后写 | 压缩后种子自动重写 |
| “写作任务必须交给 writer”只写在提示词里 | 自带的工具拦截挡住 | 能挡住 |
| `ModeReminder` 专用的 `ModeSlot` | Profile 级 `render` 覆盖任何扩展事件 | 一种机制 |
| 文件变更感知的档位是主创自己的设置项 | `nbook.history` 扩展的设置，按 Profile 配 | 不必每个 Profile 各写 |
| 固定顺序 History → ModelContext → AppendingSet → CurrentUserInput | 模板定位置；提醒是日志里真实的事件 | 顺序看日志就知道 |
| `runtimeDefaults.summarizer` 每 16 次 | `nb-memory` 扩展数“运行结束”，到 16 次启动 summarizer（后台运行等 t22） | 记忆归记忆插件 |

改写后的结构见 spike 的 `examples/profiles.tsx`（`leader`、`leaderCore`）。结论：

- **能力**：旧版能做的都能做；多出来的是规则能挡住、插件能给不认识的 Profile 加上下文、回退与预览自动正确、压缩后种子重写、缓存不再每轮丢一段。
- **写法**：主创的上下文部分从约 120 行缩到约 60 行，七种提醒不再出现。
- **对写手、单轮模板不一定更短**（Opus 审查第 17 条）：旧版写手与上下文有关的结构约 35 行，按第二稿的 API 改写是 79 行，多出的主要是调用参数没有位置（约 20 行）与预设的重读时机；第三稿加了 `initial`、`payload`、`sample`、多片状态，按推断这两处能回到几行（没有重新改写计数）；新增的工具拦截（约 10 行）是真正的新能力。单轮模板读一个文件放进请求，旧版 `ModelContext` 约 8 行，新版用 `sample` 加一个槽，按推断也在 10 行以内。
- **代价**：主创收到的完整上下文分散在多个插件里，要靠预览看全（每块标了来源）；人设改了，系统提示词跟着变，缓存失效一次；扩展的设置要能在 Profile 设置里按 Profile 显示。

### 12. 原型与审查

第二稿写成后做了一个 spike（`spike/`，连同场景检查约 2,500 行），再请两位审查者审：omp（gpt-6.1-sol，架构、不变量与性能，24 条）与 Claude Opus（以插件作者的身份照 API 写了四个扩展与 Profile，API 形状与好用程度，17 条），证据在 t20 的 `evidences/`。成立的都改进了 spike 与本稿；spike 现在 38 个场景检查全部通过，`typetest.ts` 里七种写错的地方都是编译错误。

主要改动（括号里是审查条目）：

- **事实与恢复**：模型请求、工具执行之前先落 `model_started`、`tool_started`；失败、中止都写收口事件；崩溃后 `recover()` 结算（omp 1、2、17）。
- **单写者**：运行中到达的写入排队到边界（omp 16）。
- **并行工具批次**（omp 3）。
- **状态**：每条事件记下 path 与 session 这一对；只读；一个扩展多片；归约返回 undefined 表示不变（omp 6、9，Opus 8、12）。
- **日志**：`leaf_changed`、加载校验、换 Profile 照日志重新归约（omp 7、10、11、22）。
- **压缩**：`firstKept` 之前换成摘要（omp 8）。
- **事件名**：扩展事件自动带前缀，内核事件是常量（Opus 2、11）；类型推断与声明合并（Opus 3）。
- **“接着做”要显式**（Opus 1）；深度上限精确到第 3 层并留 `reaction_limit`（omp 5）。
- **视图**：块保留来源、缓存按块与同一路径比对（Opus 5，omp 19）；`sample` 与 `view.now`，记进 `model_started`（Opus 6，omp 23）；结构化输入与 `initial`（Opus 7）；槽的声明与内容写在一起、`*` 必须写档位（Opus 9，omp 21）；`render` 只在 Profile 与扩展上（Opus 10）；文字拼法（Opus 13）。
- **审计**：工具的实际参数与原本的结果进日志（omp 14）。
- **诊断**：结构化、带扩展 id、去重（Opus 12，omp 21）。
- **各入口读到的状态**写成表（Opus 4，omp 4）。

**性能**（spike，假模型，本机）：

- 1,200 轮（约 1 万条日志，最后一次请求约 37 万 token、7,200 条消息）：打开约 13 ms，算一次请求约 3 ms，长会话上每条新事件约 8 ms。
- 第三稿的检查更多、开发模式冻结状态，300 轮（4,200 条）：打开 18–30 ms，算一次请求 0.5–1.6 ms。

每次请求都要重新投影、渲染、比对整段历史，是 O(历史长度)。真实模型的延迟以秒计，这个量级不是瓶颈，但产品实现要做到三点：

- 渲染按事件记住结果；
- 缓存比对用增量哈希；
- 快照只在压缩点与稀疏的检查点持久化。

并给出 10 万条事件的预算（待定项 14）。

**参照实现的机制在本稿里的对应**（omp 审查第 30 条）：

| 参照机制 | 本稿 |
|---|---|
| omp `before_provider_request`（改原始请求体） | 不开放；改与服务商无关的 `ModelRequest`（主动接口的收窄） |
| omp `after_provider_response`、`assistant_message`（改写回复） | 模型拦截在 `next` 之后改回复；原文与改后都进日志 |
| omp 工具批次的并发与插话屏障 | 工具批次（第 5 节）与边界（第 2 节） |
| omp、OMP 的自动重试 | 适配器内的重试算一次逻辑请求，每次尝试记诊断（待定项 12）；扩展要重试就在模型拦截里调两次 `next` |
| Claude Code `PostToolBatch`、`PostToolUseFailure` | 对工具结果的反应（整批写入后派发）；失败是 `isError` 的工具结果 |
| Claude Code `PreCompact`、`PostCompact` | 压缩拦截；对 `K.compaction` 的反应 |
| Claude Code `PreModelSwitch` | 对 `settings_changed` 的反应 |
| Claude Code 的匹配器 | 在代码里按事件类型、工具名判断 |
| LangGraph checkpoint | 由日志归约的快照（待定项 3） |
| LangGraph interrupt、resume | 审批与提问的等待事件（t06），重启后照日志接着等 |
| LangGraph 持久子图 | 子 Agent 是独立会话，父会话写结果回流事件（待定项 16） |
| 流式输出的观察 | 不给扩展，只推界面（待定项 11） |

## 影响

- **`nb-harness`**：会话模块的 `fold` 与投影沿用分支并扩展为片；Profile 宿主重写，旧的节点改由扩展接口与辅助函数实现；运行时的循环由内核自己写，不再用 OMP 的 `Agent`。t02 定的“代码以分支为主体”在运行时这一层改为按语义参照；会话格式、工具登记、模型目录与凭据、压缩方法、Profile 渲染仍以分支为主体。
- **日志格式**：新增内核事件（`model_started`、`model_failed`、`tool_started`、`leaf_changed`、`profile_changed`、`reaction_limit`）与带前缀、带版本的扩展事件；新应用尚未发布，旧格式由 t03 定的一次性迁移脚本处理。
- **`nbook.models`**：模型适配器按第 5 节的合同消费 `streamSimple` 的事件流。
- **nb-story**：问答 Profile 只用了组装节点，迁移量小；它依赖的单轮调用、`TurnResult`、收尾工具、`complete()` 在新循环里保留（t02）。
- **nb-agent-ui**：显示每块的来源、被改写的原文与改后、修改记录、结构化诊断；“结果未知”的工具调用与中断的运行有专门的样子。
- **SDK 与插件作者**：`defineExtension`、`defineProfile`、`K`、`path`/`session`/`conv`/`ext`、辅助函数进 SDK；文档写清归约的纪律、反应与视图的分工、各入口读到的状态、缓存规则、事件版本。
- **安全**：扩展是受信任代码（ADR 0022），本稿不引入新的安全边界；请求可被任意修改，靠修改记录追查。审计把工具原本的结果写进日志，扩展做脱敏时原文仍在日志里（待定项 15）。

## 对 Spec 的预期改动

- `harness.session`：内核事件与数据、扩展事件的前缀与版本、片与作用域、归约规则、导出选择器、只读、加载校验、叶子、恢复、快照。
- `harness.profile`：`defineProfile`、模板节点与文字拼法、Profile 级 `render`、缺省布局、辅助函数。
- `harness.runtime`：内核循环、边界与单写者、模型适配器合同、工具批次与并发、拦截链、失败与中止、反应的快照语义与上限、修改记录、预览、缓存比对、压缩。
- 新的 `harness.extensions`：`defineExtension`、`ctx`、各入口读到的状态、生命周期、换 Profile、按标签排除、`replaces`。
- `agent.*`（Agent 插件）：`agent.extensions` 贡献点取代 `agent.hooks`。
- 验收场景以 spike 的 38 个场景为起点，换成真实运行时（真实日志存储、真实 OMP 适配器、进程重启）。

## 待定项

1. **名字**：叫“扩展”（`agent.extensions`、`defineExtension`），还是保留“钩子”。推荐“扩展”。
2. **Profile 在拦截链里的位置**：最里层（推荐：改请求时最后拍板）还是最外层。
3. **归约的快照**：spike 每条事件都在内存里留一份（结构共享，1 万条约 3 MB）。持久化的快照推荐“压缩点加稀疏检查点”：只在压缩点存，回退到很远的分支时要长距离重放（omp 审查第 3 条判断）；检查点的间隔、淘汰与分支命中策略实现时定。
4. **上限**：反应链最多 3 层、“接着做”连续最多 3 次、扩展时限缺省 30 秒。
5. **请求录制**：缺省关、需要时在设置里打开（推荐）。
6. **`reminder()` 的缺省方式**：写进历史（推荐）。
7. **工具拦截里附加的说明**：写进日志（推荐：模型看到了就要能重放）。
8. **反应的主动接口**：spike 里反应只返回事件、I/O 在反应里自己做；`complete`、`invokeTool`、`ask`、`compact` 这类会产生新事件的主动动作怎样进日志（推荐：每个动作写一条带来源的控制事件，结果作为事件回来），实现时定。
9. **请求时的数据**：已定为 `sample` 与 `view.now`，记进 `model_started`；剩下的问题是 `sample` 的值很大时（例如整章正文）是否只记哈希、另存原文。
10. **Profile 自带扩展的写法**：`extensions` 列表（spike 已按此实现，推荐）。
11. **流式输出给不给扩展看**：推荐不给，增量只推给界面，扩展只在完整回复写入后反应；以后真有需要（例如边生成边审查）再加一个只读的观察接口。
12. **模型适配器的审计粒度**：OMP 内部的重试、推理循环算一次逻辑请求还是多次；推荐一次逻辑请求一条 `model_started`，每次服务商尝试记进诊断。
13. **请求的完整形状**：图片与附件块、思考块、工具的参数 schema 与 `tool_choice`、服务商专有选项放在哪里；推荐 `ModelRequest` 的块加 `kind`（文字、图片、思考）、`tools` 用完整的工具声明，服务商专有的放适配器选项，实现 t04、t05 时定。
14. **性能预算**：长会话的目标（例如 10 万条事件打开在 1 秒内、算一次请求在 50 毫秒内）与做法（渲染记忆、增量哈希、稀疏检查点）。
15. **审计与脱敏**：工具结果被脱敏时，原文写进日志还是只记哈希；推荐扩展可以把一次修改标为敏感，日志只记哈希。
16. **多 Agent**（t14）：子 Agent 是独立的会话；父会话里写 `child_started`、`child_result`、`child_failed`（带子会话 id、调用 id、幂等键），审批冒泡与中止连带走父会话的运行控制。t14 讨论时定，事件形状按本稿的内核事件来。

## 第三稿的修订（审查后，待开发者确认）

第 12 节列出的改动都是按审查意见做的，没有经过开发者确认；其中改变了已定写法的：

- 扩展从单片状态改为多片，`pathState`、`sessionState` 改为片的构造函数 `path`、`session` 与 `ctx.set`。
- 扩展事件改由 `events` 声明，类型自动带扩展 id 前缀。
- `render` 从 `<History>` 节点上移到 Profile 与扩展上，节点上写 `render` 是模板错误。
- “接着做”从“最终回复后追加了对话事件就继续”改为要显式写 `continue`。
- 相邻的 user 消息不再在内核里拼接，内容改为块。
- 预览的“视图输入”记进日志（`model_started`），不再只在内存里。

## 决策记录

| 日期 | 决策者 | 结论 |
|---|---|---|
| 2026-10-28 | 开发者 | t20 讨论中同意：管线为骨、Profile 为主；Profile 的上下文管理里 `Appending`、`Reminder` 改用钩子做，Profile 的长处是集中与组装；`assemble` 改名 `prompt`；允许改写用户的话；主动接口收窄（不给改工具绑定、会话设置、原始请求体）；请求阶段拿到最终请求、想怎么改都行 |
| 2026-10-28 | 开发者 | 同意以“日志 → 归约 → 状态 → 视图 → 请求 → 副作用 → 日志”为骨架、扩展只做归约、反应、视图、拦截四件事的方向；要求单独写成提案再讨论 |
| 2026-10-29 | 开发者 | 同意：`reduce` 只看自己那一片；同一条事件的反应看同一份状态快照、追加的事件按扩展顺序写入；视图只在发请求与预览时算；扩展的片默认私有、经导出的选择器共享；`pathState()` 与 `scope: "session"`；扩展事件带版本 |
| 2026-10-29 | 开发者 | 同意：`prompt` 能读状态、按模型能力写条件、`<History render filter>`；视图加 `attach`、扩展给自己的事件提供缺省渲染、没留槽时丢弃并写诊断；预览也跑模型拦截链、最里层截下请求（其中 `attach` 被下面“日志记事实、历史是投影”一行取代，并进槽） |
| 2026-10-29 | 开发者 | 循环由内核自己写，不再套 OMP 的 `Agent`，与服务商通信只用 `streamSimple`；t02 的“代码以分支为主体”在运行时这一层改为按语义参照 |
| 2026-10-29 | 开发者 | 扩展交片段的字段改名 `contribute`，“视图”只指“状态 → 请求”这一步；Profile 的 `prompt` 改为可选，不写用缺省布局 |
| 2026-10-29 | 开发者 | 日志记事实、历史是投影：`core.history` 是内置扩展，Profile 可以替换；模板四个节点 `<History>`、`<Input>`（本轮的用户输入，整轮有值）、`<Transcript>`（本轮其余记录）、`<Slot>`；去掉 `tail`、`attach`，并进槽，扩展声明槽稳定还是会变；缓存由预览比对相邻两次请求检查，不靠结构禁止；事实写进日志的时间由内核定、不开放；内核只留写日志、循环与运行控制、审批与只读、请求校验、上限，其余做成内置扩展，只有 Profile 能替换 |
