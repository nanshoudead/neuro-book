# t16 实施计划：单行输入框、模型目录与自定义服务商、Markdown 作答

## Context

开发者试用 t15 后提出三件事（2026-10-24）：输入框收成一行并补齐控件；要一个能按 OMP 目录选模型、能自定义服务商的设置界面，选模型的界面做进 nb-agent-ui；作答不必结构化，Markdown 读着更轻松。静态稿与决定见 [README](README.md) 的决定 1 到 12 与评审板 [review](artifacts/review/index.html) v1。

依据：[`story/qa.md`](../../../../../docs/specs/story/qa.md)、[`story/viewer.md`](../../../../../docs/specs/story/viewer.md)、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)、[`agent/harness.md`](../../../../../docs/specs/agent/harness.md) 的“模型”。

已定，不再议：

- 输入框始终一行：正文变长时只有正文长高，控件贴在右下；窄到放不下时控件折到下一行。控件为 `+`（插入 `@`，打开引用菜单）、模式（只在新对话）、模型与推理档、上下文大小、发送。
- 模型目录左右两栏：左边服务商（搜索、密钥状态圆点、用不了的灰掉），右边这一家的模型表（接口、上下文、推理、图片、单价）。
- 设置页“模型”一节：候选模型（一个默认，默认的旁边设推理档）、用到的服务商与密钥状态、自定义服务商；密钥只认环境变量。
- 目录列出全部服务商，要登录的不能选；没验证过的接口照常可选。
- 作答默认 Markdown，结构化可选；Markdown 回复里出处不对时自动让模型改一次。问答页没有作答方式的开关。
- 单行版式只给 nb-story；抽取模型的写法不改；Profile v4 接受。

工作方式：autonomous-delivery。主会话自己实现（worktree `.worktree/w00024-t16`，分支 `feat/w00024-t16-qa-composer-models`）；做完一次实现审查，前端 Sonnet、后端 omp；不 push。设计审查两份（omp 19 条、Sonnet 16 条）的处理见文末“设计审查的处理”。

## 技术选型

仿照 OMP 自己的做法（开发者 2026-10-24 要求；调研见 [evidences/omp-research.txt](evidences/omp-research.txt)，关键结论已在仓库装的 18.2.5 上核对）：

- 模型目录：`@oh-my-pi/pi-catalog` 的 `getBundledProviders`、`getBundledModels`。
- 认证元数据（只用于分类与提示）：`pi-catalog/compat/auth` 的 `authPolicyFor(id)`（登录方式、刷新方式、`allowUnauthenticated`、原生认证接口）与 `compat/providers` 的 `providerEntry(id).envVars`（有序的变量名列表）。
- 运行时取密钥与“有没有值”：`@oh-my-pi/pi-ai` 的 `getEnvApiKey`。它在 envVars 之外还走 OMP 的 hook（例如 anthropic 也认 `ANTHROPIC_OAUTH_TOKEN`，google-vertex 认 `GOOGLE_CLOUD_API_KEY`），自己按变量列表取会漏掉这些合法来源。返回占位 `<authenticated>`（云凭据链）的不算有值，同 OMP 的 `hasConcreteAuth`。不用 `getEnvApiKeyName`。
- 推理档：OMP 的 `Effort` 六档 `minimal|low|medium|high|xhigh|max`；模型支持哪些用 `pi-catalog/model-thinking` 的 `getSupportedEfforts`，选的档不支持时用同一文件的 `clampThinkingLevelForModel` 往下夹（不支持推理的模型夹成不发）。
- 自定义模型缺参数时按模型名从目录找参照：`getBundledModelReferenceIndex` 加 `resolveModelReference`（同 OMP 的 `finalizeCustomModel`）。
- 自定义服务商的模型列表：`fetchOpenAICompatibleModels`（`GET {baseUrl}/models`），传入它的 `fetch` 接缝包一层，记下响应状态与网络错误，用来区分失败原因（它自己失败时只返回 `null`）。Anthropic、Gemini 接口的服务商只能手动添加。
- 不直接用 `pi-coding-agent`（它的 ModelRegistry 会读 `~/.omp` 与 agent.db），只参照。

