# w00019 t14 首个垂直切片：实施计划

## Context

**为什么做**：nb-story 问答页（[w00024 t13](../../../w00024-nb-story/tasks/t13-qa-web/README.md)）是 nb-agent-ui 的第一个使用方。t14 的静态稿（[评审板](artifacts/review/index.html)）用书库里的真实问答记录回放，看出了接入时 nb-agent-ui 还缺的五样东西。开发者 2026-10-22 定了本次只做这五项（[README](README.md) 决定 5），其余留给 [t11](../t11-complete-view/README.md)：

1. 会话列表组件 `AgentSessionList`（图 01、09 到 11、13 到 16）；
2. 扩展点 `entries` 接进视图，nb-story 用它在文字回复里画“没核实的出处”（图 01 最后一条回复气泡里的黄色一行）；
3. 被退回的结果节点在过程里只占一行（图 04）；
4. 思考摘要去掉 Markdown 标记（图 05）；
5. 工具组的短语收到这一组的调用，nb-story 才写得出“读了第 33–37 章”（图 05）。

**依据**：
- 行为合同 [`docs/specs/ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)（planned，主工作区那份）。
- nb-story 的数据：[`docs/specs/story/qa.md`](../../../../../docs/specs/story/qa.md) 输出 7（`answer` 参数）、10（一轮怎么结束）、12（`reply.unverifiedRefs`）、15（记录与会话日志成对保存）、24（文字回复里的出处检查）、26（追问时用会话日志恢复会话）。
- 已定的决定（README 决定 1 到 5，不再议）：问答页是第一个垂直切片；不放 rewind 等占位按钮（宿主给 `canMutateHistory: false`）；会话列表第一版只做列表、选中、新建；没核实的出处接 `entries`、由 nb-story 登记；本次做上面五项，空状态可替换、隐藏用量、重命名与删除留在 t11。

**读代码时核实过的事实**（方案依赖它们）：
- `findOutcomeStart`（`src/conversation-turns.ts`）倒扫时越过结果与 `notice` 块，但碰到 `divider` 就停；`splitTrailing` 只摘末尾连续的 `divider`。所以“回复、压缩分隔线、系统提醒”这样排时，分隔线留在块里，回复被收进过程，整轮收起后什么结果都不露（设计审查 F1 用真实 `buildTurns` 复现：`outcomeStart` 等于块数）。这是现有缺陷，本计划在第 3 节一并修。
- 条目若作为单独的系统消息放进 `ctx.messages`，它的位置、时间戳与可见性都由排列顺序决定：排在回复之前、没有回复的轮次末尾时会被收进过程，时间戳晚了会拉长用时（审查 F2、F3）。所以本计划把条目挂在它所跟随的助手消息上（第 4 节）。
- `buildBlocks` 对 `presentation: "node"` 的工具一律切成 `node` 块，不看状态；`isAnswer` 只认成功的结果节点。被退回的 `answer` 因此在过程里画成宿主的整张卡片，并把思维链切成两段（图 04 的“思考 · 4 次操作”、卡片、“思考”）。
- `AgentChainBlock` 对思维链里的工具步骤：`presentation === "card"` 画卡片，其余一律画 `AgentToolStepRow`。`node` 呈现的工具进了思维链就是一行，Vue 层不用改。
- 折叠行露出的第一行只有 `format.ts` 的 `firstLine` 一处，用在 `AgentTextStepRow`（思考与系统提示词）、`AgentTurnBlock` 的信息条目行、`AgentRawView` 的思考。思维链摘要行（`AgentChainSummary`）只写计数或正在执行的那一步，不取思考文字。
- 真实记录里思考的第一行是 `**Gathering later chapter arcs****Checking later chapter summaries**`：模型把几段粗体小标题首尾相接写在同一个思考块里（`~/.local/share/nbstory/book-8576901b/qa/20261020120114398-823fa8.session.jsonl` 的 seq 8、37）。去标记要认这种写法。
- `groupPhrase` 只在 `makeToolGroup`（按渲染器计次）与 `guardTool`（抛错回退）两处被调用；内置四个 explore 工具与 Lab 的两个领域工具登记了它。
- 注册表已有 `entries` 扩展点与合并规则，`EntryRendererEntry` 是 `{messageKind, systemSource?, component}`，没有任何使用方。
- nb-story 的“没核实的出处”不在会话日志里：引擎在一轮结束后算出 `unverifiedRefs`（`packages/nb-story/src/qa/engine.ts`），写进问答记录这一轮的 `reply`（`src/core/qa-records.ts`）。nb-session 有通用的 `meta {key, value}` 条目，harness 适配器静默跳过它；适配器对 OMP 的 `role: "custom"` 消息报“不认识的消息角色”，nb-harness 也不写这种消息。
- 适配器每次 `messages()` 对没改动的消息返回同一个对象，`reuseTurnGroups` 按引用比较整组消息，打节拍时不重算已结束的轮次。宿主给某条消息加条目时要换成新对象并缓存它，否则这层复用失效。
- nb-story 现在的引擎不再写“催交卷”的用户消息（qa 输出 10“不提醒”）；只有旧形状的记录里有，旧记录不能续问、也没有 `unverifiedRefs`（审查 F12）。

**工作方式**：代码在 worktree `.worktree/w00019-nb-agent-ui`（分支 `feat/w00019-nb-agent-ui`，接在 t13 的 `4fb6162ea` 之后）按切片提交；Spec 与 Task 记录在主工作区 `master` 上改（切片 0）。包还没有外部使用方，`groupPhrase` 与 `EntryRendererEntry` 直接改形状，跟着改的只有本仓库的 Lab、测试与 nb-story 草稿（草稿不提交）。

## 技术选型

- **去掉 Markdown 标记**：预览怎么取由宿主决定（Markdown 方言属于宿主），`AgentViewRenderers` 加可选的 `markdownPreview` 函数；包内缺省在核心 `src/format.ts` 手写一个只处理常见写法的函数，不引入库。
  - 包的边界规定核心不依赖任何包（`packages/nb-agent-ui/AGENTS.md`）；Markdown 的解析与方言属于宿主（NeuroBook 有自己的标签与文字标记语法，通用库不认识）。
  - 只作用于折叠时露出的一行，展开后由宿主注入的 Markdown 显示全文，偶尔去得不干净的代价只是预览里多一个符号。
  - 否决 `remove-markdown`：同样是正则，面向整篇文档（表格、脚注），加一个依赖换不来更多正确性。
  - 否决 `marked` 的 lexer 或 `mdast-util-from-markdown` 加 `mdast-util-to-string`（仓库里都有）：解析正确，但为一行预览给视图加一个运行时依赖，而且仍不认识宿主的方言。
- 其余没有通用问题。会话列表的时间用 `Intl.DateTimeFormat`（与 `formatClock` 相同），列表用 nb-ui 已有的 `ScrollArea`、`IconButton`、`Badge`、`Spinner`、`EmptyState`、`Button`。

## 关键设计

### 1. 工具组的短语收到调用：`src/registry.ts`、`src/conversation-turns.ts`、`src/builtin-tools.ts`

签名改为收到这一组里由本渲染器处理的调用：

```ts
| (ToolRendererBase & {
    category: "explore";
    /**
     * 探查组合并摘要中本工具的那一段，例如“读取 5 个文件”“读了第 33–37 章”。收到这一组里由本渲染器处理的全部调用，
     * 按时间顺序，含运行中与出错的；参数可能还是流式的半截，读参数用 argString 等。至少一次。
     */
    groupPhrase: (calls: readonly ToolCallView[]) => ViewText;
})
```

- `makeToolGroup`：把 `Map<ToolRendererEntry, number>` 换成 `Map<ToolRendererEntry, ToolCallView[]>`，仍按渲染器首次出现排序；JS 宿主没给 `groupPhrase` 的回退写成 `{key: "toolGroup.generic", params: {count: calls.length}}`。
- `guardTool`：`groupPhrase` 的回退改为 `(calls) => ({key: "toolGroup.generic", params: {count: calls.length}})`，抛错时仍只报一次诊断。
- 内置四项（`builtin-tools.ts` 的 read、搜索、网页、查询）改为 `(calls) => ({key: …, params: {count: calls.length}})`，文字不变。
- 一个渲染器可以登记几个工具名（nb-story 草稿的“情节与主线”管 `arcs`、`episodes` 等四个），所以只给次数不够，给调用后渲染器能按 `call.name` 与参数分开说。
- 注释写明（审查 F8）：`calls` 含出错与运行中的调用，只想说成功读到的要自己按 `call.status` 过滤；运行中参数可能是半截，短语会随之变化；一组至少两次调用才成形，但同一渲染器在组里可能只有一次。README 写明组短语按调用写、思维链摘要按不同路径计数，两处口径不同。Lab 的 `domain-tools.ts` 样例按 `status` 过滤一次。
- 测试：组里有出错与运行中的调用时，`calls` 原样给出（顺序、状态）。
- 跟着改：Lab 的 `fixtures/nb-agent-ui/domain-tools.ts` 两项；`registry.test.ts`、`conversation-turns.test.ts` 里的写法。

### 2. 思考摘要去掉 Markdown 标记：`src/format.ts`、`src/vue/stream/AgentTextStepRow.vue`、`src/vue/stream/AgentTurnBlock.vue`

`format.ts` 新增：

```ts
/**
 * Markdown 文字折叠时露出的一行：取第一段非空的行，去掉行首的块标记与行内的强调、代码、链接标记，只留文字。
 * 不做完整解析：展开后由宿主的 Markdown 显示全文，这里只保证一行预览里不出现 `**` 之类的符号。
 */
export function markdownPreviewLine(text: string): string;
```

缺省规则只保证常见写法（审查 F6 指出的反例都进测试）：
1. 取去掉首尾空白后的第一个非空行；以代码围栏、`---`、表格行开头的行跳过。
2. 先把行内代码切出来原样保留（代码里的星号不动），之后的步骤只处理代码之外的部分。
3. 首尾相接的粗体（`**A****B**`，真实模型的思考摘要就这样写）在 `****` 处断开，只留第一段。
4. 行首块标记后面必须跟空白才算：标题的 `#`（含行尾收尾的 `#`）、引用的 `>`、列表的 `-`、`*`、`+`、`1.`、`1)` 与任务框；`#伏笔`、`*注：`、`-5℃` 不动。
5. 行内：图片留说明，链接留文字，自动链接留地址；`***`、`**`、`~~`、`==` 成对时去掉，紧挨汉字或全角标点也算（照 NeuroBook 方言输出 6 的 CJK 友好规则）；单个 `*`、`_` 只在两侧是空白、行首行尾或标点时当作强调，`读取_章节_摘要`、`snake_case`、`2 * 3 * 4` 不动（不用 JS 的 `\b`，它把汉字当非词字符）；反斜杠转义还原成字符；`<mark>` 这类行内标签去掉标签留文字。
6. 流式半截：行尾落单的 `*`、`**`、`***`、`_`、`__`、`~~` 去掉（`…arcs*` 不留星号）。

宿主可换（`ports.ts` 与 `AgentViewRenderers`）：

```ts
/** Markdown 文字折叠时露出的一行纯文字；宿主按自己的方言取，缺省用 markdownPreviewLine。 */
markdownPreview?: (text: string) => string;
```

neuro-book 以后注入时用 `nbook.markdown` 的解析取第一行纯文字，方言写法自动一致；nb-story 用缺省。

使用处：
- `AgentTextStepRow` 的 `detail` 改用它（思考与系统提示词都是 Markdown，展开时也按 Markdown 显示）。
- `AgentTurnBlock` 信息条目行的第一行改用它（展开后同样是 Markdown）。
- `AgentRawView` 的思考预览不改，仍用 `firstLine`：原始视图是对照数据用的，展开后也是原文。

`firstLine` 仍由原始视图与 `AgentQueuedMessages`（排队消息是用户的纯文字，不该去标记）使用，保留；模块头的说明改为“Markdown 来源的折叠行用 `markdownPreview`，`firstLine` 只取原文第一行”。

### 3. 被退回的结果节点只占一行：`src/conversation-turns.ts`

`buildBlocks` 遇到工具调用时：

```ts
const renderer = registry.resolveTool(call.name);
// 结果工具被退回（出错或参数无效）的那几次是过程：进思维链画成一行，不画宿主的节点组件（Spec“结果节点”）。
const rejectedOutcome = renderer.outcome === true && toolCallPhase(call.status) === "error";
if (renderer.presentation === "node" && !rejectedOutcome) { flush(); blocks.push({kind: "node", …}); }
else append(step);
```

- 运行中与流式中的结果调用仍是 `node`（宿主组件看得到正在写的答案）；失败那一刻移进思维链。只对 `outcome` 渲染器生效，提问、任务清单等普通节点出错照旧。
- 移进思维链后：它不再切开思维链，前后两段合成一条（图 04 的“思考 · 4 次操作”与“思考”合并）；按 `interact` 类别结束当前工具组；计入这条思维链的操作次数与失败次数（整轮的计数本来就算它，不变）。
- 一行上显示的是渲染器的图标、动作名与 `summary(call)`，展开是 `AgentToolDetail`（出错时错误在最上方，已有行为）。“退回：41.20 不是读过的原文段落”这句由渲染器的 `summary` 在 `call.status` 为出错时写出，视图不替所有出错的工具改行内文字（见“待确认”第 1 项）。`ToolRendererBase.summary` 的注释补一句：调用出错时也会调用它，可以写出失败原因。
- Lab 的 `answer` 登记（`domain-tools.ts`）的 `summary` 改成出错时写“退回：”加 `call.error` 的第一行；`call.error` 为空时（适配器 `applyRunEnd` 把运行结束时还没有结果的调用改成出错、不带说明）写“没有完成”，不说成退回（审查 F7）。`ToolRendererBase.summary` 的注释写明：出错时也会调用；它同时用于步骤行、工具组的明细与详情的代码块标签。
- 整轮的结果调用都被退回：只剩一条思维链，没有结果区，整轮收起只露出摘要里的失败计数，状态照运行的结束方式（与改前一致）。写进 Spec 术语与验收 29，补单测。
- 已知小跳动（接受）：被退回的调用是整轮第一个块时，后一条思维链并进它、思维链 id 改变，`collapsed` 下用户点开过的那条会收起；节点变成行时宿主组件被卸载。被退回的行是 `interact` 类，会结束当前探查组（读、退回、读分成两组），不为它在组里加一种项。

**一并修现有缺陷（审查 F1）**：`splitTrailing` 摘末尾分隔线时越过夹在其中的 `notice`：末尾由 `divider` 与 `notice` 混成的一段里，`divider` 移到 trailing，`notice` 留在结果区。补单测：回复、压缩、提醒三条依次排时，回复仍在结果区，`outcomeMessage` 是那条回复。

### 4. 条目渲染器：挂在助手消息上的附注（`src/types.ts`、`src/registry.ts`、`src/vue/stream/`、`src/vue/stream/AgentRawView.vue`）

**条目从哪来：助手消息上的附注。** 宿主在它要跟随的那条助手消息上带出附注；附注跟着这条消息走，不占消息流里的位置，不参与分轮、用时与计数（审查 F1、F2、F3）：

```ts
export type MessageAnnotationView = {
    /** 条目渲染器按它匹配，例如 "nb-story.unverified-refs"。 */
    customType: string;
    /** 没有登记渲染器、或渲染器出错时显示的一句；写成单独读也看得懂。 */
    text: string;
    /** 条目渲染器读的结构化数据。 */
    details?: JsonValue;
};
export type AssistantMessageView = { …现有字段; /** 宿主给这条回复加的附注，显示在回复正文之后。 */ annotations?: MessageAnnotationView[] };
```

- **显示位置**：附注画在这条消息的文字之后，和文字在同一个容器里。消息是这一轮的最终回复时，附注在回复气泡里、正文下方（与图 01 一致），整轮收起后照常露出；消息的文字在过程里（中间的文字步骤行），附注随这一行展开时显示；消息没有文字时，附注作为一个独立的块排在这条消息的块之后，按“信息条目”的位置规则显示。
- **没有登记渲染器**：画默认的淡色一行（`text`）。**渲染器抛错**：退回默认的淡色一行并打一条开发诊断（审查 F11），不画错误卡片；`RenderGuard` 加一个 `fallback` 插槽供这里使用。
- **原始视图**：附注是那条助手消息的字段，JSON 模式里看得到，字段行写出 `annotations` 的条数与 `customType`；原始视图不用条目渲染器。待确认第 2 项因此不再存在。
- **引用稳定**：宿主给某条消息加附注时换成新对象，并按依据缓存（例如按消息 id 加出处列表），打节拍时给同一个对象；README 写明。补一条单测：带附注的轮次在 ctx 整体替换后沿用同一分组。

**注册表**（审查 F5，不收窄已有形状）：`EntryRendererEntry` 保留 `messageKind`、`systemSource`，新增可选 `customType`：

```ts
export type EntryRendererEntry = RegistryEntryBase & {
    messageKind?: MessageView["kind"];
    systemSource?: SystemMessageSource;
    /** 按附注（以后也包括自定义系统消息）的 customType 精确匹配。两个渲染器不能声明同一个。 */
    customType?: string;
    /** 接收 `EntryComponentProps`、发 `HostComponentEmits`。 */
    component: Component;
};
export type EntryComponentProps = HostComponentContext & {annotation: MessageAnnotationView; message: AssistantMessageView};
```

- `AgentViewRegistry` 加 `resolveEntry(customType: string): EntryRendererEntry | null`，只按 `customType` 精确匹配；本次视图只消费附注。按 `messageKind`、`systemSource` 匹配内置消息的那一半仍归 t11（Spec 注册表一行照写，“视图读取”的范围写清）。
- 冲突：两个条目渲染器声明同一个 `customType` 时抛 `AgentViewRegistryConflictError("entries", {kind: "customType", customType}, …)`；`RegistryConflict` 与 `describeConflict` 各加一种。理由同工具名：谁生效不能取决于登记先后。
- 公开入口导出 `MessageAnnotationView`、`EntryComponentProps`。

**视图**：附注由一个内部组件 `AgentMessageAnnotations`（`src/vue/stream/`，`验证入口: AgentConversationView`）画，最终回复、文字步骤行与独立块三处共用：

```vue
<template v-for="annotation in annotations" :key="annotation.customType + index">
    <RenderGuard v-if="entry(annotation)" :source="`条目 ${entry.id} 的组件`">
        <component :is="entry.component" :annotation :message :ctx :services :locale @action="emit('action', $event)" />
        <template #fallback>…默认的淡色一行…</template>
    </RenderGuard>
    <div v-else class="…淡色一行…">{{ annotation.text }}</div>
</template>
```

### 5. nb-story 的“没核实的出处”怎么进来：宿主在适配器之外补

推荐 nb-story 问答页从问答记录读出每一轮的 `reply.unverifiedRefs`，给那一轮最终回复的助手消息加附注；适配器不改。

```ts
// nb-story 问答页（w00024 t13）里，示意：
{...replyMessage, annotations: [{customType: "nb-story.unverified-refs", text: `没核实的出处：${refs.join("、")}`, details: {refs}}]}
```

理由：
- 数据的真相源是问答记录：出处检查在一轮结束后做（qa 输出 24），结果只在记录里（输出 12 的 `reply.unverifiedRefs`），命令行也从记录读。
- 会话日志是交还给模型的历史：追问时整份恢复成模型的上下文（输出 26），记录与日志成对保存并核对摘要（输出 15）。往日志里写要改 w00024 的保存与恢复规则，换来的只是显示上的方便。
- 适配器保持只认 harness 的格式，不认识 nb-story 的键。

对应关系由 nb-story 按自己的数据定：记录的第 N 轮对应日志里第 N 个用户提问开始的那一轮，附注挂在这一轮最后一条带文字的助手消息上。失败、中断的轮次也有会话日志（qa 输出 15），对应不能漏；旧形状的记录没有 `unverifiedRefs`，不用挂。运行中的一轮还没有检查结果，`turn_end` 到了再补。

nb-story 登记的条目渲染器（w00024 t13 写，不在本 Task）：读 `details.refs`，画“没核实的出处：41.20 …”，点出处发 `reference.open`，与答案卡片里的出处走同一条路。

### 6. 会话列表组件 `AgentSessionList`：`src/types.ts`、`src/format.ts`、`src/messages.ts`、`src/vue/AgentSessionList.vue`、`src/vue/index.ts`

**数据**（核心 `types.ts`，经核心入口导出；以后 t11 的会话列表弹窗在 `ctx.panels` 里用同一个形状）：

```ts
export type AgentSessionListItem = {
    id: string;
    /** 空串时显示“未命名会话”。 */
    title: string;
    /** 第二行的补充说明，宿主写好，例如“3 轮 · 图当目录”；缺省不显示。 */
    description?: string;
    /** 最近活动的时刻（毫秒）。 */
    updatedAt: number;
    status: "idle" | "running" | "interrupted" | "error";
    /** 需要注意的一句，提醒色另起一行，例如“读到 38.12，早于你现在的位置”；图标缺省 i-lucide-circle-alert。 */
    note?: {text: string; icon?: string};
};

export type AgentSessionListState = "ready" | "loading" | "error";
```

**组件**：

```ts
type AgentSessionListProps = {
    items: readonly AgentSessionListItem[];
    selectedId: string | null;
    /** 缺省 "ready"。loading 与 error 时不显示条目。 */
    state?: AgentSessionListState;
    /** error 时的说明；缺省用包内文字“会话列表没取到”。 */
    errorMessage?: string;
    /** 宿主提供的当前时间，时间列按它写“今天的时刻 / 昨天 / 月-日 / 年-月-日”。 */
    now: number;
    locale: AgentLocale;
    /** 是否显示自己的标题行（标题与新建按钮）；放进宿主的下拉、宿主自有新建入口时传 false。缺省 true。 */
    header?: boolean;
    /** 覆盖包内文字（审查 F4）：nb-story 整页叫“对话”，给整句；英文也由宿主给。 */
    labels?: Partial<Record<"title" | "create" | "loading" | "empty" | "error" | "retry" | "untitled", string>>;
};
type AgentSessionListEmits = {action: [action: AgentViewAction]};
```

- 发出的 action 与视图同一套：点一行发 `session.select {sessionId}`（点已选中的也发，视图不去重），点新建发 `session.create {}`，出错时点重试发新增的 `sessions.refresh`（命名同 `history.refresh`、`changes.refresh`）。宿主可以把它和视图的 action 交给同一个处理函数；t11 的会话列表弹窗复用这个组件时原样转发。
- 不 inject：它挂在视图之外（宿主的左栏或下拉），语言由 `locale` 属性给，文字直接用核心的 `agentText(locale, key)`。不持有状态，选中由 `selectedId` 受控。能力标签 `[]`。
- 布局：根是纵向 flex、高度随父容器；标题行（`header` 为 true）左边标题、右边 `IconButton`（`i-lucide-square-pen`，名称“新建会话”）；下面是 `ScrollArea` 包的 `<ul>`，每行一个 `<button>`，选中行 `aria-current="true"`、强调色浅底。行内三行：标题（单行截断）与时间同一行；说明与状态同一行（运行中是 `Spinner` 加“运行中”，已中断是中性 `Badge`，出错是危险色 `Badge`）；提醒行（提醒色小字，图标加文字）。宽度不设下限，260px 的左栏与 390px 手机的下拉里都不横向溢出。
- 三种状态：`loading` 为 `Spinner` 加“正在加载会话”；`ready` 且没有条目为 `EmptyState`“还没有会话”；`error` 为危险色说明加 `Button`“重试”。三种状态都保留标题行与新建按钮。
- 时间：`format.ts` 新增 `formatListTime(timestamp, now, locale)`，按本地时区的日历日比较（不用 `now - 24h`，跨夏令时也对）：同一天写 `HH:mm`；前一天用 `Intl.RelativeTimeFormat(locale, {numeric: "auto"})` 写“昨天”“yesterday”；同一年用 `Intl.DateTimeFormat` 的 `{month: "short", day: "numeric"}`（“10月18日”“Oct 18”）；否则加上年。`updatedAt` 晚于 `now`（多机时钟差）时按同一天写时刻。时间放在 `<time datetime>` 里。测试用 `new Date(年, 月, 日, 时, 分)` 构造时刻，含一个跨夏令时的用例。README 写明宿主要定期更新 `now`（例如每分钟），否则过了午夜“今天”的行不会变成“昨天”。
- 文字表（`messages.ts`，中英各一份）加：`sessions.title`、`sessions.create`、`sessions.loading`、`sessions.empty`、`sessions.error`、`sessions.retry`、`sessions.running`、`sessions.interrupted`、`sessions.failed`；未命名沿用 `header.untitled`；`labels` 给了的项覆盖它们。
- 读屏与键盘：`<ul role="list">`（`list-style: none` 时 Safari 会丢列表语义），每行一个 `<button>`，选中行 `aria-current="true"`；这是导航式列表，不是 `listbox`，不做方向键漫游，`.md` 写明，t11 的弹窗沿用。状态除颜色外都有文字。
- 谁关下拉：列表不持有开关。宿主收到 `session.select`、`session.create` 后自己关下拉；`sessions.refresh` 不该关。README 写明。
- `status` 的注释写明：宿主按自己的状态映射（nb-story 的问答记录有中断与出错；主应用的会话以后接时再定来源）。
- 能力标签按实现如实声明：不持有任何 `ref` 时为 `[]`，用到就写 `state:local`。
- `types.ts` 的 `BuiltinAgentViewAction` 加 `{type: "sessions.refresh"}`。
- `src/vue/index.ts` 导出 `AgentSessionList`（成为受管组件，`docs:check` 机检同名 `.md` 与标签）；同名 `AgentSessionList.md` 写布局、交互、数据与“与会话列表弹窗的关系”。

**与 Spec 里会话列表弹窗的关系**：Spec 的“面板与弹窗”有一个顶栏打开的会话列表弹窗（三种筛选、搜索、翻页、新建、归档、恢复、就地重命名），由 t11 做。本组件是它的列表本体：弹窗以后在本组件外面加筛选与搜索栏、翻页，行上的重命名、归档、恢复加进本组件（同一套 `session.*` action）。这样只有一份会话行的画法，嵌入页面（左栏、下拉）和弹窗看到的一样。

### 7. Lab 与 e2e：`packages/neuro-book/src/plugins/lab/web/fixtures/nb-agent-ui/`、`packages/neuro-book/e2e/lab-agent-ui.e2e.ts`

- **会话列表场景**：新文件 `session-list.scenes.ts`，在 `index.ts` 用 `defineSubjectFixture` 登记 `AgentSessionList`：`subject: async () => ({default: (await import("@notnotype/nb-agent-ui/vue")).AgentSessionList})`（不经 `host.ts` 包装，它不 inject），`events: ["action"]`。场景：`list`（五行：选中、运行中、带提醒行、已中断、出错，时间覆盖今天、昨天、更早）、`no-header`（下拉里的形状）、`loading`、`empty`、`error`、`english`。`index.dom.test.ts` 要求每个可挂载组件至少一个场景、输入能 JSON 往返，这几个都满足。
- **条目渲染器场景**：`domain-tools.ts` 加 `labDomainEntriesContribution`（模块头的说明改为“领域工具与条目”），登记 `customType: "nb-story.unverified-refs"` 的条目组件 `LabUnverifiedRefsEntry.vue`：读 `details.refs`，提醒色一行，点出处发 `reference.open {target: "paragraph://<出处>"}`，与 `LabAnswerNode` 的写法相同。`host.ts` 的 `labAgentRegistry()` 加上它。`view.scenes.ts` 加场景 `reply-unverified`：第一轮先读两次原文、再文字回复（有过程，整轮能收起），回复带这种附注；第二轮回复带一条没登记的 `customType` 的附注，看默认的淡色一行。
- **时间与时区**：Lab 场景里的时间按本地时区构造（夹具里用 `new Date(年, 月, 日, 时, 分).getTime()`），e2e 不断言时间文字（审查 F10）。
- **已有场景**：`answer` 场景的数据不变（已经是“退回一次、交成功一次、后面一条压缩分隔线”），改的是它的画法；`running-live` 场景的一段思考改成真实记录的 `**…****…**` 写法，看去标记的效果。
- **e2e**（`lab-agent-ui.e2e.ts`）：
  - `answer`：展开整轮后答案卡片仍只有一个，被退回的那次是一行，行内有“退回”；
  - `reply-unverified`：整轮收起后附注仍在回复气泡里，点出处发出 `reference.open`；
  - `AgentSessionList` 的 `list`：点一行发 `session.select`，点新建发 `session.create`；`error` 场景点重试发 `sessions.refresh`。
  - `lab-scenes.e2e.ts` 自动把新场景纳入 390 宽巡检。

### 8. 文档：`packages/nb-agent-ui/README.md`、组件 `.md`

- README“宿主接入”加三段：会话列表怎么摆（左栏、下拉，`header` 与宿主自己的新建入口）；附注与条目渲染器（登记、给回复加附注的写法、引用稳定的约定，示例指向 Lab 的 `domain-tools.ts`）；`groupPhrase` 收到调用的写法与口径；会话列表要宿主定期更新 `now`、谁关下拉。
- 组件 `.md`：新增 `AgentSessionList.md`；新增 `AgentMessageAnnotations.md`（`验证入口: AgentConversationView`）；改 `AgentTurnBlock.md`（回复里的附注、没有文字的消息的附注块）、`AgentTextStepRow.md`（折叠时露出去掉标记的第一行）、`AgentChainBlock.md`（被退回的结果调用是一行）、`AgentRawView.md`（字段行写出附注）、`AgentConversationView.md`（会话列表不在视图里，另有组件）。
- 包的 `AGENTS.md`：`./vue` 入口导出的组件从“只有 `AgentConversationView`”改为它与 `AgentSessionList`。

## Spec 与文档改动

`docs/specs/ui/agent-conversation-view.md`（主工作区 master，切片 0；正文不写 Task 编号，`docs:check` 会查）：

- **目标与非目标**：“不包含 Inline AI、左侧会话栏和 Trace Viewer”改为视图本身不含会话栏；包另提供会话列表组件，由宿主摆在左栏、下拉或弹窗里。
- **Props 与事件**：“包公开的组件只有这个视图”改为这个视图与 `AgentSessionList`。
- **新增小节“会话列表”**（放在“面板与弹窗”之前）：props 形状（同关键设计 6）、行的内容、三种状态、发出的 action、时间写法；会话列表弹窗的列表部分就是它。
- **消息**：`assistant` 消息加 `annotations?`（`customType`、`text`、`details?`）与说明：显示在这条消息的文字之后，没有文字时作为独立的块。
- **注册表**：条目渲染器一行改为“匹配的消息类型与系统条目来源，或附注的 `customType`；内容组件”，写明视图现在只按 `customType` 读取附注；工具渲染器一行的“探查组的合并摘要”补“收到这一组里它处理的各次调用”；“宿主组件收到…”一段补条目组件收到这条消息；工具名匹配一段后加一句：两个条目渲染器声明同一 `customType` 时构造失败。
- **术语**：“结果节点”一条补“被退回的那几次是过程，在思维链里显示为一行，不画 `node` 组件；全部被退回时这一轮没有结果区”；新增“附注”：宿主挂在助手消息上的补充信息，由条目渲染器画，没登记或出错时显示为淡色一行。
- **分轮视图**：结果区一条补“末尾的分隔线移到轮末汇总之后时，夹在其中的信息条目留在结果区”。
- **分轮视图**：常显层的信息条目一项同上；思维链“思考显示为一行摘要”改为“折叠时露出第一行，去掉 Markdown 标记”。
- **面板与弹窗**：会话列表一项写明列表部分复用“会话列表”小节的组件。
- **action**：会话组加 `sessions.refresh`。
- **失败与恢复**：注册表冲突一条加 `customType`；条目组件抛错时退回默认的淡色一行，不画错误卡片。
- **验收**新增 26 到 31：
  - 26 会话列表的行：五个会话（选中、运行中、已中断、出错、带提醒行），每行有标题、说明、时间、状态与提醒；点一行（含已选中的）发 `session.select`，点新建发 `session.create`；时间按日历日写今天的时刻、昨天、月日、年月日。
  - 27 会话列表的状态：加载中、空、出错三种显示；出错时重试发 `sessions.refresh`；`header` 为 false 时没有标题行与新建按钮；`labels` 覆盖包内文字。
  - 28 附注与条目渲染器：最终回复带一条登记了 `customType` 的附注，整轮收起后由宿主组件画在回复气泡里，组件收到 ctx、服务、界面语言、这条附注与消息，点出处的 `reference.open` 到达宿主；附注在中间的文字步骤行上时随这一行展开显示；没有文字的消息的附注作为独立块显示；没登记的 `customType` 与组件抛错都显示为淡色一行；两个渲染器声明同一 `customType` 时构造失败。
  - 29 被退回的结果：结果工具退回一次再交成功，展开整轮后被退回的那次是思维链里的一行，宿主的 `node` 组件只出现一次，退回前后的过程是同一条思维链；全部被退回时这一轮没有结果区；运行结束时没有结果的结果调用同样是一行。回复、压缩、提醒依次排时回复仍在结果区。
  - 30 思考预览：思考第一行是 `**Finding X**`、`## X` 或两段粗体首尾相接时，折叠的思考行露出去掉标记的文字（首尾相接的只露出第一段）；行内代码里的星号、`snake_case`、`读取_章节_摘要`、`#伏笔` 保留；宿主给了 `markdownPreview` 时用宿主的。
  - 31 工具组短语：explore 渲染器的短语按调用参数写，一组里它的三次调用写出一个短语；短语回调抛错时退回“调用了 3 次”。
- **Smoke** 段：单元测试加 28（注册表与分轮部分）、29、30、31；挂载测试与 e2e 加 26、27、28、29。

Task 记录（主工作区）：t14 README 链接本计划并记进展；t11 README“t13 转来的事项”里没核实的出处一条改为已由 t14 用附注与 `customType` 接上 `entries`，按 `messageKind`、`systemSource` 匹配内置消息的那一半与其余扩展点仍归 t11；w00024 t13 README 加一条接入说明（第 5 节的附注写法与对应关系、`customType`、`groupPhrase(calls)` 新签名、注册表不用内置工具登记），并更正“催交卷”那条：现在的引擎已不写，只在旧记录里。

## 切片

每片在 worktree 单独提交，提交前跑本片的验证。“包验证”是 `packages/nb-agent-ui` 的 `bun run typecheck` 与 `bun run test`；“应用验证”是 `packages/neuro-book` 的 `bun run typecheck` 与 `bun run test`；“e2e”是 `packages/neuro-book` 的 `bun run test:e2e -- lab-agent-ui lab-scenes`。跑 e2e 前先暂存本片、停掉多余的开发服务，跑完之前不改源码（t13 的教训：Lab 的 e2e 读源码）。

| 片 | 内容 | 关键设计 | 验证 |
|---|---|---|---|
| 0 | Spec 全部条目与验收 26 到 31（主工作区 master） | Spec 与文档改动 | 仓库根 `bun run docs:check`、`bun run governance:check` |
| 1 | `groupPhrase(calls)`、内置与 Lab 登记、测试 | 1 | 包验证、应用验证 |
| 2 | `markdownPreviewLine`、`markdownPreview` 端口与两处使用、`running-live` 思考数据 | 2、7 | 包验证、应用验证、e2e |
| 3 | 被退回的结果调用进思维链、`splitTrailing` 修正、Lab `answer` 的 `summary`、e2e | 3、7 | 包验证、应用验证、e2e |
| 4 | `annotations`、`EntryRendererEntry.customType`、`resolveEntry` 与冲突、`AgentMessageAnnotations` 与三处位置、`RenderGuard` 的 `fallback`、原始视图、Lab 条目与 `reply-unverified` 场景、e2e | 4、7 | 包验证、应用验证、e2e |
| 5 | `AgentSessionList`、`formatListTime`、文字表、`sessions.refresh`、`/vue` 导出、Lab 场景、e2e | 6、7 | 包验证、应用验证、e2e、`bun run docs:check` |
| 6 | README、组件 `.md`、包 `AGENTS.md` 收尾（各片已随改的不重复） | 8 | `bun run docs:check`、`bun run governance:check`、包验证 |

各片在逻辑上互不依赖，顺序按改动面从小到大；片 2、4 都改 `AgentTurnBlock.vue`，片 3、4、5 都改 Lab 的场景与 e2e，按顺序做、逐片提交即可。

## 验收映射

| 验收 | 覆盖 |
|---|---|
| 26 | `src/vue/AgentSessionList.dom.test.ts`（行内容、选中标记、两种 action）；e2e `lab-agent-ui` 会话列表 `list` 场景 |
| 27 | `AgentSessionList.dom.test.ts`（三种状态、重试、`header`）；e2e `error` 场景重试；`lab-scenes` 390 宽巡检 |
| 28 | `src/registry.test.ts`（`resolveEntry`、`customType` 冲突）；`src/vue/AgentConversationView.dom.test.ts`（最终回复、文字步骤行、没有文字的消息三处位置，组件 props 与 action，没登记与抛错退回默认一行）；`conversation-turns.test.ts`（带附注的轮次整体替换 ctx 后沿用分组）；e2e `reply-unverified` |
| 29 | `conversation-turns.test.ts`（退回的调用在思维链、前后合成一条、交成功的仍是节点、全部被退回、运行结束时没有结果、回复压缩提醒依次排）；`AgentConversationView.dom.test.ts`（宿主节点组件只渲染一次）；e2e `answer` |
| 30 | `src/format.test.ts`（真实记录的首尾相接粗体、标题、列表、行内代码、`snake_case`、`2 * 3`、链接、转义、流式半截）；`AgentConversationView.dom.test.ts` 一条（思考行露出的文字没有 `**`） |
| 31 | `conversation-turns.test.ts`（短语按参数写、按渲染器分开收到调用、出错与运行中的调用原样给出）；`registry.test.ts`（抛错回退带次数） |
| 15（沿用） | 28 的抛错降级用例与它共用 `RenderGuard`，`AgentConversationView.dom.test.ts` 已有的工具组件用例不动 |

## 验证

- 每片按上表自跑；全部完成后在 worktree 再跑一遍包验证、应用验证、e2e、`docs:check`、`governance:check`。
- 变异检查（改坏一处，相应用例应失败）：`buildBlocks` 去掉 `rejectedOutcome` 判断；`splitTrailing` 恢复只摘末尾连续分隔线；`resolveEntry` 永远返回 null；附注渲染器抛错时不走 `fallback`；`markdownPreviewLine` 不拆 `****`；`makeToolGroup` 只传第一次调用；`AgentSessionList` 点击行不发 action；`formatListTime` 改用 `now - 24h`。
- 真实浏览器：开发者在 Lab 看 `AgentSessionList` 各场景、`AgentConversationView` 的 `answer`、`reply-unverified`、`running-live`，明暗两种主题与 390 宽。
- 真实数据：用草稿 worktree `.worktree/w00019-t14-drafts` 的问答页（不提交）换上新接口重截图 01、04、05：`story-tools.ts` 的短语改收调用、`DraftStoryMarkdown.vue` 去掉 `<!-- unverified -->` 替身改成给回复加附注并登记条目渲染器、`DraftSessionList` 换成 `AgentSessionList`（`labels` 改称“对话”）。这一步只为给开发者看效果，截图放评审板 r2，不进分支。
- 未验证边界：nb-story 问答页的正式接入（记录的轮与日志的对应、条目插入、运行中补条目）在 w00024 t13；会话列表弹窗在 t11。

## 不做与风险

**不做**：
- 空状态可替换、隐藏用量、会话重命名与删除（决定 5，留 t11）。
- `entries` 以外的扩展点（顶栏动作、面板、待处理区、状态栏）与条目匹配用户、助手、提醒等内置消息（留 t11，需要时再加）。
- 适配器认 OMP 的 `role: "custom"` 消息：现在没有写它的一方；以后 harness 写自定义消息时，适配器把它转成带 `customType`、`details` 的系统消息即可，形状已经对齐。
- 内置 `read` 的组短语按次数写“读了 N 个文件”，同一文件读两次算两个，与思维链摘要按不同路径计数对不上。有了调用后改起来很容易，但它改的是内置文字，不在本次五项里，记给 t11。
- 适配器把同一条消息里的多个思考块直接拼接、不加分隔（`harness.ts` 的 `thinking +=`）；真实记录里首尾相接的粗体是模型在一个块里写的，与此无关，本次只在预览里处理。展开后的全文怎么显示 `****` 取决于宿主的 Markdown。

**风险**：
- **宿主加附注时破坏引用稳定**：每次新建带附注的消息对象，打节拍时那一轮就重算一次。README 写明约定，并有单测覆盖。
- **nb-story 的轮与日志对不上**：失败、中断的轮次也有日志，对应漏算会把附注挂错。写进 w00024 t13 的接入说明。
- **去标记的正则误伤**：用 `format.test.ts` 的反例兜底（`snake_case`、`2 * 3 * 4`、行内代码里的星号）；这些用例调用真实的 `markdownPreviewLine`，不是替身。
- **被退回的调用从节点变成行时的跳动**：运行中结果调用从卡片（正在写）变成一行（被退回）会让下方内容上移。`processDisclosure: "live"` 时用户正看着过程，属预期；滚动锚点规则（Spec“历史与滚动”）照常起作用，e2e 的现有滚动用例兜底。


## 待确认

主 Agent 按开发者“小取舍按推荐、重要决策再问”的要求处理，没有要开发者拍板的项：

1. 出错的步骤行写不写失败原因：按推荐，由渲染器的 `summary` 写，`call.error` 为空时另写（第 3 节）。
2. 条目进 `ctx.messages` 后原始视图看得到：设计审查后条目改为助手消息上的附注（第 4 节），这一项不再存在。

## 设计审查

Sonnet 只读审查 12 条（重要 3、建议 9，报告见 [evidences/design-review.txt](evidences/design-review.txt)），全部成立，处理如下：

- F1（分隔线之后的提醒让回复被收进过程）：现有缺陷，第 3 节一并修，补单测与验收 29。
- F2、F3（条目的位置与时间戳靠宿主约定）：条目改为助手消息上的附注，不占消息流位置，画在回复气泡里，与图 01 一致（第 4、5 节）。
- F4（“会话”与“对话”）：`AgentSessionList` 加 `labels`。
- F5（收窄了 `EntryRendererEntry`）：保留 `messageKind`、`systemSource`，新增可选 `customType`。
- F6（核心自写方言）：加 `markdownPreview` 端口由宿主决定，缺省规则按反例收紧；`firstLine` 的使用方说明改正。
- F7（退回的边界）：`call.error` 为空的写法、全部被退回、id 变化与探查组被切断写明；前两项进验收。
- F8（`calls` 的写法提示）：注释、README 与 Lab 样例写明按状态过滤与口径不同。
- F9（会话列表细节）：日历日、`Intl` 写法、`now` 要更新、`role="list"`、谁关下拉、标签如实声明、`status` 的来源。
- F10（验收映射）：`reply-unverified` 场景加过程，28、29 补位置与退回用例，Lab 时间按本地时区构造、e2e 不断言时间。
- F11（条目抛错过重）：退回默认的淡色一行，`RenderGuard` 加 `fallback` 插槽。
- F12（催交卷依赖已过时）：删掉这条依赖，改为提醒 w00024 t13 对应关系里失败、中断的轮次。
