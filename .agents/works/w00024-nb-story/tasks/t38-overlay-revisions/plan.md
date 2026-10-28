# t38 图的修订：实施计划

## Context

抽取出来的图有核对管不到的错（t35 小抽取：马甲与人物的种类建错、称呼挂错对象），候选身份也没有地方确认。本计划实现 [`story.revisions`](../../../../docs/specs/story/revisions.md)（planned）与 [`story.viewer`](../../../../docs/specs/story/viewer.md) 输出 58 到 62、[`story.cli`](../../../../docs/specs/story/cli-skill.md) 的 `nbstory revisions`。界面已由评审板两轮定稿（[决定](../t37-overlay-revisions-design/README.md)）：确认两处都有、范围到“身份连接、改种类、挪称呼”、事后扫描另起 Task、六条规则确认。静态稿在草稿 worktree `.worktree/w00024-t37-t37-drafts`，不合并，作前端实现的外观参照。

约束：不改抽取数据；没有修订的书所有查询结果逐字不变；`src/core/` 只用 Node 兼容 API（没有 `bun:ffi` 的文件锁）；网页只引 `src/contract/`。

命名：数据里已有 `BookMeta.revision`（数据版本）。代码里把本能力叫 **overlay**（`src/core/overlay/`），修订文件的版本叫 `overlayVersion`，不与它混。

## 技术选型

- 跨进程写入不丢：不用文件锁（`platform/flock.ts` 要 `bun:ffi`，core 不能用）。沿用 `graph-<版本>.json` 的做法，`revisions-<n+1>.json` 以 `wx`（只在不存在时创建）写入，撞上就重读重算；仓库里 `Library` 已有同类的版本文件。否决：自旋的锁文件（要判旧回收，已有的 flock 注释写明了这个坑）。
- Schema 校验：TypeBox（本包已用），与 `dataset.ts` 同一写法。
- 无新依赖。

## 关键设计

### `src/core/overlay/`（新）

- `schema.ts`：`OverlayFile = {format: 1, version, items: Revision[]}`；`Revision = {id, op, state, source, by, params, evidence, anchors, reason?, createdAt, history[]}`；`op` 为 `identity.confirm | identity.reject | identity.link | kind.set | name.move`；`state` 为 `adopted | rejected | withdrawn | pending`（`pending` 给以后的扫描留，第一版没人写）。读到不认识的 `format` 报 `unsupported_format`，写入拒绝。
- `apply.ts`：纯函数 `applyOverlay(dataset, file): {dataset, resolved}`，不改入参：
  - `identity.confirm`：目标说法 `certainty` 改为确定，加 `revision` 标记；`identity.reject`：说法从 `statements` 去掉，同时去掉别的记录对它的引用（`premises`、`rel.to`、秘密的 `statements`）；
  - `identity.link`：新增说法（id `u<n>`，family 身份、fact、`at` 取依据位置、出处取依据段、文字用依据位置上的显示名，写法同 `ingest/persona-check.ts` 的 `toStatement`，把那个函数里“显示名取依据位置”的部分抽成两处共用的纯函数），带 `revision` 标记，用户自己写的不进待确认；
  - `kind.set`：给对象加可选字段 `kindFrom: {at, kind}[]`（schema 允许多出字段）；
  - `name.move`：`from` 名下依据位置之后才成立的该称呼记录移到 `to`（`at` 取依据位置）；`mentions` 里 `entity === from`、文字相同、位置不早于依据位置的改指 `to`。
  - 目标对不上锚的项不套用，记入 `resolved` 的 `stale`。
- `anchor.ts`：每条修订记锚：说法 `{id, at, text}`、对象 `{id, at, firstName}`。`resolveAnchor(dataset, anchor)`：id 与 `at`、文字都对得上就用；id 变了、位置与首称呼唯一对得上的按位置找；都不行就是 `stale`。重抽后锚对上了自动恢复（状态现算，不写回）。
- `items.ts`：`listItems(dataset, file, at)`：现算待确认项（可见、没有决定、没被后文确认的候选身份说法；同一对象对之间在 P 处已有确定的身份说法的算 `closed`）、已处理项与撤销性；来源由说法的 `origin` 定（`persona-check`，否则 `extraction`）；`summary` 与 `refs` 只用 P 之前的称呼。
- `store.ts`：`readOverlay(bookDir)`（取最大版本，读到一半被回收时重来）、`writeOverlay(bookDir, mutate)`（`wx` 写 `n+1`，`EEXIST` 重读重算，成功后删旧版本，重试有上限）。写入前读到的 `generation` 要与书的一代一致（核对 `book.json`），书已换代时报 `book_not_found`。
- `ops.ts`：五个写入操作的校验与生成修订（错误码 R1 到 R5，见 Spec），以及 `undo`（确认或驳回回到待确认＝删掉该项的决定；用户自己的修订记 `withdrawn`）。依据位置要是已抽取的原文段（`evidence_invalid`），目标要在依据位置之前出现。

