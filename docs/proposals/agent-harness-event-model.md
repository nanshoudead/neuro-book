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

### 1. 基本循环

```text
日志（事件） ──归约──▶ 状态 ──视图──▶ 请求 ──调用──▶ 响应 ──追加──▶ 日志
                ▲                                         │
                └────────────── 反应：新的事件 ◀────────────┘
```

循环由 harness 内核自己写，不再套 OMP 的 `Agent`；与服务商通信只用 OMP 的 `streamSimple`（`pi-ai`），由 `nbook.models` 的模型适配器调用（t09）。理由：本稿要求“一条事件的反应全部完成后才算下一次请求”“模型调用可以重试与换模型”“日志是唯一的上下文”，`Agent` 自己的上下文与异步投递的事件和这几条都要对着干，现有的等待逻辑就是证据。代价是内核自己实现并行执行工具、插话（t07）、中止与收口，这些分支里已有可参照的语义。

一次运行：

1. 用户输入经输入拦截链，作为事件写进日志；所有扩展对它归约、再反应（可能追加新的事件）。
2. 需要请求模型时，由当前状态算出请求（视图），经模型拦截链发给模型。
3. 回复作为事件写进日志，归约、反应。
4. 回复里有工具调用时，每个调用经工具拦截链执行，结果作为事件写进日志，归约、反应；送达插话（t07）；回到第 2 步。
5. 没有工具调用时，回复是最终回复；扩展对它反应，可以追加“接着做”的消息，回到第 2 步；否则运行结束。

压缩、审批等待、插话、排队、中止都是这个循环上的事件与副作用（下文逐项说明）。

### 2. 事件与日志

日志只追加（t03），已经写下的条目谁都不能改。事件分三类：

| 类 | 例子 | 进不进模型上下文 |
|---|---|---|
| 对话 | 用户消息、助手回复、工具结果、扩展注入的消息（种子、提醒、文件变更通知、检索结果） | 进：它们就是历史 |
| 控制 | 运行开始与结束、审批与提问的请求和应答、设置变化、工具集变化、压缩 | 历史那一片状态据此调整（例如压缩替换前面的内容） |
| 扩展 | 扩展的状态变化、外部事实（“第 3 章被改了”“后台任务结束了”）、插件的自定义记录 | 不进；扩展归约它们，再决定要不要经视图或反应带给模型 |

- 对话与大部分扩展事件是树上的节点，跟着路径走；标题、归档、模型与推理档这类会话级事件不进树（t03、t09）。
- 每条由扩展产生的事件带上来源（扩展 id），界面可以标出“这条是某某加的”。
- 扩展事件的类型带版本（`type` 加 `v`）。扩展改了事件的含义就升版本，`reduce` 对旧版本按旧含义处理；否则旧会话用新代码重新归约，状态会和当时不一样。
- 模型实际收到与产出的东西必须全部进日志：被改写过的用户输入、回复、工具参数与结果，改后的与原文都记下。扩展能决定自己加的东西写不写，不能阻止真实的模型消息与工具结果写入。

### 3. 状态与归约

为什么用“日志加 reduce”：扩展的状态必须跟着对话路径走（回退到第 3 次发言，提醒计数也回到 3），重启后要恢复，预览与运行要看到同一份。存在内存里，回退与重启都不对；另存状态文件，要给树上每个节点存一份才回得去（那就是又一份日志），日志写成了、状态没写成时两边还会对不上。由日志归约，只有一个真相源，换一片叶子重新归约就对。

状态是一组片，每片归一个所有者：

- **内置的片**：历史（沿当前路径的消息，处理过压缩）、工具集、会话设置（模型、推理档、审批模式、Agent 模式，t09 定为会话级、不跟路径走）、运行状态与待处理事项（t06）。
- **扩展的片**：每个扩展一片，例如提醒的计数、还没告诉模型的文件改动、记忆检索的结果。

```ts
interface StateSlice<S> {
    initial: S;
    scope?: "path" | "session";                  // 缺省 path：跟着对话路径走；session：和标题一样在树外
    reduce(state: S, entry: SessionEntry): S;    // 纯函数；只看得到自己这一片与这条事件；不认识的条目原样返回
    exports?: {[name: string]: (state: S) => unknown};   // 给别的扩展读的只读选择器
}
```

