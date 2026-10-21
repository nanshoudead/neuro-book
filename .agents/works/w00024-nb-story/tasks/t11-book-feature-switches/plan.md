# t11 实施计划：按书关闭数值与秘密

## Context

开发者 2026-10-20 在 t10 讨论里定：数值（状态变动 `ledger`）与秘密要能按书关闭，默认都开。很多小说用不上数值，游戏文才要；没有身份秘密的书，秘密那一套也是空转。关掉以后抽取不写这类记录，“已有记录”不列，查看器不显示对应页面，问答不提供对应查询。

依据：[`story.ingest`](../../../../../docs/specs/story/ingest.md)、[`story.queries`](../../../../../docs/specs/story/queries.md)、[`story.viewer`](../../../../../docs/specs/story/viewer.md)、[`story.qa`](../../../../../docs/specs/story/qa.md)；t10 README 的决定 3（数值、秘密按书开关，默认开，另立 t11）；本 Task README 的决定 1 到 4。

约束：两项都开时（默认），发给模型的每个请求与 t10 合入时逐字相同，已验证过的质量不受影响。两个开关互相独立，四种组合都要成立。

设计审查（omp，[evidences/design-review.txt](evidences/design-review.txt)）有效发现 16 条：阻断 0、重要 12、建议 4，都已改进本计划，对照见文末“设计审查的处理”。

## 关键设计

### 开关是什么、存在哪里

- `BookFeatures = {ledger: boolean; secrets: boolean}`，缺省都为 `true`。放在 `src/core/dataset.ts`，附一个 `featuresOf(x?: Partial<BookFeatures>)` 补缺省值。
- **新建时定，之后不改**（决定 1）。
- 存三处，都在已有的写入点上：
  - 抽取记录的 `source.json`（`IngestSource.features`），接着抽、追加时读它。旧记录没有这个字段，按都开处理。
  - 书的数据里 `book.features` 是可选字段（`DatasetSchema` 的 `book`），由 compile 从抽取记录带入；导入的 V9 数据文件可以带这个字段。
  - 书的元数据 `book.json`（`BookMeta.features`，可选）：`commitExtraction` 与 `importBook` 都从数据集写入。`books.list` 只读元数据，从这里取；旧 `book.json` 没有这个字段时按都开处理。
- **导入的边界**：数据文件里 `book.features` 关掉了某一项，对应的数组（`ledger`，或 `secrets`）却不为空时，`book.import` 报 `unsupported_format`，并写明是哪一项冲突。这样书里一定没有关掉的那类记录，查询层不用逐个方法判断开关。

### 发起：`src/ingest/start.ts`、`runner.ts`、`src/cli/*`、`src/server/ingest-service.ts`

- 命令行：`nbstory ingest <文件> --no-ledger --no-secrets`。
  - 现有的选项适配器（`cli/commands.ts`、`program.ts`）按选项名读值，读不到 commander 的否定选项。commander 把 `--no-ledger` 存在 `ledger=false` 下，不传时也存一个缺省的 `ledger=true`。
  - 改法：在命令表里登记否定选项，适配器用 `getOptionValueSource(name) === "cli"` 区分“显式传了”与“缺省”，只把显式传的值交给 ingest。不在 ingest 层另写一套参数解析。
- 网页：`ingest.preview` 与 `ingest.start` 都加可选输入 `features: {ledger?, secrets?}`；`ingest.preview`、`ingest.status` 的结果加 `features`（生效值）。
- **判定放在 `planFromText`、`planFromSaved` 里**：`start` 在锁里调用它们，`preview` 不拿锁也调用它们，不新开第二条路径。
  - 新建：请求里给了值就用请求值，没给的项用缺省值，写进 `source.json`。
  - 已有抽取记录（`resume`、`append`、`done`，包括第 1 章还没提交的 `resume`）：请求里显式给了、但与保存值不同的项，抛 `StoryError("invalid_params", "开关只能在新建时设……要换请删除后重抽")`。要在 `done` 提前返回之前比较。没给的项沿用保存值。
  - 结果里 `features` 都写生效值。