这些子路径靠包的 `"./*"` 通配导出，结构随 OMP 版本变，所以对全部 69 家服务商的分类做快照测试，升级 OMP 时重跑。其余无新增依赖。

## 关键设计

### `packages/nb-harness/src/model.ts`：目录列表与自定义服务商

- 新增 `listCatalog(): CatalogProvider[]`，只含静态元数据：`{id, name, access, keyEnvs: string[], models: CatalogModel[]}`；`CatalogModel` 为 `{id, name, api, contextWindow, maxTokens, reasoning, efforts, images, price: Price | null}`。
- 另加 `providerKeyReady(id): boolean`：`getEnvApiKey(id)` 非空且不是 `<authenticated>`。“有没有值”与目录分开，由宿主决定何时取（nb-story 在服务启动时取一次）。
- `access` 按下面的顺序取第一个符合的（对 18.2.5 的 69 家逐一核过，不会落空）：
  1. `keyless`：`allowUnauthenticated`（commandcode、google-vertex、zenmux），不设密钥也能选；
  2. `login`：登录的刷新方式是 `request` 或 `hook`（会过期的登录令牌：anthropic、openai-codex、github-copilot、cursor、gitlab-duo、xai-oauth 等），或者有登录方式但没有任何变量（muse-code、kimi-code、google-gemini-cli）；
  3. `key`：有 `envVars`；
  4. `unsupported`：其余（amazon-bedrock 的云凭据链、minimax-cn 没有认证元数据）。
- 能不能选：`keyless`、`key` 能选（`key` 没有值时标“没有值”）；`login` 只有在有值时能选，否则灰掉并写“要登录，问答用不了”，`keyEnvs` 非空时另写“也可以设 X”；`unsupported` 灰掉。nb-story 不读 OMP 的登录态（存在 agent.db），只认环境变量。
- `resolveModel` 的取密钥仍走 `getEnvApiKey`；缺失时的 `MissingModelKeyError` 列出全部 `keyEnvs`（现在多变量的服务商写成 null）。`keyless` 的服务商没有值时不报错，不带密钥发请求。
- 单价：18.2.5 的目录没有定价状态字段，分不出“免费”和“没标价”，所以 cost 全为 0 的一律当未知（`price: null`、`priceKnown: false`，费用记 `null`）；有非零单价的才是已知。`resolveModel` 现在固定写 `priceKnown: true`，一并改。
- `defineModel` 已收 `api`；自定义服务商的接口用 OMP 的名字 `openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai`。没写的上下文、最大输出、推理、图片先按模型名从目录补，再交给 `defineModel`（它在 `buildModel` 之后用宿主的值整个盖回去，先补后传才不会冲掉）。单价不补。
- 换服务商时的历史：日志永远原样；发给另一个服务商或接口时由 OMP 的 `transformMessages` 按目标转换（别家的签名思考会去掉或转成文字，Responses 的原生回放只在同一模型时用）。harness.md 的“历史逐字段保真”改成只约束日志与同一模型的回放。
- 测试：69 家的 `access` 与 `keyEnvs` 快照；目录模型的上下文、推理档、未知单价；`keyless` 无值不报错；脚本端点上同一对话从 `openai-completions` 换到 `openai-responses` 再换回，第二、三次请求能发出且日志不变。

### `packages/nb-story/src/contract/config-schema.ts` 与 `src/qa/config.ts`：配置第 2 版

```ts
type Effort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type QaConfig = {
    providers?: Record<string, {         // 自定义服务商；键是 id，[a-z0-9-]+，不能与 OMP 目录的 id 重名
        name?: string;
        api: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
        baseUrl: string;
        apiKeyEnv: string;
        models: {id: string; name?: string; contextWindow?: number; maxTokens?: number; reasoning?: boolean; images?: boolean; price?: Price}[];  // 没写的运行时按模型名从目录补
    }>;
    models: string[];                    // 候选，"服务商/模型名"，至少一个、不重复
    model: {use: string; thinking?: Effort};  // 默认模型，必须在候选里；不写推理档就不发
    ingest?: …;                          // 不变
    qa?: {maxChapters?; fullReadMaxChars?; answer?: "markdown" | "structured"};  // answer 默认 markdown
};
```