- **`reduce` 只看自己那一片**：各扩展的 `reduce` 互不依赖，谁先谁后结果都一样。要用别人的数据，在反应或视图里读。
- **默认私有**：扩展的片只有它自己读得到原样。想给别人看的，经 `exports` 导出选择器，例如 `nbook.history` 导出 `pendingChanges`，别的扩展用 `ctx.state.read("nbook.history", "pendingChanges")` 读；选择器的返回类型是这个扩展的公开接口，内部结构可以随便改。内置的片对所有扩展只读可见。
- **状态不另外存**：总是由日志归约而来。回退与 fork 时归约到当前叶子为止的路径；重启后照日志重建。平时增量归约：每写入一条，在现有状态上再调一次 `reduce`。打开长会话靠压缩点的快照（待定项 3）。
- **简化写法**：只想“存一个值、跟着路径走”的扩展不必手写 `reduce`：

  ```ts
  const notes = pathState<{pending: string[]}>({initial: {pending: []}});
  // setup 里返回 {state: notes.slice}；反应里 await notes.set(ctx, {pending: []}) 写一条扩展事件
  ```

  内核生成的 `reduce` 取路径上最后一次 `set` 的值；`sessionState()` 同理、写在树外。手写 `reduce` 只用在对别的事件计数或累积时（例如数用户发言，不必每次发言都写一条事件）。
- 扩展在内存里可以有缓存（连接、索引句柄），但缓存不是真相，丢了要能从状态重算。

### 4. 视图：请求怎样算出来

视图只在要发请求和预览时算，不跟着每条事件算。请求是状态的纯函数，不做 I/O，不写日志：

```ts
interface ModelRequest {
    model: ModelRef;
    params: {temperature?: number; topP?: number; maxTokens?: number; stop?: string[]};
    headers: {[name: string]: string};
    system: string;
    messages: Message[];
    tools: ToolInfo[];
}
```

“视图”指整个“状态 → 请求”这一步，由两样东西一起完成：Profile 的 `prompt` 定布局，扩展的 `contribute` 交片段。布局只能有一个拥有者，否则谁先谁后会影响结果、前面的内容会被改掉；要改整个请求的，用模型拦截（下一节）。

**Profile 的 `prompt` 定布局**，可选，签名是 `(input: {state, settings, tools, model}) => TSX`。不写时用缺省布局 `<System>{声明里的 system}<Slot name="*" /></System><History />`，只写一段系统提示词的 Profile 不必写它。写的话：

- 读状态：全部内置的片、自己的片、别的扩展导出的选择器；例如“有大纲时才放大纲那段”。
- 按模型能力写条件：`model.capabilities.vision` 等（t05 的模型能力声明）。
- 组装：系统提示词由哪几段组成、`<Slot>` 放在哪、历史放在哪里（作为消息，或渲染成一段文字）、历史前后有没有固定的消息（例如示例对话）。
- 控制历史里每条怎么渲染：`<History render={...} filter={...}>`。例如注入的消息包成 `<system-reminder>`、太旧的工具结果只留摘要、某类事件在这个 Profile 里不显示。同一条事件每次渲染的结果必须相同，否则前缀变了、缓存失效；改了渲染规则会让缓存失效一次，预览给出警告。
- 模型与参数的缺省值从会话设置与 Profile 设置取。

**扩展的 `contribute` 交片段**，从状态算出三样东西，按扩展顺序拼接，Profile 自己的扩展最后：

| 产出 | 去处 | 用于 |
|---|---|---|
| `slots` | Profile 留的同名 `<Slot>` | 稳定的内容：书的设定、记忆的长期摘要 |
| `tail` | 接在历史末尾的消息，只对这一次请求有效 | 每次都变的内容：本章字数、时间、阅读位置 |
| `attach` | 附在请求最末尾那条消息（用户消息或工具结果）里的内容块，只对这一次请求有效 | 同上，但不想多出一条消息时（避免连续两条 user 消息被服务商合并或拒绝） |

- **扩展的事件渲染**：扩展可以给自己的对话事件类型提供缺省渲染（`render`），例如检索结果在日志里存结构化数据，渲染成 `<memory>…</memory>`；Profile 的 `<History render>` 可以覆盖。
- **Profile 没留槽**：扩展往一个不存在的槽填内容时，内容丢弃并写诊断“Profile 没留这个槽”，预览里看得到。不自动塞进系统提示词末尾：那样 Profile 失去控制，也会破坏缓存。
- **缓存规则**：系统提示词与槽里只放稳定的内容，变的放 `tail` 或 `attach`。`attach` 只附在请求最末尾的那条消息上：附在更早的消息（例如工具循环里那条早先的用户消息）上，每次内容一变，它之后的整段历史都失去缓存。槽的内容在两次请求之间变了，预览与诊断给“不利于缓存”的警告。历史只追加，所以前缀稳定。
- **视图之外**：视图是声明式、对缓存友好、预览看得到的缺省途径；要做视图做不到的事（删改历史里的消息、换模型、加 header），用模型拦截（下一节），代价由扩展自己承担，日志记下它改了什么。