- **退出码**：命令行对 `startIngest`、`planFromText` 抛出的 `StoryError` 一律按退出码 1 处理，这一种要单独映射成 2。
  - 用一个错误子类 `IngestUsageError extends StoryError`（码仍是 `invalid_params`），在 `cli/ingest.ts` 的 catch 里按类型映射成退出码 2；HTTP 照常是 400。
  - 其余 `invalid_params`（例如读不了原文文件）保持退出码 1，不变。
- `runner` 和 `worker` 不传开关：worker 里的 job 读 `source.json` 时自带。

### 抽取：`src/ingest/prompts.ts`、`context.ts`、`reconcile.ts`、`chapter.ts`、`compile.ts`、`job.ts`

- **系统提示词不变**（决定 3）。【任务】段按两个开关各自生成；两项都开时，函数输出与现在逐字相同。
  - `draftTask(input, features)`：
    - 关数值：输出字段清单去掉 `ledger`；“当前状态里的每个量”“账本”“任务进度”三条去掉；末尾加一句“这本书不记数值：不要写 ledger。”
    - 关秘密：输出字段清单去掉 `secrets`；“秘密清单里的每个秘密……”改成只讲知情（“知情表里标了推断的判断……”），“本章有没有新的秘密”去掉；“知情记录的 who……”这条改成“about 写他知道或不知道的那条说法的编号（例如 s9-3），本人对自己的事总是知道，不要写 unaware”；末尾加一句“这本书不记秘密：不要写 secrets，说法也不写 secret 字段；知情记录的 about 写说法编号。”
    - 两项都关时两句都加。
  - `reviewTask(input, features)`：`replace` 的格式示例与可替换的部分里，去掉关掉的那几项；关数值时去掉“对账”这条原则；关秘密时，“身份”这条原则改成“补 identity 说法和指向它的知情”。
  - 核对清单 `buildChecklist({..., features})`：
    - 关数值时不开“对账”“任务”“工具”三类条目，这三类都是对账，以及“账本里道具用法”的那几条。
    - “身份”条目照开，但关秘密时文字里的“建秘密并写知情”改成“写指向它的知情”。
- **编译**：`compile(book, …)` 的 `book` 带 `features`。关秘密时不做 `secret-missing` 检查：identity 说法本来就不该有秘密，不能为此多走核对与修复。其余检查不变。
- **已有记录**（`renderContext`）：从 `dataset.book.features` 取开关。关秘密时不出“秘密与知情”一节，说法选法里“挂在列出的秘密上”这一组为空；关数值时不出“当前状态”一节。整理用的全量已有记录同样处理。两项都开时与现在逐字相同。
- **编译前去掉**（`draft-tools.ts` 新增 `stripDisabled(draft, features)`）：用在草稿刚写好、每次 `applyPatch` 之后，并且在 `checkDraft` 之前。要去掉的是：
  - 关数值：`ledger`；
  - 关秘密：`secrets`、说法的 `secret` 字段、`about` 是秘密编号的知情记录。草稿 schema 里秘密编号是 `x<章>-<序号>`，与说法编号互斥，所以按编号判断就够了。

  去掉的条数在 `ChapterResult.notes` 里记一条，例如“按书的设置去掉 3 条数值记录”，不计入 `dropped`。整理稿的 deps 已经由 `sanitizeConsolidation` 限定为现有的说法与情节，不用另外处理。
- `job.ts`：`book = {id, title, features}`，从 `source.features` 补缺省值后得到；`extractChapter` 的 `features` 从这里传入。

### 查询：`src/core/dataset.ts`、`src/core/library.ts`、`src/contract/contract.ts`、`src/core/queries/books.ts`

