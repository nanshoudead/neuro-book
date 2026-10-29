# t38 图的修订：实施计划

## Context

抽取出来的图有核对管不到的错（t35 小抽取：马甲与人物的种类建错、称呼挂错对象），候选身份也没有地方确认。本计划实现 [`story.revisions`](../../../../docs/specs/story/revisions.md)（planned）与 [`story.viewer`](../../../../docs/specs/story/viewer.md) 输出 58 到 62、[`story.cli`](../../../../docs/specs/story/cli-skill.md) 的 `nbstory revisions`。界面已由评审板两轮定稿（[决定](../t37-overlay-revisions-design/README.md)）：确认两处都有、范围到“身份连接、改种类、挪称呼”、事后扫描另起 Task、六条规则确认。静态稿在草稿 worktree `.worktree/w00024-t37-t37-drafts`，不合并，作前端实现的外观参照。

约束：不改抽取数据；没有修订的书所有查询结果逐字不变；`src/core/` 只用 Node 兼容 API（没有 `bun:ffi` 的文件锁）；网页只引 `src/contract/`。

命名：数据里已有 `BookMeta.revision`（数据版本）。代码里把本能力叫 **overlay**（`src/core/overlay/`），修订文件的版本叫 `overlayVersion`，不与它混。

## 技术选型

- 跨进程写入不丢：不用文件锁（`platform/flock.ts` 要 `bun:ffi`，core 不能用）。先写完整的临时文件，再用 `fs.link` 发布成 `revisions-<n+1>.json`（硬链接在目标已存在时失败，是原子的“只创建一次”，读者看不到半个文件），撞上就重读重算。否决：`wx` 直接写正式文件名（崩溃会留下半个最高版本）、自旋的锁文件（要判旧回收）。
- Schema 校验：TypeBox（本包已用），与 `dataset.ts` 同一写法。
- 无新依赖。

## 关键设计

### `src/core/overlay/`（新）

- `schema.ts`：`OverlayFile = {format: 1, generation, version, items: Revision[]}`；`Revision = {id, op, state, source, by, params, evidence, anchors, reason?, createdAt, history[]}`；`op` 为 `identity.confirm | identity.reject | identity.link | kind.set | name.move`；`state` 为 `adopted | rejected | withdrawn | pending`（`pending` 给以后的扫描留，第一版没人写）。读到不认识的 `format` 报 `unsupported_format`，写入拒绝。
- `apply.ts`：纯函数 `applyOverlay(dataset, file): {dataset, resolved}`，不改入参：
  - `identity.confirm`：目标说法 `certainty` 改为确定，加 `revision` 标记；`identity.reject`：说法从 `statements` 去掉，引用它的地方集中在一张“被移除说法的引用清理表”里处理：`premises`、`rel.to`、秘密的 `statements`、`knowledge.about`（整条知情记录去掉）、`question.updates.answer`（去掉答案字段）、`statement.secret`；另加一条数据集级的引用完整性检查（测试里对 apply 的结果跑一遍，不只测几个查询）；
  - `identity.link`：新增说法（id `u<n>`，family 身份、fact、`at` 取依据位置、出处取依据段、文字用依据位置上的显示名，写法同 `ingest/persona-check.ts` 的 `toStatement`，把那个函数里“显示名取依据位置”的部分抽成两处共用的纯函数），带 `revision` 标记，用户自己写的不进待确认；
  - `kind.set`：给对象加可选字段 `kindFrom: {at, kind}[]`（schema 允许多出字段）；
  - `name.move`：用一个纯函数同时生成三样东西：`from` 的称呼表里成立位置不早于依据位置的该称呼记录去掉；`to` 的称呼表在依据位置加一条（非主名，说明“由修订挪入”，`to` 已有同文字称呼时不加）；`mentions` 里 `entity === from`、文字相同、位置不早于依据位置的改指 `to`。称呼表、原文出现与按称呼找对象不各自再算一遍。
  - 目标对不上锚的项不套用，记入 `resolved` 的 `stale`。
