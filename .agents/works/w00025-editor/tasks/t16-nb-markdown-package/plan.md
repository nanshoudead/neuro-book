# t16 实施计划：抽出 nb-markdown 包

## Context

nb-agent-ui 的 Markdown 显示、输入框与已发送文字的显示由宿主注入（`packages/nb-agent-ui/src/ports.ts`），能给出真实组件的只有 neuro-book 的插件 `nbook.markdown`。nb-story 不是插件宿主，接入问答页（w00024 t13）时只能用纯文字与文本框，原计划另写 `StoryMarkdown`（marked 加 dompurify）；dev-panel 的 `MarkdownView` 与 nb-agent-ui 手写的预览规则又各是一份。开发者 2026-10-23 定（[README](README.md) 决定 1、2）：把 Markdown 抽成建在 nb-ui 之上的独立包 `nb-markdown`，`nbook.markdown` 改为包装，排在 w00024 t13 之前。

依据：[`ui/markdown-display`](../../../../../docs/specs/ui/markdown-display.md)、[`ui/prompt-editor`](../../../../../docs/specs/ui/prompt-editor.md)、[`workspace/markdown-dialect`](../../../../../docs/specs/workspace/markdown-dialect.md)、[`workspace/markdown-syntaxes`](../../../../../docs/specs/workspace/markdown-syntaxes.md)、[ADR 0028](../../../../../docs/adr/0028-tailwind-only-host-compiles-nb-ui.md)（宿主编译包源码的 Tailwind）、[包边界](../../../../../docs/modules/monorepo-boundaries.md)。

工作方式：autonomous-delivery；代码在 `.worktree/w00025-t16-nb-markdown`（分支 `feat/w00025-t16-nb-markdown`，从 master 拉出），主会话实施，前端实现审查派 Sonnet。用户可见的行为不变：现有测试与 e2e 是回归网，搬家后照旧通过。

## 技术选型

无新的通用问题：包沿用插件现有的依赖，版本与 neuro-book 写成同一个固定值，Bun 提升后只有一份（设计审查核对过 `prosemirror-model`、`@tiptap/*`、`marked`、`entities` 都只有一份）。脚手架照抄 nb-agent-ui（`bun test` 跑纯 TS，Vitest 加 happy-dom 跑 `*.dom.test.ts`，`tsc` 与 `vue-tsc` 两份 tsconfig）。

依赖按 nb-agent-ui 的分法：`dependencies` 放 `@notnotype/nb-ui`、`entities`、`marked`、`marked-cjk-friendly` 与源码用到的全部 TipTap 包（`@tiptap/core`、`pm`、`vue-3`、`starter-kit`、`markdown`、`extension-code`、`-hard-break`、`-image`、`-link`、`-list`、`-paragraph`、`-placeholder`、`-table`，以 `rg "from \"@tiptap/"` 的结果为准）；`vue` 是 peer；测试用的 `fast-check`、`@vue/test-utils`、`happy-dom`、`@notnotype/neuro-book-test-support`、`@notnotype/nb-agent-ui`（端口类型断言）放 `devDependencies`。根目录全部提升会掩盖漏声明，所以边界测试另核对“源码里 import 的第三方包都在 `package.json` 里”。

## 关键设计

### 归属：搬什么、留什么

搬进 `packages/nb-markdown`（组件的同名 `.md` 一起搬）：

- 方言常量与链接词法：`shared/markdown-dialect.ts`、`shared/link-syntax.ts`（纯 TS，后端的字数也用）。
- 语言与编解码器：`web/language.ts`、`web/syntax/**`（核心、原样保留与七种内置方言的语法模块）、`web/codec/**` 与语料。
- 显示：`web/display/**`、`MarkdownDisplay`、`MarkdownImage`、`InlineChip`、`parts/chip.ts`、`parts/chip.css`、`parts/markdown.css`、`parts/report.ts`。
- 提示词编辑器：`web/components/prompt/**`。
- 编辑器扩展：`web/editor/**`（图片、引用链接、行内代码快捷键、编辑器的扩展清单、视图宿主）。

