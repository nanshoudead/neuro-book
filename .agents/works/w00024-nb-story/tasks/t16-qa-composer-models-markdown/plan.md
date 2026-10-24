# t16 实施计划：单行输入框、模型目录与自定义服务商、Markdown 作答

## Context

开发者试用 t15 后提出三件事（2026-10-24）：输入框收成一行并补齐控件；要一个能按 OMP 目录选模型、能自定义服务商的设置界面，界面做进 nb-agent-ui；作答不必结构化，Markdown 读着更轻松。静态稿与决定见 [README](README.md) 的决定 1 到 9 与评审板 [review](artifacts/review/index.html) v1。

依据：[`story/qa.md`](../../../../../docs/specs/story/qa.md)、[`story/viewer.md`](../../../../../docs/specs/story/viewer.md)、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)、[`agent/harness.md`](../../../../../docs/specs/agent/harness.md) 的“模型”。

已定，不再议：

- 输入框始终一行：正文变长时只有正文长高，控件贴在右下；窄到放不下时控件折到下一行。控件为 `+`（插入 `@`，打开引用菜单）、模式（只在新对话）、模型与推理档、上下文大小、发送。
- 模型目录左右两栏：左边服务商（搜索、密钥状态圆点、要登录的灰掉），右边这一家的模型表（接口、上下文、推理、图片、单价）。
- 设置页“模型”一节：候选模型（一个默认，默认的旁边设推理档）、用到的服务商与密钥状态、自定义服务商；密钥只认环境变量。
- 目录列出全部服务商，要登录的不能选；没验证过的接口照常可选。
- 作答默认 Markdown，结构化可选；Markdown 回复里出处不对时自动让模型改一次。

工作方式：主会话自己实现（worktree `.worktree/w00024-t16`，分支 `feat/w00024-t16-qa-composer-models`）；做完一次实现审查，前端 Sonnet、后端 omp；不 push。

## 技术选型

- 模型目录与密钥变量名：用 nb-harness 已依赖的 `@oh-my-pi/pi-catalog`（`getBundledProviders`、`getBundledModels`）与 `@oh-my-pi/pi-ai`（`getEnvApiKeyName`），不自己维护模型表。
- 自定义服务商的模型列表：服务的 `GET {baseUrl}/models`（OpenAI 兼容服务都有）。用 nb-story 已有的 `openai` 依赖的 `models.list()`；Anthropic、Gemini 的服务商不提供“从服务读取”，只能手动添加。
- 其余无新增依赖。

## 关键设计

### `packages/nb-harness/src/model.ts`：目录列表与自定义服务商

- 新增 `listCatalog(): CatalogProvider[]`：`{id, name, auth: "key" | "login", keyEnv: string | null, models: CatalogModel[]}`，`CatalogModel` 为 `{id, name, api, contextWindow, reasoning, efforts, images, price}`。哪些服务商要登录（ChatGPT 登录、Copilot、Cursor 等）要按 OMP 的认证元数据判断：实测 `getEnvApiKeyName("anthropic")` 也返回空，不能只看它，第一片先查清 OMP 的做法并写成对照测试。
- `defineModel` 已收 `api`，自定义服务商的四种接口直接映射为 OMP 的 `openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai`；provider 名仍用宿主自己的名字，不套目录的修正。
- 目录模型照旧用 `resolveModel("provider/id")`。
- Spec：[`agent/harness.md`](../../../../../docs/specs/agent/harness.md) 的“模型”补 `listCatalog`。

### `packages/nb-story/src/contract/config-schema.ts` 与 `src/qa/config.ts`：配置第 2 版

```ts
type QaConfig = {
    providers?: Record<string, {         // 自定义服务商；键是服务商 id，不能与 OMP 目录的 id 重名
        name?: string;
        api: "chat" | "responses" | "anthropic" | "gemini";
        baseUrl: string;
        apiKeyEnv: string;
        models: {id: string; contextWindow?: number; maxTokens?: number; efforts?: Thinking[]; images?: boolean; price?: Price}[];
    }>;
    models: string[];                    // 候选，写成 "服务商/模型名"（目录的或自定义的），至少一个
    model: {use: string; thinking?: Thinking};  // 默认模型，必须在候选里
    ingest?: …;                          // 不变
    qa?: {maxChapters?; fullReadMaxChars?; answer?: "markdown" | "structured"};  // answer 默认 markdown
};
```