- `anchor.ts`：每条修订记锚：说法 `{id, at, text}`、对象 `{id, at, firstName}`。`resolveAnchor(dataset, anchor)`：id 与 `at`、文字都对得上就用；对象 id 已不在时按留下的对象的 `mergedFrom` 跟过去（整理合并建重的对象是现实里改编号的唯一途径：`ingest/compile.ts` 合并时写 `mergedFrom`）；再不行按位置与首称呼唯一对得上的找；都不行就是 `stale`。锚又对上了自动恢复（状态现算，不写回）；`stale` 的项只能丢弃（`undo`），没有“重新绑定”。
- `items.ts`：`listItems(原始 dataset, file, at)`：输入是套用之前的数据集（套用后候选已经变确定或消失，列表要靠原始候选与修订历史才能给出原说法、出处与时间）；现算待确认项（可见、没有决定、没被后文确认的候选身份说法；同一对象对之间在 P 处已有确定的身份说法的算 `closed`）、已处理项与撤销性；状态优先级 `stale` > 已有决定 > `closed` > `pending`；来源由说法的 `origin` 定（`persona-check`，否则 `extraction`）；`summary` 与 `refs` 只用 P 之前的称呼。
- `store.ts`：`readOverlay(bookDir, generation)`（只认 `generation` 相同的文件，取其中版本最大且读得出来的，损坏的跳过并回退；读到一半被回收时重来）、`writeOverlay(bookDir, generation, mutate)`（临时文件加 `fs.link` 发布 `n+1`，`EEXIST` 重读重算，重试有上限；成功后只删最近 50 个版本之外的文件（版本号不能马上空出来，否则晚到的写入者会重用已回收的版本号、覆盖别人的写入，实测八个进程并发写时出现过），发布撞上代号不符的遗留文件就删掉它再发布，`ENOENT` 当作已被别人回收）。写入前核对 `book.json` 的一代、写入后再核对一次；书已换代时报 `book_not_found`，已发布的文件因代号不符不会被新一代读到。
- `ops.ts`：五个写入操作的校验与生成修订（错误码 R1 到 R5，见 Spec），以及 `undo`（确认或驳回回到待确认＝删掉该项的决定；用户自己的修订记 `withdrawn`）。依据位置要是已抽取的原文段（`evidence_invalid`），目标要在依据位置之前出现。

### `src/core/book-index.ts`、`src/core/projection.ts`、`src/core/api.ts`

- `openBookIndex`：`pinBook` 之后用固定下来的一代的代号读修订文件（读到的文件代号与之不符就当没有），`applyOverlay` 之后再 `settle`；缓存键加 `overlayVersion`；`BookIndex` 带 `overlay`（解析结果与文件）。一次查询读一次，不重读。
- `projection.ts` 的 `VisibleEntity.kind` 按 `kindFrom` 与阅读位置给出生效的种类；`anonymous` 判断随之。核对 `identity.ts` 里两处直接读 `entity.kind` 的地方（代表对象、`shortNote`）是否走视图后的对象。
- `api.ts`：新增方法 `revisions.list`、`revisions.evidence`（书级读；后者按 `mentionsByParagraph` 取对象在 P 之前出现的段，分页）与写入类 `revisions.confirm/reject/link/kind/moveName/undo`（不走 `bookCall` 的位置解析，经 `Library` 取书目录与格式检查）；`book.info` 加 `revisions: {pending, stale}`，计数按 `(索引, 阅读位置)` 缓存在 `BookIndex` 上，列表明细只在请求时生成；分页游标绑定 `overlayVersion`（`cursor.ts`）。
- `src/contract/contract.ts`：八个方法的 schema 与结果类型，失败码 R1 到 R6 进错误表（沿用 F 系列的登记方式）。

### `src/ingest/`

- 草稿 schema 是严格的（`additionalProperties: false`）且文字与发给模型的结构要逐字不变，所以 `origin` 不进草稿：马甲核对写下的说法编号记进这一章的抽取记录（`PersonaOutcome.statements`），`job.ts` 编出书之后按这些编号给说法补 `origin: "persona-check"`；`dataset.ts` 的说法 schema 加可选 `origin`、`revision`。
- 抽取汇总（`ingest/status.ts`、命令行结尾、网页进度）：抽完时写“N 条待确认”，N 取全书算（用阅读位置在末尾的 `revisions.list` 计数）。

### `src/cli/`

`commands.ts` 的命令表加 `revisions`（`list|confirm|reject|link|kind|move-name|undo`），按现有命令的解码器与 `--json` 写法；文字输出沿用 `format.ts`。`skill/` 的 Skill 文字加一句（待确认项由用户在查看器或命令行处理，Agent 不替用户确认）。

### `src/web/`（前端，Sonnet 审查）

- `contract` 客户端加八个方法；`host/book.ts` 的 `Page` 加 `revisions`，`shell/BookFrame.vue` 的 `NAV`、页面异步映射与手机“更多”里加“待确认”与角标（`book.info.revisions`）。写入成功后递增 `book.dataVersion`，所有页面（图、人物卡、原文、统计）按现有机制重新取数。
- `pages/RevisionsPage.vue`（新，输出 58）：两个页签、来源筛选、卡片（对不上的项按钮是“丢弃”）；`parts/RevisionCard.vue`（卡片，页与抽屉共用）；`parts/EvidenceQuote.vue`（依据原文一句加出处链接，复用 `RefLink`、`SourceText`）。
- `shell/DrawerCard.vue`（输出 59、60）：头部候选块 `parts/CandidateBlock.vue`、“⋯”菜单（nb-ui `DropdownMenu`）、三个对话框 `shell/ReviseDialog.vue`（连接、改种类、挪称呼三种模式，nb-ui `Dialog`，依据段列表用 `revisions.evidence` 取（对象在已读章里出现的段落，分页），对象搜索沿用 `SearchBox.vue`）。
- 写入后刷新当前页数据，阅读位置、滚动与抽屉不变（输出 62）；撤销提示用 nb-ui `Notification`。
- 每个新 `.vue` 先写同名 `.md`（本包约定）。

