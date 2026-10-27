# t30 计划：问答读未抽取章的原文

## Context

书还在抽取时，书里只有已提交的章（`book.meta.paragraphs`、`extractedThrough`），原文全本在 `<书库>/.ingest/<书 id>/source.json`（`IngestSource.chapters`，与 `SourceChapter` 同形）。现在问答的阅读位置只能落在已提交的章内：`resolvePosition` 按已提交的章校验，`ReadLedger` 的段数表也只有已提交的章。开发者要的是：位置可以选到更后面的章；那些章助手能读原文，但图里没有它们的记录。

术语：E = 已提交的最后一章（`extractedThrough.chapter`）；P = 对话的阅读位置；**图位置** G = P 在 E 以内时是 P，否则是 `extractedThrough`；**未抽取尾部**（下称尾部）= source.json 里章号大于已提交章数的那些章。

## 技术选型

无新依赖。尾部读取沿用 `IngestSource` 的现有格式，不另存一份原文。

## 关键设计

### core/unextracted.ts（新）

`unextractedTail(library, bookId, committed: readonly number[]): Promise<SourceChapter[]>`：读 `ingestDir(id)/source.json`，取章号大于已提交章数的章。`committed` 是调用方这一代已提交各章的段数（`book.meta.paragraphs`）。三道校验，任何一道不过都返回空尾部并写一条诊断，不让问答整体失败（设计审查第 1、8 条）：
- 运行时结构校验：`chapters` 是数组，章号从 1 连续，每章 `paragraphs` 是非空字符串数组；
- **指纹**：source.json 里前 `committed.length` 章的段数必须与 `committed` 逐章相等。这把尾部绑定到这一代：删书后同 id 换成别的书，前缀段数几乎不可能整体吻合，换代后的 source.json 读出来是空尾部，不会拼进旧索引；
- 文件不存在（导入的 V9 记忆图没有 `.ingest`）为空。`.ingest/<id>/source.json` 抽完后仍保留（`ingest.status` 靠它），抽完的书尾部是空，因为章都已提交；不新增任何清理。

缓存键是文件路径加 `mtimeMs` 加 `size`，只缓存解析结果；指纹每次调用时核对，不进缓存键。引擎在每问的准备阶段读一次，这一问里不再读。

### book.info 加字段

`BookInfo.unextracted: number[]`：尾部各章的段数（没有尾部为空数组），`toc` 里尾部各章也列出（标题 null，沿用“P 之后的章 title 为 null”）。`paragraphs` 仍只含已提交的章，其余消费者不变。网页把两者合成一张完整段数表（见下），位置控件、新对话草稿位置、章节与段落的 @ 候选（`MentionBook`）、位置提醒的章末判定都只用这一张表，不再各自读 `info.paragraphs`（设计审查第 2、3 条）。

### qa/reach.ts（新）

问答的“可到达范围”。`resolveReach(book, input?)` 返回 `{at, graphAt, paragraphs, tail}`（尾部由 `unextractedTail` 读，指纹不符即空）：`paragraphs` 是已提交加尾部的段数表；`at` 按这张表落到具体的段（只给章取章末段，章不在表里报 `position_out_of_range`）；`graphAt` 按上面的定义。已提交范围内的位置仍走 `book.call("book.info", {at})`，保持现有错误与行为。`readRange(book, reach, from, to)`：已提交部分用 `source.read`（at 取 `graphAt`），尾部部分直接从 `tail` 取，拼成同一个 `source.read` 结果形状（尾部段不带称呼标记、`recordCount` 为 0），所以 `formatResult` 与账本记录不用改。

### qa/engine.ts

`startNew`、`startContinued`、`planPositionChange` 用 `resolveReach` 代替直接调 `book.info`；`ReadLedger` 的段数表用 `reach.paragraphs`；`QaToolState` 加 `graphAt` 与 `reach`。`fullReadMessage` 用 `readRange`，全读对话也能读到尾部。位置提醒文字（`positionReminder`，章末判定用 `reach.paragraphs`，不用 `book.meta.paragraphs`）在目标位置超过 E 时加一句“图只抽到第 E 章，之后只能用 read 读原文”。**系统提示词不写具体的 E**（设计审查第 7 条）：Profile 只加一句固定的话“工具结果末尾写了‘图只抽到第 N 章’时，第 N 章之后只能用 read 读原文”，当前进度只出现在每次工具结果与位置提醒里，所以抽取进度增长不会让提示词陈旧。