- 校验分两层，所有入口共用一个 `validateQaConfig(config, catalog)`：结构（TypeBox）加语义（候选非空且不重复、每个引用的服务商与模型都存在、`model.use` 在候选里、自定义服务商 id 合法且不与目录重名、自定义服务商的上下文与最大输出为正）。调用方：读入升级后、`config.set` 的锁内、命令行写回、`config.get` 判 valid、`config.test`、`qa.start`。`model.thinking` 不在默认模型支持的档里不算错，运行时按 `clampThinkingLevelForModel` 夹（第 1 版的 `xhigh` 配到不认识的模型上照常能用），`config show` 写出夹后的档。
- 与 OMP 不同的两处：密钥只写变量名（OMP 的 `apiKey` 一个字段兼作变量名、命令与明文）；自定义服务商 id 不能与目录重名（OMP 允许同名覆盖；我们要换地址就建自定义服务商，少一套合并规则）。
- 读到第 1 版（`model` 是 `{baseUrl, id, apiKeyEnv, …}`）时在内存里升级：建自定义服务商 `custom`（`chat` → `openai-completions`，`responses` → `openai-responses`），候选与默认都是 `custom/<id>`，推理档、上下文、最大输出、单价跟过去。写回一律写第 2 版。升级是 `config.ts` 里的纯函数，命令行、服务端、设置页共用。
- 没有配置文件时 `config.get` 给第 2 版的空起点 `{models: [], model: {use: ""}}`（`state: "absent"`）；它不合法，保存前要先选一个模型。
- 抽取（`ingest.model`、`ingest.recall.model`）写法不变。没写抽取模型时回落到问答默认模型，只在它能用抽取的 OpenAI Chat 管线时成立：默认模型的接口是 `openai-completions`，地址取自定义服务商的 `baseUrl` 或目录模型的 `baseUrl`，密钥变量取自定义服务商的 `apiKeyEnv` 或目录服务商 `keyEnvs` 里第一个有值的（都没值取第一个）。否则 `ingestModel` 返回“用不了”与原因（“问答默认模型 X 用的接口是 Y，抽取要单独写模型”），`ingest start`、导入页预览与设置页照写。
- `src/qa/harness-model.ts` 的 `configuredModel(config)` 改成 `resolveQaModel(config, choice?: {model?, thinking?})`：按引用找自定义服务商或目录，返回 `ResolvedModel`、`{ref, contextWindow, efforts}` 与实际发出的推理档。

### `src/cli/config.ts`、`src/qa/config-edit.ts`：命令行

- `config show` 列候选（标出默认与推理档）、服务商与密钥状态，以及抽取模型的来源或“用不了”的原因。
- 字段编辑沿用 `config set|unset <路径>`，路径换成第 2 版的（`model.use`、`model.thinking`、`models`、`providers.<id>.<字段>`、`qa.answer`）。语义校验不过（`model.use` 不在候选里、服务商 id 与目录重名等）是用法错误，退出 2。
- 第 1 版的路径（`model.baseUrl`、`model.id`、`model.apiKeyEnv`、`model.api`、`model.contextWindow`、`model.maxTokens`、`model.price.*`）退出 2，错误里写出对应的新路径（例如 `providers.custom.baseUrl`）；不做自动映射。
- `config init` 先问用目录里的模型还是自定义地址。
- `nbstory ask` 加 `--model <服务商/模型名>`、`--thinking <档>`（只对这一问，规则同 `qa.start`）、`--structured`（只对新对话，同 `qa.answer`）。

### `src/qa/engine.ts`、`tools.ts` 与 Profile：每一轮的模型、作答方式与出处复查