- 读到第 1 版（`model` 是 `{baseUrl, id, apiKeyEnv, …}`）时在内存里升级：建一个自定义服务商 `custom`（接口取原来的 `api`），候选与默认都是 `custom/<id>`，推理档、上下文、单价跟过去。写回一律写第 2 版。升级是 `config.ts` 里的一个纯函数，命令行、服务端、设置页共用。
- 抽取模型（`ingest.model`、`ingest.recall.model`）维持原样，不在本 Task 改；抽取没写模型时用问答的默认模型（经解析后的服务地址、密钥变量）。
- `src/qa/harness-model.ts` 的 `configuredModel(config)` 改成 `resolveQaModel(config, ref?)`：按引用找自定义服务商或目录，返回 `ResolvedModel` 与 `{contextWindow, efforts}`；引用不在候选里报 `qa_unconfigured`。

### `src/cli/config.ts`、`src/qa/config-edit.ts`：命令行

- `config show` 列候选（标出默认与推理档）、服务商与密钥状态。
- 字段编辑沿用 `config set|unset <路径>`，路径换成第 2 版的（`model.use`、`model.thinking`、`models`、`providers.<id>.<字段>`、`qa.answer`）；`model.use` 不在候选里、服务商 id 与目录重名是用法错误（退出 2）。
- `config init` 先问用目录里的模型还是自定义地址。
- `nbstory ask` 加 `--model <服务商/模型名>`、`--thinking <档>`（只对这一问）、`--structured`（只对新对话，同 `qa.answer`）。

### `src/qa/engine.ts` 与 Profile：每一轮的模型、作答方式与出处复查

- 每一轮按传入的模型引用与推理档建 harness（现在就是每轮新建），记录里的 `model` 写引用。
- 作答方式按对话固定（开对话时定，记进记录与 Profile 的初始输入，像做法一样）。Markdown 对话不声明 `answer` 工具，规则换成“用 Markdown 回答，出处写成章.段”；结构化对话照旧。Profile 版本 3 → 4：t16 之前开始的对话又会“能看不能续问”。
- 出处复查（决定 9）：一轮以文字回复结束时，用现有的 `replyOf` 找出没核实的出处；有的话，引擎先往会话日志写一条 `meta` 条目（`nb-story.reply-check`，带问题清单），再用同一个 harness 跑一次 `turn`，输入是写明问题的复查消息。第二次的文字作为这一轮的结果，用量合计；仍有问题照旧标出。只复查一次；结构化作答不复查（它已有退回）。不改 nb-harness。
- 网页按 `meta` 条目把紧跟其后的那条用户消息显示成过程里的一行“出处检查：N 处没读过，已让模型重写”，不显示成提问。

### `src/server`：接口

- 新增 `models.catalog`：目录加自定义服务商，每家带密钥变量与“服务启动时有没有值”（沿用 `config.get` 的 `keys` 做法）。
- 新增 `models.discover {provider}`：读自定义服务商的 `/models`，只返回模型名。
- `qa.ask` 与续问加 `model`、`thinking`；新对话另加 `answer`。

### `packages/nb-agent-ui`：输入框与模型界面

- `AgentConversationComposer`：新增版式 `inline`（`AgentConversationView` 的 `composerLayout` 属性，缺省仍是现在的两层，NeuroBook 不变）。
- `ComposerView` 加 `context?: {used: number; window: number | null}`，新零件 `AgentContextMeter`（圆环、70% 黄、90% 红、悬停写数字）。
- 登记的输入框按钮加 `placement: "leading"` 与 `insert?: string`：放在正文前，点了往编辑器插入文字，不发 action。nb-story 用它做 `+`。
- `AgentModelPicker` 末尾加“管理模型…”，发出 `model.manage` action；宿主没登记处理时不显示（`services` 里给开关）。
- 新组件 `AgentModelCatalog`（左右两栏的目录对话框）与 `AgentProviderForm`（自定义服务商表单），都是纯视图：数据与动作经 props、emits，读取 `/models`、保存由宿主做。各配同名 `.md` 与 Lab 场景。

