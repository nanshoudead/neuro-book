---
schema: nbook.task/v2
taskId: t07-markdown-plugins
status: active
updated: 2026-10-16
---

# Markdown 方言插件化与三种 Markdown 界面

## 目标与范围

开发者 2026-10-16 定：先做方言插件化，菜单一类的任务先建好、搁置（t08 编辑命令与菜单、t09 链接与图片的插入、t10 frontmatter 属性面板）。本轮把三种用到 Markdown 的界面一起做好，共用同一套方言与外观：

| 界面 | 开发者的要求 |
|---|---|
| Markdown 编辑器（t06 做的这个） | 方言最全；流式写入的需求不高（流式写入多发生在 Agent 操作时） |
| Composer 输入框 | 支持 `@` 文件引用、`/` Agent 命令、`$` 技能；对排版的需求低（写给 Agent 看，不要表格、列表、标题），但引用、技能这些小块本身是富文本。旧应用里已经调过一轮，效果不错 |
| Markdown 展示器（Agent 流式输出用，通常只读） | 性能、速度与流式渲染是重点（旧应用在约 100 条 AI 消息的对话里拖动改外层宽度时严重卡顿）；支持本方言；开发者提出可以考虑用只读的编辑器来做，但性能没测过 |

另外两件，开发者 2026-10-16 提出：

- 引用小块（`[文字](地址)` 显示成的小块）与图片的**外观规范**要补，三种界面共用。
- 方言要能**由插件贡献**（一种方言连同它的读写与显示），解耦并增加扩展性。

