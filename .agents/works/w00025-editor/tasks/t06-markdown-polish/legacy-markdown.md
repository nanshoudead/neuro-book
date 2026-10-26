# 旧应用的 Markdown 功能与新应用现状

调研范围：旧应用 `packages/neuro-book-legacy/app/components/markdown-studio/`（`TipTapMarkdownEditor.vue`、`MarkdownSelectionMenu.vue`、`MarkdownCommentFlowPanel.vue`、`TipTapFrontmatterPanel.vue`、`tiptap/` 下各扩展）、`app/utils/markdown/render.ts`、`app/components/editor-workbench/MarkdownEditorView.vue`（套壳）与 `app/components/common/form/StructuredTextEditor.vue`（表单内嵌用法）、旧应用 `.agents/tasks/101-markdown-studio-dialect-and-performance/README.md`；新应用 `packages/neuro-book/src/plugins/editor/web/markdown/`、`web/components/MarkdownControl.vue`（同名 `.md`）、`docs/specs/workbench/editor.md`、`docs/specs/workbench/menus.md`。只读调研，未运行代码，部分结论标注“从代码推断”。

日期：2026-10-15。对照的新应用提交：worktree `.worktree/w00025-t03-tabs-and-split` 的 `d0b131745`（2026-10-15）。

调研由 Sonnet 完成；旧应用一侧标注的文件路径均为相对仓库根路径。

## 一、核心编辑行为

### 1.1 Markdown 往返与 frontmatter 隔离

- **用户看到与能做的**：打开 `.md` 文件后，YAML frontmatter（`---` 包裹的头部）折叠显示在正文上方一张独立卡片里，默认折叠，点击展开/收起编辑 YAML 源码；没有 frontmatter 时显示一个“添加”按钮。正文部分是富文本：加粗、标题、列表等直接看到渲染效果，而不是看到 `**x**`、`# ` 等符号。保存、切走、关闭文件如果没有编辑过，磁盘字节不变；编辑后保存，只有编辑过的内容对应的输出变化。
- **旧应用的位置**：`TipTapMarkdownEditor.vue`（`splitMarkdownFrontmatter`/`composeMarkdown`，第 95、131 行起）、`TipTapFrontmatterPanel.vue`（折叠卡片 UI）。
- **依赖**：无额外依赖，纯编辑器内部逻辑。
- **新应用现状**：部分有。frontmatter 拆分与原样回写已有（`source-merge.ts` 的 `splitFrontmatter`），但**没有 frontmatter 面板** —— frontmatter 不进入富文本区，改它要“用源码编辑器重新打开”（`MarkdownControl.md` 的“不支持”一节；`docs/specs/workbench/editor.md` 输出 20）。
- **备注**：旧应用“保存时只有编辑过的行变化”这句话不完全准确——`TipTapMarkdownEditor` 保存时是 `composeMarkdown(readEditorMarkdown(...))`，即 TipTap **整篇重新序列化正文**，不是按行合并；未编辑的行是否字节不变取决于 TipTap 的 Markdown 序列化器是否幂等（列表标记、换行风格等可能被规范化）。新应用的 `source-merge.ts` 做的是**三方合并，只替换真正编辑过的那一段，其余保持原始字节**（`mergeSource`），是比旧应用更严格的保证，见下方“新应用有、旧应用没有”。

### 1.2 撤销历史语义

- **用户看到与能做的**：Ctrl+Z/Ctrl+Y 撤销重做只回溯“我自己在这个视图里的输入”；外部内容变化（文件被别处改写、AI 流式写入覆盖、裁决冲突后采用新内容）不会进入撤销栈，也不会被 Ctrl+Z 撤销掉或者把旧历史错误地重放到新内容上。
- **旧应用的位置**：`TipTapMarkdownEditor.vue` 的 `resetHistoryBaseline`（第 401 行起，手拼历史插件 state 重建）、`update()`（第 415 行起，`addToHistory: false`）。
- **依赖**：无。
- **新应用现状**：有，等价实现。`MarkdownControl.vue` 的 `reload()`（只替换 diff 出的那一段并 `setMeta("addToHistory", false)`）与 `load()`（新建 `EditorState` 重置历史）。新应用用 ProseMirror 官方 diff（`findDiffStart`/`findDiffEnd`）定位差异范围再局部替换，比旧应用手拼 `historyState` 重建更依赖官方 API，风险更低。
- **备注**：无需改动，新应用做法更干净。

### 1.3 输入防抖与保存时机

- **用户看到与能做的**：打字时不会卡顿（即使大文档），停顿后内容才真正提交给文档模型；失焦、Ctrl+S、提交（Enter）、切换文件之前一定会把最新内容结算掉，不会丢失最后一小段输入。
- **旧应用的位置**：`TipTapMarkdownEditor.vue` 的 `useEditorChangeDebounce`（第 189 行起，300ms）；`.agents/tasks/101-markdown-studio-dialect-and-performance/README.md` 的 D1、D11、D13（这是修复过的性能 bug：早期版本每次按键都做一次全文序列化 + 约 4 次全文评论扫描 + 向隐藏 Monaco 推送全文，导致大文档打字 CPU 跑满）。
- **依赖**：无。
- **新应用现状**：有，等价实现。`MarkdownControl.vue` 用 150ms 防抖（`COMMIT_DELAY_MS`），失焦/切文档/卸载前 `commitNow()`。
- **备注**：旧应用的防抖是 300ms，新应用是 150ms，数值差异不影响功能对等；旧应用这段历史说明了"每键全文操作"是真实踩过的坑，新应用从一开始就做了防抖，不需要重新发现这个问题，但如果后续往 `MarkdownControl` 加评论面板之类功能，要留意别重新引入"每键全文扫描"。

