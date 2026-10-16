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

- S2（`22bbd8fe1`）：方言的两个贡献点。`markdown.dialects`（顶层声明，浏览器与项目两个位置都有拥有者，项目位置只有贡献点没有入口）、`markdown.syntaxes`（浏览器入口交实现）。内置方言的声明写在插件描述里，实现由 `nbook.markdown` 直接持有；外来方言由方言目录（`web/syntax-catalog.ts`，不碰 DOM）配对声明、核对标签名、判撞名与加载失败，不生效时记诊断 `markdown.dialect.inactive`；组成语言（`web/language-registry.ts`）只在组件一侧，Markdown 控件在建实例时取定语言。行内代码改按标记组排斥注音，内置方言逐个缺席都能组成语言。字数改为按声明表计（`dialectTable`），书架统计的快照记声明表指纹，指纹不同（或旧记录没有）时首扫后重定今天的基线。测试方言插件 `web/testing/kbd-dialect.ts`。`test:affected --typecheck` 通过（bun 1405 条、vitest 257 条），随机性质测试默认种子与 1–60 全过；生产构建上编辑器区、编辑器类型、Lab 编辑器、书架、书架统计与项目的 e2e 共 48 个通过。变异检查：行内代码的排斥改回写死 `markdownRuby`，缺注音的组成测试失败。

- S3（`85647109c`）：外来方言晚到。S2 已让控件在建实例时取定语言，这一片补验收：真实内核的浏览器实例里测试方言由测试激活，之后新建的编辑器认得它，已打开的实例仍按原样片段读写、未交出的输入照常交出（`web/components/late-dialect.dom.test.ts`）；变异检查（控件每次写出都取最新的语言）时这一例失败。运行中晚到的方言只有测试插件会产生，不另做浏览器 e2e，Spec 的 Smoke 行随之改写。`test:affected --typecheck` 中两例文件监视测试（`files/changes.test.ts`、`settings/backend/layer-owner.test.ts`）在负载下失败，单独重跑两遍都过，这一片没改它们。

- S4（`1a0951524`）：引用小块与图片。`InlineChip`（由旧 `PromptTokenChip` 移植，外观判断在 `parts/chip.ts`、样式在 `parts/chip.css`，与普通 DOM 共用）、`MarkdownImage`；目标分类 `shared/targets.ts`（方言 Spec 输出 27）；图片地址 `parts/asset-urls.ts`（文件服务的字节路由 URL，文件变了加版本号重新取，真实文件服务场地测过）；编辑器里作品内链接用装饰画成一个引用小块（被批注盖住一半时也是一个；变异检查：不合并同一链接的连续范围时测试失败），图片节点视图用 `render()` 挂 `MarkdownImage`。文件图标的配色挪到 `ui/file-icons/palette.css`，加不经 Vue 的 `renderFileIcon`。Lab 加 `InlineChip`（17 个场景）、`MarkdownImage`（5 个）两个组件，编辑器的方言场景加引用链接与图片；`lab:shot` 在手机与 1400×900、明暗两态下 0 个问题，截图目视核对过（编辑器区是集成场景，`lab:shot` 要加 `--wait 6000` 才等到控件加载与读文档）。`test:affected --typecheck` 通过（bun 1410 条、vitest 266 条）。
  - 和计划不同：图片不读成 blob、不做引用计数缓存，直接用字节路由的 URL；节点视图不用 Tiptap 的 Vue 节点视图。计划第 5 节已随之修改。