留在 `nbook.markdown`：插件定义与两个贡献点（`plugin.ts`、`shared/dialects.ts`、`shared/plugin.ts`、`shared/contracts.ts`、`web/plugin.ts`、`web/contracts.ts`）、外来方言的目录与组语言（`syntax-catalog.ts`、`language-registry.ts`）、作品文件的目标解析与图片地址（`shared/targets.ts`、`parts/asset-urls.ts`）、字数（`shared/word-count.ts`）、编辑器区的控件 `MarkdownControl.vue`、测试用方言与浏览器宿主（`web/testing/**`），以及新加的宿主接线（见“`nbook.markdown` 改成包装”）。服务 `markdownKey` 交出的组件不变，外来方言照旧按 `markdown.syntaxes` 贡献。

端口类型断言 `prompt-ports.typecheck.ts` 搬进包（`src/agent-ports.typecheck.ts`，devDependency 依赖 nb-agent-ui）：nb-story 这类不是 neuro-book 的宿主也要靠它保证组件满足 nb-agent-ui 的端口；nb-agent-ui 的 `ports.ts` 注释与 README 里指向它的路径一起改。

### 包的入口：`packages/nb-markdown`

| 入口 | 内容 | 依赖 |
|---|---|---|
| `.` | 方言常量、链接词法、目标分类的接口与缺省规则（`classifyScheme`）、`namesOf`（一种语法占用的名字）、界面语言类型 | `entities`；对编辑内核只有 `import type` |
| `./language` | 见下面的导出清单 | marked、TipTap |
| `./host` | `MarkdownHost`、`markdownHostKey`、`provideMarkdownHost`、`useMarkdownHost`（没有提供时给缺省宿主） | vue、`./language` |
| `./display` | `MarkdownDisplay`、`MarkdownImage` | 上面几个 |
| `./chip` | `InlineChip`、`chipView`、`renderChipIcon`、`ChipIcon`、`ChipEnv` | 同上 |
| `./prompt` | `PromptEditor`、`PromptTextView`、文字写法的公开函数（`promptReferenceText` 等）与类型 | 同上，nb-ui |
| `./editor` | `MarkdownControl` 用的 TipTap 扩展与视图宿主 | 同上 |
| `./lab-sources` | 组件文档与模块，给 Component Lab 建索引（照 nb-agent-ui） | Vite |
| `./tailwind.css` | `@source` 本包源码（图标类名） | — |

`./language` 的导出：`createMarkdownLanguage`、`MarkdownLanguage`、`MarkdownSyntax` 与它引用的读法、写法类型（贡献方言的插件按它写，是公开合同，变更按 `runtime.plugin-api` 的产品版本规则）、`builtinSyntaxes()`（`{name, order, syntax}` 的有序列表，`order` 与 nbook 的方言声明一致）、`coreSyntax`、`reservedSyntaxNames()`（内置、核心与原样保留语法占用的名字；`createRawSyntax` 不公开）、`defaultMarkdownLanguage()`、`codecFor`、`compare` 的 `equivalent`、`schemaFor`（从 `display/renderer.ts` 拆到 `codec/schema.ts`，不带展示器的 DOM 代码）。

分成几个入口是为了首屏：编辑内核与解析器只进按需加载的 chunk（`workspace.markdown-syntaxes` 输出 2，`packages/neuro-book/scripts/check-dist.ts` 机检）。`.` 不引 DOM 与编辑内核，后端可以用。

包边界测试（同 nb-agent-ui 的 `boundary.test.ts`）：不引用 `nbook/` 与应用源码，不引 `@notnotype/nb-runtime`；`.` 只引 `entities`（编辑内核只许 `import type`）；第三方 import 都在 `package.json` 里声明。

