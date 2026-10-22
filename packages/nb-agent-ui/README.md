# @notnotype/nb-agent-ui

Agent 对话视图。行为合同见 [`ui.agent-conversation-view`](../../docs/specs/ui/agent-conversation-view.md)，包的约定见 [AGENTS.md](AGENTS.md)。

- `@notnotype/nb-agent-ui`：核心，纯 TS。视图合同（`ctx`、`services`、`action`）、注册表、界面文字，以及宿主注入组件要满足的形状（`ports.ts`）。
- `@notnotype/nb-agent-ui/vue`：渲染层。`AgentConversationView` 与各零件、内置登记、注入用的 `provideAgentView`，以及缺省实现。

## 宿主接入

1. **依赖**：只进前端构建的宿主放 `devDependencies`；`vue` 是 peer 依赖。
2. **样式**：宿主自己编译 Tailwind，在 nb-ui 之后导入本包的入口，图标类名才会生成：

   ```css
   @import "@notnotype/nb-ui/tailwind.css";
   @import "@notnotype/nb-agent-ui/tailwind.css";
   ```

3. **挂载**：

   ```vue
   <AgentConversationView
       :ctx="ctx"
       :services="services"
       :registry="createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, builtinMessageActionsContribution, builtinComposerContribution, ...宿主的登记])"
       :locale="locale"
       :renderers="{markdown, promptEditor, promptTextView}"
       @action="handle"
   />
   ```

   - `renderers` 是宿主的 Markdown 显示、提示词编辑器与已发送文字的显示，形状见核心的 `MarkdownDisplayPortProps`、`PromptEditorPortProps`、`PromptTextViewPortProps`。缺哪个用包内的缺省实现（`PlainMarkdown`、`PlainPromptEditor`、`PlainPromptTextView`）：Markdown 按纯文字显示，输入框是普通文本框，没有标签、附件与粘贴块。neuro-book 注入 `nbook.markdown` 的组件，并有一份类型断言对照它们（`packages/neuro-book/src/plugins/markdown/web/prompt-ports.typecheck.ts`）。
   - 单独挂零件（例如只要输入框）时，在外层组件的 `setup` 里调用 `provideAgentView({locale, renderers})`。
   - 领域工具（不是通用 harness 工具的那些）由宿主自己登记渲染器，例子见 Lab 的 `packages/neuro-book/src/plugins/lab/web/fixtures/nb-agent-ui/domain-tools.ts`。读参数用核心导出的 `argString`、`argArray` 等（容忍流式半截的参数，不抛错）；改文件的工具给 `effects` 与 `diff` 就有改动统计与 diff 详情。两个渲染器不能声明同一个工具名或前缀；要替换内置的某一项，先从内置登记里过滤掉它：`{...builtinToolsContribution, tools: builtinToolsContribution.tools!.filter((tool) => tool.id !== "read")}`。

4. **数据**：视图不持有会话数据。消息、运行状态、草稿、附件状态都经 `ctx` 给出，宿主受理用户操作后给出新的 `ctx`（例如发送后给一个新版本的空草稿）。

## 跑 harness 的宿主

`createHarnessTranscript()` 把 nb-harness 的会话日志条目与流式事件合成 `ctx.messages`（实现与两条来源的分工见 `src/harness.ts` 的模块头）：

```ts
const transcript = createHarnessTranscript({locale});
for (const entry of await log.read()) transcript.applyLogEntry(entry);   // 打开会话：先读已有日志
// 运行中：按到达顺序
transcript.applyEvent(agentEvent);      // harness.subscribe 的事件，或 SSE 帧里的 JSON
transcript.applyLogEntry(newEntry);     // 新写进日志的条目
ctx.messages = [...transcript.messages()];
```

- **日志是权威**：运行错误（`run_end`）与费用（`usage`，单价未知为 null）只从日志来。只推事件、不推日志的宿主看不到运行错误与费用。
- **断线重连**：宿主按 `seq` 游标补发日志；适配器忽略重复与更旧的 `seq`。
- **图片**：harness 只给 base64，适配器把它写成 `data:` 定位符，`services.resolveAttachmentUrl` 原样返回即可。
- **写坏的输入**：跳过并记进 `problems()`，不抛异常。宿主可以把它们写进自己的诊断。
- **投递方式**：harness 没有 steer 与 followup，适配器不产生这两种投递。排队消息由宿主自己放进 `ctx.composer.queued`。
