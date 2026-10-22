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
   - 领域工具（不是通用 harness 工具的那些）由宿主自己登记渲染器，例子见 Lab 的 `packages/neuro-book/src/plugins/lab/web/fixtures/nb-agent-ui/domain-tools.ts`。

4. **数据**：视图不持有会话数据。消息、运行状态、草稿、附件状态都经 `ctx` 给出，宿主受理用户操作后给出新的 `ctx`（例如发送后给一个新版本的空草稿）。
