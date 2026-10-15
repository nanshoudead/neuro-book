# t06 实施计划：Markdown 读写重做与常用方言

## Context

- **为什么做**：实验（[conversion.md](conversion.md)）在现有的 Markdown 富文本编辑器里测出 8 类会改坏内容的问题（中文引号旁的粗体丢失、改一项列表拆成几个、任务列表让编辑器出错、表格丢数据与写进控制字符、脚注与引用式链接变形、实体变字面、行首文字变块语法），根因是写出不保留写法、写出后不读回校验、解析结果不校验、按行合并而结构按块。开发者 2026-10-15 决定重做转换并加上常用方言，可以重构或重写，先搭好代码结构。
- **合同**：`workspace.markdown-dialect`（t06 分支的 `docs/specs/workspace/markdown-dialect.md`，`planned`，下称“方言 Spec”）；[`workbench.editor`](../../../../../docs/specs/workbench/editor.md) 输出 13、14、19、27。
- **开发者已确认**（[README](README.md) 的“开发者的决定”7–12）：不换 `@tiptap/markdown`；只做富文本；中文强调放宽、只有 `~~` 是删除线、段内单换行是换行；任务列表正式支持、脚注原样保留；新加提示块与 `==高亮==`；批注分截；写不出读得回来的内容时保存失败。
- **工作方式**：worktree `.worktree/w00025-t06-markdown-polish`（分支 `feat/w00025-t06-markdown-polish`，从 t03 拉出，随 Work 一次合入）。主会话编码；逐片自跑验证后提交，只暂存本片文件。审查按深入审查（开发者 2026-10-15 批准的三轮：设计、转换核心、收尾），见 README。

## 关键设计

### 1. 总体：一个编解码器，编辑器只经它读写

现在编辑器用 `@tiptap/markdown` 的 `setContent(…, {contentType: "markdown"})` 读、`getMarkdown()` 写，再用 `source-merge.ts` 按行三方合并。改为一个与编辑器无关的**编解码器**：

```ts
// web/markdown/codec/codec.ts
interface MarkdownCodec {
    readonly schema: Schema;
    /** 读：frontmatter 前缀、文档、每个顶层节点的来源。永不失败（方言 Spec 输出 9）。 */
    read(source: string): ReadResult;
    /** 写：不变的块写原文，变了的块重新写出并读回校验（输出 1–3）。 */
    write(doc: PMNode, read: ReadResult): {ok: true; text: string} | {ok: false; code: "unrepresentable"; block: number};
}
interface ReadResult {
    readonly prefix: string;               // BOM 与 frontmatter，原样
    readonly doc: PMNode;
    readonly origins: Origins;             // 顶层节点对象 → 来源
}
```

- 编解码器按扩展组建一次、全应用共用（模块级单例），自己 `new Marked()` 一个实例交给 `MarkdownManager({marked})`。现在每个编辑器都把全部方言分词规则 `use()` 进全局的 `marked`，开的编辑器越多重复登记越多（从 `@tiptap/markdown` 的 `registerTokenizer` 读出）；改后全局 `marked` 不再被改动。
- 编辑器不再装 `@tiptap/markdown` 的 `Markdown` 扩展（不再用 `getMarkdown`、`setContent` 的 markdown 模式）；粘贴 Markdown 以后经编解码器的 `read` 做。
- 不变量：编解码器不依赖 DOM 与 Vue，在 `bun test` 里直接测。

### 2. `web/markdown/codec/source.ts`：原文、规范化与分块

- `splitFrontmatter` 从 `source-merge.ts` 搬来，行为不变。
- **规范化带偏移表**：`normalize(body) → {text, toSource(offset)}`。两件事：CRLF 换成 LF（`marked` 自己也会这样做，提前做以便记偏移）；宽容写法（方言 Spec 输出 17）在开标签前补空行。规范化只插入或删除字符，偏移表记下每处改动，任意规范化后的偏移能换回原文偏移。现在的 `normalizeMarkdownDialectBlocks` 判据整体沿用（含 fence 与缩进代码的跳过），移进这里。
- **分块**：用编解码器的词法器 `lex` 规范化后的文字，取顶层词法单元。已核实：顶层单元的 `raw` 依次拼接等于输入（LF 文字）。每个非 `space` 单元是一块；块的原文是经偏移表换回的原文切片（含 CR、含宽容写法里没有的那个空行之外的原字节），块之间的原文切片是间隔。引用定义（`def` 单元）也是块。
- 不变量：所有块与间隔的原文切片依次拼接，等于正文原文（逐字节）。这是输出 1 的基础，单独有测试。

