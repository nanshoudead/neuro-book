# @notnotype/nb-agent-ui

Agent 对话视图。行为合同见 [`ui.agent-conversation-view`](../../docs/specs/ui/agent-conversation-view.md)，包的约定见 [AGENTS.md](AGENTS.md)。

- `@notnotype/nb-agent-ui`：核心，纯 TS。视图合同（`ctx`、`services`、`action`）、注册表、界面文字，以及宿主注入组件要满足的形状（`ports.ts`）。
- `@notnotype/nb-agent-ui/vue`：渲染层。宿主只挂 `AgentConversationView`，注册表用内置登记（`builtinContributions` 或四份单独的）加自己的。
- `@notnotype/nb-agent-ui/lab`：只给应用的 Component Lab，单独挂内部零件与算轮次样例；不是宿主接口，形状随时会变。

## 宿主接入

1. **依赖**：只进前端构建的宿主放 `devDependencies`；`vue` 是 peer 依赖。
2. **样式**：宿主自己编译 Tailwind，在 nb-ui 之后导入本包的入口，图标类名才会生成：

   ```css
   @import "@notnotype/nb-ui/tailwind.css";
   @import "@notnotype/nb-agent-ui/tailwind.css";
   ```

3. **挂载**：一个最小宿主（跑 harness 的宿主，数据见下一节）：

   ```vue
   <script setup lang="ts">
   import {ref, watchEffect} from "vue";
   import {acceptSubmission, applyComposerAction, createAgentContext, createAgentViewRegistry, type AgentViewAction} from "@notnotype/nb-agent-ui";
   import {AgentConversationView, builtinContributions} from "@notnotype/nb-agent-ui/vue";

   // 宿主声明自己支持的操作；不声明时输入框是只读的。
   const ctx = ref(createAgentContext({interaction: {canSend: true, canStop: true}}));
   const registry = createAgentViewRegistry([...builtinContributions, ...宿主的登记]);

   function handle(action: AgentViewAction) {
       const composer = applyComposerAction(ctx.value.composer, action);   // 草稿回声、模式、模型、思考档位
       if (composer !== null) return void (ctx.value = {...ctx.value, composer});
       if (action.type === "composer.submit") {
           send(action.text);                                                // 宿主自己的接口
           ctx.value = {...ctx.value, composer: acceptSubmission(ctx.value.composer)};
       }
       // 其余 action（停止、附件、打开引用……）按宿主支持的处理，不认识的忽略。
   }

   // 运行中每秒更新 now，运行中的用时按它算；空闲时不用打节拍。
   watchEffect((onCleanup) => {
       if (ctx.value.run.status === "idle") return;
       const timer = setInterval(() => (ctx.value = {...ctx.value, now: Date.now()}), 1000);
       onCleanup(() => clearInterval(timer));
   });
   </script>

   <template>
       <AgentConversationView :ctx="ctx" :services="{}" :registry="registry" :locale="locale" @action="handle" />
   </template>
   ```

   - `services` 三项都可选：没有 `resolveAttachmentUrl` 时附件显示不可用占位，没有 `resolveTriggerMenu` 时只剩 `/` 命令，没有 `resolveMarkdownAsset` 时回复里的图片只显示说明。`resolveTriggerMenu` 是纯函数，数据到达时换一个新函数，编辑器据此重取菜单。
   - 草稿：编辑器每次改动发 `composer.draftChanged`，宿主只换文字不换版本（`applyComposerAction` 就是这样做的），编辑器认得这是自己的回声；宿主受理发送后给一个新版本的空草稿（`acceptSubmission`），视图据此清空，发送失败时文字不会丢。
   - `renderers` 是宿主的 Markdown 显示、提示词编辑器与已发送文字的显示，形状见核心的 `MarkdownDisplayPortProps`、`PromptEditorPortProps`、`PromptTextViewPortProps`。缺哪个用包内的缺省实现：Markdown 按纯文字显示，输入框是普通文本框，没有标签、附件与粘贴块。neuro-book 注入 `nbook.markdown` 的组件，并有一份类型断言对照它们（`packages/neuro-book/src/plugins/markdown/web/prompt-ports.typecheck.ts`）。
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
ctx.messages = transcript.messages();
```

- **日志是权威**：运行错误（`run_end`）与费用（`usage`，单价未知为 null）只从日志来。只推事件、不推日志的宿主看不到运行错误与费用。
- **断线重连**：宿主按 `seq` 游标补发日志；适配器忽略重复与更旧的 `seq`。
- **图片**：harness 只给 base64，适配器把它写成 `data:` 定位符，`services.resolveAttachmentUrl` 原样返回即可。
- **写坏的输入**：跳过并记进 `problems()`，不抛异常。宿主可以把它们写进自己的诊断。
- **投递方式**：harness 没有 steer 与 followup，宿主把 `interaction.canSteer`、`canQueue` 都给 false，运行中能写不能发。
- **运行状态**：以宿主服务端的运行状态为准。`transcript.run()` 只按事件推出（`agent_start` 后运行中，`agent_end` 或日志的 `run_end` 后空闲），页面刷新、断线重连后只补日志时得不到“运行中”，只作没有服务端状态时的退路。