### 宿主接口：`src/host.ts`

组件现在靠插件注入方言目录（`syntaxCatalogKey`）、图片地址服务与诊断出口，没有就报错。改成包自己的一份宿主对象，经 `provideMarkdownHost` 交给子树；没有提供时 `useMarkdownHost()` 给缺省宿主，组件单独挂也能用：

```ts
export interface MarkdownHost {
    /** 组件挂上时取一次（视图建立时取定语言，markdown-syntaxes 输出 7）。缺省：`defaultMarkdownLanguage()`。 */
    language(): MarkdownLanguage;
    /** 小块的目标分类与图标，见下两节。 */
    readonly chips: ChipEnv;
    /** 记一条诊断；缺省丢掉。 */
    report(event: string, message: string, error: unknown): void;
}
// ./chip
export interface ChipEnv {
    readonly targets: MarkdownTargets;
    /** 文件小块的图标；缺省是 lucide 的文件图标类。 */
    fileIcon(name: string): ChipIcon;
}
export type ChipIcon = {readonly className: string} | {readonly render: (document: Document) => Element};
```

`ChipIcon` 取代 `chip.ts` 里现有的 `{file: CatppuccinIcon} | {className}`，只有一份定义。

`host.ts` 带 DOM 类型、引 `./language`，只在浏览器一侧、只从懒加载的代码引用：后端类型检查（`tsconfig.json`，lib 只有 ESNext）会经 `src/*.test.ts` 导入插件的浏览器入口，入口直接或经动态 `import()` 引到包源码都会把 DOM 类型带进后端检查；入口里同步构造语言则会把编辑内核带进首屏。

宿主到达各处小块：

- Vue 组件：`MarkdownDisplay`、`PromptEditor`、`PromptTextView` 用 `useMarkdownHost()`；TipTap 节点视图（`PromptTokenView`、`PromptPasteBlockView`）在 `EditorContent` 挂上后拿得到祖先的 provide（设计审查读过 `@tiptap/vue-3`），第 4 片用测试核实。
- `InlineChip` 不 inject，保持只收属性：加可选属性 `env?: ChipEnv`（缺省是缺省宿主的那份），调用它的 `PromptTokenView`、`PromptTextView` 传自己拿到的 `chips`；组件规范要外部能力经属性传入。
- 普通 DOM 路径：`chipView(input, env)` 多收 `env`；展示器的 `StaticViewHost` 与编辑器的视图宿主加 `chips` 字段，`decorateLinks` 与 `reference-links` 从那里取；`MarkdownControl` 把宿主的 `chips` 放进视图宿主。
- `MarkdownImage` 不依赖宿主：静态视图用 `render(h(...), dom)` 把它挂到普通 DOM，没有 `appContext`，inject 拿不到东西。这条写进 `MarkdownImage.md`，包内测试在没有应用上下文时挂它。

`MarkdownImage` 现有的“（不在作品里，不显示）”是 NeuroBook 的说法：包内缺省改为中性的“（不显示）”，加可选属性 `unavailableText`，nbook 经静态视图宿主与编辑器的图片视图传原来的文字，neuro-book 里看到的不变。

### 目标分类：`src/targets.ts`

链接显示成小块还是普通链接、小块取什么图标与色调、点击发 `reference` 还是 `link`，现在都调 `shared/targets.ts` 的 `classifyTarget`，它认 `project://`、`user://`、`local://` 并按作品根解析相对路径，是 NeuroBook 的规则。包里只留接口与不认任何作品方案的缺省规则：