### 5. 副作用与拦截

有副作用的步骤只有这几样：接受用户输入、调用模型、执行工具、压缩。每样都可以被拦截，形状是包裹式的：

```ts
interface Interceptors {
    input?(input: UserInput, next: (input: UserInput) => Promise<void>, ctx: ExtensionContext): Promise<void>;
    model?(request: ModelRequest, next: (request: ModelRequest) => Promise<ModelResponse>, ctx: ExtensionContext): Promise<ModelResponse>;
    tool?(call: ToolCall, next: (call: ToolCall) => Promise<ToolResult>, ctx: ExtensionContext): Promise<ToolResult>;
    compaction?(job: CompactionJob, next: (job: CompactionJob) => Promise<CompactionResult>, ctx: ExtensionContext): Promise<CompactionResult>;
}
```

- **改**：调 `next` 之前改输入，之后改输出。请求里的模型、参数、header、系统提示词、消息都可以改（开发者 2026-10-28：请求阶段想怎么改都行）。改的是上面这个与服务商无关的请求对象；按各家格式转换后的原始请求体不开放（主动接口的收窄）。
- **拦**：不调 `next`。输入被拦下时给出理由；工具被拦下时返回一个错误结果；模型调用被拦下时可以直接给出一条回复（例如命中缓存）。
- **重试、换做法**：调两次 `next`，或换个参数（例如换模型）再调。每一次真实的模型调用与工具执行都进日志，重试看得见。
- **审批**（t06）在工具拦截链的最里层、执行之前判定；扩展的放行只能免掉审批模式本来要弹的询问，盖不过用户配置的拒绝、工具按参数声明的拒绝与只读模式。
- **顺序**：一层套一层，外层是插件（按依赖拓扑序，再按 id），最里层是 Profile（待定项 2）。改请求时 Profile 最后动手、最后拍板；改回复时 Profile 最先拿到原始回复，插件在外层再加工。
- **最里层**：模型拦截链的最里层是 `nbook.models` 的适配器：解析模型、从凭据库取密钥（t09），调 `streamSimple`；工具名的 `.` 换成 `__`（t04）在这里做。
- **查得到是谁改的**：每次模型调用记下哪些扩展改了请求的哪几项（模型、参数、header、系统提示词、消息）与改后请求的哈希；可选的请求录制把真正发出的请求整个存下（待定项 5），供排查。
- **流式输出**：界面先显示原始的流；回复被拦截链改写后，用最终文字替换。
- **预览也跑模型拦截链**：最里层的 `next` 不发请求，只把请求截下来交给预览，所以预览看到的是最终请求。拦截前要做 I/O 的扩展用 `preview: "skip"` 跳过。

### 6. 反应：在事件之后追加新的事件

```ts
react?(entry: SessionEntry, ctx: ExtensionContext): Promise<EventInput[] | void>;
```

- 反应可以做 I/O（读文件、检索记忆、调一次不进会话的模型），返回要追加的事件；这些事件写进日志，再被归约与反应。
- 要影响重放的外部输入都经反应变成事件：检索结果写进日志之后，重放与预览不用再去检索。
- **同一条事件的反应看同一份状态**：一条事件写入后，先由全部扩展归约，再把归约后的状态快照交给全部扩展的反应，它们可以并发执行。追加的事件按扩展顺序写入（插件按依赖拓扑序、Profile 最后），一个扩展看不到另一个扩展这一轮刚追加的事件，要等那条事件自己归约、反应时才看到。不这样定，结果就看谁先跑完。
- **反应全部完成后，才算下一次请求。**
- 用途：会话创建时写种子；用户发言后追加提醒或文件变更通知；最终回复后追加“接着做”的消息；工具结果之后追加说明。
- 防循环：同一条事件引出的反应链有深度上限，最终回复之后的“接着做”连续最多 3 次（待定项 4）。

### 7. 一次运行的数据流

以用户在对话框里说“你好”为例，从点“发送”到收到回复（数据形状是示意）：