- 每一轮按传入的模型引用与推理档建 harness（现在就是每轮新建）。记录每轮的 `model` 写引用；旧记录的裸模型名原样显示，不尝试映射。
- 作答方式按对话固定：开对话时定，写进对话记录的新字段 `answer: "markdown" | "structured"`（`qa.get` 返回它；旧记录读作 `structured`）与 Profile 的 `initial`。
- Profile v4：`answer` 改为 `optional(toolRef)`；`storyQaPlugin(state, features, answer)` 只在结构化对话里登记 `answer`。`resolveEffectiveTools` 对没登记的可选工具直接跳过，所以 Markdown 对话的快照里没有 `answer`，恢复时按记录里的作答方式登记同一套。规则按 `initial.answer` 二选一：Markdown 是“用 Markdown 回答，出处写成章.段”，结构化照旧。
- 能否续问：`qa.get` 与续问共用一个 `continuability(conversation, log)`：日志第一条快照的 Profile 不是 `story-qa@4` 时为否，原因“t16 之前的对话，只能查看”。这样网页在提交前就知道。
- 出处复查（决定 9）是同一轮里的第二次运行：一轮以文字回复结束且 `replyOf` 找出没核实的出处时，引擎往日志写一条 `meta`（`nb-story.reply-check`，带出处清单，只供审计，不进模型上下文），再用同一个 harness 跑一次 `turn`，复查消息本身写明哪些出处没读过。结局：
  - 第二次以文字结束：它是这一轮的结果（`length` 时 `truncated` 按第二次），仍没核实的照旧标出；
  - 第二次出错或被取消：保留第一次的回复为结果，状态仍是作答，记录写 `recheck.outcome: "failed" | "aborted"`；
  - 用量两次相加，`complete` 两次都完整才为真；`rejections` 不受影响（Markdown 对话没有 `answer`）。
  - 记录每轮加 `recheck?: {unverified: number; outcome: "rewritten" | "failed" | "aborted"}`。只复查一次；结构化作答不复查（它已有退回）。
- `runTurn` 现在每次都 `harness.subscribe` 而不取消，同一个 harness 跑两次会把第二次的事件处理两遍；改成一个 harness 只装一个订阅、`finally` 里取消。
- 不改 nb-harness 的轮次机制。

### `src/server`：接口

- `qa.start`（计划初稿误写成 `qa.ask`）加 `model?`、`thinking?`；新对话另加 `answer?`。服务端在登记运行前统一校验：`model` 必须在候选里，`thinking` 必须在该模型支持的档里（不支持推理的模型不能带），续问带 `answer` 或 `mode`、`at` 是 `invalid_params`；不传 `model` 时新对话用默认模型，续问用该对话最近一轮的引用（仍在候选里时），否则用默认。校验失败不发请求、不写日志、不留运行项。`QaRunView` 与记录视图的每轮带 `model` 与 `recheck`。
- 新增 `models.catalog`：目录加自定义服务商，每家带 `access`、`keyEnvs` 与服务启动时取的一份“有没有值”快照（目录服务商按 `providerKeyReady`，自定义服务商按现有 `keysOf` 读注入的 `env`）。
- 新增 `models.discover {api, baseUrl, apiKeyEnv}`：用对话框里正在编辑的值读 `/models`，不读配置文件，只收 `openai-*` 两种接口。返回 `{state: "found" | "empty" | "not_supported" | "auth" | "unreachable" | "failed", status?, models?: {id, suggested?: {contextWindow, maxTokens, reasoning, images, from: "服务商/模型名"}}[], keySet}`：状态按包住的 `fetch` 记下的 HTTP 状态分（404 → `not_supported`，401、403 → `auth`，网络错误或超时 → `unreachable`，其余非 2xx 或坏响应 → `failed`）。`suggested` 只是建议，界面显示为“自动”，不写进配置；运行时按模型名补参数只在 `resolveQaModel` 一处。
- `config.test` 仍只测默认模型，设置页写明。
- 测试端点 `testing/qa-endpoint-server.ts` 加 `/v1/models` 与让它返回空、404、401、断开的开关。

### `packages/nb-agent-ui`：输入框与选模型的界面