```ts
export type TargetKind = "file" | "attachment" | "external" | "other";
export interface Target {
    readonly kind: TargetKind;
    /** 细分，写进 `data-reference-link` 与色调类 `nb-chip--<variant>`；缺省等于 kind。nbook 给 work、user。 */
    readonly variant?: string;
    /** 文件名：取图标与显示用，路径最后一段（解码后）；没有路径时为空字符串。不限于 file。 */
    readonly name: string;
}
export interface MarkdownTargets {
    classify(target: string, base: string | null): Target;
    /** 对任何目标调用（PromptEditor 插入引用时）：属于文件的按百分号编码 `%`、`#`、`?`，别的原样返回。 */
    encodeFile(target: string): string;
}
export function classifyScheme(target: string): Target;   // 缺省规则
```

缺省规则 `classifyScheme`：`http`、`https`、`mailto`（不分大小写）是 `external`，别的都是 `other`；`encodeFile` 原样返回。nbook 的 `classifyTarget` 先委托它判 external，再叠加 work、user、`local://`，不另写一份方案识别；适配给包时 work、user 归为 `file` 并带 `variant`，所以 `data-reference-link="work"`（`e2e/markdown-input.e2e.ts`）与 `nb-chip--work`（`InlineChip.dom.test.ts`）照旧。`address` 只给图片地址用，留在 nbook 的 `classifyTarget`。

`prompt-text.ts` 的 `linkAttrs` 用 `classifyTarget(target, null).kind === "other"` 判断不带方案的相对地址，在 `base` 为 null 时它等价于“没有方案且不以 `/` 开头”（设计审查核实），改写成这一判断，不再依赖目标分类；旧应用工作区路径（`LEGACY_WORKSPACE_PREFIXES`）是文字写法的一部分，随它搬。`promptReferenceText` 加可选参数 `targets`，缺省用缺省规则，nbook 的 Lab 与宿主传自己的。

### 界面语言：`src/locale.ts`

组件现在用 `nbook/shared/localized-text` 的 `DisplayLocale`、`localize`、`formatText`（约 20 处）。包里定义 `MarkdownLocale = "zh-CN" | "en-US"` 与同样两个函数的最小实现（与 nb-agent-ui 的做法一致，跨包不能引应用源码）。nbook 的 `DisplayLocale` 与它相同，类型断言核对。

### 内置方言的顺序

`builtinOrder()` 现在按 `shared/dialects.ts` 的声明 `order` 排语法模块。包里的 `builtinSyntaxes()` 返回 `{name, order, syntax}`，`order` 与声明的数字相同（外来方言按数字插在内置之间，所以要数字，不只是顺序）；nbook 的声明 id 是 `nbook.markdown.<name>`，`language-registry.ts` 直接用包给的 `order`，`codec/word-count.test.ts` 已经核对声明与模块的标签，加一条逐项核对 `order` 相同。`namesOf` 搬到包的 `.`（只读语法模块的字段，`syntax-catalog.ts` 在插件入口里用它，不能引编辑内核），`fullNamesOf` 用到 `flattenExtensions`，留在 `language-registry.ts`，保留名字的集合改用包的 `reservedSyntaxNames()`。

### `nbook.markdown` 改成包装

宿主接线放在一个懒加载的 `.vue` 里，插件入口不引包：