1. **浏览器**：Composer 先显示一条“发送中”的用户消息，经远程服务（ADR 0024，WebSocket 上的 RPC，t10）发出 `agent.send({sessionId, text: "你好", clientId})`。
2. **运行控制**（t07）：会话还没加载时，读日志、沿当前叶子归约出状态、对每个扩展调用 `setup`；空闲就开始一次运行，写 `run_started`；正在运行就按插话或排队处理。
3. **输入**：经输入拦截链，写入对话事件 `{id: "e2", parent: "e1", message: {role: "user", content: "你好"}, clientId}`；全部扩展归约、反应；e2 推给订阅的窗口，界面按 `clientId` 把“发送中”换成正式消息。
4. **视图**：Profile 的 `prompt` 定布局、各扩展的 `contribute` 交片段，算出 `ModelRequest`：模型按“会话里选的 → Profile 设置 → 全局缺省”取（t09），系统提示词、`[user: 你好]`、工具清单。
5. **模型拦截链**：从外到里，日志记下修改记录；最里层的适配器取密钥，调 `streamSimple(model, {systemPrompt, messages, tools}, {apiKey, signal, maxTokens, temperature, headers, reasoning})`；`pi-ai` 按服务商协议转换（DeepSeek 走 OpenAI 兼容的 `/chat/completions`，`stream: true`）并发出 HTTP 请求。
6. **流式回复**：服务商回 SSE，`pi-ai` 解析成文字、思考、工具调用的增量，最后给出完整的助手消息与用量。服务端把增量推给窗口，同一条消息每 100 毫秒最多推一次（t10）；增量不写日志。
7. **写回**：完整回复由内往外穿过拦截链，写成 e3（带模型、推理档与用量）；归约、反应。有工具调用就逐个走工具拦截链，结果写日志后回到第 4 步。
8. **结束**：没有工具调用、也没有扩展追加“接着做”，写 `run_ended`，推给窗口；界面用日志里的正式版本替换流式显示的文字。第二句话的请求是 `[system][user 你好][assistant …][user 下一句]`，前缀与第一次相同，服务商的缓存命中。

### 8. 扩展的形状与生命周期

```ts
interface AgentExtension {
    id: string;
    tags?: string[];                         // 例如 ["memory"]；Profile 按标签排除
    setup(ctx: ExtensionContext): {           // 每打开一个会话调用一次
        state?: StateSlice<unknown>;
        react?: (entry: SessionEntry, ctx: ExtensionContext) => Promise<EventInput[] | void>;
        contribute?: (mine: unknown, input: ViewInput) => {slots?: {[name: string]: string}; tail?: MessageInput[]; attach?: ContentBlock[]};
        render?: {[entryType: string]: (entry: SessionEntry) => Message[] | null};   // 自己的对话事件的缺省渲染
        intercept?: Interceptors;
        dispose?(): void | Promise<void>;
    };
    timeoutMs?: number;                       // 缺省 30 秒
    onFailure?: {tool?: "deny" | "ignore"};   // 工具拦截出错缺省按拒绝，其余缺省忽略并写诊断
    preview?: "run" | "skip";                 // 预览时反应与拦截是否执行
}
```

`state`、`react`、`contribute`、`render`、`intercept` 都是可选的，扩展用到哪个写哪个。

生命周期：

```text
扩展：插件激活 → 声明登记 → [每个会话] setup 挂上 → dispose 摘下 → 插件停用
会话：创建（一次）→ 打开（每次加载进内存，含重启后）⇄ 空闲 / 运行中 / 等用户 → 关闭
运行：受理 → 输入 → 循环[请求 → 回复 → 工具 × N] → 准备结束 → 结束；循环中随时可能压缩；中止或出错时收口
一条事件：写进日志 → 全部扩展归约 → 全部扩展反应（追加的事件各自再走一遍）
```

“会话已创建”“会话已打开”“运行开始”“最终回复”“运行结束”都是日志里的事件或运行时发出的事件，扩展经反应或订阅处理它们，不另设钩子点。

`ExtensionContext` 给每个会话一份：会话身份、`preview` 标志、中止信号；读：内置的片、自己的片、别的扩展导出的选择器（`ctx.state.read(扩展 id, 选择器名)`）、工具、当前模型、上下文用量、`read(uri)`（t08）；主动：`complete`（不进会话的模型调用，经 `nbook.models`）、`invokeTool`（走审批）、`ask`（t06）、`send`（插话或排队，t07）、`emit`（追加扩展事件）、`compact`、`abort`、`setTitle`、诊断。不给：改工具绑定（t04 归用户）、改会话设置（t09 归用户；按请求换模型经模型拦截做，不改设置）、定时器与界面（插件自己的入口与贡献点能做）。

插件经 `agent.extensions` 贡献点登记（取代 t10 的 `agent.hooks`），按需激活；Profile 写在 `defineProfile` 里。Profile 用 `globalExtensions: {exclude: [标签]}` 或 `"none"` 排除全局扩展，用户在 Profile 设置里还能单独开关（t20 已定）。

### 9. Profile 在其中

Profile 是一个扩展，加上一组声明，排在最后：