- `AgentConversationComposer`：新增版式 `inline`（`AgentConversationView` 的 `composerLayout` 属性，缺省仍是现在的两层，NeuroBook 不变）。正文与控件同一行，控件 `align-items: flex-end` 贴右下；容器宽度小于 520px 时（容器查询）控件整排折到正文下面，`+` 留在正文前。展开按钮保留，展开后正文撑满、控件仍在右下。`inline` 不支持附件条，`canRegisterAttachments` 为真时退回两层版式；写进组件 `.md`。
- 上下文大小复用已有的 `ctx.usage.contextTokens`、`contextLimit`（数据表与状态栏已用这两个字段），不另加 `ComposerView.context`。新零件 `AgentContextMeter`（圆环，70% 黄、90% 红）在 `contextLimit` 有值时显示；超过 100% 时圆环满格、文字写实际百分比；数字写在 `title` 与 `aria-label`，点按也能看到。宿主口径：最近一条带用量的助手消息的 `input + cacheRead + cacheWrite`（同 OMP 的 `calculatePromptTokens`），运行中是上一次请求的值；没有用量时不显示。
- `+`：登记的输入框按钮加 `placement: "leading"` 与 `trigger?: "@" | "$" | "/"`。点了调用编辑器端口新增的 `openTrigger(char)`：先聚焦、光标移到末尾、前一个字不是空白或标点时先补一个空格、再插入触发字符，菜单随之打开（`findPromptTrigger` 要求触发字符前是空白或标点，`介绍一下@` 不触发）。端口在 `ports.ts`，实现在 nb-markdown 的 `PromptEditor`。
- 宿主能力：`InteractionView` 加 `canManageModels`（默认 false）；为真时 `AgentModelPicker` 末尾出现“管理模型…”，发出内置 action `model.manage`。
- `ComposerModelView` 加可选的 `group`（服务商名，下拉按它分组，同名模型分得清）与 `unavailable?: string`（灰掉并写原因，例如密钥没有值）；`canRegisterAttachments` 为假时不画“不支持图片”的图标。
- 新组件 `AgentModelCatalog`（左右两栏的目录对话框），纯视图：
  - props：`open`、`providers: CatalogProviderView[]`（`{id, name, source: "catalog" | "custom", access, keyEnvs, keySet, models: CatalogModelView[]}`，视图类型在 `types.ts` 自己定义，宿主映射）、`chosen: string[]`（已在候选里的引用）；emits：`update:open`、`pick(refs: string[])`、`add-provider`。
  - 多选：右栏每行可勾选，已在候选里的标“已添加”且不能再选，底部“加入候选（N）”。
  - 左栏：“全部”，然后各服务商，能用的在前、标模型数，用不了的排在分隔线后、变暗。不做“最近用过”（nb-story 没有这份数据）。
  - 右栏顶上搜索，按 `服务商/模型名` 搜，结果分精确、连续子串、模糊三层；搜索时左栏显示各服务商的命中数。排序与分层是核心里的纯函数，带单测。一次最多画 200 行，多了写“还有 N 个，继续输入缩小范围”。
  - 默认顺序：服务商、版本号新的在前、名字。
  - 模型表的列：模型、接口、上下文、推理、图片、单价；单价未知写“未知”；窄了先丢接口列、再丢图片与推理列。对话框宽度小于 640px 时左栏收成顶上的下拉。
  - 点到用不了的服务商时右栏是说明页：要设哪个环境变量（列出全部 `keyEnvs`）、是否只能登录、目录里有几个模型。
  - 配同名 `.md` 与 Lab 场景（含 390px）；包的 AGENTS.md 与 Spec 的公开组件清单加上它。

### `packages/nb-story/src/web`：问答页与设置页

- `QaPage.vue`：
  - 用 `inline` 版式；`canChangeRuntime` 在运行中以外都为真（修好“模式按钮点不动”），`canManageModels` 为真，`model.manage` 去设置页。
  - 模型相关的状态不进按对话存的输入框存档：存档只存草稿、历史、模式与“这个对话选了哪个模型、哪个档”；候选、`thinkingLevels`、标签与不可用原因由 computed 从 `models.catalog` 叠上去。对话没选过时：新对话用默认模型与默认档，续问用最近一轮的引用（仍在候选里时）。换模型时档按 `clampThinkingLevelForModel` 夹，发出的就是夹后的档。
  - 输入框存档挪到模块级的 Map（按书与对话 id），切到设置页再回来草稿还在。
  - 上下文大小按上面的口径算，`contextLimit` 取所选模型的窗口。
  - 出处复查：`turns.ts` 的 `composeMessages` 把一个记录轮（或正在跑的一轮）里第一条提问之后的用户消息改成过程里的一行系统消息“出处检查：N 处没读过，已让模型重写”，不另开一轮。nb-story 不发 steer，同一记录轮里的第二条用户消息只会来自复查。运行中第一次回复会先显示为回复，复查开始后收进过程。
