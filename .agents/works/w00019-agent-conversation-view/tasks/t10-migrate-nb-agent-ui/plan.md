# t10 实施计划：对话视图迁入 nb-agent-ui

## Context

w00019 在 2026-10-21 重新打开（[Work README](../../README.md#重新打开开发者2026-10-21)）。t03 到 t09 做的对话视图都在旧应用里，代码只存在于归档提交 `865c9f593`（分支 `archive/legacy-ui-tuning`，没有合入）。新应用和 w00024 t13 的问答页都要用它，开发者定了三件事：

- 单独建包 `nb-agent-ui`，建在 nb-ui 之上，形状照 nb-form；
- 通用零件放进 nb-ui；
- Markdown 显示与提示词编辑器由宿主注入。

本 Task 只换位置、断开旧应用的依赖，行为不变。另外加一个 harness 适配器，供 nb-story 与主应用共用。补齐没做过的部分属于 t11。

依据：

- 归档 Spec [`ui/agent-conversation-view.md`](../../../../../docs/archived/specs/ui/agent-conversation-view.md)。master 上这份不含 t09 改的 15 行，那几行在 `865c9f593` 里。
- 提案 `packages/neuro-book-legacy/docs/proposals/agent-conversation-view.md`。
- 组件规范 [`components.md`](../../../../../docs/standards/code/components.md)。
- 新应用的 [`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md)、[`ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md)。

设计审查（2026-10-22，omp 默认模型，报告见 [evidences/design-review.txt](evidences/design-review.txt)）：11 条，已按下文修订。
- 成立并修改：1 至 6、8 至 11。
- 第 7 条（nb-story 交不出事件与日志）：供给移到 w00024 t13，t10 只定输入合同。
- 第 6 条里“限制文本长度”一项不采纳。

工作方式：

- 在 worktree `.worktree/w00019-nb-agent-ui` 上工作，分支 `feat/w00019-nb-agent-ui`。各切片在这条分支上提交，验证也在这条分支上做，Work README 写明这条分支。
- Task 记录只在主工作区改。
- 迁移来源只用 `865c9f593`；`neuro-book-legacy` 里的那份停在 t09 之前，不用。

## 技术选型

| 问题 | 选用 | 理由 / 否决 |
|---|---|---|
| 界面文字 | 包内自带中英两张表，组件收 `locale` 属性，做法同 nb-form 的 `src/vue/messages.ts`；文字表是纯数据，放在核心 | 新应用与 nb-story 都不用 vue-i18n；否决宿主注入翻译表，因为 130 多条文字会全部变成宿主负担 |
| 调用方给的文字（注册表里的名称、命令说明） | `ViewText` 为 `string \| LocalizedText \| {key: AgentTextKey; params?}`：宿主与插件写中英两份（带参数时先用核心导出的 `formatText` 把参数代进两种语言），包内文字仍写本包文字表的键加参数 | 纯逻辑与它们的单测里的 `{key, params}` 原样保留；否决只留中英两份，否则 `groupPhrase(count)`、过程摘要这些带数字的文字要么各自拼接、要么英文里混中文 |
| 图标 | 照旧用 `i-lucide-*` 类名；包导出 `tailwind.css`，里面只有 `@source`，宿主在 nb-ui 之后导入 | 应用与 nb-story 都已经用 Tailwind 加 `@iconify/tailwind4`；否决改成 SVG 组件，因为全仓库要多出第二套图标做法 |
| 样式 | 组件内 scoped CSS 加 nb-ui token，不用原子类，同 nb-form | 旧组件基本已经是 scoped CSS，只有 `AgentConversationView` 用了 8 处原子类，迁时改写 |
| 测试 | 纯逻辑用 `bun test`；组件用 Vitest 加 happy-dom（`*.dom.test.ts`）；真实布局与滚动用应用的 Playwright e2e | 沿用 nb-form 与新应用的分法；旧应用的 `scripts/smoke` 方式不再沿用 |
| 消息的流式合成 | 自己写适配器：会话日志条目是权威来源，SSE 的 `AgentEvent` 只作运行中的临时显示；输入按 `unknown` 接收，用手写的类型守卫收窄 | 只读少数字段，没有通用库可用；否决在运行时依赖 nb-harness 或 OMP，否则浏览器包会带上模型 SDK；否决引入 TypeBox 校验整份 OMP 消息，适配器只认它读的那几个字段，其余原样忽略 |

## 关键设计

### `packages/nb-agent-ui/`（新包）

- **包外壳**照 nb-form：
  - `package.json` 的 `exports`：`.`（核心）、`./vue`、`./lab-sources`、`./tailwind.css`；
  - 两份 tsconfig、`vitest.config.ts`、`bunfig.toml`；
  - `AGENTS.md` 写边界与验证命令，`README.md` 写用法。
- **依赖**：`dependencies` 只有 `@notnotype/nb-ui`；`peerDependencies` 是 `vue`；nb-harness 只作 devDependency，供契约测试用。
- **边界**：`src/boundary.test.ts` 照抄 nb-form 的写法。
  - 核心（`src/` 下除 `vue/` 以外的文件）不依赖任何包，只允许 `import type` 自 `vue`，用于注册表类型里的组件字段；
  - Vue 层只依赖 `vue`、`@notnotype/nb-ui` 与核心；
  - 都不能越出 `src/`，也不能用 `nbook/` 这类应用别名。旧 `agent-view.types.ts` 就引用了应用里的 `PromptEditorPastePolicy`，迁移时改为本包 `ports.ts` 里的定义；测试里加一个 `nbook/…` 导入的反例。
- **机检**：`src/icon-registration.test.ts` 照抄 nb-ui 的两条规则（图标名必须存在、类名不能拼接）。nb-ui 的 token 机检不扫本包，本包另写一份精简版：不写字面颜色、不写常量圆角、`var(--x)` 必须有声明。

### `src/`：核心，纯 TS

- **`types.ts`**：来自 `agent-view.types.ts`。消息、ctx、services、action 原样搬过来，只改四处：
  - `ViewText` 改成上文的形状；
  - `UsageView.cost` 由 `number` 改为 `number | null`，`null` 表示单价未知：harness 对单价未知的模型记 `null`、对免费模型记 `0`，显示时前者不写金额、后者写 0；
  - `services` 加可选的 `resolveMarkdownAsset(src, signal)`，签名同 `MarkdownDisplay` 的 `resolveAsset`；
  - action 加 `link.open {href}`（见下文 `AgentMarkdown`）。
- **`messages.ts`**：本包的中英文字表与 `AgentTextKey`、`formatText`，纯数据与纯函数。
- **纯逻辑**，带着各自的测试原样搬过来，测试从 Vitest 改用 `bun test`：
  - 分轮：`conversation-turns.ts`；
  - 过程摘要：`process-summary.ts`；
  - 任务清单：`task-list.ts`；
  - 工具参数与详情行：`tool-args.ts`、`tool-detail-lines.ts`；
  - 发送规则：`composer-actions.ts`；
  - 点击标签的去向：`prompt-token-action.ts`。
- **`ports.ts`**：宿主注入组件要满足的形状，按结构类型写，不引用应用包。
  - `PromptEditorPort` 列出 `865c9f593` 的 `AgentConversationComposer.vue` 实际用到的全部属性、事件与外露，实施时以该文件为准逐项列，不凭记忆。已知的有：
    - 属性：`draft`、`locale`、`placeholder`、`ariaLabel`、`readonly`、`bare`、`fill`、`enterSubmits`、`triggers`、`resolveMenu`、`commands`、`acceptImages`、`acceptFiles`、`attachments`、`resolveThumbnail`、`pastePolicy`、`recall`；
    - 事件：`change`、`submit({mod})`、`escape`、`shift-tab`、`menu-open`、`token-activate` 与附件的几个事件；
    - 外露：`focus(at?)`、`insertText`、`insertFiles`。
  - 共用的数据形状也定义在这里：标签 `PromptToken`、菜单、附件卡片、粘贴策略 `PastePolicy`。`ComposerView` 与端口都引用这一份。
  - `PromptTextViewPort`、`MarkdownDisplayPort` 同理。`MarkdownDisplayPort` 写上 `locale`、`streaming`、`resolveAsset` 与 `activate` 事件。
  - **端口的属性类型写成组件 `$props` 的形状**，事件写成 `onX` 处理函数，供下面的类型断言用。
- **类型断言**：
  - 不对 `nbook.markdown` 服务交出的值做断言。服务字段的类型是宽泛的 `Component`，什么都能通过（审查第 2 条实测：空对象也能赋给它）。
  - 改为在 `nbook.markdown` 插件自己的 `web/` 下，对三个 `.vue` 源组件逐项断言：
    - 端口属性能赋给 `InstanceType<typeof PromptEditor>["$props"]`：本包传的每个属性和事件处理函数，组件都接受、类型也兼容，组件的必填属性也都在端口里；
    - 组件实例能赋给端口的外露类型。
  - 每一项都配一个 `@ts-expect-error` 反例，证明缺少必填属性、事件名写错、缺少外露方法时会报错。
  - 服务在运行时还包了一层（`withHost` 或 `defineAsyncComponent`），它只转发属性和插槽，这一层没有类型保证，由 e2e 的输入框一组兜底。
- **`harness.ts`**（适配器，最后一片做）：
  ```ts
  createHarnessTranscript(): {
      applyLogEntry(entry: unknown): void;   // 会话日志条目，权威来源
      applyEvent(event: unknown): void;      // SSE 的 AgentEvent，只作运行中的临时显示
      messages(): readonly MessageView[];
      problems(): readonly TranscriptProblem[];  // 跳过的输入与原因
  }
  ```
  - **以日志为准**：
    - 运行结果只从日志来：`run_end`（错误、停止）与 `usage` 条目。审查第 1 条实测：缺密钥时 harness 一个事件都不发，日志里却有 `run_end`；单价未知与免费在事件里都是 0，日志里分别是 `null` 与 `0`。
    - 事件只用来拼出“正在生成的那条助手消息与它的工具调用”。同一条消息的日志条目到达后，临时版本整条换成日志版本。
    - 收到 `run_end` 或 `agent_end` 时，清掉剩下的临时版本。
    - 日志条目按 `seq` 只进不退，重复或更旧的 `seq` 忽略。
  - **对宿主的要求**（写进包 README 的接入说明）：
    - 运行中把 harness 的事件和新写入的日志条目按顺序推给浏览器；
    - 断线重连时按 `seq` 游标补发日志；
    - 只发事件不发日志的宿主，看不到运行错误和费用。
  - **映射规则**：
    - 用户消息：文字与图片映射成 `blocks`；
    - 助手消息：文字、思考、工具调用，工具调用按 `toolCallId` 与工具结果配对；
    - `usage` 加到所在的消息上，`cost` 原样保留 `null`；
    - `run_end` 的 `error`、`aborted` 分别成为错误条目与“已停止”。
  - **输入不可信**：两个入口都按 `unknown` 接收，用手写的类型守卫只收窄本包读的字段。下面几种情况都跳过，并记一条 `problems()`，不抛异常、不中断回放：
    - 认不出的条目或事件；
    - 缺字段；
    - 重复的工具 id：保留先到的；
    - 找不到调用的工具结果。
    - 不限制文本长度：日志来自本机，不值得为它多一层截断。
  - harness 没有 steer 与 followup，适配器不产生这两种投递，排队由宿主自己管。
  - 图片只有 base64，适配器生成 `data:` 定位符，由 `resolveAttachmentUrl` 原样返回。
  - **nb-story 的供给不在本 Task**：它的问答引擎目前只对外发三种简化的进度，要交出事件与日志，属于 w00024 t13。本 Task 在 t13 记录里写明这个前置。

### `src/vue/`：渲染层

- **目录**：沿用 t09 的分区与依赖方向，即 `parts/`、`stream/`、`tools/`、`composer/` 加根目录，`865c9f593` 里的 `app/components/agent/README.md` 改写成包内的 `src/vue/README.md`。
- **改动只有四类**：
  - `useI18n` 换成 `useAgentText()`，按注入的 `locale` 查 `messages.ts`；
  - `AgentMarkdown` 改成渲染注入的 `MarkdownDisplay`：
    - 传入 `locale`；`resolveAsset` 取 `services.resolveMarkdownAsset`，宿主没给时图片按 `MarkdownDisplay` 的缺省只显示说明；
    - 接住 `activate` 并换成动作：
      - 引用发出 `reference.open {target}`；
      - 图片打开原图预览，地址经 `resolveMarkdownAsset` 取，取不到不打开；
      - 外链发出新的 `link.open {href}`，由宿主决定怎么打开。
    - 旧版把链接画成普通的 `<a>`，在应用里点了会把整页跳走，引用也没有动作，所以这里算修正，不算改了约定的行为。三种点击各有一条 DOM 测试。
  - `AgentUserContent` 改用注入的 `PromptTextView`；
  - `AgentConversationComposer` 改用注入的 `PromptEditor`。
- **注入**：由 `host.ts` 负责。
  - `AgentConversationView` 新增属性 `locale` 与 `renderers: {markdown, promptEditor, promptTextView}`，用 `provide` 传给子组件；
  - 零件单独挂载时（Lab、宿主自己拼装）用导出的 `provideAgentView({locale, renderers})`；
  - 用到注入的组件在文档里标 `state:inject`。
  - 每个注入项都有包内的简单实现作缺省：`PlainMarkdown`（保留换行的纯文字）、`PlainPromptTextView`、`PlainPromptEditor`（textarea，只实现 `draft`、`change`、`submit`、`focus`、`insertText`）。neuro-book 注入 `nbook.markdown` 的实现；没有富编辑器的宿主（例如以后的 nb-story）可以用缺省实现。
  - `nbook.markdown` 的 PromptEditor 是异步组件，加载完成前拿不到外露的方法，输入框调用 `focus`、`insertFiles` 时要容许它还没加载，旧代码本来就是可选调用。
  - **宿主接入说明**写在包 README：加依赖、在 nb-ui 之后导入 `tailwind.css`、注入渲染组件、按适配器的要求提供日志与事件。nb-story 的实际接入属于 w00024 t13，照这份说明做，本 Task 不改 nb-story。
- **注册表与内置登记**：
  - `registry.ts` 与 `builtin-roles.ts`、`builtin-message-actions.ts`、`builtin-composer.ts` 原样迁；名称改为中英两份。
  - `builtin-tools.ts` 只保留通用工具：读、写、改、补丁、网页搜索与抓取、`list_` 开头的查询、提问、模式切换、任务清单、Workflow、bash、SQL、Agent 协作。
  - 只属于 NeuroBook 的三项（`subject_memory`、`subject_rag_search`、查会话与 Agent 的 `agent_lookup`）挪进 Lab 的场景宿主，作为“宿主登记领域工具”的示例。主应用以后有 Agent 插件时，由它登记。迁移后核对：用到这几个工具的场景都登记了它们，不会退成通用卡片。
- **原图预览**：`OriginalImagePreviewDialog` 暂时放在本包的 `parts/`。它是通用件，但 w00030 t04 正在拆 nb-ui 的 Dialog，现在放进 nb-ui 会撞车，所以记入 w00024 的 nb-ui 候选清单，等 w00030 做完再搬。
- **入口与文档**：`src/vue/index.ts` 导出 `AgentConversationView`、各零件、`provideAgentView` 与注册表构造函数。导出的组件都是受管组件，同名 `.md` 搬过来，跟着上面的改动更新。

### `packages/nb-ui/`：新增四个通用零件

| 文件 | 来源 | 改动 |
|---|---|---|
| `components/display/CodeBlock.vue/.md` | `parts/AgentCodeBlock` | “空”“已截断”两处文字改由属性传入 |
| `components/layout/CollapsibleCard.vue/.md` | `parts/AgentCard` | 转圈的无障碍名称（原来用 `useI18n` 取 `agentView.turn.running`）改由属性 `runningLabel` 传入，缺省用 nb-ui `Spinner` 的缺省文字 |
| `components/layout/CollapsibleRow.vue/.md` | `stream/AgentStepLine` | 同上 |
| `composables/useStreamScroll.ts` | `stream/use-stream-scroll.ts` | 原样迁，注释里的锚点规则一并带上 |

- **样式变量先列迁移表再动手**：旧零件读一组 `--acv-*` 变量，父组件 `AgentTurnBlock` 又在局部覆盖其中几个，例如步骤行左右内边距在过程区是 6px，单独挂载时缺省 8px。另外还有 `--acv-markdown-*`、`--acv-block-indent`。S1 开始前，用 `865c9f593` 的源码把每个变量的写入处和读取处列成表，分三类：
  - 零件自己的取值，改用 nb-ui token；
  - 零件公开、允许宿主覆盖的变量，改用 nb-ui 前缀，带缺省值，按 nb-ui token 机检的规则登记，并写进零件文档；
  - 对话视图自己的布局变量，留在本包，改用本包前缀。
- 写入处和读取处一起改名。加一条 DOM 测试，同时覆盖“嵌在过程区里是 6px”和“单独挂载是 8px”。

- 这些零件在 `components/index.ts` 与 `composables` 入口导出，并在 Lab 的 nb-ui 场景（`fixtures/nb-ui*`）里登记。
- 两项合并留给 w00024 后续清单，本 Task 不做：`CodeBlock` 与 dev-panel `DiffView` 的合并，以及给 `CodeBlock` 加语法高亮。
- 对话视图里原来的这三个零件（`AgentCodeBlock`、`AgentCard`、`AgentStepLine`）改用 nb-ui 的版本，旧文件删除。

### `packages/neuro-book/`：宿主与 Lab

- **依赖与样式**：`package.json` 加 `@notnotype/nb-agent-ui`；`src/web/tailwind.css` 在 nb-ui 之后导入 `@notnotype/nb-agent-ui/tailwind.css`。
- **Lab 收录组件**：`src/plugins/lab/web/component-index.ts` 照 nb-form 的写法收录 `nb-agent-ui` 一组。
- **场景**：放在 `src/plugins/lab/web/fixtures/nb-agent-ui/`，由 `fixtures/index.ts` 展开。
  - 来源是 `865c9f593` 里的 `Agent*Fixture.vue`、`*.scenes.ts`、`agent-conversation-fixture-data.ts`、`agent-composer-lab-host.ts`；`prompt-lab-menu.ts` 改用新应用 PromptEditor 场景里已有的那份，没有就一起搬。
  - 只搬新视图的场景；旧侧栏 `novel-ide/agent` 的那批不搬，t11 做顶栏和面板时再拿来参考。
  - 场景用真实的 `nbook.markdown` 组件（Lab 允许引用其它插件的 `web/`），另加一个“缺省实现”场景，看 `Plain*` 的效果。
  - 控制按钮改用新 Lab 的 `LabFixtureControls`；读事件用 `__nbLab`。
- **e2e**：新增 `e2e/lab-agent-ui.e2e.ts`，写法照 `lab-nb-form.e2e.ts`。把旧 smoke 两个文件的检查逐条搬过来：
  - `agent-conversation-view.ts`：跟随底部与阅读锚点、整轮收起后最终回复不动、历史翻页与重试、原始视图、投递状态未知、已发送消息的文字写法与原图预览；
  - `agent-composer.ts`：发送与命令、运行中的投递方式、附件上传中与失败时不能发送、展开与模型下拉、只读场景。
- **类型断言**：在 `nbook.markdown` 的 `web/` 下新增 `prompt-ports.typecheck.ts`（见上文 `ports.ts`）。

### 仓库登记

| 文件 | 改动 |
|---|---|
| 根 `package.json` | `workspaces` 加 `packages/nb-agent-ui` |
| `bun.lock` | 由 `bun install` 生成 |
| `docs/modules/monorepo-boundaries.md` | 加一行 nb-agent-ui |
| `scripts/ci/check-documentation.ts` | `COMPONENT_BARRELS` 加 `packages/nb-agent-ui/src/vue/index.ts` |
| `.github/workflows/code-baseline.yml` | `paths` 加本包 |
| `.github/workflows/workspace-packages.yml`、`scripts/ci/workspace-package-matrix.ts` | `paths` 与矩阵各加本包，跑 `typecheck`、`test`；nb-ui 的消费方闭包加上本包 |
| 根 `AGENTS.md` 的包目录树、`packages/AGENTS.md` 的成员列表 | 各加一行 |
| `docs/standards/code/components.md` | 受管组件一句加上本包 |

## Spec 与文档改动

- **Spec 搬回**：`docs/archived/specs/ui/agent-conversation-view.md` 搬回 `docs/specs/ui/agent-conversation-view.md`，用 `git mv`。
  - 补上 `865c9f593` 里的 15 行；
  - `owners` 改为 `packages/nb-agent-ui`、`packages/nb-ui`；
  - 链接改到新位置：提案在 `neuro-book-legacy`，组件文档在本包；
  - 状态保持 planned；
  - Smoke 一节改写为新的测试入口；
  - 行为条目只补三处，其余一字不改：
    - action 表加 `link.open {href}`；
    - 服务加可选的 `resolveMarkdownAsset`；
    - 用量的费用可以是“未知”，未知时不显示金额。
  - 这三处都是迁移暴露出来的缺口，不是新功能。
- **其它文档**：
  - `docs/specs/ui/component-lab-timeline.md` 不动；
  - nb-ui 新零件与本包组件的同名 `.md`，见上文；
  - w00024 README 的“后续安排”加两条：原图预览进 nb-ui；`CodeBlock` 加语法高亮。
  - w00024 t13 记录加一条前置：问答引擎要按 nb-agent-ui README 的接入说明，交出 harness 事件与带 `seq` 的日志条目。
  - 包 README 写宿主接入说明（见上文）。

## 切片

每片在 Work 分支上单独提交，验证和提交分两步。

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S0 | 开 worktree 与分支，Work README 写明分支；Spec 搬回；包骨架、边界与图标机检、仓库登记 | `bun install`；本包 `bun run typecheck`、`bun run test`；`bun run docs:check`、`governance:check` |
| S1 | 先列样式变量迁移表；nb-ui 的四个零件、文档与 Lab 场景 | nb-ui `typecheck`、`test`（含两项机检）；6px 与 8px 两种情况的 DOM 测试；应用 Lab 场景门禁测试 |
| S2 | 核心：类型、纯逻辑与测试、`ports.ts` | 本包 `bun run test` |
| S3 | 渲染层：文字表、注入与缺省实现、注册表与内置登记、消息流与工具详情、`AgentMarkdown` 的点击与图片；改用 S1 的零件 | 本包 Vitest：搬来的 `AgentUserContent` 测试与注册表测试；新增测试覆盖：注入缺失时退回缺省实现、Markdown 三种点击、带参数文字的中英两种语言 |
| S4 | 输入框、原图预览、应用侧的类型断言与反例 | 本包 Vitest；应用 `bun run typecheck`，并临时删掉一个必填属性，确认会报错 |
| S5 | 应用接入：依赖、样式、Lab 收录与场景、`lab-agent-ui.e2e.ts` | 应用 `bun run test`、`test:e2e`（含 `lab-scenes.e2e.ts` 全场景巡检）、`nbdev shot` 截图看溢出 |
| S6 | harness 适配器、契约测试、Lab 场景“harness 记录回放” | 本包 `bun run test`；契约测试用 `@notnotype/nb-harness/testing` 的假模型跑真实 harness，订阅事件、读内存日志，交给适配器；覆盖普通完成、收尾工具完成、运行前就失败（缺密钥）、中途停止、单价未知与免费 |

适配器的“记录回放”场景：用 S6 契约测试录下的日志生成场景数据，这样 Lab 里能直接看到真实 harness 输出画成什么样。

## 验收映射

只列 t10 已有实现、要守住的条目。5、16、19 和 17 里顶栏的部分属于 t11。条目编号指归档 Spec 的“验收与 Smoke”。

| 条目 | 覆盖 |
|---|---|
| 验收 1、2、3、8 | `conversation-turns.test.ts`、`process-summary.test.ts`（bun）；3 的运行中转圈另由 e2e 看 |
| 验收 4、7 与“历史与滚动” | `lab-agent-ui.e2e.ts`（跟随与锚点、整轮收起、翻页与重试） |
| 验收 6 | 分轮单测（最新一轮展开、错误露出） |
| 验收 9、10 | `lab-agent-ui.e2e.ts`（原始视图、投递状态未知） |
| 验收 11、12 | `composer-actions.test.ts`；`lab-agent-ui.e2e.ts` 的输入框一组 |
| 验收 13、14、15 | 注册表测试（Vitest） |
| 验收 17、18 | `lab-scenes.e2e.ts`（手机宽度、无报错、无溢出）；`nbdev shot` 看明暗两种主题 |
| 适配器 | `harness.test.ts`：先喂事件、再喂日志，最终结果与只喂日志相同；运行中只有事件时显示临时消息；写坏和乱序的输入进 `problems()` 且不抛异常；契约测试见 S6 |

## 验证

- 端到端：`nbdev dev start` 起开发服务，在 Lab 的 `nb-agent-ui` 组里逐个场景过一遍：
  - 对话视图的各场景、输入框 7 个场景、原图预览、缺省实现场景、harness 记录回放；
  - 手机与 1400×900 两种宽度，明暗两种主题；
  - 然后交开发者在 Lab 确认，t09 第 2 步的确认也在这里一起做。
- 全量：本包与 nb-ui 的 `typecheck`、`test`；应用的 `bun run typecheck`、`bun run test`、`bun run test:e2e`；`docs:check`、`governance:check`。
- 明确留下不验证的：
  - Firefox 与 Safari；
  - 真实模型的流式运行，契约测试只用假模型；
  - nb-story 实际接入，那是 w00024 t13 的事。

## 不做与风险

- **不做**：
  - Spec 里没做过的部分（顶栏、状态栏、待处理区、横幅、提问向导、就地编辑、面板与弹窗、时间线回放），都属于 t11；
  - 主应用的 Agent 插件与真实会话接入；
  - `CodeBlock` 的语法高亮。
- **风险：nb-ui 撞车**。w00030 t04 正在改 nb-ui 的公开导出与 Dialog。本 Task 只在 nb-ui 里加新文件，在入口文件里加导出行。合入前先合 master，导出行冲突手动解决。
- **风险：注入接口走样**。应用侧对 `.vue` 源组件的类型断言管住属性、事件处理函数与外露方法，带反例；服务运行时包的那一层不在类型检查里，靠 e2e 的输入框一组兜底。
- **风险：缺省实现简陋**。`PlainPromptEditor` 没有标签、附件和粘贴块，输入框的附件按钮与 `/` 菜单在它上面不可用：附件按钮隐藏，命令按普通文字发送。缺省实现的文档里写明这一点。
- **风险：工具参数名不一致**。nb-harness 内置的 `read`、`edit` 的参数名如果与旧渲染器读的字段不一致，S6 的契约测试会暴露出来。届时在渲染器里同时认两种写法，并告诉开发者。