- **声明**：身份、`initialSchema`、要哪些工具（必需、可选，t04）、需要的模型能力（t05）、压缩要求（t11）。
- **`prompt`**：布局，可选，见第 4 节；TSX 只写组装（`<System>`、`<Slot>`、`<History>`、`<History as="text">`、固定消息、`<ToolName>`、`<If tool>`），条件与数据从参数里的状态取。
- **`extensions`**：Profile 自带的扩展列表，每一项的写法与插件的扩展相同（有自己的 id 与状态片），排在全局扩展之后、按列出的顺序，拦截链里在最里层（待定项 2）。辅助函数 `seed()`、`reminder()`、`sessionState()` 都返回一个扩展，直接放进列表（待定项 10）。

旧节点的去处：

| 旧节点 | 新设计 |
|---|---|
| `System`、`<Slot>`、`History` 布局、`History as="text"`、固定消息 | `prompt` 里，不变 |
| 种子（`History` 的子节点） | 对“会话已创建”与“压缩完成”的反应，辅助函数 `seed()` |
| `Appending` 与 `Input` | 不需要：用户消息由 harness 写入；输入前后的消息是对用户消息的反应 |
| `Reminder` | 辅助函数 `reminder({every, when, once, watch, mode})`：状态加反应（写进历史）或状态加视图（只接在这一次请求末尾） |
| 有状态的节点 | 扩展的状态片，或 `pathState()` |
| 按请求刷新的数据源 | 稳定的放进槽（视图），会变的放 `tail` 或 `attach`（视图），要重放的经反应写进日志 |

### 10. 例子

**用户说“你好”，系统提示词是静态的。** 见第 7 节。

**每 5 次用户发言提醒一次文风。** 状态 `{turns, lastAt}`；`reduce` 在用户消息上 `turns + 1`、在自己的提醒事件上 `lastAt = turns`；反应：用户消息之后 `turns - lastAt >= 5` 就追加一条提醒。回退到第 3 次发言时，状态归约到那里，计数自然回到 3。

**文件变更感知（t13）。** `nbook.history` 把“第 3 章被用户改了”作为扩展事件写进日志；状态记还没送达的改动；反应：下一次用户发言之后追加一条通知消息，并写“已送达”事件，状态清空。回退到用户发言之前，“已送达”不在路径上，未送达的改动自动恢复。

**记忆检索。** 对用户消息反应：检索，把结果作为结构化的对话事件写进日志，经自己的 `render` 渲染成 `<memory>` 块。重放与预览不用再检索；Profile 排除 `memory` 标签时没有这一步。

**字数不够就接着写。** 对最终回复反应：读正文，不到 3000 字就追加“请接着写完”，循环继续，连续最多 3 次。

**本章当前字数（会变的状态）。** 视图：`attach` 里放“本章当前字数：2,100”，附在请求最末尾的那条消息里，只对这一次请求有效，不进日志，只影响最后一小段的缓存。

**写手只能改正文目录。** 工具拦截：`edit` 的路径不在 `project://正文/` 下就不调 `next`，返回错误结果“写手只改正文目录”。

**路由插件按问题难易换模型。** 模型拦截：看请求里最后一条用户消息，简单的换成便宜的模型再调 `next`；日志记下“请求的模型被某某改了”。

**审批。** 工具拦截链的最里层判定；要询问时写审批请求事件，运行进入等用户；应答事件写入后继续执行或返回拒绝结果（t06）。

**压缩（t11）。** 压缩是副作用，经压缩拦截（可以取消、追加要求、直接给结果）；结果是一条压缩事件，历史那一片据此替换前面的内容；种子经 Profile 对“压缩完成”的反应重写。

**Profile 改版（t04 方案 D）。** “Profile 已更新”“工具集变化”是事件；旧 Profile 的扩展 `dispose`、新的 `setup`；工具集那一片据此更新，并追加提醒。

### 11. 验证：改写旧应用的 `leader.default`

用旧应用的默认主创 Profile（`packages/neuro-book-legacy/assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`，2026-10-29 读）检验本稿的能力与写法。提示词正文不改写，只看结构。

旧版的 `context(ctx)` 是一个异步函数，每次渲染都读人设文件，返回 `ProfilePrompt`：`System`（置顶提示词、人设、三项设置各挑一段、主提示词）、`HistorySet`（只在历史为空时写入的 14 条消息：11 个 `Import` 与 3 个目录）、`ModelContext`（`SqlSchemaSummary`，不落盘，每次请求插在本轮的追加消息之前）、`AppendingSet`（工作区焦点、文件变更、模式可用性、已关联 Agent、任务、模式、提到的 Skill 七种提醒，每轮写进日志）。另有 `runtimeDefaults.summarizer`：每 16 次调用后跑一次 summarizer Profile。