- `web/components/MarkdownHosted.vue`（加同名 `.md`）：属性 `component`（`"MarkdownDisplay" | "MarkdownImage" | "InlineChip" | "PromptEditor" | "PromptTextView"`），其余属性、事件与插槽原样转给对应的包组件；setup 里从现有的三个注入（方言目录、图片地址、诊断）建 nbook 的 `MarkdownHost` 并 `provideMarkdownHost`，`InlineChip` 另传 `env`。每个包组件仍各自 `defineAsyncComponent(() => import("@notnotype/nb-markdown/display"))` 这样按需加载，分在各自的 chunk。后端类型检查对 `.vue` 只按通配声明看（`src/types/vue-sfc.d.ts`），不展开包源码。
- `web/host.ts`（只由上面的 `.vue`、`MarkdownControl.vue` 与 Lab 引用）：`nbookMarkdownHost({catalog, assets, report})` 建宿主：`language` 是 `languageFor(catalog)`，`chips.targets` 是 `shared/targets.ts` 的适配，`fileIcon` 用 `nbook/ui/file-icons` 的 `fileIconForName` 与 `renderFileIcon`，`report` 原样；另给静态视图与编辑器的图片视图传 NeuroBook 的“不在作品里”文字。
- `web/plugin.ts`：六个服务组件都过 `withHost`（现在只有 `MarkdownControl`、`MarkdownDisplay` 过，`InlineChip`、`MarkdownImage`、`PromptEditor`、`PromptTextView` 是裸的；不补的话它们在应用里会悄悄用缺省分类）；后四个与 `MarkdownDisplay` 加载的是 `MarkdownHosted.vue` 并带上 `component`。加载失败的诊断与纯文字回退不变。
- `MarkdownControl.vue` 引 `@notnotype/nb-markdown/editor`、`./language`、`./host`，用 `nbookMarkdownHost` 拿 `chips` 放进视图宿主。
- Lab：直接挂组件的场景（`fixtures/nb-agent-ui/host.ts`、`MarkdownDisplayFixture.vue`、`PromptEditorFixture.vue`、`InlineChipFixture.vue`、`MarkdownImageFixture.vue`、`editor-scene/EditorAreaFixture.vue` 与 `prompt-scene/*`）改引包，并经 `nbookMarkdownHost` provide，不然 Lab 与 e2e 会在图标变了的状态下照样通过。`component-index.ts` 加 `nb-markdown` 前缀的 `lab-sources`，搬走的 10 个组件（`InlineChip`、`MarkdownDisplay`、`MarkdownImage` 与 `prompt/` 下 7 个）才留在 Lab 里。
- `src/web/tailwind.css` 在 nb-agent-ui 之后导入 `@notnotype/nb-markdown/tailwind.css`。

### 测试的归属

- 随代码搬：`web/codec/*.test.ts`（`word-count.test.ts` 除外）、`syntax/comment/comment.dom.test.ts`、`MarkdownImage`、`prompt/**` 的测试；`InlineChip.dom.test.ts` 在包内改用一份给出文件分类的测试宿主，nbook 的真实适配由下面的接线测试覆盖。
- `prompt-text.test.ts` 里“文件名含 `#`、`?`、`%` 时引用读回仍是同一个文件”（`ui.prompt-editor` 场景 4）用 nbook 的 `classifyTarget(...).address` 断言：拆成包内“`promptReferenceText` 用传入的 `targets.encodeFile`”与 nbook 侧“用 nbook 的分类往返仍是同一个文件”。
- `MarkdownDisplay.dom.test.ts`：失败与恢复（某一块画不出来、组不成语言）用包内 `provideMarkdownHost` 给一份自定义语言测，随组件搬；场景 3（与编辑器同一份语料的方言元素结构一致）要编辑器扩展，第 3、4 片留在 nbook，第 5 片随编辑器扩展搬；用晚到方言（`kbd-dialect`）、经方言目录的几例留在 nbook。
- 新增 nbook 的接线测试 `web/host.dom.test.ts`：经 `web/testing/browser-host.ts` 启动插件，从 `markdownKey` 取 `MarkdownDisplay`、`PromptTextView`、`InlineChip`、`MarkdownControl` 各挂一次，断言 `/设定/林雪.md`、`project://…`、`user://…` 是文件图标，`local://` 是回形针，`chapter://` 是链接图标，`data-reference-link` 为 work、user。
- 留在 nbook：`asset-urls`、`targets`、字数、`syntaxes`、`late-dialect`、`MarkdownControl` 的测试。

## Spec 与文档改动