- `books.list` 的每本书和 `book.info` 都加 `features`（生效值）。
- 其余查询方法不改。书里没有关掉的那类记录：`secrets.matrix` 的行为空，`ledger.tracks` 为空。`ledger.track` 给任何轨道名都得到现有的 `entity_not_found`，这是沿用不存在轨道时的行为，不新增成功形状。Spec 里照这样写清楚。
- 命令行与问答共用的人物卡文字格式（`cli/format.ts`）：没有秘密行时不输出“秘密：”标题。开着秘密的书总有行（每个秘密一格），这条只影响关秘密的书。

### 查看器：`src/web/host/book.ts`、`src/web/shell/BookFrame.vue`、各页

- **允许的页**由 `host/book.ts` 按书的 `features` 算出（`allowedPages`），只有这一份来源。导航、手机上的“更多”、全书图节点跳转、`goPage`/`jump` 都从它生成或经它检查。
- **回退**：打开书（`openBookSession`）、同一本书里换地址（`router.afterEach`）、恢复存下的阅读状态三处，统一检查当前页是否允许。不允许时改为总览，清掉对应的目标与页签，给一次提示（“这本书没有记录数值”或“这本书没有记录秘密”），再同步地址与阅读状态。地址 `/book/<id>/ledger`、`/secrets` 仍是公开接口，旧链接不会报错。
- 全书总览：关掉的项不出对应的数字块，不出“秘密矩阵（精简）”，“这一章发生了什么”里也不出对应的行。
- 人物卡不出秘密一节；全书图的类型开关里不出“秘密”。
- 说明与统计：`StatsPage` 与 `ChapterBars` 按开关去掉关掉那一项的行、颜色系列与图例。`book.stats` 的输出形状不变，只是页面不显示。
- 导入页：新书在“开始抽取”上方放两个开关：“记录数值（钱、道具、任务进度）”和“记录秘密（身份秘密与谁知道）”，默认都开。
  - 开关的值随 `ingest.preview` 与 `ingest.start` 一起发送。
  - 预览返回的是已有书时，开关换成一行字，写明这本书保存的设置；页面把“新建时的选择”和“已有书的保存值”分开存，换书名后不会互相覆盖。
  - 预览回包过期（文件或书名已经变了）时按现有逻辑作废。开始时以服务端锁内的判定为准。
- 进度页：在模型那一行旁边写一句设置，例如“不记数值”；两项都开时不写。

### 问答：`src/qa/story-qa.profile.tsx`、`src/qa/tools.ts`、`src/qa/engine.ts`

- Profile 现在是模块级的静态定义，固定引用 20 个查询工具。只在注册时不登记关掉的工具，建会话时会报 `tool_unavailable`。
- 改法：Profile 的工具清单改成按书的 `features` 生成，每问构造一次，不改模块级的 `QUERY_TOOL_IDS`，也不让两问之间共用改过的 Profile。插件只登记允许的工具。关数值时没有 `ledger`、`track`，关秘密时没有 `knows`。
- 系统说明里列举能查什么的那句，按开关去掉“数值”。“谁知道什么”靠指向说法的知情，照留。

## Spec 与文档改动

- `ingest.md`：
  - 命令表加 `--no-ledger`、`--no-secrets`；网页方法表的 `ingest.preview`、`ingest.start` 输入加 `features`，`ingest.preview`、`ingest.status` 的结果加 `features`。
  - 新增一条输出：开关的含义；只在新建时设；显式给了不同值时报 `invalid_params`、命令行退出码 2，什么都不改。
  - 输出 4 加一句“关掉的那类不列”；输出 13 写明按设置去掉的记录不计入丢弃数；输出 15 的退出码 2 加上这一种。
  - “副作用与数据”写 `features` 存在哪三处。
- `queries.md`：
  - `books.list`、`book.info` 加 `features`；`book.import` 的失败加“开关关掉了却带着记录”的 `unsupported_format`。
  - “边界与兼容”写 `book.features` 是可选字段、缺省都开。
  - 写明关掉的书里 `ledger.track` 沿用 `entity_not_found`。