- `SettingsPage.vue`：
  - “模型”一节换成候选列表与服务商列表，加“添加模型”（`AgentModelCatalog`）与“自定义服务商”对话框；限额与抽取仍用 `SchemaForm`。保存仍是整份 `config.set`，冲突处理不变。
  - 自定义服务商对话框放在 nb-story（`web/shell/ProviderDialog.vue`）：名称、接口、地址、密钥变量用 `SchemaForm` 配从 `config-schema.ts` 拆出的 `ProviderSchema`（沿用 `ENV_NAME_PATTERN` 等校验，不另抄一份）；下面的模型表手写，“从服务读取”调 `models.discover`，建议值显示为“自动”。
  - 编辑时维持不变量：删默认候选时把默认改成剩下的第一个并提示；删被候选引用的服务商要确认，并一并去掉它的候选；服务商 id 由名称生成、建好后只读。保存前再走一遍语义校验，失败时指出是哪一项。
  - 抽取一节的标题与导入页预览在默认模型不能用于抽取时写明“抽取要单独写模型”。
  - 空起点：没有配置文件时“模型”一节只有“添加模型…”，选了第一个即成默认。

## Spec 与文档改动

- `story/qa.md`：配置第 2 版、语义校验与升级规则、第 1 版命令行路径的报错；推理档六档与夹档；抽取回落的条件；输出 7、9、10、11 按作答方式改写；出处复查（含失败与取消的结局、记录字段）；能否续问按 Profile 版本；`qa.start` 的新参数与校验；`models.catalog`、`models.discover`；`ask` 的新选项；验收补对应场景。
- `story/viewer.md`：问答页输入框（单行、控件、上下文大小、复查的过程行）、设置页模型一节与两个对话框、编辑时的不变量、导入页预览的“抽取要单独写模型”；改写验收 11。
- `ui/agent-conversation-view.md`：`inline` 版式（工具栏次序、折行、展开、不支持附件）、`AgentContextMeter` 与 `usage` 口径、前置按钮的 `trigger`、`canManageModels` 与 `model.manage`、`ComposerModelView` 的 `group` 与 `unavailable`、`AgentModelCatalog`，公开组件清单。
- `agent/harness.md`：`listCatalog`、`providerKeyReady`、`access` 分类、未知单价、换服务商时的历史转换。
- `packages/nb-agent-ui/AGENTS.md`：公开组件清单加 `AgentModelCatalog`。

## 切片

1. **nb-harness 目录**：`listCatalog`、`providerKeyReady`、`access`、未知单价、四种接口的 `defineModel` 与补参数、换服务商；单测。harness.md。
2. **配置第 2 版**：schema、`validateQaConfig`、升级、空起点、抽取回落、`resolveQaModel`、命令行 `config`；单测。qa.md 的配置部分。
3. **引擎**：每轮的模型与推理档、作答方式与记录字段、Profile v4、能否续问、出处复查与订阅修正、`ask` 的新选项；单测。qa.md 其余部分。
4. **服务端接口**：`qa.start` 新参数与校验、`models.catalog`、`models.discover`、测试端点的 `/v1/models`；单测。
5. **nb-agent-ui**：`inline` 版式、`AgentContextMeter`、前置按钮与 `openTrigger`（含 nb-markdown）、`canManageModels`、`ComposerModelView` 新字段、`AgentModelCatalog` 与搜索纯函数；dom 测试与 Lab 场景。ui/agent-conversation-view.md、AGENTS.md。
6. **nb-story 网页**：问答页、设置页与服务商对话框、导入页预览；e2e。viewer.md。

每片单独提交；自跑 `bun run test:affected` 与相关包的 typecheck，5、6 片另跑 Lab smoke 与受影响的 nb-story e2e。全部做完后跑 nb-story 全量 e2e，再派实现审查。

## 验收映射

编号在写 Spec 时定，这里按行为列：

