# t07 实施计划：Markdown 方言插件化与三种 Markdown 界面

## Context

- **为什么做**：开发者 2026-10-16 要求把方言做成插件贡献（一种方言连同它的读写与显示），并让三种用到 Markdown 的界面共用同一套方言与外观：Markdown 编辑器（t06 做的）、Composer 的编辑组件、Agent 输出用的 Markdown 展示器。引用小块与图片的外观要补规范，三边共用。
- **已确认的决定**：见 [Task README](README.md) 的“开发者的决定”1–5：三种界面本轮一起做；Composer 只做编辑组件，移植旧应用调好的 `PromptEditor`、保留它的文字写法；展示器用静态渲染；Composer 与展示器在 Lab 用假数据验收；贡献点第一版只给内置插件；名称“引用小块”。
- **依据**：方言规则 [`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md)；编辑器接入 [`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 19、61；贡献点机制 [`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)（顶层贡献、`implementation: "required" | "none"`、单条校验）；热插拔 [`runtime/plugin-hot-plug.md`](../../../../../docs/specs/runtime/plugin-hot-plug.md)；性能测量 [evidences/display-perf.md](evidences/display-perf.md)；旧 Composer 在分支 `archive/legacy-ui-tuning`（`865c9f593`）的 `packages/neuro-book/app/components/common/form/`。
- **工作方式**：worktree `.worktree/w00025-t07-markdown-plugins`，分支 `feat/w00025-t07-markdown-plugins`。逐片提交，只暂存本片文件；Task 记录在主工作区路径限定提交。实施中的审查按深入审查（审查计划与预算先报开发者）。

## 关键设计

### 1. 新插件 `nbook.markdown`（`src/plugins/markdown/`）

插件之间只经服务与贡献点协作（`packages/neuro-book/AGENTS.md`），所以 Markdown 的核心从编辑器插件挪进一个独立插件，编辑器与以后的 Agent 插件都经它的服务使用：

- **目录**：`shared/`（贡献点 id、声明 schema、字数规则与计数，两端共用）、`web/`（编解码器、语法模块、展示器、Composer 编辑组件、小块与图片零件）、`backend/`（项目进程的入口，只提供字数服务，第 3 节）。运行位置：`browser`、`project`。
- **挪动**：`plugins/editor/web/markdown/`（`codec/`、`syntax/`、`language.ts`、`inline-code-shortcut.ts`）与 `src/shared/markdown-dialect.ts`、`src/shared/word-count.ts` 挪进来，行为不变；语料与测试跟着走。编辑器的 `MarkdownControl` 留在编辑器插件，经服务取语言与编解码器。
- **服务** `markdownKey`（浏览器）：
  - `language: Readonly<ShallowRef<MarkdownLanguage>>`：按当前生效的语法贡献组成；集合变了换成新对象（第 4 节）。
  - `codecFor(schema, language)`：与现在同一个函数。
  - `components`：`MarkdownDisplay`、`PromptEditor`、`PromptTextView`、`InlineChip`、`MarkdownImage`（Vue 组件，共享实例）。
- **服务** `markdownWordsKey`（浏览器与项目进程）：`countWords(text)`，按生效的方言声明计数。编辑器状态栏（`editor/web/status-items.ts`）与书架统计（`projects/project/stats-tracker.ts`）改用它。

### 2. 方言贡献点（`src/plugins/markdown/shared/contracts.ts`）

一种方言分两处登记，因为字数要在项目进程里算，而顶层贡献不能投给要实现的点（`runtime/plugins.md` 输出 16）：

- **`markdown.dialects`**（`implementation: "none"`，插件描述的顶层贡献，所有运行位置都登记）：声明，TypeBox 校验：
  - `order: number`（同一词法单元有几个模块认领时，小的先试；内置的按现在 `markdownLanguage()` 的顺序取 10、20……，核心语法最后）；
  - `blockTags`、`inlineTags`：本方言的标签名（HTML 兜底不抢、宽容写法判断开标签都从这里取，取代 `shared/markdown-dialect.ts` 的写死名单）；
  - `words`：字数规则，每个标签一条 `{tag, content: "count" | "skip"}`（批注、注音、正文计；`<html>` 块、译文不计）；属性一律不计。
- **`markdown.syntaxes`**（`implementation: "required"`，浏览器入口贡献，id 与一条方言声明相同）：实现 `{load(): Promise<MarkdownSyntax>}`，`MarkdownSyntax` 即现在 `syntax/types.ts` 的形状，另加第 6 节的静态视图。没有对应声明的实现、声明的标签名与已有方言重名，都按单条校验拒绝。
- **核心语法**（段落、列表、表格……）不是贡献，由 `nbook.markdown` 自带，固定在最后。
- **内置方言**（批注、注音、双语、对齐、文字标记、可渲染 HTML、提示块）由 `nbook.markdown` 自己向这两个点贡献，与第三方同一条路（同 `editor.editors` 的内置编辑器）。
- **开放范围**：第一版只接受内置插件的贡献，`validate` 里按插件 id 前缀判断；第三方的贡献为 `invalid-declaration`，原因写明。
- **测试插件** `test.markdown-dialect`（`src/plugins/markdown/testing/`）：贡献一种 `<kbd>` 方言，用来证明加入、停用、重新启用三件事。

### 3. 字数按声明计（`src/plugins/markdown/shared/word-count.ts`）

`countWords(text, dialects)`：现在的两遍扫描不变，方言相关的判断改为查声明表。没有声明的标签按普通 HTML 处理（与方言 Spec 输出 9 的原样保留一致）。声明表由服务按生效的 `markdown.dialects` 组成，浏览器与项目进程各一份，内容相同。现有的字数测试原样通过，另加一条：停用测试方言后，`<kbd>` 里的字按原样片段不计。

### 4. 语言随贡献变化（`src/plugins/markdown/web/language-registry.ts`）

- 激活时等全部已接受声明的实现交付或失败（复用 `LanguageRegistry` 的等待与撤回写法），再组成第一份语言；实现加载失败的方言当作不存在，记诊断。
- 之后实现发布或撤回时组成新语言、换掉 `language` 的值。不存在的方言，内容按“认不出的语法”读成原样块，字节不变，所以停用不会损坏文件。
- **使用方怎么换**（schema 在建编辑器时固定，换语言就要重建）：
  - `MarkdownControl`：语言变了，在没有未交出的输入时（`commitWhenSettled` 的同一时机）用新语言按当前正文重建编辑器，光标按源码偏移恢复；有写不出的输入时先不换，提示条照旧，解除后再换。
  - `MarkdownDisplay`：按新语言重新渲染。
  - `PromptEditor`：不受影响（不用编解码器，见第 7 节）。

### 5. 小块与图片零件（`src/plugins/markdown/web/parts/`）

- **`InlineChip`**：由旧应用的 `PromptTokenChip` 移植，七种：引用、技能、选区、命令、图片 `#N`、文件 `#N`、粘贴位置 `#N`；引用按目标类型取图标与色调，图标复用 `src/ui/file-icons`。旧的 `reference-chip.ts` 色调表改为主题 token。同名 `.md` 就是外观合同：行高、截断、悬停、高亮、选中、可交互时的焦点与键盘。
- **`MarkdownImage`**：图片的显示：按方言 Spec 输出 18 解析地址；作品根以外的地址不显示，显示说明；读取中、失败、说明文字的样子。地址到可显示地址的换算由宿主给（`resolveAsset(address) → Promise<string | null>`）：编辑器用文件服务按地址读字节（与图片查看器同一条路），展示器由调用方给。
- 编辑器里：指向作品里文件的链接用标记视图（`addMarkView`）套上引用小块的外框与图标，文字仍可直接编辑，写回不变；外部链接仍是普通链接。图片用节点视图套 `MarkdownImage`。方言 Spec 输出 18 里“富文本按作品里的文件显示图片”这一条由此实现。

### 6. 展示器 `MarkdownDisplay`（`src/plugins/markdown/web/display/`）

- **渲染**：`codec.read(text)` 读成文档，用 schema 的 `DOMSerializer` 逐个顶层块生成页面结构；有节点视图的节点改用语法模块交出的**静态视图** `staticView(node) → HTMLElement`。静态视图与节点视图由同一个函数生成外观（提示块、`<html>` 块、批注、引用小块、图片），所以编辑器与展示器长得一样。
- **交互**：点引用小块、链接、图片、提示块标题，经一个事件出口发出 `activate({kind, target})`，宿主决定做什么；提示块的折叠只在展示器里记，不写回。`<html>` 块默认显示源码卡片，点“渲染”后在沙箱里显示（同编辑器）。
- **流式**：`text` 变了，下一帧重新读入，从第一个不同的顶层块起替换，前面的块不动；`streaming` 为真时在末尾显示光标。只读，不建编辑器。
- **性能**：根元素自带 `content-visibility: auto` 与按上次高度的 `contain-intrinsic-size`，长对话里拖动改宽度只排看得见的消息（测量见证据）。

### 7. Composer 的编辑组件 `PromptEditor`（`src/plugins/markdown/web/prompt/`）

- **移植**：`PromptEditor.vue`、`prompt-editor/` 下的扩展、文字写法 `prompt-text.ts`、附件条、粘贴块、候选菜单、`PromptTextView`，与它们的测试。外观不重调。
- **替换旧依赖**：`vue-i18n` 改为本应用的 `localize` 文字表；`reference-chip.ts`、`plain-reference-text`、`inline-editor-selection`、`agent-image-markdown` 里用到的几个函数挪进 `prompt/`，或改用第 5 节的零件。
- **与方言的关系**：保留它自己的文字写法与解析，不经编解码器（技能 `$`、命令 `/`、粘贴块都不是 Markdown，服务端认的也是这套写法）。与编辑器共用的是 `InlineChip` 与引用 `[名称](目标)` 的识别。`@`、`/`、`$` 的候选由宿主经 props 给出，本轮不做贡献点。
- **不做**：外壳（模型切换、各种控件、发送按钮、排队消息），留给以后的 Agent Work。

### 8. Lab 场景（`src/plugins/lab/web/fixtures/`）

- `MarkdownDisplay`：一条完整回复；定时追加的流式回复；100 条的长对话（可拖宽度）；每种方言一段。
- `PromptEditor`：空、各种小块、粘贴块、附件上传中与失败、候选菜单（假数据）。
- `InlineChip`、`MarkdownImage`：各状态。
- 编辑器的场景加一份含引用链接与图片的文档。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| 新 `docs/specs/workspace/markdown-syntaxes.md`（planned） | 方言贡献点：两个点的声明与实现、顺序、单条校验、只给内置插件、加载失败、停用与重新启用、使用方怎么换语言、字数按声明 |
| 新 `docs/specs/ui/markdown-display.md`（planned） | 展示器：输入、渲染、交互出口、流式、性能要求、与编辑器外观一致 |
| 新 `docs/specs/ui/prompt-editor.md`（planned） | Composer 编辑组件：以旧应用 `PromptEditor.md` 与归档的 `docs/archived/specs/ui/agent-conversation-view.md` 输入框一节为底，只留编辑组件的部分 |
| `docs/specs/workspace/markdown-dialect.md` | 方言集合来自贡献；不存在的方言按原样保留；输出 18 显示图片一条去掉（planned） |
| `docs/specs/workbench/editor.md` | 输出 19：Markdown 控件经 `nbook.markdown` 取语言，语言变了在没有未交出的输入时重建（planned）；输出 27 字数链接新 Spec |
| `docs/specs/README.md` | 注册三份新 Spec；`nbook.markdown` 进插件名单 |
| 组件文档 | `InlineChip.md`、`MarkdownImage.md`、`MarkdownDisplay.md`、`PromptEditor.md` 等与组件同名，先于实现写 |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 改动表 | 三份新 Spec 与改动 | `docs:check`、`governance:check` |
| S1 | 第 1 节的挪动 | 新插件骨架与服务，编解码器、语法、字数挪过去，编辑器与书架统计改用服务；行为不变 | `test:affected --typecheck`；现有 markdown 与字数测试原样通过 |
| S2 | 第 2、3 节 | 两个贡献点、内置方言改为贡献、字数按声明、测试方言插件 | 同 S1；随机性质测试默认种子与 1–60 |
| S3 | 第 4 节 | 语言随贡献变化，编辑器重建 | 同 S1；编辑器 e2e |
| S4 | 第 5 节 | 小块与图片零件，编辑器的链接标记视图与图片节点视图 | 同 S1；Lab 截图 |
| S5 | 第 6 节 | 展示器与静态视图，Lab 场景 | 同 S1；Lab 截图；展示器 e2e |
| S6 | 第 7 节 | Composer 编辑组件移植，Lab 场景 | 同 S1；Lab 截图 |
| S7 | — | Spec 实现合同与证据、深入审查与修正 | `test:affected --typecheck`、e2e、`docs:check`、`governance:check` |

## 验收映射

Spec 写好后按编号补全这张表；先按计划里的行为列出：

| 行为 | 测试 |
|---|---|
| 挪动后编辑器读写、字数与之前逐字节一致 | 现有 `codec/*.test.ts`、`word-count.test.ts`、`MarkdownControl.dom.test.ts` 原样通过 |
| 测试方言加入后能读写显示；停用后它的内容读成原样块、字节不变、字数按原样不计；重新启用后恢复 | `markdown/syntaxes.test.ts`（真实插件宿主，热插拔） |
| 第三方插件的方言贡献被拒、原因可查；没有声明的实现被拒；标签重名被拒 | 同上 |
| 编辑器有未交出的输入时语言变了不重建，交出后重建，正文与光标不变 | `MarkdownControl.dom.test.ts` 增补；`editor-area.e2e.ts` 一例 |
| 展示器与编辑器对同一份文档生成相同的方言外观（提示块、批注、引用小块、图片） | `display/display.dom.test.ts`（同一份语料逐节点比对结构与类名） |
| 流式追加只替换变了的块，前面块的元素不变；`streaming` 时显示光标 | 同上 |
| 展示器根元素带 `content-visibility`；点小块、链接、图片发出 `activate` | 同上；Lab e2e 一例 |
| 编辑器里作品内链接显示为引用小块、文字可编辑、写回不变；图片按作品文件显示，根外地址显示说明 | `MarkdownControl.dom.test.ts`、`codec` 写回测试 |
| Composer 的文字写法读写原样、小块、粘贴分档、附件状态、候选菜单 | 移植来的 `PromptEditor.test.ts`、`prompt-text.test.ts`、`prompt-editor-extensions.test.ts`、`PromptTextView.test.ts` |

## 验证

- 每片：`bun run test:affected --typecheck`；动到编辑器的片跑编辑器相关 e2e（先 `build`、`build:e2e`）。
- Lab：每个新场景跑 `lab:shot`，桌面与 390px 窄屏、明暗两态。
- 展示器的性能：Lab 的长对话场景里用真实 Chrome 复测证据里的三项（首次显示、改宽度、流式追加），结果写进证据。
- 未验证的边界：真实 Agent 的流式输出（没有 Agent 插件，只有定时追加）；第三方方言插件（第一版不开放）。

## 不做与风险

- **不做**：Composer 外壳；`@`、`/`、`$` 候选的贡献点；菜单、工具栏、块手柄（t08）；插入图片与存放位置（t09）；frontmatter 面板（t10）；`MarkdownControl` 挪进 `nbook.markdown` 并改为向 `editor.editors` 贡献（以后若要编辑器插件完全不认识 Markdown 再做）。
- **风险**：
  - S1 挪动牵涉的引用多：先只挪不改，测试原样通过再进 S2。
  - 换语言要重建编辑器：撤销历史会丢。Spec 写明；只在没有未交出的输入时换。
  - 静态视图与节点视图的外观要一致：两者由同一个函数生成，测试按结构比对。
  - Composer 移植量大（连测试约 5500 行）：外观与行为不重调，只换依赖；移植后先让原有测试通过。