### 3. `web/markdown/codec/read.ts`：逐块解析与来源

- 每块单独交给 `MarkdownManager` 解析成节点（一块可能得到零到多个节点）。引用定义是全篇共享的：解析每块时把全篇的定义作为链接表交给词法器（S1 先用“在块后附上全篇定义行”的做法，`def` 单元不产出节点；若 `marked` 的 `Lexer` 能直接接收 `links` 表就改用它）。
- `space` 单元：多出来的空行按 `@tiptap/markdown` 现在的规则成为空段落（与现状一致）；这些空段落也有来源，原文是对应的那段空行。
- **校验**：每块解析出的节点逐个 `check()`；不合 schema 的那一块整体换成原样块（输出 9 最后一项），原文是这块的切片。
- **实体解码**：解析后在正文的文字节点（代码以外）里解码 HTML 实体，`&nbsp;` 成为 U+00A0（输出 4）。
- **来源**：`Origins` 记每个顶层节点对象的 `{index, raw, gapBefore}`：`index` 是它在读入时的顶层序号，`raw` 是它独占的原文（一块产出几个节点时，原文给第一个，其余为空串并标记属于同一块），`gapBefore` 是它前面的间隔原文。

### 4. `web/markdown/codec/write.ts`：以块为单位写回

- ProseMirror 的节点不可变：编辑某处只替换那里的节点，其余顶层子节点还是读入时的同一个对象。依次走当前文档的顶层子节点：
  - 来源表里有它、并且同一块的节点都还在且相邻、上下文没变（见下）：写原文；
  - 否则重新写出这一块（第 5、6 节），然后读回校验。
- **间隔**：两个相邻的顶层节点在读入时也相邻（`index` 连续）时，写原来的间隔；否则写一个空行。开头与末尾同理：第一个节点仍是原来的第一个时写原来的开头间隔；最后一个仍是原来的最后一个时写原来的结尾（含末尾有无换行），否则按原文末尾有无换行决定。
- **换行符**：重新写出的块与新间隔用原文里用得多的换行符（沿用 `source-merge.ts` 的 `dominantEol`）。
- **上下文依赖**：一块的写法依赖别的块时，即使节点没变也要重新写出。现在只有一种：分截批注的 `body` 写在第一截（输出 11）。写出前先算出每个批注 `id` 的第一截在哪一块；原文里不是第一截、现在成了第一截（或反过来）的块重新写出。
- **读回校验**（输出 3）：重新写出的块，用同一套读的流程读回，节点与原节点 `eq`（含写法属性，见第 6 节）才接受。不等时按顺序换写法再试：最小转义 → 完全转义（每个 Markdown 标点都转义）→ 强调与删除线改写成 HTML 形式（`<strong>`、`<em>`、`<del>`）；都不等就返回 `unrepresentable` 与块号。
- 删掉 `source-merge.ts` 的 `mergeSource` 与它的按行合并。

### 5. `web/markdown/codec/render/`：自己的写出器

`@tiptap/markdown` 的写出把正文转义放在私有方法里（`encodeTextForMarkdown`、`escapeMarkdownSyntax`），没有接口能换掉，表格的写出也有缺陷；所以写出由我们自己做，解析仍用 `@tiptap/markdown`。