- 受管组件：`scripts/ci/check-documentation.ts` 的 `COMPONENT_BARRELS` 加 `./display`、`./chip`、`./prompt` 的入口文件（每个入口一行一个 `export {default as X} from "./X.vue";`）；搬走的组件 `.md` 的标签按实现补（`MarkdownDisplay`、`PromptEditor`、`PromptTextView` 加 `state:inject`）。
- 四份 Spec：`owners` 加 `packages/nb-markdown`（`markdown-display`、`prompt-editor` 只留包；两份 `workspace/` 的同时保留 `nbook.markdown`）；“公开入口”“owner 与依赖方向”“实现入口”“合同测试”的路径改到包里；`markdown-display` 与 `prompt-editor` 补宿主接口一句（不经插件也能挂、`provideMarkdownHost` 给语言与目标分类）；`markdown-display` 输出 3 的小块分类引用改写为“按宿主的目标分类”。验收条目不变。
- `docs/modules/monorepo-boundaries.md` 加一行；`packages/AGENTS.md`、根 `AGENTS.md` 的目录树、`docs/specs/README.md` 的索引、`docs/standards/code/components.md` 的受管组件；`scripts/ci/check-documentation.ts` 的 `COMPONENT_BARRELS`、`scripts/ci/workspace-package-matrix.ts`、两份 workflow 的路径。
- 包内 `AGENTS.md`（边界与验证）与 `README.md`（宿主接入：不经插件挂组件、`provideMarkdownHost` 给语言与目标分类、给 nb-agent-ui 的注入口传组件的写法；Tailwind 入口导入本包的 `tailwind.css`；Vite 关掉依赖自动发现时把 `marked`、`marked-cjk-friendly` 列进预构建清单；正文里的“41.20”这类出处要宿主先改写成链接，包只认链接）。
- nb-agent-ui 的 README：注入 Markdown 显示与输入框时，非 neuro-book 的宿主直接用 nb-markdown。
- w00024 t13 的计划：不写 `StoryMarkdown`，改用 nb-markdown（主工作区记录，合入后改）。

## 切片

每片单独提交，自跑验证后再进下一片。每片结束用一份“已搬文件”的旧路径清单 `rg` 一遍，确认没有残留引用（留在 `plugins/markdown/web` 的文件本来就在）。第 3 片起每片跑 `bun run build:web` 与 `check:dist`，首屏问题当片发现。

1. **包与纯 TS 核心**：脚手架、根 `workspaces`、CI 矩阵与 workflow 路径、边界测试；搬方言常量与链接词法，`classifyScheme`、`namesOf` 进 `.`，nbook 改引包。验证：包 `typecheck`、`test`；neuro-book `bun run typecheck` 与 `bun run test:affected`。
2. **语言与编解码器**：搬 `language.ts`、`syntax/**`、`codec/**` 与测试，拆出 `codec/schema.ts`；`builtinSyntaxes()`、`reservedSyntaxNames()`、`defaultMarkdownLanguage()`；nbook 的 `language-registry.ts`、`syntax/index.ts` 改用包。包声明 TipTap 后确认 `node_modules` 里 `prosemirror-model` 只有一份。验证同上，加 `e2e/editor-area.e2e.ts`、`markdown-input.e2e.ts`。
3. **宿主接口、小块与显示**：`host.ts`、`targets.ts`、`locale.ts`；搬 `chip`、`InlineChip`、`MarkdownImage`、`display/**`、`MarkdownDisplay` 与样式；`chipView` 改签名时留在 nbook 的 `editor/reference-links.ts` 同步改；nbook 的 `web/host.ts`、`MarkdownHosted.vue`、`withHost`、接线测试；Lab 场景改引并 provide、`lab-sources`。验证同上，加 `build:web`、`check:dist`、`e2e/lab-markdown.e2e.ts`、`lab-agent-ui.e2e.ts`。
4. **提示词编辑器**：搬 `prompt/**`；`linkAttrs` 改写、`promptReferenceText` 收 `targets`；节点视图拿到宿主的测试；端口类型断言搬进包。验证同上，加 `lab-markdown.e2e.ts` 的 PromptEditor 一组与 `lab-agent-ui.e2e.ts`。
5. **编辑器扩展**：搬 `editor/**` 与 `MarkdownDisplay.dom.test.ts` 的场景 3，`MarkdownControl` 改引。验证：`MarkdownControl.dom.test.ts`、`late-dialect.dom.test.ts`、`editor-area.e2e.ts`、`files-explorer.e2e.ts`。
6. **文档与收口**：Spec、边界与索引、两份 README、`docs:check`、`governance:check`；全量 e2e；在 Lab 截图核对 Markdown 显示、编辑器、PromptEditor、InlineChip 与 nb-agent-ui 场景。