- `viewer.md`：
  - 输出 2 加“只列这本书开着的页”。
  - 输出 4、21 与“边界与兼容”加“页面不允许时按输出 2 改为总览并提示”。
  - 输出 8 全书总览、10 人物卡、11 与 12 秘密页和数值页、17 统计、31 全书图、37 导入页、38 进度页的设置一句，各在原位加条件。
- `qa.md`：查询工具按书的设置提供。
- `cli-skill.md`：如果人物卡的文字格式写在这里，同步“没有秘密时不出标题”。

## 切片

0. **默认路径的基线**（改代码之前）：在 `chapter.test.ts` 的回放里，把当前代码实际发出的每个请求逐个记下 SHA-256，包括系统提示词、实际发出的已有记录、核对、修复、整理与挑选（第 1 到 10 章）。基线文件进 `tests/fixtures/ingest/`，单独提交。之后不再替换已有记录、直接比较。原有的 t34 兼容断言保留，不改。
1. **数据与发起**：`BookFeatures` 的类型与三处存储、导入的边界、`ingest.preview`/`start`/`status`、命令行的否定选项与退出码、`books.list`、`book.info`。同时提交 Spec 的 ingest、queries 部分。
2. **抽取**：任务文字、核对清单、compile 的 `secret-missing`、已有记录、编译前去掉、问题说明。
3. **查看器与问答**：允许的页与回退、总览、人物卡、全书图、统计、导入页、进度页的一句设置、问答的 Profile、人物卡文字格式。同时提交 viewer、qa 部分的 Spec。查看器部分请 Sonnet 做前端审查。
4. **实现审查**（omp）与评测。

每片自跑 `bun run typecheck` 和受影响的测试；第 3 片另跑查看器与导入的 e2e。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 都开时逐字不变 | 切片 0 的请求基线：同一回放分别不给开关、显式给两项都开，所有请求的 SHA-256 与基线相同 |
| ingest 新增输出：开关与生命周期 | `cli/ingest.test.ts`：<br>- `--no-ledger` 新建后 `--status` 与书的 `features` 为 `{ledger:false, secrets:true}`；<br>- 不传开关接着抽沿用保存值；<br>- 显式给相同值照常；<br>- 第 1 章未提交的 `resume`、`append`、`done` 带不同值，都是退出码 2、`invalid_params`，原文、书与用量不变；<br>- 删书后同 id 用新设置新建。<br>`server/ingest.test.ts`：preview 与 start 的 `features` 输入与结果、不同值的 400、两个同时发起只有一个开始（复用现有用例） |
| 四种组合的抽取 | `chapter.test.ts` 回放，回复里都带 ledger、secrets、`secret` 字段、指向秘密的知情、指向说法的知情、`questionUpdates`。四种组合分别检查：<br>- 关掉的那类不在提交的数据里，开着的那类还在；<br>- 指向说法的知情与 `questionUpdates` 还在；<br>- 问题说明写了去掉的条数，`dropped` 为 0；<br>- 关秘密时没有 `secret-missing`，也没有因它多出的核对请求；<br>- 请求的任务段里没有关掉那项的条目，关秘密时身份条目不提“建秘密” |
| 输出 4：关掉的不列 | `context.test.ts`：关秘密时没有“秘密与知情”，关数值时没有“当前状态”；整理的全量记录同样 |
| 旧记录兼容 | `runner.test.ts`：没有 `features` 的 `source.json` 和 `book.json` 接着抽，按都开处理 |
| queries `features` 与导入边界 | `core` 的查询测试：<br>- 抽取得来的书，以及带、不带 `book.features` 的导入文件，`books.list` 与 `book.info` 都对；<br>- 关掉了却带着记录的导入文件报 `unsupported_format`，书库里没有这本书 |
| viewer | `ingest.e2e.ts` 的场地（本机回放、假密钥、隔离的配置目录）：<br>- 导入页关掉两个开关后开始，进度页写明设置，书的 `features` 是关；<br>- 打开书后导航没有秘密、数值；<br>- 直接地址 `/ledger`、`/secrets`、存下的阅读状态停在数值页，三种都落到总览并有提示；<br>- 总览、人物卡、全书图类型开关、统计页都没有对应项。<br>`viewer.e2e.ts`：全开的样例书这几处照旧 |
| qa | 真实 `createHarness` 的工具测试：关掉的书建会话不报错，模型收到的工具清单里没有那三个；两问分别问开、关两本书，互不影响 |
| 人物卡文字 | `cli` 的格式测试：没有秘密行时没有“秘密：” |

