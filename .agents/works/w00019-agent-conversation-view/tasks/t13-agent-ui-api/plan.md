# w00019 t13 nb-agent-ui 接口整理：实施计划

## Context

**为什么做**：t10 收尾时三位审查者（API 形状、可维护性、易用性与缺失）审查了 `packages/nb-agent-ui`。开发者 2026-10-22 把发现分成三类，本计划只做第二类：在 t11 往视图里加顶栏、面板、待处理区之前，把宿主接入的接口定下来，让 nb-story 问答页（w00024 t13，第一个使用方）与 t11 之后的主应用（第二个使用方）少写代码。不为假想的第三方加选项。

**依据**：
- 行为合同 [`docs/specs/ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)（planned；主工作区那份）。
- 审查报告 `/tmp/claude-1000/review-w00019-t10-quality/report-api.md`、`report-maint.md`、`report-complete.md`（下文写作 api N、maint N、complete N）。
- nb-story 的需要：[w00024 t13 README](../../../w00024-nb-story/tasks/t13-qa-web/README.md) 决定 7（运行中逐步展开）、决定 8（答案卡片常显、出处可点）。nb-story 的作答是收尾工具 `answer`（[`story/qa.md`](../../../../../docs/specs/story/qa.md) 输出 7、8：校验不过会被退回成工具错误，Agent 改了再交）。

**范围**（开发者定的第二类，七项）：宿主组件通道与原图预览并进 action；工具渲染器的“结果”标记；内置工具拆成核心数据与 Vue 组件；收窄公开面；宿主起步套件；三条行为原则（先写 Spec）；拆分 `AgentTurnBlock` 与收重复。第一类已在 t10 改完，第三类（扩展点 `entries` 等接上、无障碍、停止与复制反馈、Lab 夹具三遍登记、缺提供方的开发期警告、消息操作溢出）属于 t11，本计划不碰。

**前提**：worktree `.worktree/w00019-nb-agent-ui` 里还有 t10 第一类修改未提交（36 个文件，含 `RenderGuard.vue`、`describeUsage`、核心入口显式导出）。本计划以这份工作区代码为基准核实，开工前 t10 先提交（已提交，`a1a862d4e`）。

**核实结果**：每一项都对照代码读过，属实的按下文设计。以下说法不属实或已过时，不计划：
- api 5“渲染层入口导出 22 个组件”实为 23 个；同条的“`PreviewImageRequest` 不在公开入口”“`export type * from "./types"` 通配”已在 t10 改掉。
- api 7“要合并摘要必须知道内部文字键”不对：`groupPhrase` 返回 `ViewText`，可以直接给中英两份（用 `formatText` 代入次数）；内部键只是可选的复用，且有类型 `AgentTextKey`。所以不加 `defineToolRenderer`。
- maint 5 的“`AgentFileChanges` 自定义 `FileChange` 类型”“`AgentConversationTurn` 里的货币符号”t10 已改（用 `FileChangeView`、`describeUsage`）；只剩 `AgentRawView` 一处，而且它把单价未知显示成 `$null`（核实时新发现，第 7 项顺带修）。
- maint 1“42 条纯逻辑测试被迫进 Vitest”：`conversation-turns.dom.test.ts` 29 条，加 `registry.dom.test.ts` 里用到内置登记的几条；数字有出入，结论成立。
- maint 3、maint 13 的计数有小出入（`AgentMarkdown` 转发 7 处不是 8 处；带回退的缩进读取 5 处、写死的 24px 4 处），结论成立。

**工作方式**：代码在 worktree 分支 `feat/w00019-nb-agent-ui` 上按切片提交；Spec 与 Task 记录在主工作区 `master` 上改（切片 0）。包还没有外部使用方，旧形状不做兼容，跟着改的只有本仓库的 Lab、e2e 与测试。

## 技术选型

无。全部是包内接口与结构整理，不引入新依赖。

## 关键设计

### 1. 宿主组件通道：`src/registry.ts`、`src/vue/tools/AgentToolDetail.vue`、`src/vue/stream/AgentTurnBlock.vue`

核实：`ToolNodeProps = {call, ctx}`，`AgentToolDetail` 与 `AgentTurnBlock` 挂宿主组件时只传 `:call :ctx`，没有 `@action`，也没有 services（api 3、complete 2 属实）。

注册表里宿主给的组件统一收一套明面 props、只发一种事件。替换 `ToolNodeProps`、`ToolDetailProps`：

```ts
/** 宿主登记的组件都收到的部分；t11 接上的条目、面板、状态栏条目沿用，再各加自己的数据。 */
export type HostComponentContext = {
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    locale: AgentLocale;
};
/** 工具的 detail 与 node 组件收到的 props。 */
export type ToolComponentProps = HostComponentContext & {call: ToolCallView};
/** 宿主组件只发一种事件；视图原样交给宿主。 */
export type HostComponentEmits = {action: [action: AgentViewAction]};
```

- 走 props 与 emits，不走 provide/inject：组件规范把 inject 算隐藏通道（`docs/standards/code/components.md`“明面通道与隐藏通道”），宿主组件是别人写的，签名上要看得出它拿到了什么。
- 挂载处统一 `<component :is :call :ctx :services :locale @action="emit('action', $event)">`：`AgentTurnBlock` 的 node、`AgentToolDetail` 的 detail。`AgentToolDetail` 加 `services` 属性与 `action` 事件；`AgentRawView` 给它传 `services` 并转发。内置的 `AgentFileContentDetail`、`AgentCommandDetail`、`AgentTaskListNode` 改为 `defineProps<ToolComponentProps>()`（全量声明，免得多出的 `services` 落成根元素的属性），并声明 `action` 事件（不用也声明，免得 `@action` 落成根元素的原生监听）。
- 渲染出错仍由 t10 的 `RenderGuard` 兜底，不变。

### 2. 原图预览并进 action：新增 `src/vue/view-action.ts`（取代 `preview.ts`）

核实：`preview-image` 只有 `AgentConversationView` 一个消费者，中间层纯转发；渲染层 17 处发出 `preview-image`（maint 4 说 13 处，实际更多）。

```ts
export type PreviewImageRequest = {locator: string; name: string} | {markdownSrc: string; name: string};
/** 视图内部流通的 action：宿主的 action，加上只在视图里处理的原图预览（纯界面行为，Spec“消息”）。 */
export type ViewAction = AgentViewAction | {type: "image.preview"; image: PreviewImageRequest};
```

- 内部组件只声明一个事件 `(e: "action", action: ViewAction)`：`AgentMarkdown`、`AgentUserContent`、`AgentConversationComposer`、`AgentConversationTurn`、`AgentTurnBlock`、`AgentRawView` 删掉 `preview-image`，同名 `.md` 删掉那一行。
- `AgentConversationView` 只有一个入口 `onAction(action: ViewAction)`：`image.preview` 交给现有的 `openPreview`，`composer.submit`/`command.run` 先 `scrollToLatest()`（不论来自输入框还是宿主的结果节点，Spec“历史与滚动”改成“发出消息或命令后”），其余 `emit("action")`。`image.preview` 不进公开的 `AgentViewAction`，宿主永远收不到。
- `AgentMarkdown` 的属性 `services` 换成 `resolveAsset?: MarkdownAssetResolver`（它只读这一项），调用处传 `props.services.resolveMarkdownAsset`。
- Composer 与 UserContent 里相同的“标签点击 → action 或预览”合成一个 `vue/view-action.ts` 里的 `tokenAction(token, imageName): ViewAction | null`（maint 5 的第五条重复），复用核心 `promptTokenOutcome`。

### 3. 结果标记：`src/registry.ts`、`src/conversation-turns.ts`、`src/vue/stream/AgentConversationTurn.vue`

核实：`isOutcome` 只认最终回复与错误；`findFinalReply` 遇到最后一条带工具调用的 assistant 消息返回 null。以 node 呈现的 `answer` 收尾调用排在末尾时 `outcomeStart === blocks.length`，整轮收起后答案卡片随过程一起收进摘要（complete 1 属实）。

- `ToolRendererEntry` 加 `outcome?: boolean`：“只对 node 有效。成功的调用位于一轮末尾时算这一轮的结果，整轮收起后仍显示。”
- `splitTrailing` 的锚点改为“最后一个结果块”（最终回复，或成功的结果节点），不再只认 `content.final`：否则结果节点之后跟着压缩或分支摘要的分隔线时，分隔线留在 `blocks` 末尾，倒扫第一步就停住，答案又被折进摘要（设计审查第 1 条，已用现有代码复现 `outcomeStart === blocks.length`）。
- `isOutcome(block, registry)` 增加一条：`block.kind === "node" && registry.resolveTool(block.step.call.name).outcome === true && block.step.call.status === "success"`。`findOutcomeStart` 的倒扫规则不变（越过结果与信息条目），所以被退回的那几次（`status: "error"`）留在过程里，只有最后交成功的那次露在结果区。
- `ConversationTurn` 加 `outcomeMessage: AssistantMessageView | null`：最后一个结果块所属的消息（最终回复与结果节点并存时取排在后面的那个）。`AgentConversationTurn` 的助手一侧操作条从 `turn.finalReply` 改用它，结构化答案的轮次也有重试、分支（Spec 同步改为“作用于结果所在的消息”）。复制按结果的种类分：结果是最终回复时照旧 `message.copy`，结果是节点时发 `tool.copy {toolCallId}`（答案在工具参数里，那条消息的正文通常为空）；内置 `copy` 登记项据此选 action，Spec 写明。
- 整轮摘要的操作次数不计结果调用（它显示在结果区，不是过程）：`computeMetrics` 收结果调用的 id 排除。
- 不变量：运行中与等待中的轮次不收起，`outcome` 只影响已结束轮次的折叠与操作条。

### 4. 内置工具拆成核心数据与 Vue 组件：`src/builtin-tools.ts`（新）、`src/tool-formats.ts`（新）、`src/tool-args.ts`、`src/tool-detail-lines.ts`、`src/vue/builtin-tools.ts`

核实：`vue/builtin-tools.ts` 里只有 `detail`、`node` 四个组件字段需要 Vue；分轮测试因此放在 `vue/*.dom.test.ts`；`fileDiffLines` 按 `call.name` 分支；`AgentFileDiffDetail` 的标题与 `edit`、`apply_patch` 的 `summary` 逐字相同；Lab `domain-tools.ts` 复制了一份 `argString`；`explore` 的 `groupPhrase` 注释说必填、类型是可选（maint 1、maint 2、api 7 属实）。

- **核心 `builtin-tools.ts`**：`builtinToolRenderers: readonly ToolRendererEntry[]`，现有十四项去掉组件字段，其余（类别、图标、文字、`summary`、`groupPhrase`、`effects`）原样搬来。write、edit、apply_patch 各自带 `diff`（下一条），`fileDiffLines` 里按工具名的三个分支拆进对应项。不从核心入口导出（没有非 Vue 使用方），核心测试按相对路径用。
- **登记项交出 diff**：`ToolRendererEntry` 加 `diff?: (call: ToolCallView) => CodeLine[] | null`（null 表示这次调用给不出 diff，例如参数还是半截）。`AgentToolDetail` 在没有 `detail` 而有 `diff` 时自己画一段 `CodeBlock`，标题取 `summary(call)`；出错且没有结果时照旧附原始参数。`AgentFileDiffDetail` 删除（组件、`.md`、Lab 登记），它的场景并进 `AgentToolDetail` 的场景。改文件的领域工具只要给 `effects` 与 `diff` 就有 diff 详情。`registry.ts` 的 `guardTool` 也包 `diff`，抛错时返回 null，`AgentToolDetail` 对 null 退回原始参数与结果（空数组仍是“内容为空”）。`CodeLine` 从 `tool-detail-lines.ts` 公开。
- **`tool-formats.ts`**：补丁与 hashline 解析（`parsePatchChanges`、`editInputChanges`、`patchLine`）从 `tool-args.ts`、`tool-detail-lines.ts` 挪来；`tool-args.ts` 只留通用读取 `argString`、`argArray`、`argNumber`、`objectString`、`countLines`，并从核心入口导出（契约是“流式半截参数不抛”，宿主不必各写一份）。
- **`vue/builtin-tools.ts`** 缩成按 id 挂组件：

  ```ts
  const DETAIL: Partial<Record<string, Component>> = {read: AgentFileContentDetail, bash: AgentCommandDetail, execute_sql: AgentCommandDetail};
  const NODE: Partial<Record<string, Component>> = {task: AgentTaskListNode};
  export const builtinToolsContribution: AgentViewContribution = {source: "builtin:tools", tools: builtinToolRenderers.map(withComponents)};
  ```

- **类型收紧**：`ToolRendererEntry` 改成按类别的联合，`explore` 必须给 `groupPhrase`，其余类别不许给：

  ```ts
  type ToolRendererBase = RegistryEntryBase & {
      toolNames?: readonly string[]; toolNamePrefix?: string; icon: string; label: ViewText;
      summary: (call: ToolCallView) => string; effects?: (call: ToolCallView) => ToolEffects;
      diff?: (call: ToolCallView) => CodeLine[]; detail?: Component;
      presentation: "line" | "card" | "node"; node?: Component; outcome?: boolean;
  };
  export type ToolRendererEntry =
      | (ToolRendererBase & {category: "explore"; groupPhrase: (count: number) => ViewText})
      | (ToolRendererBase & {category: "mutate" | "interact" | "other"; groupPhrase?: never});
  ```

- **`guardTool` 按类别重写**：现在“先解构再条件展开”的写法在联合下推不出类别与 `groupPhrase` 的对应（设计审查已用包内 `tsc` 复现 TS2322）；改为 `{...entry, summary, effects, diff}` 一次替换受保护的回调，`explore` 分支单独补 `groupPhrase`。`makeToolGroup` 里 `groupPhrase?.() ?? toolGroup.generic` 的回退对有类型的宿主不可达，为 JS 宿主与 `guardTool` 保留，写一句注释。`conversation-turns` 测试里登记了没有 `groupPhrase` 的插件 `explore`，补上短语。
- **工具名重叠报冲突**：`createAgentViewRegistry` 对不同 id 的两项声明了同一个精确工具名或同一个前缀时，抛冲突错误；错误类加一个 `key` 字段与对应消息（“工具名 read 被两个渲染器声明”），不把名字塞进 `id`。前缀与前缀之间改为取最长匹配（`list_x_` 先于 `list_`），与精确名优先一致、与登记顺序无关；冲突只判相同的名字或相同的前缀。现在静默按 order 取第一个，与“不静默覆盖”的注释矛盾（api 7 第 4 点）。要替换内置渲染器的宿主先从内置登记里过滤掉那一项，README 给一行写法（`{...builtinToolsContribution, tools: builtinToolsContribution.tools.filter((tool) => tool.id !== "read")}`）。
- **测试回到 Bun**：`vue/conversation-turns.dom.test.ts` 改名挪到 `src/conversation-turns.test.ts`，`vue/registry.dom.test.ts` 挪到 `src/registry.test.ts`，都改用核心 `builtinToolRenderers`。`tool-detail-lines.test.ts` 的 diff 用例挪到 `src/builtin-tools.test.ts`，按登记项的 `diff` 断言。核心不引 `.vue`，由 `boundary.test.ts` 机检。

### 5. 收窄公开面：`src/index.ts`、`src/vue/index.ts`、新增 `src/vue/lab.ts` 与 `package.json` 的 `./lab`

核实：`/vue` 导出 23 个组件；20 个组件带 `state:inject`；核心导出 `buildTurns` 与轮次内部类型只因 Lab 单挂零件；单挂零件时 `preview-image` 要宿主自己接，README 的承诺不完整（api 5、maint 8、maint 10 属实）。两个使用方都只挂整个视图。

- **`@notnotype/nb-agent-ui/vue`** 只留：`AgentConversationView`；内置登记 `builtinContributions`（新，四份合一，见第 6 项）与四份单独的登记（要裁剪的宿主用）；类型 `AgentViewRenderers`。不再导出其余 22 个组件、`provideAgentView`、`useAgentText`、`useAgentRenderers`、`PreviewImageRequest`。单挂零件不再是宿主用法，README 删掉那段；`state:inject` 只剩视图自己与 Lab 两个提供方，缺提供方静默回退中文的风险随之落到 Lab 里（开发期警告仍是 t11 的事）。
- **核心 `@notnotype/nb-agent-ui`** 去掉 `buildTurns`、`BuildTurnsInput`、`ChainBlock`、`ConversationTurn`、`TurnBlock`、`TurnMetrics`、`TurnStatus`、任务清单的四个类型、`GENERIC_TOOL_RENDERER`、`visibleEntries`、`ToolNodeProps`、`ToolDetailProps`；加入第 1、4、6 项的新名字。`AgentConversationView` 只有 `@action` 一条事件通道，宿主看不到 `ViewAction`。
- **新入口 `@notnotype/nb-agent-ui/lab`**（`src/vue/lab.ts`）：只给应用的 Component Lab 单挂内部零件，模块头写明“不是宿主接口，形状随时会变”。导出：

  ```ts
  export const nbAgentUiLabParts = {
      AgentChainSummary: () => import("./stream/AgentChainSummary.vue"),
      AgentTurnBlock: () => import("./stream/AgentTurnBlock.vue"),
      // …其余要在 Lab 单独看的内部零件
  } as const;
  export type NbAgentUiLabPart<K extends keyof typeof nbAgentUiLabParts> = Awaited<ReturnType<(typeof nbAgentUiLabParts)[K]>>["default"];
  export {provideAgentView} from "./host";
  export {buildTurns} from "../conversation-turns";
  export type {ConversationTurn, TurnBlock} from "../conversation-turns";
  ```

  不并进 `./lab-sources`：组件索引 `component-index.ts` 静态导入 `lab-sources`，再挂上 `host.ts` 会把缺省组件拉进 Lab 首屏；`./lab` 只在选中场景时动态加载。
- **内部零件的文档**：保留 `.md` 与 Lab 场景（Lab 按 `.md` 建索引，`index.dom.test.ts` 要求可挂载组件至少一个场景）；新拆出的内部组件（第 8 项）也按组件规范写同名 `.md`（`docs/standards/code/components.md`“新建组件必须有同名文档”不分是否受管），只写职责、数据与 `验证入口: AgentConversationView`，不单独登记场景。包的 `AGENTS.md` 改为：“入口导出的组件是受管组件（`docs:check` 机检标签）；内部组件同样有同名 `.md`，要在 Lab 单独看的登记场景并经 `./lab` 挂载，其余写 `验证入口`。”收窄后只剩 `AgentConversationView` 受 `docs:check` 的标签机检，其余 `.md` 的标签靠人审，记为取舍。受管组件因此只剩 `AgentConversationView`，`scripts/ci/check-documentation.ts` 的 `COMPONENT_BARRELS` 不用改。

### 6. 宿主起步套件：`src/context.ts`（新）、`src/composer-actions.ts`、`src/harness.ts`、`src/types.ts`、`src/vue/builtins.ts`（新）

核实：`ctx` 17 个区域全部必填，`connection`、`panels`、`extensions`、`pendingInputs`、`workspaceChanges`、`editing` 与 `composer.attachmentCount` 零读取；Lab 的 `conversationContext(patch)` 就是缺省工厂；`composer-host.ts` 202 行是宿主必须重写的输入框逻辑；`labAgentRegistry()` 无参时漏了输入框登记；两个必填服务对没有附件、没有菜单的宿主是纯桩；适配器看得到 `agent_start`/`agent_end` 却不对外给运行状态（api 1、2、6、8、complete 8 属实）。

- **最小 ctx**：

  ```ts
  type MergedSections = "availability" | "interaction" | "run" | "history" | "workspaceChanges" | "composer" | "usage" | "connection";
  /** 顶层字段整个替换；上面这几个区域按字段合并，宿主只写自己有的。 */
  export type AgentContextPatch = Partial<Omit<AgentConversationContext, MergedSections>>
      & {[K in MergedSections]?: Partial<AgentConversationContext[K]>};
  export function createAgentContext(patch?: AgentContextPatch): AgentConversationContext; // 每次构造新的对象与数组，两次调用互不影响
  ```

  缺省值是“什么都没有”：`session: null`、`availability.status: "ready"`、`interaction` 全部 false（宿主声明自己支持什么）、`run: idle`、空消息、`composer` 没有模型、模式、附件，草稿 `{text: "", version: 0}`，`usage.currency: "USD"`，`now: 0`。字段不改成可选：视图里到处是 `ctx.x.y`，可选会把空值分支散进各组件（api 1 的理由成立）。`interaction` 缺省全为 false 意味着挂上去是只读输入框，README 的最小宿主显式写出 `interaction`。`composer` 等区域逐字段合并，但 `draft` 整体替换，写进注释。Lab 的 `conversationContext` 改为在它之上加数据。
- **输入框动作**（`composer-actions.ts`）：

  ```ts
  /** 只改状态、不需要宿主再动手的 action：草稿回声（只换文字不换版本）、mode.set、model.set、thinking.set。
   *  其余返回 null。附件的登记、重试、移除既要改状态又要宿主上传或释放，不在这里（设计审查第 3 条）。 */
  export function applyComposerAction(composer: ComposerView, action: AgentViewAction): ComposerView | null;
  /** 宿主受理了一次发送或命令：当前草稿原文（`draft.text`，即编辑器最近一次回声）放到输入历史最前并去重，草稿清空并换版本。
   *  命令也用草稿原文，不由宿主用 name 与 argsText 拼回；命令与普通发送一样去重（现在 Lab 宿主的命令不去重，改成一致）。 */
  export function acceptSubmission(composer: ComposerView): ComposerView;
  ```

  不做带状态的会话控制器：附件上传、持久化与权限都在宿主（api 2 的判断成立）。Lab `composer-host.ts` 改用这两个函数，留附件三个 action、上传模拟、命令与菜单。
- **内置登记一次拿全**：`vue/builtins.ts` 导出 `builtinContributions: readonly AgentViewContribution[]`（角色、工具、消息操作、输入框四份）。README 示例写 `createAgentViewRegistry([...builtinContributions, ...宿主的])`；Lab 的 `labAgentRegistry` 用它，删掉 `extra` 补登记的写法。
- **服务可选**：`AgentConversationServices` 的 `resolveAttachmentUrl`、`resolveTriggerMenu` 改为可选。缺 `resolveAttachmentUrl` 时附件显示“不可用”；缺 `resolveTriggerMenu` 时不把 `/` 之外的触发字符交给编辑器（没有菜单就不打开空菜单），`/` 命令照常。“数据变化时换一个新函数”写进 README。要改的调用点不止两处：`AgentConversationView.vue` 的 `openPreview`、`AgentConversationComposer.vue` 两处、`AgentConversationTurn.vue`、`AgentTurnBlock.vue`、`AgentRawView.vue` 各一处，`AgentUserContent` 的属性 `resolveAttachmentUrl` 改可选。
- **运行状态**：`HarnessTranscript` 加 `run(): RunView`：收到 `agent_start` 事件后 `{status: "running", phase: ""}`，收到 `agent_end` 事件或日志 `run_end` 后回到 idle。模块头写明只按事件推出：只对本页收到过 `agent_start` 的运行有效；页面刷新、断线重连后只补日志时得不到“运行中”（nb-story 一轮一到六分钟，这是常见情形），`stopping`、`waiting` 也由宿主覆盖。README 写成“运行状态以宿主的服务端状态为准，`run()` 只是没有服务端状态时的退路”。
- **类型小改**：删 `ComposerView.attachmentCount`；`AgentConversationContext.messages` 改为 `readonly MessageView[]`，宿主可以直接放 `transcript.messages()`（api 14 的后半，组件属性跟着改 readonly）。
- **README** 的“宿主接入”换成一个最小宿主（约 30 行）：`createAgentContext` 起步、`builtinContributions`、`applyComposerAction` 加 `acceptSubmission`、`transcript.messages()` 写回、运行状态取宿主自己的（`run()` 作退路）、只在运行中每秒更新 `now`。补“草稿回声与版本号”“`now` 要宿主打节拍”各一句。

### 7. 行为原则（先写 Spec，再实现）：`src/vue/AgentConversationView.vue`、`composer/AgentConversationComposer.vue`、`src/vue/host.ts`、`src/composer-actions.ts`、`src/types.ts`

核实：顶栏无条件渲染，溢出菜单只有“原始视图”；模型下拉没有 `v-if`，`models: []` 时仍显示“未选择模型”；消息流为空时不看 `availability` 一律“还没有消息”；思维链展开状态默认 false，宿主没有入口；运行中回车写死成 steer（complete 4、6、7、12，api 13 属实）。

- **没有数据的区域不显示**：
  - 模型下拉在 `composer.models` 与 `composer.thinkingLevels` 都为空时不渲染；模式按钮已是 `modes` 为空不渲染，不变。
  - 消息流为空时只分两种：`loading` 显示加载中，其余显示“还没有消息”。其余状态的说明与恢复动作由 t11 的横幅显示，这里不先显示一份，免得 t11 上线后同一句话出现两次。
  - 顶栏要不要显示没有可依据的数据：nb-story 有会话（切换对话时要靠 `session.id` 清界面状态、回到最新），却已有自己的页面标题。加一个属性 `header?: boolean`（缺省 true），nb-story 传 false。不加别的布尔属性。Spec 写明：关掉顶栏也就关掉了切到原始视图的入口，宿主要切换时用受控属性 `viewMode`。
- **运行中逐步展开**：视图属性 `processDisclosure?: "collapsed" | "live"`（缺省 `collapsed`，即现行 Spec）。沿属性往下传：View 交给 Turn，Turn 算出“这一轮运行中或等待中且为 `live`”，作为布尔属性 `live` 交给 TurnBlock 与 `AgentChainBlock`，再作为 `useOpenSet` 的 `fallback`。不走 `provideAgentView`：第 1 项为宿主组件选 props 的理由（注入是隐藏通道）对包内设置同样成立，`turnStatus` 本来也是这样一层层传下去的，Lab 单挂 TurnBlock 也能直接传 `live` 演示（设计审查第 8 条）。`live` 时，运行中与等待中轮次里的思维链与工具组默认展开，逐步列出每一步；卡片与思考仍折叠。用户点过的以用户为准；轮次结束后默认值回到折叠，整轮收起规则不变。展开状态在 ChainBlock 与 TurnBlock 的实例里，整轮收起后过程被卸载，再展开时各段回到默认值；Spec 写明这一点，不为保留它把状态提到 Turn。工具组也展开是因为 nb-story 的步骤大多是 `read` 与查询，不展开组就仍是一行（决定 7 要“每一步一行”）。
- **运行中能否投递由宿主声明**：`InteractionView` 加 `canSteer: boolean`、`canQueue: boolean`。运行中：回车在 `canSteer` 时发 steer，否则在 `canQueue` 时发 followup，否则不发；Ctrl/⌘+回车只在 `canQueue` 时发 followup。两者都不允许时输入框仍可写，发送键禁用、提示“运行结束后发送”；占位文字按允许的组合取四条之一（文字表加三条，中英各一）。`resolveSubmission` 的输入加 `deliveries: {steer: boolean; followup: boolean}`，判定仍在核心纯函数里。边界：`canSteer` 为真、`canQueue` 为假时 Ctrl/⌘+回车不发送（不退回 steer）；`/名称` 命令先于投递判定，运行中照常发 `command.run`，不受两个开关限制；`running`、`waiting`、`stopping` 三种状态都按“运行中”判定。这三条写进验收 23 与 `composer-actions.test.ts` 的用例表。harness 宿主（nb-story、主应用）两项都给 false。

### 8. 拆分 `AgentTurnBlock` 与收重复：`src/vue/stream/`、`src/vue/parts/`、`src/vue/composer/`、核心

核实：`AgentTurnBlock.vue` 546 行，`v-if` 链七种块，工具行三份、思考行两份加系统提示词一份，`running-label` 9 处；`stepStatus` 在 TurnBlock、RawView 各一份，TaskListNode 第三份，核心 `isActive`/`isFailed` 是同一张表；`formatTime` 两份、`firstLine` 三份；`CodeBlock` 的两条文字 9 处；`--nb-agent-block-indent` 只在一条注释里出现；Composer 的编辑器句柄暂存与附件门禁是两块独立逻辑（maint 3、5、12、13 属实）。

- `stream/AgentChainBlock.vue`（内部）：只管思维链（摘要行加展开后的步骤），持有自己的展开状态。`AgentTurnBlock` 只做块种类分派，目标 250 行以内。
- `stream/AgentToolStepRow.vue`（内部）：一个工具步骤一行，图标、名称、摘要、状态、改文件的增删统计都从注册表取，展开是 `AgentToolDetail`；工具组内一项、出错露出的一项、顶层一项共用。`stream/AgentTextStepRow.vue`（内部）：思考与系统提示词一行，折叠时显示第一行，展开是淡色 Markdown。两者都内置 `running-label`。
- `vue/use-open-set.ts`：`useOpenSet()` 返回 `{isOpen(id, fallback = false), set(id, open)}`，没设过的跟随 `fallback`（第 7 项的 `live` 属性从这里进）；ChainBlock、TurnBlock、RawView 共用。
- `now` 只让运行中的最新一轮依赖：Turn 里 `buildTurn` 的 `now` 改为 `latest && 运行中 ? ctx.now : 0`，已结束的轮次不再随宿主每秒换 `now` 重算（设计审查第 6 条；`computeMetrics` 只对运行中轮次用 `now`，结果不变）。
- `parts/AgentCodeBlock.vue`（内部）：包 nb-ui `CodeBlock`，绑定空内容与截断两条文字；9 处调用改用它。
- 核心 `tool-status.ts`：`toolCallPhase(status): "running" | "error" | "done"`，`isActive`、`isFailed`、步骤行、RawView、TaskListNode（`done` 映射成 `success`）都用它；新增状态时只改一处。
- 核心 `format.ts`：`formatClock(timestamp, locale)`、`firstLine(text)`；`process-summary.ts` 的 `formatCost` 导出到包内，RawView 的用量行改用它（修掉 `$null`）。
- 缩进变量：`.acv-turn` 根上声明 `--nb-agent-block-indent: 24px`，Turn 里写死的 24px 改读它；TurnBlock 各根元素用 `--acv-indent: var(--nb-agent-block-indent, 24px)` 只写一次回退（Lab 单挂时没有 Turn 祖先）。写进 `AgentConversationTurn.md`、`AgentTurnBlock.md` 新的“样式变量”一节。
- Composer：`composer/use-editor-handle.ts` 的 `useEditorHandle()` 返回 `{editorRef, withEditor}`（就绪前暂存、出现后补做）；核心 `composer-actions.ts` 加 `sendBlockedReason(live: ReadonlySet<string>, states: ReadonlyMap<string, PromptAttachment>): "uploading" | "failed" | null`，组件只维护 `liveAttachments` 并翻译原因。

### 9. Lab 与 e2e：`packages/neuro-book/src/plugins/lab/web/fixtures/nb-agent-ui/`、`packages/neuro-book/e2e/lab-agent-ui.e2e.ts`

跟着改的地方：
- `host.ts`：`agentSubject` 改按 `nbAgentUiLabParts` 取组件，`provideAgentView` 从 `@notnotype/nb-agent-ui/lab` 取；`labAgentRegistry` 用 `builtinContributions`。
- `index.ts`、`parts.scenes.ts`：零件的类型从 `typeof X`（公开入口）改为 `NbAgentUiLabPart<"X">`；`buildTurns`、`TurnBlock`、`ConversationTurn` 从 `./lab` 取；`builtinRolesContribution` 等仍从 `/vue` 取。删 `AgentFileDiffDetail` 的登记，它的场景并进 `AgentToolDetail`。
- 三个手写夹具（`AgentTurnBlockFixture.vue`、`AgentConversationTurnFixture.vue`、`AgentMarkdownFixture.vue`）改从 `./lab` 取组件；各夹具与 `defineSubjectFixture` 的事件列表去掉 `preview-image`；detail 类零件的 `runtimeProps` 补 `services`，场景输入补 `locale`。
- `data.ts` 的 `conversationContext` 改为在 `createAgentContext` 上加数据，`interaction` 补 `canSteer`、`canQueue: true`。
- `composer-host.ts` 改用 `applyComposerAction`、`acceptSubmission`。
- `domain-tools.ts`：删自写的 `argString`，改用核心导出；加一项 `answer` 渲染器（`presentation: "node"`、`outcome: true`），组件 `LabAnswerNode.vue`（放在本目录，不以 `Fixture.vue` 结尾）显示结论与一行出处，点出处发 `reference.open`。它是宿主组件通道与结果标记的活样例。
- `view.scenes.ts` 加场景：`answer`（已结束，有一次被退回、一次交成功）、`running-live`（`processDisclosure: "live"`）、`running-no-steer`（`canSteer`、`canQueue` 为 false）、`embedded`（`header: false`，没有模型、模式）。
- `e2e/lab-agent-ui.e2e.ts`：改“回复里 Markdown 的引用、外链与图片”一条（事件日志里看 `image.preview` 的 action，或改在 `AgentConversationView` 场景里看对话框打开）；加验收 20 到 24 的用例（见验收映射）。
- `prompt-ports.typecheck.ts` 只用端口类型，不受影响；`entry.test.ts`、`vue/entry.dom.test.ts` 改为经包名导入新的公开名字（核心跑 `createAgentContext` 加适配器，渲染层挂 `AgentConversationView`）。

### 10. 另判的三条

- **api 9（action 联合约 30 个没人发出、宿主按域处理）：不并入。** 视图不要求宿主处理每个 action，宿主只接自己支持的；没人发出的那些正是 t11 要接的顶栏、面板、待处理区，等 t11 真正发出时再看要不要分域。现在拆子联合是为假想的穷尽检查做设计。
- **api 12（locale 与 renderers 两条通道、`ctx.now` 节拍）：并入一部分。** 第 5 项收掉 `provideAgentView` 之后宿主只剩视图属性一条通道，前半自然消失；`now` 保持宿主提供（Spec“副作用与数据”：视图不自行计时，Lab 才能确定性回放），只在 README 写一句要打节拍；`locale` 保持封闭联合。
- **maint 14（nb-ui 扫描测试复制了一份）：不并入。** 它是测试基础设施，与宿主接口无关，还要改 nb-ui 包，混进来会让本 Task 的切片跨三个包；照 t12 收 `import-boundary` 的做法另做一个小 Task，在 w00019 的后续清单里记一行。

## Spec 与文档改动

- `docs/specs/ui/agent-conversation-view.md`（主工作区）：
  - “术语与参与者”：“结果与过程”改为“结果是一轮末尾连续的最终回复、错误与结果节点”；加“结果节点”：渲染器声明为结果、调用成功的 node。
  - “Props 与事件”：加 `header?: boolean`（关掉顶栏也关掉原始视图的切换入口，宿主用 `viewMode`）、`processDisclosure?: "collapsed" | "live"`；写明公开组件只有 `AgentConversationView`。
  - “ctx 的组成”：`interaction` 加“运行中能否补充说明、能否排队”。
  - “服务”：`resolveAttachmentUrl`、`resolveTriggerMenu` 改可选，写缺省行为。
  - “注册表”：工具渲染器加“diff 行”“是否算结果（只对 node）”；加一段宿主组件的约定（收 `ctx`、`services`、`locale` 与自己的数据，只发 action）。
  - “顶栏”：`header` 为 false 时不显示。“分轮视图”：Agent 一侧的操作作用于结果所在的消息；结果调用不计入整轮摘要的操作次数。
  - “展开与折叠”：“思维链默认折叠，运行中也不自动展开”后加 `live` 的例外。
  - “输入框与待处理区”：运行中回车与 Ctrl/⌘+回车按 `canSteer`、`canQueue`；模型下拉在没有模型与思考档位时不显示。
  - “历史与滚动”或“消息”：消息流为空时 `loading` 显示加载中，其余显示“还没有消息”；发出消息或命令后回到最新，不论来自输入框还是宿主组件。
  - “展开与折叠”：整轮收起后再展开，里面各段回到默认展开状态。
  - “失败与恢复”：两个渲染器声明相同的工具名或相同的前缀时构造失败，前缀互相包含时取最长匹配；`diff` 抛错时退回原始参数与结果。
  - “分轮视图”的复制：结果是节点时复制发 `tool.copy`。
  - “验收与 Smoke”：加 20 到 25 条（见验收映射），Smoke 段补上新增的 e2e。
- `packages/nb-agent-ui/README.md`：重写“宿主接入”（最小宿主、草稿回声、`now`、服务的“换函数”约定），删“单独挂零件”。
- `packages/nb-agent-ui/AGENTS.md`：“入口导出的组件”一条按第 5 项改。
- `packages/nb-agent-ui/src/vue/README.md`：根目录加 `view-action.ts`、`use-open-set.ts`、`builtins.ts`、`lab.ts`，删 `preview.ts`；`stream/` 加三个内部组件，`parts/` 加 `AgentCodeBlock`；`tools/` 去掉 diff。
- 组件 `.md`：删 `preview-image` 事件的各行；`AgentToolDetail.md` 加 diff 的说明；`AgentConversationView.md` 加两个属性；Turn 与 TurnBlock 加“样式变量”；删 `AgentFileDiffDetail.md`。
- Task 记录：t13 README 链接本计划并写当前状态。

## 切片

每片在 worktree 单独提交，提交前自跑本片的验证。下文“包验证”指 `packages/nb-agent-ui` 的 `bun run typecheck` 与 `bun run test`；“应用验证”指 `packages/neuro-book` 的 `bun run typecheck` 与 `bun run test`；“e2e”指 `bun run test:e2e -- lab-agent-ui lab-scenes`。

| 切片 | 内容 | 关键设计 | 验证 |
|---|---|---|---|
| 0 | Spec 全部条目与验收 20 到 25（主工作区 master） | Spec 与文档改动 | `bun run docs:check`、`bun run governance:check` |
| 1 | 内置工具拆成核心数据与组件、`diff` 字段、删 `AgentFileDiffDetail`、通用读取导出、类别联合、工具名冲突、测试回到 Bun | 4、9 的对应部分 | 包验证、应用验证、e2e |
| 2 | 宿主组件通道、原图预览并进 action、`AgentMarkdown` 只收 `resolveAsset`、Lab `answer` 节点组件（先不标结果） | 1、2、9 | 包验证、应用验证、e2e |
| 3 | 结果标记、`outcomeMessage`、结果调用不计次数、`answer` 场景 | 3、9 | 包验证、应用验证、e2e |
| 4 | 拆 `AgentTurnBlock`、步骤行、`useOpenSet`、`AgentCodeBlock`、状态与格式化收进核心、缩进变量、Composer 两块抽出 | 8 | 包验证、应用验证、e2e |
| 5 | 三条行为原则：区域按数据显示与 `header`、`processDisclosure`、`canSteer`/`canQueue`，及对应场景 | 7、9 | 包验证、应用验证、e2e |
| 6 | 起步套件：`createAgentContext`、`applyComposerAction`、`acceptSubmission`、`builtinContributions`、服务可选、`transcript.run()`、类型小改、README | 6、9 | 包验证、应用验证、e2e |
| 7 | 收窄公开面、`./lab` 入口、Lab 改取法、AGENTS.md 与 README 收尾 | 5、9 | 包验证、应用验证、e2e、`bun run docs:check` |

顺序理由：1 先做，后面的测试都能在 Bun 里写；2 与 3 定宿主组件的形状，4 在它们之后重排 `AgentTurnBlock`，免得同一处改两遍；5 的 `live` 默认值落在 4 拆出的 `useOpenSet` 上；7 放最后，Lab 的取法只改一次。

## 验收映射

| Spec 编号 | 覆盖 |
|---|---|
| 验收 13（新 explore 工具并入工具组） | `src/registry.test.ts`、`src/conversation-turns.test.ts`（Bun） |
| 验收 15（渲染器抛错只降级该项） | 已有 `RenderGuard` 的 dom 测试；补 `diff` 抛错的 `src/registry.test.ts` 用例 |
| 新 20：结果节点在整轮收起后仍显示（其后跟压缩或分支摘要分隔线时也一样），被退回的那几次留在过程里，助手一侧有操作条，复制发 `tool.copy` | `src/conversation-turns.test.ts`（含结果之后跟分隔线、结果节点与最终回复并存两例）；`src/harness.contract.test.ts` 用真实 nb-harness 跑收尾工具 `answer`（现有“收尾工具完成”用例的日志）再 `buildTurns`；e2e `answer` 场景 |
| 新 21：宿主登记的 node 与 detail 收到 `services`、`locale`，发出的 action 到达宿主；原图预览不到宿主 | `vue/AgentConversationView.dom.test.ts`；e2e `answer` 场景点出处得 `reference.open` |
| 新 22：`processDisclosure: "live"` 时运行中思维链与工具组展开，结束后整轮收起 | `vue/AgentConversationView.dom.test.ts`（或 TurnBlock 挂载测试）；e2e `running-live` |
| 新 23：`canSteer`、`canQueue` 为 false 时运行中回车不发送、输入框可写、发送键禁用；只许 steer 时 Ctrl/⌘+回车不发送；命令照常执行；`waiting`、`stopping` 同运行中 | `src/composer-actions.test.ts`（`resolveSubmission`）；e2e `running-no-steer` |
| 新 24：没有模型与思考档位时不显示模型下拉；`header` 为 false 时没有顶栏；空消息流 `loading` 显示加载中；不提供 `resolveAttachmentUrl`、`resolveTriggerMenu` 时附件显示占位、点击不报错、输入 `@` 不打开空菜单 | `vue/AgentConversationView.dom.test.ts`；e2e `embedded` |
| 新 25：两个渲染器声明同一工具名或同一前缀时构造失败，前缀互相包含时取最长匹配 | `src/registry.test.ts` |
| 验收 4、11、12 与“历史与滚动”（回归） | e2e `lab-agent-ui` 现有用例 |
| 验收 17（390 宽）、18（明暗） | `lab-scenes.e2e.ts` 巡检新场景 |

起步套件不是行为合同，由单测覆盖：`src/context.test.ts`（合并规则、缺省值、两次调用互不影响）、`src/composer-actions.test.ts`（`applyComposerAction` 四种 action 与附件 action 返回 null、`acceptSubmission` 对发送与命令都去重并换版本、`sendBlockedReason` 三种情形）、`src/harness.test.ts` 与契约测试（真实 harness 事件里 `agent_start` 之后 `run()` 是 running，`agent_end` 后 idle）、`src/entry.test.ts` 经包名导入。

## 验证

- 每片：包验证、应用验证；涉及 Lab 或渲染的切片跑 e2e（先停掉多余的开发服务，本机内存紧时 Lab 首屏会超时）。
- 切片 7 后在 Lab 里手动看一遍 `nb-agent-ui` 组：每个零件场景能打开，`answer`、`running-live`、`running-no-steer`、`embedded` 四个新场景在 390 与 1200 宽、明暗两种主题下正常。
- 公开面用 `src/entry.test.ts`、`vue/entry.dom.test.ts` 按包名导入核对；另用 `rg "nb-agent-ui/lab['\"]" packages --glob '!packages/nb-agent-ui/**'` 确认仓库里只有 Lab 用 `./lab`。
- 未验证边界：nb-story 问答页还没写，起步套件对它省了多少代码只能按 README 的最小宿主推断；主应用接入在 t11 之后。

## 不做与风险

**不做**：
- t11 的第三类全部（扩展点 `entries` 等接上、无障碍、停止与复制反馈、Lab 夹具三遍登记与 `later()` 重复、缺提供方的开发期警告、消息操作溢出）。nb-story 文字回复下面的“没核实的出处”要靠条目渲染器，随 t11。
- `summarizeUsage`（`ctx.usage` 的汇总）：现在只有 `currency` 被读，消费者是 t11 的状态栏，口径（上下文 tokens 按哪条消息算）到那时随状态栏定（见待确认）。
- `defineToolRenderer`、`ToolbarButtonEntry` 的按下与禁用状态、宿主自定义空态与占位文字（Spec 里空状态起手提示只预留）、视图自己计时、`locale` 放宽成任意字符串。
- maint 9（原图预览对话框迁到 nb-ui）、maint 13 的类名前缀统一与淡色小字样式合并：不在开发者给的第二类里。
- api 9、maint 14：理由见关键设计第 10 节。

**风险**：
- **结果判定写偏**：结果节点只在“调用成功且排在末尾”时成立，靠倒扫规则排除被退回的调用。兜底测试用真实 nb-harness 的收尾工具日志（`harness.contract.test.ts` 的脚本化模型加真实 `createHarness`，不是自造的 `MessageView`），实施时核对这条测试确实走到 `buildTurns` 的结果判定。
- **`./lab` 被宿主当成接口用**：入口模块头写明只给 Lab；验证步骤里 `rg` 核对使用方。
- **测试挪到 Bun 后静默漏引 `.vue`**：核心的 `builtin-tools.ts` 不许引组件，由 `boundary.test.ts` 机检；Bun 加载 `.vue` 会直接失败，不会静默通过。
- **删 `AgentFileDiffDetail`**：它的三个场景搬进 `AgentToolDetail` 后要逐个打开核对，e2e 没有直接引用它。
- **公开面收窄后再有宿主想单挂输入框**：到时按需加回 `AgentConversationComposer` 一个，并补齐它的 `ViewAction` 收口（预览要能在单挂时打开），不在本 Task 预做。

## 设计审查（2026-10-22）

一个 Sonnet 审查（包属前端），14 条：重要 5、建议 9，[报告](evidences/design-review.txt)。全部成立，已改进上文：

- 重要 1 结果节点之后跟分隔线仍被折叠：`splitTrailing` 锚点改为最后一个结果块（第 3 项）。
- 重要 2 结构化答案的复制：结果是节点时发 `tool.copy`（第 3 项）。
- 重要 3 `applyComposerAction` 让附件上传卡住：附件三个 action 留给宿主；`acceptSubmission` 用草稿原文，命令也去重（第 6 项）。
- 重要 4 类别联合下 `guardTool` 过不了类型检查、`diff` 抛错表达不出：`guardTool` 重写，`diff` 可返回 null（第 4 项）。
- 重要 5 内部组件不写 `.md` 与组件规范冲突：新内部组件写短 `.md` 加 `验证入口`，不改规范（第 5 项）。
- 建议 6 到 14：`now` 只让运行中的最新一轮依赖；服务可选补验收与调用点；`processDisclosure` 改走属性；空消息流不先显示横幅那句、`header` 写明连带关掉原始视图入口；`run()` 降为退路；投递开关的三条边界；前缀取最长匹配、冲突错误加 `key`、README 给过滤内置渲染器的写法；`createAgentContext` 每次新对象、最小宿主写出 `interaction`；展开状态整轮收起后重置写进 Spec、核对命令、内置组件声明 `action`、回到最新不论来源、`outcomeMessage` 取最后一个结果块。

## 开发者已确认（2026-10-22）

开发者对下面九项全部同意，按推荐做。第 5 项核实过：nb-harness 目前没有 steer 与排队，两个 harness 宿主都给 false。

1. **公开组件只剩 `AgentConversationView`**，输入框等零件不再给宿主单挂，`provideAgentView` 不公开。推荐：照此收窄；两个使用方都只挂整个视图，以后真有需要再加回单个零件。
2. **内部零件保留 `.md` 与 Lab 场景**，经新入口 `./lab` 挂载，`AGENTS.md` 的规则相应改写。推荐：保留，这些场景是现有的状态演示；不保留的话可以删掉十几份 `.md` 与场景，但失去单看零件的入口。
3. **顶栏用属性 `header` 关掉**，不按数据推断。推荐：属性；nb-story 有会话数据却不要顶栏，数据推不出来。
4. **`live` 模式连工具组一起展开**。推荐：一起展开；只展开思维链时，nb-story 连续的 `read` 仍收在一行工具组里，做不到“每一步一行”。
5. **运行中投递用 `interaction.canSteer`、`canQueue` 两个布尔**，两者都为 false 时运行中不能发送但能写。推荐：照此；与现有 `can*` 一致，两个 harness 宿主都给 false。
6. **两个渲染器声明同一工具名时报冲突**，替换内置渲染器要先过滤内置登记。推荐：报冲突；现在静默按顺序取第一个，结果取决于登记先后。
7. **删 `AgentFileDiffDetail`，改由登记项的 `diff` 交出、`AgentToolDetail` 画**。推荐：删；改文件的领域工具从此只给 `diff` 就有详情。
8. **`ctx.usage` 的汇总函数放到 t11 状态栏时做**。推荐：放 t11；现在没有读它的界面，口径到那时一起定。
9. **maint 14 不并入，另起小 Task**。推荐：另起；它要改 nb-ui 的测试，与接口整理无关。