### 1.4 并发编辑与冲突裁决（多标签/分屏同一文档）

- **用户看到与能做的**：同一文档在两个标签/分屏窗口里打开，一边输入另一边也能看到（惰性同步，不是实时逐字同步）；如果两边同时编辑产生冲突，有“裁决”流程决定采用哪一份。
- **旧应用的位置**：`MarkdownEditorView.vue`（`change`/`flushPending`/`resolveConflict`，第 50-98 行）。
- **依赖**：宿主的文档修订号机制（`commitChange`/`contentRevision`）。
- **新应用现状**：有，等价实现。`MarkdownControl.vue` 的 `commitNow`/`binding.commit`/`unresolved()`。
- **备注**：两边思路一致（乐观锁 + revision 号 + 冲突保留候选），新应用是 t03（分屏）任务里写的，语义上更贴合"组的实例槽"布局重挂场景（拆分、关闭相邻组时编辑器实例不丢失，撤销历史保留）——这点旧应用未见等价说明，暂标"未确认"：没有继续深入旧应用的 `EditorGroup.vue`/分屏实现确认是否有相同的实例保留机制。

## 二、方言语法（Markdown 扩展书写方式）

这组功能都是"写进 Markdown 源码里的自定义标签，渲染成富文本"。重点是：**新应用已经把这些语法的 schema/解析/序列化逻辑原样搬过来了**（`dialect/*.ts` 与旧应用逐文件对比，除了 import 路径和一处主题变量读取方式，内容完全一致），但**没有搬任何创建这些语法的 UI 入口**（按钮、右键菜单项、斜杠命令）。也就是说：如果一份 Markdown 文件里已经写好了 `<comment>`、`<ruby>` 等标签，新应用打开它能正确渲染；但用户在新应用里没有任何方式"新建"一个评论、注音或对照块。

### 2.1 批注/评论（comment）

- **用户看到与能做的**：选中一段文字，点选区浮动菜单的"添加评论"按钮（或右键菜单 → 添加评论），弹出输入框，输入评论内容后，选区下方出现波浪线下划线标记，并在波浪线右上角显示序号角标；点击标记或在右侧"批注"侧栏面板里点对应条目可以互相跳转定位、编辑、删除。选区跨越多个段落时自动变成"块级评论"（左侧一条色条 + 顶部一行评论正文，包裹住被评论的多个段落），没跨段落则是"行内评论"（只在文字上加波浪线）。Ctrl+点击评论文字可以直接选中激活它（不用先开侧栏）。
- **旧应用的位置**：`tiptap/Comment.ts`（mark `comment` + 块节点 `commentBlock`，第 85、245 行）、`MarkdownCommentFlowPanel.vue`（侧栏列表，360px 宽，带编辑/删除按钮）、`MarkdownSelectionMenu.vue` 第 405 行（浮动菜单按钮）、`TipTapMarkdownEditor.vue` 的 `addComment`/`editActiveComment`/`deleteActiveComment`（第 611-676 行）。Markdown 序列化为 `<comment body="...">正文</comment>`（行内）或开闭标签独立成行（块级）。
- **依赖**：无外部系统依赖，纯编辑器内部状态（评论列表缓存在 ProseMirror 插件状态里，按文档位置排序）。
- **新应用现状**：schema/解析/序列化有（`dialect/Comment.ts` 与旧应用逐行一致，含 ctrl+点击选中的 `handleClick` 逻辑）；**UI 入口没有**——没有浮动菜单、没有侧栏面板、没有右键菜单项，`MarkdownControl.vue` 创建编辑器时也没有传 `comment` 的 `onSelect`/`onCommentsChange` 回调（用默认 no-op）。`MarkdownControl.md` "不支持"一节明确写了"批注侧栏"。
- **备注**：这是旧应用里被重构打磨过两轮的功能（见 101 任务 D1、D2、D14、D15），评论列表与高亮用 ProseMirror 插件状态缓存、docChanged 才全量重扫，这个性能模型值得照搬而不是从零设计。

### 2.2 注音（ruby，拼音/假名等词语级标注）

- **用户看到与能做的**：选中文字，点更多菜单里的"注音"按钮，输入标注文本（如拼音），文字上方出现小字标注（浏览器原生 ruby 排版）；输入留空则移除标注。
- **旧应用的位置**：`tiptap/MarkdownRuby.ts`（mark，属性式语法 `<ruby text="hàn zì">汉字</ruby>`，兼容标准 HTML 形式 `<ruby>汉字<rt>...</rt></ruby>`）、`MarkdownSelectionMenu.vue` 第 484 行（更多菜单里的按钮）。
- **依赖**：无。
- **新应用现状**：schema/解析/序列化有（`dialect/MarkdownRuby.ts`，与旧应用唯一差异是 import 路径）；UI 入口没有。
- **备注**：局限（旧应用已知、未解决）：mark 被其它格式打断时 `<rt>` 标注会随文字片段重复渲染，方言文档里已注明"标注内保持纯文本"。这是搬 UI 时要一并告知用户的边界，不是新应用的新问题。