### `packages/nb-story/src/web`：问答页与设置页

- `QaPage.vue`：用 `inline` 版式；候选、默认模型与推理档来自 `models.catalog`；发送带上当前选的模型与推理档；上下文大小取最近一条助手消息的用量与所选模型的窗口；修 `canChangeRuntime`（运行中以外都为真），模式按钮能切全读；`model.manage` 去设置页。
- `SettingsPage.vue`：“模型”一节换成候选列表、服务商列表，加两个对话框；限额与抽取仍用 `SchemaForm`。保存仍是整份 `config.set`，冲突处理不变。

## Spec 与文档改动

- `story/qa.md`：配置第 2 版与升级规则；输出 7、9、10、11 按作答方式改写，新增出处复查一条；`ask` 的新选项；`config` 的新路径；验收补对应场景。
- `story/viewer.md`：问答页输入框（单行、控件、上下文大小）、设置页的模型一节与两个对话框。
- `ui/agent-conversation-view.md`：`inline` 版式、上下文大小、前置插入按钮、`model.manage`、目录与服务商表单两个组件。
- `agent/harness.md`：`listCatalog`。

## 切片

1. **nb-harness 目录**：`listCatalog` 与要登录的判断、四种接口的 `defineModel`；单测。harness.md。
2. **配置第 2 版**：schema、升级、`resolveQaModel`、命令行 `config`；单测（第 1 版逐项升级、引用解析、用法错误）。qa.md 的配置部分。
3. **引擎**：每轮的模型与推理档、作答方式、Profile v4、出处复查；单测用脚本端点覆盖复查的三种结局。qa.md 其余部分。
4. **服务端接口**：`models.catalog`、`models.discover`、`qa.ask` 新参数；单测。
5. **nb-agent-ui**：`inline` 版式、上下文大小、前置插入按钮、`model.manage`、`AgentModelCatalog`、`AgentProviderForm`；dom 测试与 Lab 场景。ui/agent-conversation-view.md。
6. **nb-story 网页**：问答页与设置页接线；e2e 补“切全读”“换模型与推理档后请求里是新模型”“上下文大小”“目录选模型保存”“自定义服务商”“Markdown 回复出处复查”。viewer.md。

每片单独提交；自跑 `bun run test:affected` 与相关包的 typecheck，5、6 片另跑 Lab smoke 与 nb-story e2e。全部做完后跑 nb-story 全量 e2e，再派实现审查。

## 验收映射

编号在写 Spec 时定，这里按行为列：

| 行为 | 测试 |
|---|---|
| 第 1 版配置读出等价的第 2 版，写回是第 2 版 | `config.test.ts` |
| 引用不在候选、服务商 id 与目录重名、`model.use` 不在候选 → 退出 2 | `cli/config.test.ts` |
| 目录列表：要登录的标为 `login`；目录模型的上下文与推理档 | nb-harness `model.test.ts` |
| 每一轮按选的模型与推理档发请求，记录写引用 | `engine.test.ts` + e2e |
| Markdown 对话不声明 `answer`；结构化对话照旧 | `engine.test.ts` |
| 出处复查：第一次就对（不复查）、复查后对、复查后仍不对 | `engine.test.ts` |
| 复查消息在网页上显示为过程里的一行 | `record-messages.test.ts` + e2e |
| 新对话能切全读 | e2e |
| 单行版式：一行、折行、窄屏；上下文大小的三档颜色 | nb-agent-ui dom 测试 + Lab smoke |
| 目录选模型、自定义服务商保存后写进配置 | e2e |

## 验证

- 单测、typecheck、Lab smoke、nb-story 全量 e2e（真实 `nbstory serve`、脚本端点）。
- 未验证：Anthropic、Gemini 接口与真实服务的 `/models`。等有密钥时与 Responses 的真实冒烟一起做（要开发者批准）。

## 不做与风险

- 抽取模型不改成引用写法。
- 网页上没有作答方式的开关，只在设置（`qa.answer`）与 `ask --structured`。
- 风险：OMP 判断“要登录”的元数据如果拿不到，退回到按服务商 id 的已知清单，并在代码里写明来源。
- 风险：Profile v4 让旧对话不能续问（t15 刚发生过一次）。
