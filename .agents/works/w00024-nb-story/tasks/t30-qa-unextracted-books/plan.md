# t30 计划：问答读未抽取章的原文

## Context

书还在抽取时，书里只有已提交的章（`book.meta.paragraphs`、`extractedThrough`），原文全本在 `<书库>/.ingest/<书 id>/source.json`（`IngestSource.chapters`，与 `SourceChapter` 同形）。现在问答的阅读位置只能落在已提交的章内：`resolvePosition` 按已提交的章校验，`ReadLedger` 的段数表也只有已提交的章。开发者要的是：位置可以选到更后面的章；那些章助手能读原文，但图里没有它们的记录。

术语：E = 已提交的最后一章（`extractedThrough.chapter`）；P = 对话的阅读位置；**图位置** G = P 在 E 以内时是 P，否则是 `extractedThrough`；**未抽取尾部**（下称尾部）= source.json 里章号大于已提交章数的那些章。

## 技术选型

无新依赖。尾部读取沿用 `IngestSource` 的现有格式，不另存一份原文。

## 关键设计

### core/unextracted.ts（新）

`Library.unextracted(id): Promise<SourceChapter[]>`：读 `ingestDir(id)/source.json`，取章号大于已提交章数的章；文件不在（抽完后清理、或导入的书）为空。按文件 `mtimeMs + size` 缓存，`book.info` 每次页面加载都会调，不重复解析整本原文。读不成（JSON 损坏）当作没有尾部并写一条诊断，不让问答整体失败。不核对书代：`.ingest` 目录与书同 id，书被删时抽取记录一并清（`library.ts` 的 remove），所以不会读到别的书的原文。

### book.info 加字段

`BookInfo.unextracted: number[]`：尾部各章的段数（没有尾部为空数组）。网页用它定位置控件的可选范围与章末段；`paragraphs` 仍只含已提交的章，其余消费者不变。

### qa/reach.ts（新）

问答的“可到达范围”。`resolveReach(book, input?)` 返回 `{at, graphAt, paragraphs, tail}`：`paragraphs` 是已提交加尾部的段数表；`at` 按这张表落到具体的段（只给章取章末段，章不在表里报 `position_out_of_range`）；`graphAt` 按上面的定义。已提交范围内的位置仍走 `book.call("book.info", {at})`，保持现有错误与行为。`readRange(book, reach, from, to)`：已提交部分用 `source.read`（at 取 `graphAt`），尾部部分直接从 `tail` 取，拼成同一个 `source.read` 结果形状（尾部段不带称呼标记、`recordCount` 为 0），所以 `formatResult` 与账本记录不用改。

### qa/engine.ts

`startNew`、`startContinued`、`planPositionChange` 用 `resolveReach` 代替直接调 `book.info`；`ReadLedger` 的段数表用 `reach.paragraphs`；`QaToolState` 加 `graphAt` 与 `reach`。`fullReadMessage` 用 `readRange`，全读对话也能读到尾部。位置提醒文字（`positionReminder`）在目标位置超过 E 时加一句“图只抽到第 E 章，之后只能用 read 读原文”；系统提示词的初始信息在 P 超过 E 时带 `graphThrough`，Profile 里写一句同样的话。抽取进度在两问之间增长时，下一问按新的 E 重算 G，提示词那句不更新（接受，写进待确认清单）。

### qa/tools.ts

除 `read` 外的查询工具都用 `graphAt` 调；`read` 经 `readRange`。P 超过 E 时，图工具的结果末尾追加一行“（图只抽到第 E 章；第 E+1 章到 P 的内容只能用 read 读原文）”。`answer` 的出处校验仍是账本，尾部段读过即可引用。

### server 与网页

`qa-service` 的位置校验已经走引擎，不改。`QaPage.vue`：位置控件的 `paragraphs`、`maxChapter` 用已提交加 `unextracted`；P 超过 E 时位置控件旁显示一句“图只抽到第 E 章，之后只读原文”（沿用 `ModeNotice` 的样式）；@ 候选与 `entities.list` 的位置取 G，不是 P（尾部没有对象）。出处链接指向尾部段时不做链接（查看器没有那一段），按普通文字显示。

### 命令行

`ask --at 60` 经同一条引擎路径，自动支持；`nbstory qa` 的位置显示不变。

## Spec 与文档改动

`docs/specs/story/qa.md` 新增输出 42（没抽完的书）、失败码不变；`viewer.md` 位置控件与提示一句；`queries.md` 的 `book.info` 加 `unextracted`。

## 切片

1. `core/unextracted.ts` 与 `book.info.unextracted`（含缓存）、`qa/reach.ts`，单测。
2. 引擎与工具：位置、账本、`read`、全读、提醒与提示词；引擎测试。
3. 网页：位置控件范围、提示、@ 候选取 G、出处链接；e2e。
4. Spec、Task 记录、收口。

## 验收映射

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
- 抽取进度增长后，已有对话的提示词里那句不更新；工具结果的提示是每次现算的，模型以工具结果为准。
- source.json 很大时（整本小说，几 MB）首次解析约 10 毫秒量级，由缓存摊掉；未实测，实现后量一次。