### 2.3 双语对照（bilingual，段落级）

- **用户看到与能做的**：给整段文字添加/编辑对照译文，已在对照块内再次操作、留空则解除对照；渲染时译文以弱色小字行显示在原文段落上方。
- **旧应用的位置**：`tiptap/MarkdownBilingual.ts`（块节点 `<bilingual text="...">正文</bilingual>`）、`MarkdownSelectionMenu.vue` 第 493 行。
- **依赖**：无。
- **新应用现状**：schema/解析/序列化有（`dialect/MarkdownBilingual.ts`，仅 import 路径差异）；UI 入口没有。

### 2.4 对齐（align：左/中/右/两端）

- **用户看到与能做的**：选中段落，点更多菜单里的对齐按钮（左/中/右/两端对齐），整段文字按方向排版；左对齐等同取消对齐包装。
- **旧应用的位置**：`tiptap/MarkdownAlign.ts`（块节点 `<align value="center">...</align>`）、`MarkdownSelectionMenu.vue` 第 500-511 行。
- **依赖**：无。
- **新应用现状**：schema/解析/序列化有（`dialect/MarkdownAlign.ts`，仅 import 路径差异）；UI 入口没有。

### 2.5 文字颜色 / 高亮 / 上标 / 下标

- **用户看到与能做的**：选区浮动菜单的调色板按钮，分别选"文字颜色"和"高亮底色"的预设色板（各 10 种，含"默认/无"选项）；更多菜单里有上标、下标切换按钮。
- **旧应用的位置**：`tiptap/MarkdownTextMarks.ts`（4 个 mark：`markdownTextColor`→`<span style="color:...">`、`markdownHighlight`→`<mark style="background-color:...">`、`markdownSuperscript`→`<sup>`、`markdownSubscript`→`<sub>`）、`MarkdownSelectionMenu.vue` 第 57-81、412-454、466-479 行（色板定义与下拉 UI）。
- **依赖**：无。
- **新应用现状**：schema/解析/序列化有（`dialect/MarkdownTextMarks.ts`，与旧应用**逐字节相同**，`diff` 无输出）；UI 入口没有，没有色板组件。

### 2.6 显式 HTML 嵌入（`<html>` 块，带沙箱渲染）

- **用户看到与能做的**：写一段 `<html>...</html>`（开闭标签独立成行）在正文里，默认显示为一张"源码卡片"（低调样式，显示原始 HTML 源码，限高滚动）；点击卡片上的"渲染"按钮切换成 iframe 渲染（沙箱隔离，脚本能跑但拿不到 NeuroBook 的 DOM/cookie/存储），点"查看源码"切回去。这是唯一"可渲染"的 HTML 语法。
- **旧应用的位置**：`tiptap/HtmlEmbed.ts`（NodeView 挂 DOM 按钮与 iframe，`sandbox="allow-scripts"`，postMessage bridge）。
- **依赖**：无外部系统；预留了"数据接口"注入点（`resolveDataApi`），当前默认未注入（iframe 内请求统一被拒绝）。
- **新应用现状**：几乎逐字节搬过来了（`dialect/HtmlEmbed.ts`）。唯一差异：读取主题变量（iframe 内文字颜色/字体）时，旧应用从编辑器所在的 `THEME_HOST_SELECTOR` 容器读 CSS 变量，新应用改成直接从 `document.documentElement` 读（注释说明新应用的主题 token 写在文档根上）。**这一条功能链路（NodeView + iframe + postMessage）是完整可用的**——没有被 UI 入口缺失挡住，因为它不需要选区菜单或侧栏，只要 Markdown 源码里有 `<html>` 块就能工作。
- **备注**：旧应用这段功能经历过一次用户反馈返工（101 任务 D9）：首版"任意未知标签都能渲染"误伤面太大（空文件因 `<br>` 残留被误判成 HTML 卡片），改成只有显式 `<html>` 块才能渲染，未知标签兜底降级为纯源码块（见 2.7）。新应用照搬的是修复后的版本，这个坑不需要重踩。

### 2.7 未知 HTML / XML 标签兜底（防止静默丢数据）