- `blocks.ts`：按节点类型的块写出表（段落、标题、列表、任务列表、引用、提示块、代码块、分割线、表格、图片所在段落，以及各方言的块）。列表项的子块按列表符号的宽度缩进；表格的单元格里的 `|` 写成 `\|`、单元格里的换行写成 `<br>`（输出 20），不再出现 U+001F。
- `inline.ts`：行内内容写出。标记的开闭按标记的优先级嵌套（同 schema 的 mark rank），相邻文字节点的标记集合变化时先关后开；同类型、不同属性的标记（例如两条批注）各自成段，保证标签正确嵌套。
- `escape.ts`：最小转义（输出 4）。按位置判断：行首的块语法字符；会开闭强调、删除线、`==高亮==` 的 `*`、`_`、`~`、`=`（按与解析相同的侧翼判定）；`` ` ``、`[`（后面跟得成链接时）、`!`（在 `[` 前）、`<`（后面是字母、`/`、`!`、`?`）、`&`（后面像实体）、`\`（在标点前）；U+00A0 与零宽字符写成实体。判断不准的情况由第 4 节的读回校验兜底。
- 写出器由各语法模块（第 6、7 节）登记自己的块与标记写法，`render/` 本身不认识具体方言。

### 6. `web/markdown/syntax/`：每种语法一个模块

每个模块导出同一个形状，规则只写在一处：

```ts
interface MarkdownSyntax {
    readonly name: string;
    /** schema 与解析：Tiptap 扩展（带 markdownTokenizer / parseMarkdown）。 */
    readonly extensions: ReadonlyArray<AnyExtension>;
    /** 写出：节点类型 → 块写法；标记类型 → 开闭写法。 */
    readonly blocks?: Readonly<Record<string, BlockRenderer>>;
    readonly marks?: Readonly<Record<string, MarkRenderer>>;
    /** 块级方言标签名：宽容写法的规范化与 HTML 兜底的排除名单都从这里取。 */
    readonly blockTags?: ReadonlyArray<string>;
    /** 词法器的覆盖（例如删除线只认两个波浪线）。 */
    readonly marked?: MarkedExtension;
}
```

`syntax/index.ts` 按固定顺序列出全部模块，编解码器与编辑器都从这里取，代替现在的 `markdown-dialect-extensions.ts` 与分散的名单。

**写法属性**（输出 2）：需要保留写法的节点与标记加一个 `markdown` 属性（不渲染到 DOM），解析时从词法单元的 `raw` 取，写出时照用；新建的节点没有这个属性，用规范写法（输出 10）：

| 节点或标记 | 记下什么 |
|---|---|
| 无序列表 | 符号 `-`、`*`、`+` |
| 有序列表 | 分隔符 `.`、`)` 与起始编号 |
| 任务项 | `x` 或 `X` |
| 标题 | `#` 或下划线式（`=`、`-`） |
| 代码块 | 围栏符号与长度；缩进代码 |
| 分割线 | 原写法 |
| 粗体、斜体 | `*` 或 `_` |
| 高亮 | `==` 或 `<mark>` |
| 链接 | 行内、引用式（标签）、自动链接 |
| 硬换行 | 单换行、两空格、反斜杠、`<br>` |
| 注音 | 属性式或标准 `<rt>` 式 |
| 行内 HTML 方言 | 原开标签的写法（大小写、属性顺序） |

**模块清单**：

- `syntax/core/`：段落（高优先级，沿用 `MarkdownParagraph` 的理由）、标题、列表、任务列表（`@tiptap/extension-list` 的 `TaskList`、`TaskItem`）、引用、代码、分割线、硬换行、强调、删除线、链接、图片、表格。
- `syntax/cjk/`：中文友好的强调（输出 6）与删除线只认 `~~`（输出 7）。强调先评估 `marked-cjk-friendly`（0.1.2）：用往返语料与它自己的样例验证，合格就用；不合格就在我们的 `Marked` 实例上按[同一规则](https://github.com/tats-u/markdown-cjk-friendly/blob/main/specification.md)覆盖强调的侧翼判定。删除线覆盖 `del` 分词：单个 `~` 返回文字单元。
- `syntax/comment/`：行内、块、分截（输出 11）。`Comment` 标记设 `excludes: ""`，允许不同 `id` 的批注重叠；读入时同一 `id` 的各截合成一条（`body` 取带 `body` 的那截，冲突的各自成条），写出时 `body` 只写第一截（第 4 节的上下文依赖）。块批注仍是 `CommentBlock` 节点。新建批注选哪种形态由以后的批注界面决定（见“Spec 与文档改动”）。现有的评论列表缓存插件（只在文档变化时重扫）保留。
- `syntax/ruby/`、`syntax/bilingual/`、`syntax/align/`、`syntax/text-marks/`（颜色、高亮含 `==`、上下标）、`syntax/html-embed/`：从现有 `dialect/*.ts` 搬入并补写法属性与写出；颜色的合法性检查按输出 15。
- `syntax/callout/`：提示块（输出 23）。解析在引用的 `parseMarkdown` 里识别第一行的 `[!类型]`，产出 `callout` 节点（属性：类型原文、折叠标记、标题原文），内容是其余的块。显示：五种类型的图标与颜色用主题 token，其余用 `NOTE` 的样子；折叠只是视图状态。
- `syntax/raw/`：原样块与原样片段（输出 9）。HTML 兜底（现有 `HtmlFallback.ts` 的三件）、脚注引用与定义、数学 `$…$`（按 Pandoc 的规则：开 `$` 后不是空白、闭 `$` 前不是空白且后面不是数字）与 `$$` 块、HTML 注释，统一成两种节点 `rawBlock`、`rawInline`（属性 `raw`），显示源码，可以整体删除、复制。

### 7. `web/components/MarkdownControl.vue`：接入

- `load`：`codec.read(binding.text.value)`，用结果的 `doc` 建 `EditorState`；视图状态记 `ReadResult`（代替现在的 `split` 与 `base`）。
- `commitNow`：`codec.write(editor.state.doc, view.read)`；成功按现在的方式 `binding.commit`；失败调用绑定的新方法 `refuse({code: "unrepresentable", block})`，这次不提交。
- `reload`：`codec.read` 新正文，照旧按 `findDiffStart/End` 只替换不同的那一段；之后按位置把新读入结果的来源对到当前文档的顶层节点上（留下来的旧节点与新读入的节点结构相同、原文以新正文为准），这样外部只改了写法的块不会被旧原文写回。
- 写法属性不画到 DOM；提示块、任务复选框、原样块与原样片段的显示在各自的语法模块里（NodeView 或 `renderHTML`），样式用主题 token。

### 8. `web/area.ts` 与 `shared/contracts.ts`：写不出的输入

- `TextEditorBinding` 增加 `refuse(reason: {code: "unrepresentable"; block: number}): void`：把这个绑定记成有未裁决输入（与 [editor](../../../../../docs/specs/workbench/editor.md) 输出 13 同一通道），原因是 `unrepresentable`；之后一次被接受的 `commit` 清掉它。
- 组顶部的提示：“第 N 块的格式写不回 Markdown”，只给“采用当前正文”（丢弃这份输入）；保存遇到它按输出 13 不发出写入，关闭询问照计入。
- 控件句柄的 `flushPendingChange` 不变。

### 9. 测试：往返语料与性质

- `web/markdown/codec/corpus/`：一组 `.md` 样例（小说正文；方言 Spec 每条输出至少一例；[conversion.md](conversion.md) 的全部发现；旧应用 101 任务修过的方言形态；现有 `markdown-dialect.test.ts` 的样例搬入）。
- `codec.test.ts`（`bun test`）对每个样例检查四条性质：
  1. 不编辑写回，逐字节等于原文；
  2. 每一块单独标记为“变了”后写回，再读入，文档 `eq` 读入时的文档（写出读得回来，且写法属性保持）；
  3. 在每一块的文字里插一个字后写回：其余块与间隔的原文逐字节不变，再读入的文档只有那一处不同；
  4. 读入的文档 `check()` 通过。
- **随机往返**：加开发依赖 `fast-check`，随机生成小文档（段落、列表、引用、强调、链接、批注、注音、中文标点与各种特殊字符），新建（无写法属性）后写出、读回，必须 `eq`。
- 组件层：`MarkdownControl` 的现有 DOM 测试改走编解码器；任务列表里回车、勾选；`refuse` 的通道（area 测试）。
- e2e：`editor-area.e2e.ts` 增补方言 Spec 场景 1、2、4、6 的真实浏览器版本。

## Spec 与文档改动

| 文档 | 改什么 |
|---|---|
| `docs/specs/workspace/markdown-dialect.md`（t06 分支） | 输出 11“写出时选哪种形态”改为“写回保持形态；在富文本里新建时，选区正好是连续的完整块写成块，只在一段里写成行内，其余分截”（写回不改变形态，避免读回校验时形态变化）；实现后补实现合同与证据，晋升由开发者批准 |
| [`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) | 输出 13 补“写不出的输入（`unrepresentable`）也是未裁决输入，只能采用当前正文”（planned）；输出 19 的 planned 句随实现去掉旧句；“控件合同”补 `refuse` |
| `MarkdownControl.md` | 视图状态改为读入结果；写不出时的行为 |
| 删除 | `source-merge.ts` 与测试、`markdown-workbench.ts`、`markdown-dialect-extensions.ts`、`dialect/` 目录（内容迁入 `syntax/`） |

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S0 | 记录：计划交审、处理第 1 轮审查；Spec 按上表改 | `docs:check`、`governance:check` |
| S1 | 编解码器骨架：`codec.ts`、`source.ts`（含偏移表与分块）、`read.ts`、`write.ts`（先只有“原文写回”与间隔规则）、独立 `Marked` 实例；语料目录与性质 1、4 | `bun test src/plugins/editor/web/markdown`、`typecheck` |
| S2 | `render/` 与 `syntax/core/`、`syntax/cjk/`：写法属性、最小转义、读回校验与降级；性质 2、3 与随机往返；修掉表格、实体、行首、单波浪线 | 同上 |
| S3 | 方言迁入 `syntax/`：批注（含分截与重叠）、注音、双语、对齐、文字标记、HTML 嵌入、原样（HTML、脚注、数学、注释）；新增提示块与 `==高亮==`、任务列表；删除旧文件 | 同上；第 2 轮审查（转换核心） |
| S4 | 接入：`MarkdownControl` 改用编解码器、`refuse` 与 area 的未裁决通道、编辑器里的显示（提示块、复选框、原样块）；组件测试 | `test:affected --typecheck` |
| S5 | e2e、Lab 场景（提示块、原样块）、`lab:shot`、Spec 实现合同与证据；第 3 轮审查（收尾） | `test:affected --typecheck`、`test:e2e` 编辑器相关、`docs:check` |

## 验收映射

| 方言 Spec | 覆盖 |
|---|---|
| 输出 1、2、9（原样字节）、17 | 语料性质 1、3 |
| 输出 2（写法）、3、4、5、6、7、10 | 语料性质 2；随机往返；读回失败的降级与 `unrepresentable` 单测 |
| 输出 11–16、18–24 | 每条的语料样例走性质 1–4；分截与重叠的专门样例 |
| 输出 9（不合 schema） | 语料：任务列表的旧坏形态、表达不了的嵌套 |
| 失败码 `unrepresentable` | 编解码器单测（构造读不回的块）；area 测试（未裁决通道）；e2e 不做（真实输入难以构造） |
| 场景 1、2、4、6 | e2e |
| 场景 3、5、7 | 语料 |
| editor 输出 13（planned 句）、19 | area 测试、`MarkdownControl` DOM 测试 |
| editor 输出 27（字数不计批注等） | 字数的单测补样例 |

## 验证

- 每片：`bun test src/plugins/editor/web/markdown`、`bun run --cwd packages/neuro-book typecheck`；S4 起 `bun run test:affected --typecheck`。
- 端到端：生产构建上跑 `editor-area.e2e.ts` 的新场景；开发服务上手动打开一份含全部方言与 [conversion.md](conversion.md) 样例的文件，编辑、保存，用 `git diff --no-index` 对比原文，确认只有编辑的块变了。
- 性能：一章十万字的文件，打开、打字时写回的耗时与现在比较（写回只重新写出变了的块，应不慢于现在每次整篇序列化）；数字写进 Task。
- 未验证边界：粘贴 Markdown 与网页内容（不在本 Task）；批注界面（新建、侧栏）不在本 Task，分截只在格式层与语料里验证。

## 不做与风险

- **不做**：排版菜单、右键菜单、批注界面、frontmatter 面板、相对路径图片的显示与插入、`<html>` 块的预览令牌（方言 Spec 输出 16 的 planned 句、输出 18 的显示）——这些是 t06 后续的界面工作，另起计划。
- **风险**：
  - 一块产出多个节点、或宽容写法跨多个词法单元时，来源的对应最容易错：S1 先以“全部块与间隔拼回原文”的不变量测试锁住。
  - `marked-cjk-friendly` 版本很新：S2 先验证，不合格就自己覆盖强调判定。
  - 写法属性让同一文字上的标记因属性不同而不合并（`**a**` 与 `__b__` 相邻）：这是预期的，写出各自保持；在语料里放这类样例。
  - `@tiptap/markdown` 升级可能改变解析：锁定 `@tiptap/*` 与 `marked` 的确切版本，升级时先跑语料与随机往返。