## 验收映射

行为不变，验收由现有测试覆盖，搬家后编号不变：

- `ui.markdown-display` 场景 1–4、输出 2–8、失败与恢复 → 包内 `MarkdownDisplay.dom.test.ts` 与 nbook 留下的外来方言部分，`e2e/lab-markdown.e2e.ts`。
- `ui.prompt-editor` 场景 1–5、输出 14 → 包内 `prompt/` 四份测试，`e2e/lab-markdown.e2e.ts`。
- `workspace.markdown-dialect` 各输出 → 包内 `codec/` 测试；输出 18、27 → nbook `targets.test.ts`（分类）与 `web/host.dom.test.ts`（分类经宿主到达展示器、PromptTextView、InlineChip 与编辑器）；包内缺省规则另加一例：`paragraph://41.20` 是 `other`、显示为小块，点击发 `reference`。
- `workspace.markdown-syntaxes` 输出 1–7 → nbook `syntaxes.test.ts`、`late-dialect.dom.test.ts`；输出 2（首屏）→ `check-dist`。
- 新增：不经插件挂 `MarkdownDisplay`、`PromptEditor`（不提供宿主）可用 → 包内 DOM 测试各一例；外层 provide 的自定义 `targets` 到达 PromptEditor 初始文档里的引用小块 → 包内 DOM 测试；`MarkdownImage` 没有应用上下文时可用 → 包内 DOM 测试；包边界与依赖声明 → `boundary.test.ts`。

## 验证

- 每片：包 `bun run typecheck`、`bun run test`；neuro-book `bun run typecheck`、`bun run test:affected`；片内受影响的 e2e 文件。
- 收口：`bun run build` 与 `check-dist`；`docs:check`、`governance:check`；全量 e2e；`nbdev shot` 看 `MarkdownDisplay`、`PromptEditor`、`InlineChip`、`MarkdownImage` 与 nb-agent-ui 的 `answer` 场景。
- 不验证：nb-story 实际接入（w00024 t13 做）。

## 不做与风险

- 不做：nb-agent-ui 的折叠预览改用包里的解析（另记后续）；dev-panel 的 `MarkdownView` 改用本包（另记后续）；字数统计搬家（只有 neuro-book 用，前后端共用的纯函数留在插件）。
- 风险：ProseMirror 装出两份时 `instanceof` 悄悄失效（第 2 片核对 `node_modules`，有第二份就停）；Tailwind 扫不到包源码里的图标类（第 3 片在 Lab 看图标）；编辑内核进首屏或 DOM 类型进后端检查（宿主接线只在懒加载的 `.vue` 里，第 3 片起每片 `check:dist` 与 `typecheck`）；漏 provide 时组件悄悄用缺省分类（接线测试与 Lab provide）。

## 设计审查

2026-10-23 Claude Sonnet 审第一版：重要 7、建议 5，全部成立并改进了计划（宿主接线移到懒加载的 `.vue`、六个服务组件都过宿主、小块的四条路径、`variant` 保住 work 与 user、测试归属与接线测试、Lab 的 `lab-sources`、`./language` 的导出清单等）。逐条处理与报告原文见 [evidences/design-review.txt](evidences/design-review.txt)。