- **用户看到与能做的**：用户看不到"功能"本身，而是看到"数据不丢"的效果——正文里写了方言语法之外的 HTML/XML 标签（完整的、残缺的、未闭合的都算），保存后再打开，标签原样还在（显示为源码块或 `code` 风格的 chip），不会被静默剥掉只剩文字。
- **旧应用的位置**：`tiptap/HtmlFallback.ts`（三件套：`HtmlBlock` 块级兜底源码块、`HtmlBlockBridge` 接管 marked 原生 html token 的截断形态、`RawInlineHtml` 行内兜底 chip）。
- **依赖**：无。
- **新应用现状**：逐字节搬过来了（`dialect/HtmlFallback.ts`，仅 import 路径差异）。
- **备注**：这是旧应用修复过的一个真实数据丢失 bug（101 任务用户反馈点 6），其判据相当精细（tokenizer 执行顺序陷阱、marked 段落中断伪装陷阱、标签名单并集不变量等，见该任务 D3-D5、D14、D15），新应用直接继承了这些判据，不需要重新踩坑，但以后如果要新增别的方言块语法，要注意把新标签名加入 `KNOWN_BLOCK_EXCLUDED_TAGS` 等排除名单，否则会被这套兜底机制错误吞掉。

### 2.8 行内代码快捷输入（反引号包裹选区/光标前文字）