合同：[`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md)（读写规则）、[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（编辑器接入）；贡献点、外观、Composer 与展示器的 Spec 待写。

## 开发者的决定

1. （2026-10-16）先做方言插件化；菜单一类的任务先建好、搁置（t08–t10）。三种界面本轮一起做好。
2. （2026-10-16）Composer 只做编辑组件；模型切换、各种控件、发送按钮等外壳留给以后的 Agent Work。没有另说怎么做，按推荐：移植旧应用调好的 `PromptEditor`，保留它自己的文字写法，与编辑器共用小块外观与引用的识别。
3. （2026-10-16）展示器用静态渲染（编解码器读入后按 schema 生成页面结构，不建编辑器）。
4. （2026-10-16）Composer 与展示器在 Lab 里用假数据验收（流式用定时追加模拟）。
5. （2026-10-16）没有异议，按推荐：方言贡献点第一版只给内置插件；`[文字](地址)` 显示成的小块叫“引用小块”。

6. （2026-10-16）Composer 里的 `@` 插入以 `/` 开头的作品根地址；三种界面按同一个“目标分类”判断引用指向什么、取什么图标；旧应用的领域地址（`chapter://` 等）不迁。
7. （2026-10-16）“只给内置插件”第一版不加来源判断（现在装不进第三方插件）；安装机制落地时由装配方给允许清单。
8. （2026-10-16）不在运行中换语言：已打开的编辑器与展示器沿用建立时的语言，后来的方言重新打开后生效。第二版计划确认，开始实施。

## 调研

- **现在的方言结构**：每种方言是一个语法模块（`plugins/editor/web/markdown/syntax/types.ts` 的 `MarkdownSyntax`：schema、读法、写法、节点视图都在模块里，编解码器不认识具体语法）。还不是贡献点：`markdownLanguage()` 里列死了八个模块；只有编辑这一面，没有展示用的渲染；字数在 `src/shared/` 里写死了方言标签名（服务端书架统计也用）；模块直接交出 `marked` 的词法单元与 Tiptap 扩展。
- **旧应用的 Composer**：调好的版本在分支 `archive/legacy-ui-tuning`（提交 `865c9f593`，`packages/neuro-book/app/components/common/form/`）：`PromptEditor.vue`（Tiptap，1128 行）、`prompt-editor/` 下的 `PromptTokenChip`（引用、技能、选区、命令、图片、文件、粘贴位置七种小块的外观，编辑器与静态显示共用）、`PromptTextView`（已发送消息的静态显示）、附件条、粘贴块、候选菜单。它有自己的文字写法与解析（`prompt-text.ts`，不经 `marked`），“文字是唯一真相”，读进来的文字原样写回。
- **旧应用的展示器**：`AgentMarkdown.vue` 与更早的 `AgentMarkdownContent.vue` 都是 `marked` 转 HTML 后 `v-html`，流式时节流后整条重转；引用小块是另外拼的 HTML 字符串（`reference-chip.ts` 的 `renderReferenceChipHtml`），与编辑器不是同一份，不认批注等方言。
- **性能测量**（[evidences/display-perf.md](evidences/display-perf.md)）：拖动改宽度的卡顿来自整页布局，三种做法都一样（300 条时每次改宽度 34–45 毫秒）；每条消息加 `content-visibility: auto` 后都降到 3 毫秒左右。只读 Tiptap 的首次显示约是“编解码器读入后静态序列化”的 3 倍（300 条 1.8 秒对 0.5 秒），JS 堆 48 MB 对 7.5 MB；流式追加三种都在 4 毫秒左右。
- **Tiptap 现成的件**：`@tiptap/extension-drag-handle`（及 Vue 3 版）、`bubble-menu`、`floating-menu`、`suggestion` 都有 3.27.3，MIT（t08 用）。

## 计划审查

第一版计划经深入审查：omp（默认模型）11 条（阻断 2、重要 8、建议 1）、Opus 19 条（阻断 3、重要 13、建议 3），报告见 [evidences/plan-review-omp.txt](evidences/plan-review-omp.txt)、[evidences/plan-review-opus.txt](evidences/plan-review-opus.txt)。两边都用真实内核宿主做了实验。全部成立，按下表改成[第二版计划](plan.md)；Composer 引用目标的写法由开发者定（决定 6）。

| 问题（omp / Opus 编号） | 处理 |
|---|---|
| 拥有者在激活里等自己的贡献，永远激活不完（omp 2 / Opus 1） | 内置方言的实现由 `nbook.markdown` 直接持有，只把声明投到点上 |
| 等别的插件交付没有终点（— / Opus 2） | 第一份语言只用内置与核心，不等任何贡献；外来方言晚到时组成新语言 |
| 换语言重建会丢别的视图里写不出、未裁决的输入；光标没有源码偏移的换算（omp 4 / Opus 4、5） | 不在运行中换语言：视图在建立时取定语言，编辑器实例整个寿命用同一份；重建与光标换算归热插拔 |
| 运行中重建只服务测试插件（— / Opus 16） | 同上 |
| 配对与标签撞名放不进单条校验（omp 1 / Opus 3） | 单条校验只做形状与“id 以贡献方插件 id 开头”；配对与撞名在组成语言时判，不生效、记诊断、与顺序无关 |
| 按 id 前缀判内置会拒掉测试插件，也不等于内置身份（omp 3 / Opus 6） | 第一版不加来源判断：没有安装第三方插件的途径，清单里的都是内置；Spec 写明前提，安装机制落地时由装配方给允许清单 |
| 核心的行内代码硬依赖注音，注音缺席建不了 schema（omp 5 / —） | 改按标记组排斥；逐个去掉内置方言的组成测试 |
| 字数规则变了缓存不失效、今天的基线混口径；两端口径不同（omp 6、7 / Opus 8） | 字数只按声明，进程寿命内固定；声明表指纹写进书架统计，变了整轮重扫、基线重定；实现加载失败不改字数，写成已知偏差 |
| 声明 `{tag, content}` 表达不了提示块与可渲染 HTML（— / Opus 7） | 改名 `tagWords`，只管标签类方言；提示块与可渲染 HTML 仍由核心扫描处理，写成已知偏差 |
| 标签名两个真相源、`order` 相同先后未定（— / Opus 18） | 组成时核对模块与声明的标签名，不同则不生效；`order` 相同按 id 排 |
| 字数服务与项目入口多余（— / Opus 17） | 去掉；导出纯函数与声明表，项目位置只放贡献点定义（同 `nbook.settings`） |
| 服务同步交出语言与组件，Tiptap 进首屏（— / Opus 9） | `language()` 异步、组件 `defineAsyncComponent`；`check:dist` 查首屏 |
| 挪动后编辑器拿不到扩展组与行内代码快捷输入（— / Opus 10） | 二者是编辑器界面层，留在编辑器，扩展组改为收 `language.extensions` |
| `staticView` 缺 `contentDOM`、释放与宿主参数；样式在 `.markdown-control` 作用域里（omp 8 / Opus 11） | 改为 `staticView(node, host) → {dom, contentDOM?, destroy?}`；共用外观构建函数；样式挪成共用的一份 |
| 流式时批注每次读入换身份，前面的块总被判成变了（omp 9 / —） | 先按 `identityAttrs` 对齐（挪成编解码器的公开函数），再头尾比较，只换中间变了的块 |
| 链接的标记视图会被批注拆成两个小块（— / Opus 14） | 引用小块改用装饰，按连续范围画 |
| 图片地址没有释放（— / Opus 19） | `resolveAsset(address, signal) → {url, release()}`，按地址引用计数的缓存，文件变了作废 |
| 旧 Composer 的引用识别是旧应用的地址方案（omp 10 / Opus 12） | 开发者定为作品根地址（决定 6） |
| Composer 移植漏了依赖、测试运行器、文字表与全局样式（omp 11 / Opus 13） | 第 7 节列迁移清单 |
| 换语言的验收在真实运行时没有触发手段；外观逐节点比对必然不等（— / Opus 15） | 测试方言用自己的激活前缀、由测试命令触发；比对先去掉编辑器自带的属性、类名与占位元素 |

## 当前状态

按[第二版计划](plan.md)实施中。执行位置：worktree `.worktree/w00025-t07-markdown-plugins`，分支 `feat/w00025-t07-markdown-plugins`（从 master `ee9cee973` 拉出）。

- S0（`fe32a7327`）：三份新 Spec（planned）：[`workspace/markdown-syntaxes.md`](../../../../../docs/specs/workspace/markdown-syntaxes.md)、[`ui/markdown-display.md`](../../../../../docs/specs/ui/markdown-display.md)、[`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md)；方言 Spec 加“方言由插件贡献”与输出 27“引用的目标分类”、字数口径，编辑器输出 19、27，书架统计输出 16 的口径指纹，热插拔输出 8。
- S1（`863d006f8`）：新插件 `nbook.markdown`。编解码器、语法模块、字数（`markdown-dialect.ts`、`word-count.ts`）与 Markdown 控件挪进来，内容只改导入路径；编辑器区把服务交出的 `MarkdownControl` 当内置编辑器直接持有；`check:dist` 加首屏检查（入口脚本与预加载的 chunk 里没有 ProseMirror 与 `marked`）。`test:affected --typecheck` 通过（bun 1398 条、vitest 257 条）；生产构建上编辑器区、编辑器类型、Lab 编辑器与资源管理器、书架统计、资源管理器的 e2e 共 54 个通过。
  - **和计划不同**：第二版计划是服务交 `language()` 与 `codecFor`、控件留在编辑器。实施时发现后端的类型检查（不带 DOM）包含装配浏览器插件的 bun 测试，会顺着插件定义里的动态 `import()` 检查到语法模块的节点视图（用 DOM）。仓库的做法是带 DOM 的代码只经 `.vue` 加载，所以改成控件挪进 `nbook.markdown`、服务只交组件；产品行为不变。计划第 1、4 节与 Spec 已随之修改。

## 下一步

S2：两个贡献点、内置方言声明、配对与冲突、核心按组排斥、字数按声明与指纹、测试方言插件。