### qa/tools.ts

除 `read` 外的查询工具都用 `graphAt` 调；`read` 经 `readRange`。P 超过 E 时，每个图工具的结果（成功和出错都算）末尾追加一行“（图只抽到第 E 章；第 E+1 章到 P 的内容只能用 read 读原文）”。`chapter`、`para` 的章号落在尾部时不调查询（现有查询会报 `position_out_of_range`，与“超出全书”混淆），工具直接返回普通结果“第 N 章图里还没有记录：只能用 read 读原文”（设计审查第 5 条）。`search` 的 `kinds: ["source"]` 空结果同样带尾行。`answer` 的出处校验仍是账本，尾部段读过即可引用。

### server 与网页

`qa-service` 的位置校验已经走引擎，不改。`QaPage.vue`：位置控件的 `paragraphs`、`maxChapter` 用已提交加 `unextracted`；P 超过 E 时位置控件旁显示一句“图只抽到第 E 章，之后只读原文”（沿用 `ModeNotice` 的样式）；@ 候选与 `entities.list` 的位置取 G，不是 P（尾部没有对象）。出处链接：QA 页建一个 `linkable(chapter)`（章号不超过 E），传给 Markdown 的 `linkRefs`、结构化答案的 `refSegments` 与未核实出处 `UnverifiedRefs`；尾部章的出处保留原文字串，不发 `reference.open`，`chapter://` 同理（设计审查第 4 条）。

### 命令行

`ask --at 60` 经同一条引擎路径，自动支持；`nbstory qa` 的位置显示不变。

## Spec 与文档改动

`docs/specs/story/qa.md` 新增输出 42（没抽完的书，含尾部章上 `chapter`、`para`、`search source` 的结果合同）、失败码不变；`ingest.md` 不改（`source.json` 的生命周期不变）；`viewer.md` 位置控件与提示一句；`queries.md` 的 `book.info` 加 `unextracted`。

## 切片

1. `core/unextracted.ts` 与 `book.info.unextracted`（含缓存）、`qa/reach.ts`，单测。
2. 引擎与工具：位置、账本、`read`、全读、提醒与提示词；引擎测试。
3. 网页：位置控件范围、提示、@ 候选取 G、出处链接；e2e。
4. Spec、Task 记录、收口。

## 设计审查

[design-review.txt](evidences/design-review.txt)：8 条（阻断 1，重要 6，建议 1），全部成立并并入上文。第 6 条是计划里“抽完后清理 source.json”的假设错了（现有实现不清理），已改。

## 验收映射

- 尾部与书不是同一代（前缀段数不符）、source.json 结构错误：尾部为空，位置超过 E 报 `position_out_of_range`，有诊断。
- 位置提醒：从 E 章改到尾部第 E+1 章（尾章），提醒写“第 E+1 章”。
- `@21`、`@21.3` 在位置落在尾部时列出章节与段落候选。
- 尾部章的出处在 Markdown 回复、结构化答案、未核实出处里都是普通文字。
- `chapter`、`para` 传尾部章号返回“只能用 read”的普通结果；`search source` 的空结果带尾行。

- 位置选到尾部章：新对话 `ask --at 25`（E=20）运行，位置是 25；`read` 25 章成功，出处 25.3 通过校验。
- 图工具回答到 E：`find` 看不到尾部才出现的对象；结果末尾有“图只抽到第 20 章”。
- 往回调到 E 以内后读尾部被拒（`beyond_position` 一类的普通拒绝）。
- 没有 source.json：位置超过 E 报 `position_out_of_range`，行为同现在。
- 改位置的提醒文字带“图只抽到”那句。
- 网页：位置控件可选到尾部章，出现提示；@ 候选不含尾部之后的对象。

## 验证

nb-story 单测加新用例；e2e 加一个未抽完的书（样例书截掉后几章，写 source.json）；不调真实模型。

## 不做与风险

- 查看器不显示尾部原文，也不能在查看器里把阅读位置放到尾部。
- source.json 很大时（整本小说，几 MB）首次解析的耗时未实测，实现后量一次（缓存失效与换代各测一次）。
- 指纹只比前缀段数，不比文字：同 id 换成前缀段数完全相同的另一本书不会被发现，概率可忽略，接受。