- **用户看到与能做的**：选中文字后输入反引号 `` ` ``，直接把选中文字转成行内代码；或者先在某段文字后面打一个反引号，再把光标移到这段文字前面打一个反引号，中间的文字也会变成行内代码。只支持单行、不含反引号的内容。
- **旧应用的位置**：`tiptap/MarkdownInlineCodeShortcut.ts`。
- **依赖**：无。
- **新应用现状**：逐字节搬过来了（`dialect/MarkdownInlineCodeShortcut.ts`）。

### 2.9 硬换行、链接、段落 schema 基座

- **用户看到与能做的**：Shift+Enter 换行序列化为单个 `\n`（不是 Markdown 标准的行尾两空格写法，避免改写原文已有的硬换行）；点击链接的行为两边不同（见下）；空文档/删空内容时正确回退成空段落而不是其它方言节点。
- **旧应用的位置**：`AgentHardBreak`（novel-ide 模块，未在本次范围深入）、`tiptap/MarkdownLink.ts`（`openOnClick: true`，点击打开链接）、`tiptap/MarkdownParagraph.ts`（priority 1500，修复"空文档被填充成空 HTML 卡片"的 bug，101 任务 D10）。
- **依赖**：硬换行扩展在旧应用里挂在 Agent 模块下（`novel-ide/agent/tiptap/AgentHardBreak`），新应用重新实现了等价逻辑，不依赖 Agent 模块。
- **新应用现状**：硬换行、段落 schema 基座有等价实现（`MarkdownHardBreak`，就地定义在 `markdown-editor-extensions.ts`；`dialect/MarkdownParagraph.ts` 与旧应用一致，priority 1500 的坑和注释都保留了）。链接点击行为**故意不同**：新应用 `openOnClick: false`（注释："点击不打开：编辑器里点链接是要编辑它；打开引用随引用插件再定"），旧应用是 `openOnClick: true`。

## 三、写作工具与引用（依赖新应用还没有的系统）

这组功能全部依赖"Agent 触发菜单"（`novel-ide/agent/trigger-menu`、`agent-suggestion`）或"工作区引用解析"（工作区树、角色/地点/规则档案），新应用目前都还没有这些系统，因此这组是**整体性缺失**，不是漏搬，是旧应用自己在 `markdown-editor-extensions.ts` 文件头的注释里说明过的"不迁移"的部分（新应用 `markdown-editor-extensions.ts` 第 1-5 行注释：旧应用的 Agent 触发菜单、斜杠命令、行内 AI 引用与工作区引用标签不迁，它们依赖新应用还没有的服务）。

### 3.1 斜杠命令（`/`，快速插入/转换区块）

- **用户看到与能做的**：输入 `/` 弹出命令菜单（可过滤），选中后把当前文字转成标题/列表/引用/代码块/分割线，或插入 `@` 引用触发符、插入评论模板。
- **旧应用的位置**：`tiptap/MarkdownSlashCommand.ts`（基于 `@tiptap/suggestion`）。
- **依赖**：Agent 触发菜单解析器（`resolveMenu`）。
- **新应用现状**：没有。

### 3.2 `@` 工作区引用（引用章节/人物/地点/规则等领域对象，带可视化 chip）

- **用户看到与能做的**：输入 `@` 弹出引用候选菜单，选中后插入一个"芯片"样式的内联节点（带图标、类型徽标），Ctrl+点击或双击可以跳转到被引用的对象；Backspace/Delete 在芯片边界会先把它"退化"回普通 Markdown 链接文本方便继续编辑，而不是直接整体删除。
- **旧应用的位置**：`tiptap/WorkspaceReference.ts`（NodeView + Suggestion 插件）。
- **依赖**：工作区树解析器（`resolveReference`）、Agent 触发菜单。
- **新应用现状**：没有。工作区/领域链接目前按**普通 Markdown 链接**原样保留源码（`markdown-editor-extensions.ts` 文件头注释）。

### 3.3 Inline AI 引用高亮（PromptBar 引用 chip 在正文里的反向高亮）

- **用户看到与能做的**：在 AI 对话框里引用了正文的某段文字后，正文里对应位置会被标记高亮（细节：全部引用都有基础标记，鼠标悬停在某条引用上时它对应的正文位置会叠加更强的背景色）；即使文字位置因为编辑发生偏移，也有文本匹配 + 行号兜底的定位策略。
- **旧应用的位置**：`tiptap/InlineAiReferenceHighlight.ts`（三级回退定位：精确文本匹配 → 选区 offset 消歧 → 行号整块兜底）。
- **依赖**：PromptBar/Agent 对话系统（提供 `inlineAiReferences`）。
- **新应用现状**：没有。

### 3.4 Agent 快速触发 / 技能（Quick Triggers）

- **用户看到与能做的**：`enableQuickTriggers` 开启时多一种触发菜单（`AgentSkill` 节点），具体交互未深入（本次范围未读 `novel-ide/agent/tiptap/AgentSkillNode`）。
- **旧应用的位置**：`markdown-editor-extensions.ts` 第 98 行起（`enableQuickTriggers` 条件注册）。
- **依赖**：Agent 系统。
- **新应用现状**：没有。标为"未确认"：没有深入读 `AgentSkillNode` 的具体交互，只确认了它依赖 Agent 系统、新应用没有对应物。

### 3.5 frontmatter 专属档案表单（角色/地点/规则）

- **用户看到与能做的**：frontmatter 的 `type` 字段是 `character`/`location`/`rule` 时，折叠卡片上多一个"编辑档案"图标按钮，点击打开对应类型的专属结构化表单（不是直接编辑 YAML）。
- **旧应用的位置**：`TipTapFrontmatterPanel.vue`（`profileKind`/`openProfile`，第 30-41、64-69 行）、`TipTapMarkdownEditor.vue` 的 `frontmatterProfileKind`（第 330 行起）。
- **依赖**：角色/地点/规则档案系统（`FrontmatterProfileKind`）、frontmatter 面板本身（新应用没有，见 1.1）。
- **新应用现状**：没有（前置依赖 frontmatter 面板已经没有）。

## 四、导航

### 4.1 标题大纲 / 面包屑标题跳转

- **用户看到与能做的**：面包屑最后一段显示光标所在的标题，点开下拉列出本章全部标题（按层级缩进，当前标题高亮），选中跳转到对应位置并滚动过去。
- **旧应用的位置**：`EditorBreadcrumbs.vue`（通用"附加符号节点"扩展点，第 19 行注释提到"例如 Markdown 标题大纲"）。**未确认**：本次没有深入读完 `EditorBreadcrumbs.vue` 消费端与它上游是谁在喂 Markdown 标题数据，不能确认旧应用这条链路是否真的接通、交互细节是否与新应用一致。
- **依赖**：无（纯编辑器内部，扫描 `heading` 节点）。
- **新应用现状**：有，而且是本次调研中唯一一处新应用明确"做了"的功能。`MarkdownControl.vue` 的 `outline`/`revealHeading`/`headingPositions`（第 204-249 行），`docs/specs/workbench/editor.md` 输出 60 对面包屑标题下拉有完整合同（缩进层级、当前高亮、键盘操作、读取中/空/失败态）。
- **备注**：由于旧应用这条链路本次没有确认完整，不写进"新应用有、旧应用没有"列表，只标注为大纲功能在两边都存在、新应用这边的合同更完整。

### 4.2 字数统计

- **用户看到与能做的**：打开/切换文档立即显示字数；输入时停手一段时间后更新。
- **旧应用的位置**：`markdown-editor.types.ts`、`TipTapMarkdownEditor.vue` 提及 wordCount 概念，但本次未深入字数算法具体文件（在 `novel-ide` store 层，范围之外）。
- **依赖**：无。
- **新应用现状**：有。`docs/specs/workbench/editor.md` 输出 27 有完整算法合同（汉字/假名/谚文每字计 1，拉丁字母数字连续计 1 词，frontmatter 不计，300ms 停手更新）。
- **备注**：两边都有，细节算法未逐一对比，不计入缺口。

### 4.3 光标位置与"上次光标"记忆

- **用户看到与能做的**：重新打开文档，光标回到上次编辑的位置并自动滚动过去。
- **旧应用的位置**：未深入确认具体存储位置（推断在 `novel-ide` store，范围之外）。
- **新应用现状**：有，合同完整（`docs/specs/workbench/editor.md` 输出 30，`MarkdownControl.vue` 的 `rememberCursor`/`cursor` 处理）。Markdown 富文本"不给出行列号"（输出 28，因为 frontmatter 和写出格式会改变行号），这点两边应该一致（旧应用右键菜单、选区菜单都没有行列号显示）。

## 五、菜单与工具栏

### 5.1 选区浮动气泡菜单（Bubble Menu）

- **用户看到与能做的**：选中文字后，选区上方弹出一条工具条：左边一个"AI 改写/添加引用"的强调按钮，然后是文本样式下拉（段落/H1-H3/列表/引用/代码块）、加粗/斜体/下划线/删除线/行内代码/清除格式图标按钮、链接/评论/图片按钮、颜色下拉、更多菜单（上标/下标/注音/对照/对齐/列表缩进）。空选区（光标但没有选中文字）时整条菜单不显示；只读模式、编辑器未聚焦时也不显示。
- **旧应用的位置**：`MarkdownSelectionMenu.vue`（整个文件）、挂载在 `TipTapMarkdownEditor.vue` 第 1292-1302 行。
- **依赖**：评论、注音、对照、`@` 引用插入都依赖对应的方言/Agent 功能（见二、三节），格式按钮不依赖外部系统。
- **新应用现状**：没有。`MarkdownControl.md` "不支持"明确列出"选区浮动菜单"。
- **备注**：这是本次调研里"按钮最多、最直接影响日常写作体验"的单个组件——没有它，加粗/斜体等基础格式化只能靠键盘快捷键（Tiptap StarterKit 默认绑定 Mod-B/Mod-I 等，从代码推断仍然可用，但不可发现、鼠标用户完全找不到入口）。

### 5.2 正文右键菜单

- **用户看到与能做的**：在富文本区右键，弹出应用自己风格的菜单：保存、撤销/重做（带快捷键提示）、剪切/复制/粘贴、插入引用/链接/图片、添加评论/注音/对照，光标在已有评论上时还会多出"编辑评论/删除评论"两项；菜单项按能否执行（如是否有选区、是否只读）置灰。
- **旧应用的位置**：`TipTapMarkdownEditor.vue` 的 `buildContextMenuItems`/`openEditorContextMenu`（第 1015-1068 行），用应用通用的 `ContextMenu` 组件渲染。
- **依赖**：评论/注音/对照依赖方言功能本身（已有 schema，缺 UI）；其余（撤销/重做/剪切复制粘贴/保存）不依赖外部系统。
- **新应用现状**：没有。这正是 t06 本次任务要新定义的功能（`docs/specs/workbench/editor.md` 不承诺列表第一条："正文的右键菜单，随第一个往里加东西的插件定义菜单位置"；`docs/specs/workbench/menus.md` 第 20 行同样把"编辑器正文右键"列为待定位置）。目前右键是**浏览器原生菜单**。
- **备注**：旧应用这份菜单项列表可以直接作为新应用定义 `editor.content-context` 菜单位置时的候选起点，但"评论/注音/对照"三项在新应用里暂时没有对应能力可挂（除非先做选区菜单或先把评论能力的 UI 层补上）。

### 5.3 批注侧栏面板

见 2.1 已描述交互；旧应用位置 `MarkdownCommentFlowPanel.vue`，依赖评论功能本身；新应用没有。侧栏宽度 360px，窄容器（<700px）下覆盖正文显示并可关闭（`MarkdownEditorView.vue` 第 157-161 行的 `@container` 样式）。

### 5.4 frontmatter 折叠面板

见 1.1；旧应用位置 `TipTapFrontmatterPanel.vue`；新应用没有，frontmatter 改动目前只能切到源码编辑器（Monaco）。

### 5.5 格式工具栏（固定可见，非选区触发）+ 富文本/源码模式切换

- **用户看到与能做的**：在表单里嵌入的 Markdown 字段（例如角色/地点的简介字段，不是正文文档）上方有一条固定工具条：左边是"富文本模式/源码模式"两个图标按钮（直接切换，不是"重新打开"），右边是加粗/斜体/下划线/删除线/行内代码/标题/列表/引用/清除格式等按钮（容器变窄时自动收缩成只显示"核心"按钮）。
- **旧应用的位置**：`app/components/common/form/StructuredTextEditor.vue`（第 101-230 行起，`modeButtons`/`formatButtons`/`showFormatTools`）。这个组件不是正文主编辑器，是表单里短字段用的包装层，底层仍然是 `TipTapMarkdownEditor`/Monaco 两个编辑器按需挂载。
- **依赖**：底层富文本/源码两个编辑器控件本身。
- **新应用现状**：主文档编辑场景里，"富文本/源码"切换是**按标签的"重新打开方式"**实现的（`docs/specs/workbench/editor.md` 输出 20"Markdown 也可以用源码编辑器重新打开，选择记在标签上"），不是同一视图里的模式切换按钮；也没有发现新应用里有等价于 `StructuredTextEditor` 的"表单内嵌 Markdown 字段+固定工具条"组件（本次调研范围未检查新应用是否已有角色/地点等表单，**未确认**：如果新应用还没做到这类表单字段，这条差距暂时不适用）。
- **备注**：旧应用这个固定工具栏调用的命令（`applyMarkdownFormat`）在整个旧应用代码库里**只有这一个消费者**（`grep` 结果只命中 `markdown-editor.types.ts`、`TipTapMarkdownEditor.vue` 自身定义和 `StructuredTextEditor.vue`），也就是说旧应用的**主文档编辑器从未在 UI 上提供过固定格式工具栏**——`EditorToolbar.vue`（t06 README 候选列表提到的那个）是编辑组标签栏通用的"动作+更多菜单"组件，不是 Markdown 专属格式工具栏，不要把它和"加粗/斜体工具栏"的需求混为一谈。

## 六、性能与同步（内部机制，非直接可见功能，但影响"深度打磨"的实现路线）

| 问题 | 旧应用的发现与修复 | 新应用现状 |
| --- | --- | --- |
| 每键全文序列化/全文评论扫描导致大文档打字 CPU 跑满 | 101 任务 D1、D13：引入防抖（300ms）+ 评论列表/高亮 decoration 缓存进 ProseMirror 插件状态，docChanged 才全量重扫 | 新应用从一开始就有防抖（150ms，`MarkdownControl.vue`）；但因为没有搬评论 UI，暂时没有"评论列表缓存"这个场景需要验证——补评论功能时要照搬这个缓存模型，不要重新从头每次扫描 |
| marked tokenizer 执行顺序陷阱（后注册先执行，与 TipTap priority 顺序相反） | 101 任务 D3：固化规则，写进 `markdown-dialect-extensions.ts`/`HtmlFallback.ts` 文件头注释 | 新应用 `markdown-dialect-extensions.ts` 文件头注释原样保留了这条规则 |
| marked 段落中断检测把 `src.slice(1)` 伪装成字符串开头，导致块级标签误判 | 101 任务 D4：`findMarkdownBlockTagStart` 封装，只认 `\n<tag>\n` 形式 | `markdown-workbench.ts`（新应用 shared 层）未逐行比对，**未确认**是否原样保留；dialect 文件引用了同名函数，推断逻辑已带过来 |
| 空文档/删空内容被错误填充成空 `htmlBlock`（而不是空段落） | 101 任务 D10：`MarkdownParagraph` priority 提到 1500，立规则"新增块级扩展 priority 不得超过 1500" | 新应用 `dialect/MarkdownParagraph.ts` 与旧应用逐字节一致，注释完整保留 |
| 混合形态（标签黏着正文、跨行残片）被 DOM 解析静默丢数据 | 101 任务 D14、D15：读时规范化 + 名单拆分 + 残片捕获三重修复 | `HtmlFallback.ts`/`markdown-workbench.ts` 的判据注释原样保留，推断逻辑已带过来，但**新应用是否有对应的 `normalizeMarkdownDialectBlocks` 全部三重守卫测试未逐一比对**（标为未确认） |

备注：这一组不是"用户可见功能"，但旧应用的 101 任务文档本身就是一份详细的"这里有坑、怎么踩的、怎么修的"记录，新应用在往方言 UI 层补功能（评论面板、选区菜单、斜杠命令）时会重新碰到这些坑（尤其是评论的缓存模型），建议补功能前先读一次该任务文档而不是凭空重新设计。

## 总表

| 功能 | 旧应用 | 新应用 | 依赖 | 一句话说明 |
| --- | --- | --- | --- | --- |
| frontmatter 折叠编辑面板 | 有 | 没有 | 无 | 新应用改 frontmatter 要切到源码编辑器 |
| frontmatter 专属档案表单入口 | 有 | 没有 | 角色/地点/规则档案系统 + frontmatter 面板 | 前置依赖都没有 |
| 撤销历史的"外部内容不入栈"语义 | 有 | 有（等价实现） | 无 | — |
| 输入防抖 + 强制结算时机 | 有 | 有（等价实现） | 无 | 新应用 150ms，旧应用 300ms |
| 多视图冲突裁决 | 有 | 有（等价实现） | 宿主修订号机制 | — |
| 评论/批注（数据模型） | 有 | 有（schema 原样搬运） | 无 | 能解析渲染已有评论，不能新建 |
| 评论/批注（创建 UI：浮动菜单按钮、右键菜单项、侧栏面板） | 有 | 没有 | 评论数据模型（已有） | 本次最大的单项缺口 |
| 注音 ruby（数据模型） | 有 | 有（schema 原样搬运） | 无 | 同上，缺创建 UI |
| 双语对照 bilingual（数据模型） | 有 | 有（schema 原样搬运） | 无 | 同上，缺创建 UI |
| 对齐 align（数据模型） | 有 | 有（schema 原样搬运） | 无 | 同上，缺创建 UI |
| 文字颜色/高亮/上标/下标（数据模型） | 有 | 有（schema 原样搬运） | 无 | 同上，缺创建 UI（无色板组件） |
| 显式 HTML 嵌入渲染（`<html>` 块 + 沙箱 iframe） | 有 | 有（功能完整，不缺 UI） | 无 | 不需要选区菜单即可工作 |
| 未知 HTML 兜底（防丢数据） | 有 | 有（功能完整） | 无 | — |
| 行内代码反引号快捷输入 | 有 | 有（功能完整） | 无 | — |
| 选区浮动气泡菜单 | 有 | 没有 | 部分功能依赖评论/注音/对照 | 日常写作最常摸到的入口缺失 |
| 正文右键菜单（应用风格） | 有 | 没有（浏览器原生菜单） | 部分菜单项依赖评论/注音/对照 | t06 本次任务的核心目标 |
| 斜杠命令 | 有 | 没有 | Agent 触发菜单 | 依赖系统未就位 |
| `@` 工作区引用 chip | 有 | 没有 | 工作区树解析、Agent 触发菜单 | 依赖系统未就位，暂退化为普通链接 |
| Inline AI 引用高亮 | 有 | 没有 | Agent/PromptBar 系统 | 依赖系统未就位 |
| Agent 快速触发/技能 | 有 | 没有 | Agent 系统 | 依赖系统未就位 |
| 标题大纲/面包屑跳转 | 有（链路未逐一确认） | 有（合同完整） | 无 | 新应用这边已做，合同比旧应用确认得更清楚 |
| 字数统计 | 有 | 有 | 无 | 两边都有，算法细节未逐一比对 |
| 上次光标记忆 | 有（细节未深入） | 有（合同完整） | 无 | — |
| 固定格式工具栏（表单内嵌 Markdown 字段用） | 有（`StructuredTextEditor.vue`，非主文档编辑器） | 未确认 | 底层富文本/源码控件 | 主文档编辑器本身旧应用也没有固定工具栏 |
| 三方合并保存（只换编辑过的行，其余保持原始字节） | 没有（整篇重新序列化） | 有 | 无 | 见下方"新应用有、旧应用没有" |

## 新应用有、旧应用没有的功能

- **三方合并保存**：新应用 `source-merge.ts` 的 `mergeSource` 只把编辑过的那一段换成编辑器的写法，其余部分保持磁盘原始字节（含换行符、列表标记、方言写法等）；旧应用 `TipTapMarkdownEditor.vue` 保存时是 TipTap 对整篇正文重新序列化，未编辑部分是否逐字节不变取决于序列化器是否幂等，没有旧应用文档明确承诺这一点。这是 `docs/specs/workbench/editor.md` 输出 19 的明文合同（"未编辑的行字节不变"），新应用比旧应用的保证更强。
- **标题大纲/面包屑的完整黑盒合同**：新应用 `docs/specs/workbench/editor.md` 输出 60 把大纲下拉的交互（缩进层级、当前高亮、键盘操作、各种边界状态）写成了验收级合同；旧应用本次调研没有找到同等精确度的文档（`EditorBreadcrumbs.vue` 只是通用扩展点），不确定旧应用这块功能的边界是否同样清楚。

## 需要主 Agent 核实的地方（本次调研拿不准）

1. 旧应用 `EditorBreadcrumbs.vue` 的"附加符号节点"扩展点是否真的接上了 Markdown 标题数据、交互细节是否与新应用一致——本次只读到组件本身，没有追踪它的数据来源（可能在 `novel-ide` store 或某个 composable 里）。
2. 新应用 `markdown-workbench.ts`（shared 层，parse/render 基建）是否完整带过来了 101 任务 D4、D14、D15 的三重规范化守卫（`findMarkdownBlockTagStart`、`normalizeMarkdownDialectBlocks` 的逻辑行首判据、fence 感知等）——本次只确认了 dialect 扩展文件引用了同名函数，没有逐行 diff `markdown-workbench.ts` 本身。
3. 新应用是否已经有类似旧应用 `StructuredTextEditor.vue` 的"表单内嵌 Markdown 字段"场景（角色/地点简介等）——如果还没有这类表单，固定格式工具栏这条差距暂时不适用，优先级应该让给选区菜单/右键菜单。
4. `AgentSkillNode`（Quick Triggers）的具体交互没有深入读，只确认了依赖关系和新应用缺失的事实，没有确认它和斜杠命令、`@` 引用在交互上的区别。
5. 旧应用 `openOnClick: true`（点击链接跳转）与新应用 `openOnClick: false`（点击链接是编辑它）是故意的设计差异还是旧应用的遗留行为，取决于开发者对"工作区引用"将来接入时点击链接应该跳转还是编辑的产品判断，本次没有找到明确拍板记录。

## 主 Agent 的核实与补充（2026-10-15）

- **“需要核实”第 2 条已核实**：新应用 `web/markdown/markdown-workbench.ts` 与旧应用 `packages/neuro-book-legacy/shared/markdown-workbench.ts` 去掉 import 行后完全相同（都是 391 行），D4、D14、D15 的守卫都在；`markdown-dialect.test.ts` 有 `normalizeMarkdownDialectBlocks` 的用例。
- **“需要核实”第 3 条**：新应用还没有角色、地点这类表单，固定格式工具栏这一条暂不适用。
- **“需要核实”第 5 条**：新应用 `markdown-editor-extensions.ts` 的注释写明点链接是编辑它，打开引用随引用插件再定，是有意的改动。
- **修正 3.1 斜杠命令的依赖**：旧实现借用了 Agent 触发菜单的弹出与过滤（`novel-ide/agent/trigger-menu`、`agent-suggestion`），但转标题、列表、引用、代码块、分割线这些命令本身不依赖 Agent，可以只做这一部分，弹出菜单自己写或用 nb-ui 的组件。
- **补充：图片与表格**：两边都装了 `@tiptap/extension-image` 与 `TableKit`，所以已有的图片与表格能显示、能编辑单元格文字；但新应用没有插入图片、插入表格、增删行列的入口。旧应用插图是右键菜单里的“插入图片”，弹框输入地址（`TipTapMarkdownEditor.vue` 的 `insertImageFromMenu`），没有表格入口。两边都没有把相对路径的图片（例如 `![](../images/a.png)`）换成项目里的文件地址（从代码推断：没找到改写 `src` 的地方），这类图片在富文本里大概率显示不出来，待在页面上确认。
- **补充：链接**：旧应用的链接按钮在选区浮动菜单里；新应用能显示链接、点了是编辑文字，但没有插入链接、改链接地址的入口。