| 旧机制 | 新设计 | 变化 |
|---|---|---|
| 七种提醒写在 `AppendingSet` 里，每个 Profile 各列一遍（`WorkspaceFocusReminder` 出现在 9 个内置 Profile 里） | 各自归拥有那份数据的插件，作为全局扩展：工作区焦点归宿主、文件变更归 `nbook.history`（t13）、模式归 `nbook.agent`（t06）、任务归 `todo` 工具所在的插件（t12）、已关联 Agent 归多 Agent（t14）、提到的 Skill 归 Skill（t15） | Profile 里这部分是零行；不要的按标签排除；插件不改 Profile 就能给它加上下文 |
| `TaskReminder` 靠 `stateKey: "agent.tasks"` 字符串读 `customState`，工具往同一个键写 | 任务的状态片由 `todo` 工具的结果归约而来，提醒和工具在同一个插件里 | 没有跨模块的字符串约定 |
| `ModelContext` 的库结构摘要不落盘，每次请求插在本轮追加消息之前；下一轮它挪到新一轮之前，上一轮那段的缓存就失效（从 `server/agent/profiles/prompt-order.ts` 推断） | `nbook.sql` 扩展从状态填系统提示词里的 `<Slot name="sql-schema">`，库结构变了才变 | 每轮不再丢一段缓存 |
| `context()` 每次渲染读一次人设文件 | 人设是 `sessionState`，在会话打开、设置变化、人设文件被改时读一次，写成事件 | `prompt` 变成纯函数，预览不读盘，回放用记下的值 |
| `HistorySet` 只在历史为空时写入 | `seed()` 在“会话已创建”与“压缩完成”时写 | 压缩后种子自动重写（t11） |
| “写作任务必须交给 writer”只写在提示词里 | Profile 自带的工具拦截：`write`、`edit` 改 `project://正文/` 时返回错误结果，告诉它用 writer | 规则从“请求模型遵守”变成能挡住 |
| 模式提醒的措辞经 `ModeReminder` 专用的 `ModeSlot` 子节点定制 | 通用的 `<History render>`：Profile 可以覆盖任何扩展事件的渲染 | 一种机制覆盖所有扩展，不用每种提醒各开插槽 |
| 文件变更感知的档位（完整、精简、关闭）是主创自己的设置项 | 是 `nbook.history` 扩展的设置，用户在 Profile 设置里按 Profile 配（t20） | 每个 Profile 不必各写一遍同样的设置 |
| 固定顺序 History → ModelContext → AppendingSet → CurrentUserInput | 布局由 `prompt` 定；提醒是日志里真实的事件，按写入的顺序出现 | 顺序看日志就知道，不靠一处硬编码 |
| `runtimeDefaults.summarizer` 每 16 次调用跑一次 | `nb-memory` 扩展归约“运行结束”计数，到 16 次启动 summarizer（后台运行等 t22） | 记忆归记忆插件，Profile 不再配置它 |
| `toolset(...)` 由 Profile 带工具 | 只声明必需与可选（t04） | 已在 t04 定 |

改写后的结构（提示词常量与设置表单省略，照旧）：