### `src/core/book-index.ts`、`src/core/projection.ts`、`src/core/api.ts`

- `openBookIndex`：读修订文件，`applyOverlay` 之后再 `settle`；缓存键加 `overlayVersion`；`BookIndex` 带 `overlay`（解析结果与文件）。一次查询读一次，不重读。
- `projection.ts` 的 `VisibleEntity.kind` 按 `kindFrom` 与阅读位置给出生效的种类；`anonymous` 判断随之。核对 `identity.ts` 里两处直接读 `entity.kind` 的地方（代表对象、`shortNote`）是否走视图后的对象。
- `api.ts`：新增方法 `revisions.list`（书级读）与写入类 `revisions.confirm/reject/link/kind/moveName/undo`（不走 `bookCall` 的位置解析，经 `Library` 取书目录与格式检查）；`book.info` 加 `revisions: {pending, stale}`；分页游标绑定 `overlayVersion`（`cursor.ts`）。
- `src/contract/contract.ts`：七个方法的 schema 与结果类型，失败码 R1 到 R6 进错误表（沿用 F 系列的登记方式）。

### `src/ingest/`

- `persona-check.ts` 的 `toStatement` 给说法加 `origin: "persona-check"`；`dataset.ts` 的说法 schema 加可选 `origin`、`revision`。
- 抽取汇总（`ingest/status.ts`、命令行结尾、网页进度）：抽完时写“N 条待确认”，N 取全书算（用阅读位置在末尾的 `revisions.list` 计数）。

### `src/cli/`

`commands.ts` 的命令表加 `revisions`（`list|confirm|reject|link|kind|move-name|undo`），按现有命令的解码器与 `--json` 写法；文字输出沿用 `format.ts`。`skill/` 的 Skill 文字加一句（待确认项由用户在查看器或命令行处理，Agent 不替用户确认）。

### `src/web/`（前端，Sonnet 审查）

- `contract` 客户端加七个方法；`host/book.ts` 的 `Page` 加 `revisions`，`BookShell.vue` 的 `NAV` 与手机“更多”里加“待确认”与角标（`book.info.revisions`）。
- `pages/RevisionsPage.vue`（新，输出 58）：两个页签、来源筛选、卡片；`parts/RevisionCard.vue`（卡片，页与抽屉共用）；`parts/EvidenceQuote.vue`（依据原文一句加出处链接，复用 `RefLink`、`SourceText`）。
- `shell/DrawerCard.vue`（输出 59、60）：头部候选块 `parts/CandidateBlock.vue`、“⋯”菜单（nb-ui `DropdownMenu`）、三个对话框 `shell/ReviseDialog.vue`（连接、改种类、挪称呼三种模式，nb-ui `Dialog`，依据段列表默认取对象在已读章里出现的段落，沿用 `SearchBox.vue` 的对象搜索）。
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
| 输出 11 | `overlay/anchor.test.ts`（重抽改 id、改位置、锚恢复） |
| 输出 12、13 | `ingest/status.test.ts`、`cli/revisions.test.ts`（真实子进程） |
| 输出 14 | `persona-check.test.ts` |
| 失败码 R1 到 R6 | `ops.test.ts`、`server/revisions.test.ts`（真实 HTTP） |
| 验收 1 到 6、9 | 同上，用样例书与构造的数据 |
| 验收 7、8 | `overlay/store.test.ts`（真实子进程并发写、跨进程；重抽用 `ingest-replay`） |
| viewer 输出 58 到 62、验收 14 | `e2e/revisions.e2e.ts`（含手机宽度） |

## 验证

端到端：独立服务指向 t35 小抽取的书库副本，用 Playwright 在真实 Chromium 里确认十万水星、把银色闪光改成人物、把“小萱萱”挪给洛萱、撤销，刷新后仍在。不调真实模型。留下的未验证边界：重抽后锚对应只用构造数据验证，没有在真实重抽的书上验证；手机宽度只在 Chromium 的窄视口里验证。

## 不做与风险

- 不做合并对象、改说法类别、事后扫描、自动采纳开关与“待确认时暂停”（见 README 的决定）。
- 风险：`kindFrom` 要让所有按种类分的查询按阅读位置取种类，靠 `projection` 的 `VisibleEntity.kind` 一处解决；`identity.ts` 里直接读 `entity.kind` 的两处要核对（对象来自视图），否则改种类对身份合并的代表对象不起作用。`identity.reject` 去掉说法后要同时清掉对它的引用，否则校验会报悬空编号；用对全部记录类型的引用扫描加测试兜底。游标绑定修订版本后，写入会让翻页中的游标失效（符合 Spec，前端遇到 `cursor_invalid` 从第一页重取）。
