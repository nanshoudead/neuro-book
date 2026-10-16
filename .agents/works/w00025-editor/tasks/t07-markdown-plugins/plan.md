# t07 实施计划（第二版）：Markdown 方言插件化与三种 Markdown 界面

第一版经 omp 与 Opus 深入审查（[evidences/plan-review-omp.txt](evidences/plan-review-omp.txt)、[evidences/plan-review-opus.txt](evidences/plan-review-opus.txt)，处理见 [README](README.md) 的“计划审查”）后改写。

## Context

- **为什么做**：开发者 2026-10-16 要求把方言做成插件贡献（一种方言连同它的读写与显示），并让三种用到 Markdown 的界面共用同一套方言与外观：Markdown 编辑器（t06 做的）、Composer 的编辑组件、Agent 输出用的 Markdown 展示器。引用小块与图片的外观要补规范，三边共用。
- **已确认的决定**：见 [Task README](README.md) 的“开发者的决定”：三种界面本轮一起做；Composer 只做编辑组件，移植旧应用调好的 `PromptEditor`、保留它的文字写法；展示器用静态渲染；Composer 与展示器在 Lab 用假数据验收；贡献点第一版只给内置插件；名称“引用小块”。
- **依据**：方言规则 [`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md)；编辑器接入 [`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 19、27、30、61；贡献点机制 [`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)（顶层贡献、`implementation`、输出 15–24）；书架统计 [`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md)；性能测量 [evidences/display-perf.md](evidences/display-perf.md)；旧 Composer 在分支 `archive/legacy-ui-tuning`（`865c9f593`）的 `packages/neuro-book/app/components/common/form/`。
- **工作方式**：worktree `.worktree/w00025-t07-markdown-plugins`，分支 `feat/w00025-t07-markdown-plugins`。逐片提交，只暂存本片文件；Task 记录在主工作区路径限定提交。实施中的审查按深入审查（审查计划与预算先报开发者）。

## 关键设计

### 1. 新插件 `nbook.markdown`（`src/plugins/markdown/`）

插件之间只经服务与贡献点协作（`packages/neuro-book/AGENTS.md`），所以 Markdown 的核心从编辑器插件挪进一个独立插件。

- **目录与运行位置**：`shared/`（贡献点 id、声明 schema、字数）、`web/`（编解码器、语法模块、展示器、Composer 编辑组件、小块与图片零件）。运行位置 `browser`、`project`：项目位置的定义只有方言贡献点、没有入口（同 `nbook.settings` 的 `settings/shared/point.ts`），这样顶层声明在项目进程里也有拥有者、能查到。
- **挪动**（S1，只挪不改）：`plugins/editor/web/markdown/` 的 `codec/`、`syntax/`、`language.ts` 与语料、测试；`src/shared/markdown-dialect.ts`、`src/shared/word-count.ts`。**留在编辑器**：`MarkdownControl.vue`、`markdown-editor-extensions.ts`（改为收 `language.extensions` 参数，再加占位与行内代码快捷输入）、`inline-code-shortcut.ts`：它们是编辑器界面层。
- **服务** `markdownKey`（浏览器，普通共享服务）：
  - `language(): Promise<MarkdownLanguage>`：第一次调用时才动态加载语法模块与 `marked`、Tiptap，之后返回同一个对象，直到方言集合变了（第 4 节）；`onLanguageChange(listener) → () => void`。
  - `codecFor(schema, language)`：与现在同一个函数。
  - `components`：`MarkdownDisplay`、`PromptEditor`、`PromptTextView`、`InlineChip`、`MarkdownImage`，一律 `defineAsyncComponent` 包一层再交出。
  - 首屏不含 Tiptap、ProseMirror、`marked` 与 Composer：`check:dist` 加一条，入口直接引用的 chunk 里没有它们的标记字符串。
- **字数不经服务**：`shared/contracts.ts` 导出 `dialectTable(declarations)` 与 `countWords(text, table)`（同步纯函数），编辑器状态栏与书架统计在各自入口激活时用 `context.declarations` 算一次表（第 3 节）。

### 2. 方言贡献点（`src/plugins/markdown/shared/contracts.ts`）

一种方言分两处登记：字数要在项目进程里算，而顶层贡献不能投给要实现的点（`runtime/plugins.md` 输出 16）。

- **`markdown.dialects`**（`implementation: "none"`，插件描述的顶层贡献，浏览器与项目两个位置都登记）。声明经 TypeBox 校验：
  - `order: number`：同一词法单元有几个模块认领时小的先试；相同时按方言 id 的码元顺序；
  - `blockTags`、`inlineTags`：本方言的标签名；
  - `tagWords`：每个标签一条 `{tag, content: "count" | "skip"}`，属性一律不计。只描述“标签里的字计不计”，提示块与可渲染 HTML 这类非标签写法的字数规则仍在核心扫描里（第 3 节）。
- **`markdown.syntaxes`**（`implementation: "required"`，浏览器入口贡献）：实现 `{load(): Promise<MarkdownSyntax>}`。`MarkdownSyntax` 是现在 `syntax/types.ts` 的形状，另加第 6 节的静态视图。
- **单条校验只做形状**：声明与实现的 id 都要以贡献方插件 id 加 `.` 开头（同 `editor/shared/contracts.ts` 的写法），所以同 id 配对天然限定在同一插件内。
- **配对与冲突在组成语言时判**（拥有者的接收层，不在单条校验里）：
  - 实现没有同 id 声明，或模块交出的标签名与声明不同：这种方言不生效，记诊断；
  - 两种方言声明了同一个标签名，或交出同名的节点、标记、写法：两种都不生效（同 `duplicate-contribution` 的“全部重复者都拒绝”），与登记顺序无关；
  - 都不影响贡献方的其它贡献。Spec 里叫“不生效”，不是 `invalid-declaration`。
- **内置方言**（批注、注音、双语、对齐、文字标记、可渲染 HTML、提示块）：声明投到 `markdown.dialects`（供目录与字数）；实现由 `nbook.markdown` 直接持有，不经自己的贡献点交付（同 `editor-registry.ts` 直接持有内置编辑器），因为拥有者不能在激活里等自己的交付。核心语法同样直接持有、排在最后。
- **只给内置插件**：现在没有安装第三方插件的途径（`plugin-install.md` 为 planned），装配清单里的插件都是内置的，所以第一版不加来源判断。Spec 写明这个前提：安装机制落地时，由装配方给出允许清单（同 `delegatingPlugins`），不按 id 前缀猜。
- **核心不依赖可选方言**：行内代码的 `excludes: "code markdownRuby"` 改成按组排斥（行内代码与注音都进同一个标记组，组里至少有行内代码自己，组不会为空），注音缺席时 schema 照常建。
- **测试插件** `test.markdown-dialect`（`src/plugins/markdown/testing/`）：贡献一种 `<kbd>` 方言。它的浏览器入口用自己拥有的激活前缀，由同插件另一入口贡献的测试命令触发，这样“晚到的方言”在测试里是真实交付。

### 3. 字数按声明计（`src/plugins/markdown/shared/word-count.ts`）

- `countWords(text, table)`：现在的两遍扫描不变；标签类方言的判断改查声明表，没有声明的标签按普通 HTML 处理。提示块的类型标记与可渲染 HTML 块仍由核心扫描处理，不随方言变（方言 Spec 的“已知偏差”加一句）。
- **口径**：字数只按已接受的声明，与浏览器里实现能否加载无关（加载失败另记诊断，Spec 写成已知偏差）。声明集合在一个进程的寿命内固定：顶层声明在实例登记时注入，运行期启停插件归 `runtime.plugin-hot-plug`（planned）。
- **换版本时的书架统计**：声明表算一个指纹，写进书架统计的持久记录。重开作品时指纹不同（例如升级后多了一种内置方言），整轮重扫，今天的基线按新口径重定，差额不算今天写的字。
- 现有字数测试原样通过；一致性测试改为对照声明表与组成后的语言。

### 4. 语言在视图建立时取定（`src/plugins/markdown/web/language-registry.ts`）

- **第一份语言**只用内置方言与核心语法，在第一次 `language()` 时组成，不等任何别的插件。
- **外来方言**的实现交付或撤回后，组成新的语言对象、通知订阅者。
- **使用方不在运行中换语言**：已打开的视图沿用建立时的语言，之后新建的用最新的。
  - `MarkdownControl`：编辑器实例（`KeptEditor`）记下建它时的语言与编解码器，整个寿命都用这一份，不重建、不迁移。所以写不出、未裁决的输入与撤销历史都不受影响。新建的实例（新的组、重新创建）取最新语言。
  - `MarkdownDisplay`：一条消息的显示在挂上时取定语言。
  - 后来的方言在已打开的视图里按原样块显示、字节不变；重新打开后生效。不加提示（第一版产品里没有运行中改变方言集合的场景，只有测试插件）。
- 运行中重建、光标换算留给做热插拔的 Task。

### 5. 小块与图片零件（`src/plugins/markdown/web/parts/`）

- **`InlineChip`**：由旧 `PromptTokenChip` 移植，七种：引用、技能、选区、命令、图片 `#N`、文件 `#N`、粘贴位置 `#N`。同名 `.md` 是外观合同：行高、截断、悬停、高亮、选中、可交互时的焦点与键盘。
  - 引用的图标与色调按第 7 节的“目标分类”取：作品里的文件按扩展名取 `src/ui/file-icons` 的图标，外部链接与附件各一种。
  - 旧应用的色调在全局 `reference-chips.css`，改为零件自己的样式、只用主题 token；不沿用旧的全局类名（新应用已有全局 `.nb-skill-chip`，避免叠加）。
- **`MarkdownImage`**：按方言 Spec 输出 18 解析地址；作品根以外的地址不显示，显示说明；读取中、失败、说明文字的样子。
  - 宿主接口 `resolveAsset(address, signal) → Promise<{url, release()} | null>`。
  - `nbook.markdown` 提供按地址引用计数的缓存：最后一个使用者 `release` 时 `revokeObjectURL`；编辑器的宿主用文件服务按地址读字节（同图片查看器），经 `watch` 订阅文件变化，变了就作废对应条目、重新读取。
  - 卸载、地址变化、读取中被取消，都不留 URL。
- **编辑器里的引用小块**：指向作品里文件的链接用装饰画外框与图标，不用标记视图：批注只盖住链接的一部分时，标记视图会把一个链接拆成两个元素。一个插件按同一个链接标记的连续范围算起止，起点放图标（`Decoration.widget`），整段加类名（`Decoration.inline`），只在两端画圆角。文字照常可编辑，写回不变；外部链接仍是普通链接。展示器在序列化后按同样的连续范围补类名。
- **编辑器里的图片**：节点视图套 `MarkdownImage`。方言 Spec 输出 18 里“富文本按作品里的文件显示图片”这一条由此实现。

### 6. 展示器 `MarkdownDisplay`（`src/plugins/markdown/web/display/`）

- **渲染**：`codec.read(text)` 读成文档，用 schema 的 `DOMSerializer` 逐个顶层块生成页面结构；标记一律走 `renderHTML`（批注本来就没有节点视图）。有节点视图的节点（提示块、可渲染 HTML、图片）改用语法模块交出的**静态视图**：
  - `staticView(node, host) → {dom, contentDOM?, destroy?}`。容器把子块交给 `contentDOM`，由渲染器递归填入；`destroy` 释放监听与图片。
  - `host` 给文字表与当前语言（locale）、`activate` 出口、`resolveAsset`、折叠状态的读写。
  - 节点视图与静态视图共用“按节点与状态画 DOM”的外观构建函数，事件接线各写各的：折叠在编辑器里由 ProseMirror 插件管，在展示器里由展示器自己记。
- **样式**：方言的样式从 `MarkdownControl` 的 `.markdown-control :deep(...)` 挪到 `nbook.markdown` 的一份共用样式，挂在两边共同的根类名下，展示器与编辑器同一份。
- **交互**：点引用小块、链接、图片、提示块标题，经一个出口发出 `activate({kind, target})`，宿主决定做什么；提示块的折叠只在展示器里记，不写回。可渲染 HTML 默认是源码卡片，点“渲染”后在沙箱里显示（同编辑器）。
- **流式**：`text` 变了，下一帧重新读入，先按 `identityAttrs` 把新读入的身份对齐到上一次（与 `codec.reload` 同一个对齐函数，挪成编解码器的公开函数），再按“头尾相同的块保留”比较：只替换中间变了的块，被替换的块调 `destroy`。后面的引用定义改变了前面块的含义时，前面那块也因比较不等而替换。`streaming` 为真时在末尾显示光标。
- **性能**：根元素自带 `content-visibility: auto` 与按上次高度的 `contain-intrinsic-size`。

### 7. Composer 的编辑组件 `PromptEditor`（`src/plugins/markdown/web/prompt/`）

- **移植范围**：`PromptEditor.vue`、`prompt-editor/` 下的扩展、文字写法 `prompt-text.ts`、附件条、粘贴块、候选菜单、`PromptTextView`，与它们的测试。外观不重调。
- **保留**：它自己的文字写法（技能 `$`、命令 `/`、粘贴块、图片与文件 `#N`），不经编解码器。
- **改写引用的识别**（待开发者定，见 README“待确认”）：
  - 旧版只认旧应用的 `chapter://` 等领域地址与白名单里的旧根路径，与方言 Spec 输出 18 的地址规则不同；
  - 推荐：`[名称](目标)` 的词法按 Markdown 链接的规则（尖括号、括号、空格），目标经共用的“目标分类”（作品根 `/…`、`project://`、`user://`、外部链接、附件）；Composer 的 `@` 插入以 `/` 开头的作品根地址（Composer 没有“当前文件”，不写相对地址）；旧的领域地址不迁；
  - 文字写法的其余部分不变，节点仍存原文、原样写回。
- **迁移清单**：
  - `packages/neuro-book/package.json` 声明 `@tiptap/vue-3`（3.27.3，与其它 `@tiptap/*` 一致），并加进 `vite.config.ts` 的预构建清单；
  - 图片写法不用 `mdast-util-*`，改用本应用已有的 `marked` 或手写的小解析，不引新依赖；
  - 文字表：`vue-i18n` 改为本应用的 `localize`，locale 经 props 与节点视图的上下文显式传下去，测试覆盖切换语言；
  - 测试：组件测试改名为 `*.dom.test.ts`（Vitest，happy-dom）；撤销分组用真实的 ProseMirror 历史边界，不用假时钟；断言的期望值不变，只改装配与引用目标的写法（有意改变的期望，在测试里注明）。
- `@`、`/`、`$` 的候选由宿主经 props 给出，本轮不做贡献点。
- **不做**：外壳（模型切换、各种控件、发送按钮、排队消息），留给以后的 Agent Work。

### 8. Lab 场景（`src/plugins/lab/web/fixtures/`）

- `MarkdownDisplay`：一条完整回复；定时追加的流式回复（开头有一条批注与一个折叠的提示块，追加时它们不重建）；100 条的长对话（可拖宽度）；每种方言一段。
- `PromptEditor`：空、各种小块、粘贴块、附件上传中与失败、候选菜单（假数据）。
- `InlineChip`、`MarkdownImage`：各状态。
- 编辑器的场景加一份含引用链接（含被批注盖住一半的）与图片的文档。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| 新 `docs/specs/workspace/markdown-syntaxes.md`（planned） | 方言贡献点：两个点与两个位置、声明与实现、内置方言直接持有、配对与冲突“不生效”的规则、只给内置插件的前提、实现加载失败、语言在视图建立时取定、字数口径与指纹 |
| 新 `docs/specs/ui/markdown-display.md`（planned） | 展示器：输入、渲染与静态视图、交互出口、流式的比较与替换、释放、性能要求、与编辑器外观一致 |
| 新 `docs/specs/ui/prompt-editor.md`（planned） | Composer 编辑组件：以旧应用 `PromptEditor.md` 与归档的 `docs/archived/specs/ui/agent-conversation-view.md` 输入框一节为底，只留编辑组件的部分；引用目标按开发者的决定 |
| `docs/specs/workspace/markdown-dialect.md` | 方言集合来自贡献；不生效的方言按原样保留；字数的已知偏差补两句；输出 18 显示图片一条去掉（planned） |
| `docs/specs/workbench/editor.md` | 输出 19：Markdown 控件经 `nbook.markdown` 取语言，实例在建立时取定语言；输出 27 字数链接新 Spec |
| `docs/specs/runtime/projects.md` | 书架统计记声明指纹，变了整轮重扫、基线重定（planned） |
| `docs/specs/runtime/plugin-hot-plug.md` | 待办登记：方言集合运行中变化时编辑器重建与书架统计重扫 |
| `docs/specs/README.md` | 注册三份新 Spec |
| 组件文档 | `InlineChip.md`、`MarkdownImage.md`、`MarkdownDisplay.md`、`PromptEditor.md` 等与组件同名，先于实现写 |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 改动表 | 三份新 Spec 与改动 | `docs:check`、`governance:check` |
| S1 | 第 1 节 | 新插件骨架、服务（异步语言）、挪动；编辑器与书架统计改用新入口；`check:dist` 的首屏检查 | `test:affected --typecheck`；现有 markdown 与字数测试原样通过；`build` 后 `check:dist` |
| S2 | 第 2、3 节 | 两个贡献点、内置声明、配对与冲突、核心按组排斥、字数按声明与指纹、测试方言插件 | 同 S1；随机性质测试默认种子与 1–60 |
| S3 | 第 4 节 | 外来方言晚到、视图取定语言 | 同 S1；编辑器相关 e2e |
| S4 | 第 5 节 | 小块与图片零件、图片缓存、编辑器的引用小块装饰与图片节点视图 | 同 S1；Lab 截图 |
| S5 | 第 6 节 | 静态视图与共用样式、展示器、Lab 场景 | 同 S1；Lab 截图；展示器 e2e；长对话复测性能 |
| S6 | 第 7 节 | Composer 编辑组件移植、Lab 场景 | 同 S1；Lab 截图 |
| S7 | — | Spec 实现合同与证据、深入审查与修正 | `test:affected --typecheck`、e2e、`docs:check`、`governance:check` |

## 验收映射

Spec 写好后按编号补全；先按行为列出：

| 行为 | 测试 |
|---|---|
| 挪动后编辑器读写、字数与之前逐字节一致；首屏不含 Tiptap | 现有 `codec/*.test.ts`、`word-count.test.ts`、`MarkdownControl.dom.test.ts` 原样通过；`check-dist.test.ts` 增补 |
| `nbook.markdown` 激活不等任何贡献；第一份语言只含内置与核心 | `markdown/syntaxes.test.ts`（真实插件宿主） |
| 测试方言经测试命令晚到：之后新建的编辑器能读写显示它；已打开的编辑器不变、写不出与未裁决的输入不丢 | 同上；`MarkdownControl.dom.test.ts` 增补 |
| 实现没有声明、标签名与声明不同、两种方言撞名：不生效、诊断可查，其它方言与贡献方其它贡献照常，与登记顺序无关 | `markdown/syntaxes.test.ts` |
| 逐个去掉内置方言时语言照常组成（注音缺席不抛错） | `markdown/language.test.ts` |
| 字数按声明；实现加载失败时字数不变；指纹变了书架整轮重扫、今天的字数不跳 | `word-count.test.ts`、`stats-tracker.test.ts` 增补 |
| 展示器与编辑器对同一份语料的方言外观一致：比对去掉 `contenteditable`、`ProseMirror-*` 类名与占位元素后的结构 | `display/display.dom.test.ts` |
| 流式追加：开头的批注、折叠的提示块、已渲染的 `<html>` 块的元素与状态不变；替换掉的块释放了监听与图片；后面的引用定义改变前面块的含义时那块重画 | 同上 |
| 展示器根元素带 `content-visibility`；点小块、链接、图片发出 `activate` | 同上；Lab e2e 一例 |
| 编辑器里作品内链接是一个引用小块（被批注盖住一半时仍是一个），文字可编辑、写回不变；图片按作品文件显示，根外地址显示说明；同一张图两处显示、删掉一处另一处仍在，全部卸载后没有未释放的 URL；文件变了图片更新 | `MarkdownControl.dom.test.ts`、`parts/image-cache.test.ts` |
| Composer 的文字写法读写原样、小块、粘贴分档、附件状态、候选菜单；引用按新的目标分类；切换语言后文字跟着变 | 移植来的 `prompt-text.test.ts`、`prompt-editor-extensions.test.ts`、`PromptEditor.dom.test.ts`、`PromptTextView.dom.test.ts` |

## 验证

- 每片：`bun run test:affected --typecheck`；动到编辑器的片跑编辑器相关 e2e（先 `build`、`build:e2e`）。
- Lab：每个新场景跑 `lab:shot`，桌面与 390px 窄屏、明暗两态。
- 展示器的性能：Lab 的长对话场景里用真实 Chrome 复测证据里的三项（首次显示、改宽度、流式追加），结果写进证据。
- 未验证的边界：真实 Agent 的流式输出（只有定时追加）；第三方方言插件（第一版不开放）；运行中停用方言（热插拔是 planned）。

## 不做与风险

- **不做**：Composer 外壳；`@`、`/`、`$` 候选的贡献点；运行中换语言与编辑器重建（归热插拔）；菜单、工具栏、块手柄（t08）；插入图片与存放位置（t09）；frontmatter 面板（t10）；`MarkdownControl` 挪进 `nbook.markdown`（它依赖编辑器的控件合同，留在编辑器）。
- **风险**：
  - S1 挪动牵涉的引用多：先只挪不改，测试原样通过再进 S2。
  - 静态视图与节点视图的外观一致：共用外观构建函数与同一份样式，测试按归一化后的结构比对，Lab 截图目视核对。
  - Composer 移植量大（连测试约 5500 行）：外观不重调，按迁移清单改装配；引用识别的改写取决于开发者的决定。