- S5（`e8e0a5d27`）：展示器 `MarkdownDisplay`（静态渲染，`display/renderer.ts`）。编解码器读入后按 schema 的 `DOMSerializer` 逐块生成，提示块、可渲染 HTML、图片用 `display/static-views.ts`，与编辑器共用外观函数（提示块拆出 `buildCallout`，`<html>` 块导出 `renderHtmlEmbedElement`）；作品内链接画成引用小块，结构与编辑器的装饰相同。流式更新按块比较，键是去掉 `identityAttrs` 后的节点 JSON，头尾相同的块保留元素与折叠状态；同一帧多次改变只读一次。方言样式从 `MarkdownControl` 挪到共用的 `parts/markdown.css`（`.nb-markdown`）。组件测试 5 例（`components/MarkdownDisplay.dom.test.ts`：与编辑器同一份语料的方言元素结构一致、流式时元素不变、后来的引用定义重画前面的块、`activate`、替换与卸载时释放图片与沙箱）；变异检查：比较时不去掉身份属性，流式那例失败。Lab 加 `MarkdownDisplay`（5 个场景），`lab:shot` 在 900×900 与手机、明暗两态下 0 个问题，截图目视核对过。新增 `e2e/lab-markdown.e2e.ts`（流式播完、100 条长对话改宽度的布局中位数在 5 毫秒以内），2 例通过；变异检查：去掉 `content-visibility` 时中位数 10.2 毫秒、失败。性能见 [`evidences/display-perf.md`](evidences/display-perf.md) 的“实现后复测”。`test:affected --typecheck` 通过（bun 1410 条、vitest 271 条）；生产构建上编辑器区、编辑器类型、Lab 编辑器与 lab-scenes 的 e2e 35 个，一次全量中 editor-area 的“场景 2 加粗”在负载下超时，单独重跑 4 次与整个文件重跑都过。
  - 和计划不同：静态视图由 `nbook.markdown` 持有，不经语法模块交出，外来方言按 `renderHTML` 显示；流式比较不对齐身份，直接去掉身份属性。计划第 6 节与两份 Spec 已随之修改。
  - 留意：流式到一半的方言标签（例如还没写完的 `<comment body="…`）按原样片段显示源码，写完后变成方言元素。

- S6（`5fbf30ca4`）：移植 Composer 的编辑组件。`PromptEditor`、`PromptTextView` 与附件条、候选菜单、粘贴块、节点视图从旧应用移植到 `web/components/prompt/`，外观不变，小块换成 `InlineChip`；经服务交出（`components.PromptEditor`、`components.PromptTextView`）。引用、图片与文件的写法改按 Markdown 行内链接的词法认（新的 `shared/link-syntax.ts`，编解码器写地址的函数也挪到这里共用）：目标可以是尖括号里带空格的、带配对括号的、带标题的；任何有文字与地址的链接都是引用小块，图标按目标分类取（`chapter://` 这类旧地址归“其它”）。`@` 菜单的宿主用 `promptReferenceText` 拼以 `/` 开头的作品根地址。文字表从 vue-i18n 改为 `localize`，`locale` 经属性与节点视图的上下文传下去。旧测试 4 份全部移植、期望值不变（小块的标记属性换名是有意改变，测试里注明）；撤销分组用 ProseMirror 历史的 `closeHistory` 边界，不用假时钟；新加 Markdown 链接写法、`@` 菜单（场景 4）、切换语言（场景 5）几例；变异检查：节点视图的语言固定为中文时切换语言那例失败。Lab 加 `PromptEditor`（11 个场景，夹具扮演宿主：假上传、菜单数据、模拟粘贴）、`PromptTextView`、`PromptAttachmentStrip`、`PromptMenuPanel`、`PromptPasteFrame`，`lab:shot` 120 张 0 个问题，截图目视核对过。`e2e/lab-markdown.e2e.ts` 加三例真实键盘（手打技能写完变小块与退格整枚删除、回车发送与上方向键调出、`@` 菜单确认）与粘贴分档，5 例全过。`test:affected --typecheck` 中只有 test-support 的路径测试与 scripts 的 CI 工作流测试失败，两者在 master 上同样失败；生产构建与首屏检查通过。
  - 和计划不同：放在 `web/components/prompt/`（Lab 只扫这里）；`@tiptap/vue-3` 不加进 Vite 预构建清单（会让 `@tiptap/core` 有两份）。计划第 7 节已随之修改。

## 下一步

S7：Spec 补实现合同与证据（晋升 implemented 要开发者批准）；实现阶段的深入审查（先报审查计划与预算）；全量 e2e（含 lab-scenes）、`docs:check`、`governance:check`。