## Spec 与文档改动

Spec 已写（`eca8ad6f3`、`ec47f4278`）。实施中发现合同要改时先改 Spec 再改代码。实现完成后三份 Spec 的“实现合同与证据”补写，`planned` 标记去掉等开发者批准晋升。`packages/nb-story/AGENTS.md` 的边界加一句：修订文件只经 `src/core/overlay/` 读写。

## 切片

1. **纯逻辑（后端）**：`overlay/schema.ts`、`apply.ts`、`anchor.ts`、`items.ts` 与 `book-index`、`projection` 的接线；`persona-check` 的 `origin`。自跑：`bun test src/core src/ingest/persona-check.test.ts`、`bun run typecheck`。
2. **存放与方法（后端）**：`store.ts`、`ops.ts`、`api.ts`、`contract.ts`、`book.info.revisions`、游标。自跑：`bun test src/core src/contract src/server`。
3. **命令行与汇总**：`cli/commands.ts`、抽取汇总、Skill 文字。自跑：`bun test src/cli src/ingest`。
4. **前端**：待确认页、人物卡候选块与菜单、对话框、手机宽度、e2e。自跑：`bun run typecheck`、`bun run test:e2e`（`e2e/revisions.e2e.ts`）、用 `nbdev shot` 对照草稿。
5. **收口**：全量 `bun test`、全量 e2e、用 t35 的两份小抽取在独立服务里手点一遍、补 Spec 的实现合同与证据。

提交边界：每片一到两个提交，信息用 Conventional Commit。

## 验收映射

| Spec | 覆盖 |
|---|---|
| revisions 输出 1、2、3、4、5、6、7、8 | `overlay/apply.test.ts`、`overlay/items.test.ts`（样例书截到各章，变异核对：把依据位置判断改晚一段，对应用例失败） |
| 输出 9、10 | `overlay/ops.test.ts` |
| 输出 11、15、16 | `overlay/anchor.test.ts`（整理合并后的 `mergedFrom` 跟随、对不上、锚恢复）、`overlay/items.test.ts`（状态优先级）、`overlay/evidence.test.ts` |
| 输出 12、13 | `ingest/status.test.ts`、`cli/revisions.test.ts`（真实子进程） |
| 输出 14 | `persona-check.test.ts` |
| 失败码 R1 到 R6 | `ops.test.ts`、`server/revisions.test.ts`（真实 HTTP） |
| 验收 1 到 6、9 | 同上，用样例书与构造的数据 |
| 验收 7、8 | `overlay/store.test.ts`：真实子进程，并发写、发布前被杀、发布后清理前被杀、版本交错（A 发布 n+1、B 发布 n+2、A 才清理）、写入检查后删除并同 id 重新导入（新书没有旧修订）、最高版本文件损坏的回退；整理合并用 `ingest-replay` 跑到第 5 章 |
| viewer 输出 58 到 62、验收 14 | `e2e/revisions.e2e.ts`（含手机宽度） |

## 验证

端到端：独立服务指向 t35 小抽取的书库副本，用 Playwright 在真实 Chromium 里确认十万水星、把银色闪光改成人物、把“小萱萱”挪给洛萱、撤销，刷新后仍在。不调真实模型。留下的未验证边界：整理合并后的锚跟随只用回放的抽取验证，没有在真实模型抽取的书上验证；手机宽度只在 Chromium 的窄视口里验证。

## 不做与风险

- 不做合并对象、改说法类别、事后扫描、自动采纳开关与“待确认时暂停”（见 README 的决定）。
- 风险：`kindFrom` 要让所有按种类分的查询按阅读位置取种类，靠 `projection` 的 `VisibleEntity.kind` 一处解决；`identity.ts` 里直接读 `entity.kind` 的两处要核对（对象来自视图），否则改种类对身份合并的代表对象不起作用。`identity.reject` 去掉说法后要同时清掉对它的引用，否则校验会报悬空编号；用对全部记录类型的引用扫描加测试兜底。游标绑定修订版本后，写入会让翻页中的游标失效（符合 Spec，前端遇到 `cursor_invalid` 刷新后从第一页重取）。`book.info` 的计数要在 100 章样例上量一次（每次请求新增耗时记进证据，目标不超过 50 毫秒）。