## 验证

- 确定性：受影响的单元测试、类型检查、查看器与导入的 e2e。
- **真实模型**（已批准，决定 4）：用 gpt-6-luna 把样例书前 20 章抽一次，两项都关。
  - 脚本：t10 的 `regress-20.sh` 写死了旧评测 worktree，开关也传不进去。在本 Task 的 `scripts/` 里另写一份，显式指向本次的代码，只在新建时传 `--no-ledger --no-secrets`，结束时核对书的 `features`。
  - 尺子：53 条里去掉 L1 到 L15（数值）与 K1 到 K9（知情与秘密），固定剩下 29 条：T1 到 T3、S1 到 S13、E1 到 E4、J1 到 J4、Q1 到 Q2、P1 到 P3。单次满分 87。t10 三次回归同一子集的得分是 63、63、67。评分脚本核对 id 集合确实是这 29 条。
  - 报告每章的请求数、输入与输出 token、`cacheRead`、费用，模型仍写出多少条关掉的记录，与 t10 回归对照。
  - 只描述这一次的观察，不设门槛。一次运行的结果不能当作“质量没有变”的证明：t10 三次之间，这 29 条里就有 12 条判定翻转过。
- 两项都开的路径由切片 0 的基线逐字保护，不重跑回归。

## 不做与风险

- 不做事后改开关，也不做“从第几章起”的规则。
- 系统提示词里仍有数值、秘密两节规则和示例，模型偶尔还会写出这两类记录，由编译前去掉兜底。这样和“自然不写”差多少，由评测里“仍写出多少条”来看。
- 开关省下的是：关掉那类记录的输出 token、已有记录里的两节、对账类的核对条目，以及可能少掉的核对和修复请求。系统提示词不缩短。各章共用的前缀是否真的命中缓存，以实际的 `cacheRead` 为准。

## 设计审查的处理

审查报告里的编号是追加时的编号；下表按报告最后的裁定表排序。

| 报告编号 | 处理 |
|---|---|
| 11 命令行否定选项 | 改：适配器支持否定选项，用来源区分显式与缺省 |
| 6 问答 Profile 静态引用工具 | 改：Profile 按书每问生成 |
| 2 固定尾句把两项一起关 | 改：两个开关各自生成文字 |
| 14 关秘密仍要求知情指向秘密 | 改：关秘密时这一条改写成指向说法 |
| 3 `secret-missing` | 改：关秘密时 compile 不做这项检查 |
| 10 身份清单要求建秘密 | 改：清单文字按开关生成 |
| 5 导入文件关掉了却带着记录 | 改：导入时报 `unsupported_format` |
| 1 `books.list` 读不到开关 | 改：`BookMeta` 加 `features` |
| 13 预览收不到开关 | 改：preview 也收 `features` |
| 12 现有请求断言替换了已有记录 | 改：切片 0 先记下实际请求的基线 |
| 15 验收矩阵不全 | 改：四种组合、生命周期、网页各处都写进验收映射 |
| 9 评测子集与脚本 | 改：固定 29 条、另写脚本 |
| 7 页面回退的入口 | 改：三个入口统一检查 |
| 8 统计页 | 改：页面按开关去掉对应的行与系列 |
| 17 空结果的说法、人物卡的空标题 | 改：Spec 写清，没有秘密行时不出标题 |
| 18 Spec 受影响的旧条目 | 改：各条在原位加条件 |