```tsx
const persona = sessionState<string>({id: "leader.default/persona", initial: DEFAULT_LEADER_PERSONA});

export default defineProfile({
    id: "leader.default",
    name: "主创",
    initialSchema: LeaderDefaultInitialSchema,
    outputSchema: LeaderDefaultOutputSchema,
    settingsSchema: SettingsSchema,                 // 去掉 fileChangeAwareness：它归 nbook.history
    tools: {
        required: ["read", "write", "edit", "shell", "ask", "todo", "agent.invoke"],
        optional: ["world.execute", "plot.*", "sql.execute", "workflow.run"],
    },
    prompt: ({state, settings}) => (
        <>
            <System>
                {settings.customTopSystemPrompt && <Tag name="custom_top_system_prompt">{settings.customTopSystemPrompt}</Tag>}
                <Tag name="leader_persona">{state.read("leader.default/persona")}</Tag>
                {COLLABORATION[settings.collaborationMode]}
                {FAMILIARITY[settings.neuroBookFamiliarity]}
                {QUESTION_STRATEGY[settings.questionStrategy]}
                {LEADER_SYSTEM_PROMPT}
                <If tool="world.execute">{WORLD_ENGINE_SECTION}</If>
                <Slot name="sql-schema" />
            </System>
            <History render={{"nbook.agent/mode-reminder": leaderModeReminder}} />
        </>
    ),
    extensions: [
        persona.loader({
            on: ["session_opened", "settings_changed", fileChanged(({settings}) => `profile://${settings.leaderPersonaPreset}`)],
            load: (ctx) => ctx.read(`profile://${ctx.settings.leaderPersonaPreset}`),
        }),
        seed({
            on: ["session_created", "compaction_done"],
            messages: async (ctx) => [
                await agentCatalog(ctx),
                await ctx.read("docs://builtin/agent/profile-routing.md"),
                await skillCatalog(ctx),
                // ……其余 11 条照旧，路径改用 t08 的地址
            ],
        }),
        {
            id: "leader.default/writer-only",
            setup: () => ({
                intercept: {
                    async tool(call, next) {
                        if (["write", "edit"].includes(call.name) && call.args.path.startsWith("project://正文/"))
                            return {isError: true, content: "正文交给 writer：用 agent.invoke 调用 writer"};
                        return next(call);
                    },
                },
            }),
        },
    ],
});
```

结论：

- **能力**：旧版能做的都能做；多出来的是规则能挡住（工具拦截）、插件能给不认识的 Profile 加上下文、回退与预览自动正确、压缩后种子重写、缓存不再每轮丢一段。
- **写法**：主创里与上下文有关的部分从约 120 行（`context()` 一段）缩到约 60 行，七种提醒不再出现；写法上要学的是 `sessionState`、`seed`、`<Slot>` 与 `<History render>` 四样。
- **代价**：主创收到的完整上下文分散在多个插件里，要靠预览看全（预览里每条标了来源）；人设的改动会让系统提示词变、缓存失效一次（用户改的，可以接受）；扩展的设置要能在 Profile 设置里按 Profile 显示（t17、t05 的设置界面要支持）。
- **验证中改的写法**：Profile 自带的扩展写成 `extensions` 列表，辅助函数各返回一个扩展（待定项 10）；`sessionState` 的 `set` 值没变时不写事件，否则每次打开会话都多一条。

### 12. 备选方案与取舍

| 方案 | 做法 | 不选的理由 |
|---|---|---|
| 以 Profile 为中心（分支现状） | Profile 宿主决定一切，插件只填槽 | 插件能力小一截；钩子另起一套就出现两套机制 |
| 按钩子点定义结果（omp、Claude Code、t20 第二版） | 十几个点，每点各有返回值与合并规则 | 合并规则散在各点；状态放在哪、怎样跟着路径走没有统一回答；生命周期不清 |
| 只用中间件 | 每个步骤一条包裹链 | 种子、提醒这类“往历史里加东西”与旁观不适合包裹；状态仍无处安放 |
| 循环继续套在 OMP 的 `Agent` 上 | 视图接 `transformContext`、模型拦截接 `streamFn`、接着做用 `followUp` 队列 | 两份上下文；事件异步投递，反应与渲染要等；模型调用重试与换模型要绕过 `Agent` |
| **事件模型，自己写循环（本稿）** | 状态由日志归约、请求是视图、副作用可拦截、反应追加事件 | 代价见“影响”：`reduce` 与视图要守纯函数的纪律，日志多一些非消息条目，内核多一个循环要维护 |

## 影响

- **`nb-harness`**：会话模块的 `fold` 与投影沿用分支并扩展为“状态片”；Profile 宿主重写：去掉 `Appending`、`Input`、`Reminder`、有状态节点与按请求刷新的数据源，改由扩展接口与辅助函数实现；运行时的循环由内核自己写，不再用 OMP 的 `Agent`，拦截器统一为包裹式。t02 定的“代码以分支为主体”在运行时这一层不成立：分支的 `runtime/session.ts` 也套在 `Agent` 上，它的会话状态机、审批、插话、中止与收口按语义参照，不照搬代码；会话格式、工具登记、模型目录与凭据、压缩、Profile 渲染仍以分支为主体。
- **日志格式**：新增扩展事件（带版本）、注入消息的来源、请求修改记录等条目类型；新应用尚未发布，旧格式由 t03 定的一次性迁移脚本处理。
- **性能**：打开会话要从头归约；长会话靠增量归约与快照（待定项 3）。请求的修改记录与可选的请求录制增加写入量。
- **nb-story**：问答 Profile 只用了 `System`、`HistorySet` 一类组装节点，迁移量小；它的“改阅读位置”提醒可以改成状态加视图。它依赖的单轮调用、`TurnResult`、收尾工具、`complete()` 在新循环里保留（t02）。
- **nb-agent-ui**：显示注入消息的来源、被改写消息的原文与改后、请求修改记录、“Profile 没留这个槽”与“不利于缓存”的诊断。
- **SDK 与插件作者**：扩展接口进 SDK，文档写清纯函数纪律、反应与视图的分工、缓存规则、导出选择器与事件版本。
- **安全**：扩展是受信任代码（ADR 0022），本稿不引入新的安全边界；请求可被任意修改，靠修改记录追查。

## 对 Spec 的预期改动

- `harness.session`：事件类型（三类）、来源、事件版本、状态片与归约、作用域、导出选择器、快照。
- `harness.profile`：`prompt` 的参数与组装节点、`<History render filter>`、去掉的节点、Profile 作为扩展的部分与辅助函数。
- `harness.runtime`：内核循环、副作用与拦截链、反应的快照语义与防循环、修改记录、请求录制、预览截下请求。
- 新的 `harness.extensions`：扩展接口、生命周期、`ExtensionContext`、顺序、出错与时限、预览、按标签排除。
- `agent.*`（Agent 插件）：`agent.extensions` 贡献点取代 `agent.hooks`。
- 验收场景至少覆盖上面“例子”一节，加上回退后扩展状态跟着回去、重启后照日志重建、预览不调模型且与真实请求一致、同一条事件的几个反应先后不影响结果。

## 待定项

1. **名字**：叫“扩展”（`agent.extensions`、`defineExtension`），还是保留“钩子”。推荐“扩展”：它不止在某个点被调用，还有自己的状态与视图。
2. **Profile 在拦截链里的位置**：最里层（推荐：改请求时最后拍板）还是最外层（改回复时最后拍板）。
3. **归约的快照**：在压缩点存（推荐：压缩本来就切断了前面的历史）还是每 N 条存一次。
4. **反应链的深度上限**：推荐同一条事件引出的反应最多 3 层，最终回复后的“接着做”连续最多 3 次。
5. **请求录制**：缺省关、需要时在设置里打开（推荐），还是缺省开、按大小轮转。
6. **`reminder()` 的缺省方式**：写进历史（推荐：与旧应用一致，缓存友好），还是只接在这一次请求末尾。
7. **工具拦截里附加的说明**：写进日志（推荐：模型看到了就要能重放），还是像 omp 那样只交给下一次请求。
8. **反应怎样做 I/O**：直接调 `ctx` 的主动接口（推荐：写多步逻辑方便；内核给每个主动动作记一条日志，测试与回放看得到反应做了什么），还是像 Elm 那样只返回动作的描述、由内核执行（可测性更好，多步逻辑要绕）。
9. **不经事件就会变的数据**（当前时间、本章字数、阅读位置）：视图是纯函数，不能自己去取。推荐两条路：扩展自己的外部数据在反应里读、写成扩展事件（例如写手在用户发言后与 `edit` 的结果之后重新读字数）；当前时间这类通用的，由内核在每次算视图前取一次，作为视图的输入，并记进这次请求的修改记录，回放时用记下的值。
10. **Profile 自带扩展的写法**：`extensions: [...]` 列表，`seed()`、`reminder()`、`sessionState()` 等辅助函数各返回一个扩展（推荐：每项有自己的 id 与状态片，和插件的扩展同一个形状，辅助函数能自由组合）；还是 Profile 只有一个 `setup`，辅助函数返回片段再由作者合并。

## 决策记录

| 日期 | 决策者 | 结论 |
|---|---|---|
| 2026-10-28 | 开发者 | t20 讨论中同意：管线为骨、Profile 为主；Profile 的上下文管理里 `Appending`、`Reminder` 改用钩子做，Profile 的长处是集中与组装；`assemble` 改名 `prompt`；允许改写用户的话；主动接口收窄（不给改工具绑定、会话设置、原始请求体）；请求阶段拿到最终请求、想怎么改都行 |
| 2026-10-28 | 开发者 | 同意以“日志 → 归约 → 状态 → 视图 → 请求 → 副作用 → 日志”为骨架、扩展只做归约、反应、视图、拦截四件事的方向；要求单独写成提案再讨论 |
| 2026-10-29 | 开发者 | 同意：`reduce` 只看自己那一片；同一条事件的反应看同一份状态快照、追加的事件按扩展顺序写入；视图只在发请求与预览时算；扩展的片默认私有、经导出的选择器共享；`pathState()` 与 `scope: "session"`；扩展事件带版本 |
| 2026-10-29 | 开发者 | 同意：`prompt` 能读状态、按模型能力写条件、`<History render filter>`；视图加 `attach`、扩展给自己的事件提供缺省渲染、没留槽时丢弃并写诊断；预览也跑模型拦截链、最里层截下请求 |
| 2026-10-29 | 开发者 | 循环由内核自己写，不再套 OMP 的 `Agent`，与服务商通信只用 `streamSimple`；t02 的“代码以分支为主体”在运行时这一层改为按语义参照 |
| 2026-10-29 | 开发者 | 扩展交片段的字段改名 `contribute`，“视图”只指“状态 → 请求”这一步；Profile 的 `prompt` 改为可选，不写用缺省布局 |