| 行为 | 测试 |
|---|---|
| 69 家的 `access` 与 `keyEnvs`；目录模型的上下文、推理档、未知单价；`keyless` 无值不报错 | nb-harness `model.test.ts` |
| 同一对话换接口后请求照发、日志不变 | nb-harness `provider.test.ts` |
| 第 1 版配置读出等价的第 2 版，写回是第 2 版；空起点；语义校验各项 | `config.test.ts` |
| 抽取回落：`openai-completions` 成立，其它接口报原因 | `config.test.ts` |
| 语义校验不过、第 1 版路径 → 退出 2 并写新路径 | `cli/config.test.ts` |
| 每一轮按选的模型与夹后的推理档发请求，记录写引用 | `engine.test.ts` + e2e |
| Markdown 对话的快照没有 `answer`、恢复后仍没有；结构化照旧 | `engine.test.ts` |
| v3 的对话 `qa.get` 报不能续问 | `qa-service.test.ts` |
| 出处复查：不复查、复查后对、仍不对、第二次出错、第二次被取消；事件只处理一遍 | `engine.test.ts` |
| `qa.start` 的参数校验失败不发请求、不留运行项 | `qa-service.test.ts` |
| `models.discover` 的六种状态，建议值不写盘 | `qa-service.test.ts` |
| 复查消息在网页上是过程里的一行，一个记录轮只有一个提问 | `turns.test.ts` + e2e |
| `+` 在中文结尾的正文后打开引用菜单 | nb-agent-ui dom 测试（真实 `PromptEditor`） |
| 单行版式：一行、折行、窄屏、展开；上下文大小三档与超窗 | nb-agent-ui dom 测试 + Lab smoke |
| 目录：多选、已添加、搜索三层、用不了的说明页、390px | nb-agent-ui dom 测试 + Lab smoke |
| 新对话能切全读；换模型后推理档夹好、请求里是新模型 | e2e |
| 目录选模型、自定义服务商（手动与读取）保存后写进配置 | e2e |
| 设置页沿用的四条（保存与测试连接、冲突、误贴密钥、空起点）改写到第 2 版 | e2e |
| 第 1 版文件在设置页显示、保存后是第 2 版 | e2e |
| 删默认候选、删被引用的服务商 | e2e |
| 切到设置页再回来草稿还在 | e2e |

## 验证

- 单测、typecheck、Lab smoke、nb-story 全量 e2e（真实 `nbstory serve`、脚本端点）。
- 未验证：Anthropic、Gemini 接口与真实服务的 `/models`；跨 Anthropic 的历史转换。等有密钥时与 Responses 的真实冒烟一起做（要开发者批准）。

## 不做与风险

- 抽取模型不改成引用写法；不把抽取管线改成多接口。
- 网页上没有作答方式的开关，只在设置（`qa.answer`）与 `ask --structured`。
- 目录不做“最近用过”。
- 风险：认证分类依赖 OMP 的通配导出子路径，结构随版本变；69 家的快照会在升级时报出来。
- 风险：Profile v4 让旧对话不能续问（t15 刚发生过一次）。
- 风险：目录服务商的“有没有值”读真实进程环境（OMP 的 `getEnvApiKey` 不收注入的环境），与自定义服务商读注入的 `env` 来源不同；测试里目录服务商的状态要用真实环境变量设置。

## 设计审查的处理

omp（后端与计划，19 条）与 Sonnet（网页与组件，16 条）都成立，已并入上文；没有不成立的。两边都提到的：出处复查的网页显示（omp 3、Sonnet 1）、抽取回落（omp 7、Sonnet 13）、推理档词汇（omp 9、Sonnet 2）、`qa.start` 的名字与参数（omp 14、Sonnet 16）。接受取舍、交开发者知悉的写进 [待确认清单](../../pending-confirmations.md)：未知单价一律当未知、第 1 版命令行路径只报错不映射、复查失败时保留第一次的回复、服务商对话框放 nb-story、目录不做“最近用过”且没有 390px 的静态稿、目录服务商的“有没有值”读真实环境。报告存为 [evidences/design-review-omp.txt](evidences/design-review-omp.txt) 与 [evidences/design-review-web.txt](evidences/design-review-web.txt)。
