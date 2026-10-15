# t04 实施计划：查看器打磨

## Context

开发者用 100 章样例书试用 t03 的查看器，提了 13 条反馈（核对结果见 [README](README.md#反馈与核对结果)），处理意见全部同意（README 的“决定”）。行为改动先写进 [`story/viewer.md`](../../../../../docs/specs/story/viewer.md) 与 [`story/queries.md`](../../../../../docs/specs/story/queries.md)，再实现。代码在 `.worktree/w00024-t03-impl`（分支 `feat/w00024-nb-story`），和 t03 一起合入。

## 关键设计

### `src/core/queries/`（查询的新字段）

- `secrets.ts`：列加 `aliases`（读者分组里同一个点的其他成员的显示名，按出场次数排）；格加 `how`（取到的那条知情记录的 `how`，读者格的身份连接写“旁白”，没有记录为 null）。
- `questions.ts`：每条加 `episodes: EpisodeBrief[]`，取出处与这条悬念的提出或可见进展的出处（章内段落区间）有重叠的可见情节，按章排序，至多 6 段。
- `timeline.ts`：每点加 `episodes: {id, title, who: NodeRef[], place}`，取 `time` 等于这个点的可见情节；`who` 按当前分组解析成点。
- `episodes.ts`：`who` 每项加 `as`（数据里 `who[].as`），另加 `place`、`time: {id, label} | null`（所挂时间点不可见时为 null），`links` 每项加 `note`。
- `books.ts`（`book.stats`）：加 `chapters`（第 1 章到 P 所在章，各章成立的可见说法、知情、情节、流水、新提出与解答的悬念数）与 `cast`（P 之前出场最多的至多 12 个人物点，`counts[i]` 是第 i+1 章里它的成员被提到的次数，只数 P 之前的称呼出现）。
- 合同在 `src/contract/contract.ts` 同步改；输出按 schema 校验，`spoiler.test.ts` 的递归检查自动覆盖新字段的引用。
- 测试补在各自的 `queries/*.test.ts` 里，断言具体数据：例如第 38 章苏天晴列的化名含“心月狐”、时间点 t1-1 下有情节 p2-2、p2-2 地点与时间、第 38 章 `cast` 的第 39 章之后没有数。

### `src/web/shell/` 与 `src/web/host/`（外壳）

- `BookFrame.vue`：删页脚；顶栏左侧加回书架的按钮，书名改成下拉（nb-ui `Dropdown`，列出 `books.list` 的其他书）；顶栏右侧依次是搜索、存储失败提示、明暗切换（`Dropdown` 三档）、抽屉开关（有打开过的内容才可用）。左侧导航底部只留导航收起。
- `host/theme.ts`：`installAppearance` 读偏好（`host/prefs.ts` 加 `readTheme`、`writeTheme`，存 `localStorage`，读写包 try/catch），跟随系统时才监听系统变化；导出 `useAppearance()` 给开关用。
- `host/book.ts`：`savedAt === null`（从没存过）时阅读位置默认 `info.extractedThrough`；`atLabel` 在位置等于抽取终点（章等于最后一章且未指定段，或段不小于终点段）时写“全部读完”。`parts/ReadingControl.vue` 同样显示。
- `host/book.ts` 加一次性的跳转目标 `jump(page, target)`：`target` 是 `{arc}`、`{secret}`、`{question}`、`{episode}` 之一，页面挂载时取走并清空，不进地址（临时定位，和抽屉里的原文一样）。
- `shell/LibraryPage.vue`：列书名、章数、抽取到的位置；空书库写出 `nbstory import` 命令。

### `src/web/pages/`（各页）

- `OverviewPage.vue`：主线、秘密行、本章情节、最近有进展的悬念（`questions.list` 未解与有进展、`sort: recent`、前 5 条）都可点，经 `book.jump` 定位；“这一章发生了什么”补上新出场的对象、数值变动、新提出与有进展的悬念（`chapter.digest` 已有这些字段）；加“继续读”。
- `SecretsPage.vue`：状态图例（`StateBadge` 各一个）；行标题下写“第 N 章读者知道”；列头名下写化名；格里写 `how`（过长截断、悬停看全文）与出处；接 `jump` 的 `secret`，滚到并高亮那一行。
- `QuestionsPage.vue`：状态页签带条数（三次 `limit: 1` 的计数查询）；状态标签上色；右侧“几次进展 · 最近 X”；展开后相关情节做成可点的小标签、历程做成竖排列表；接 `jump` 的 `question`。
- `TimelinePage.vue`：每个点下列情节（标题可点跳情节页、参与者 `NameLink`、地点）；时段缺失写“时段不明”；页顶写故事里过了几天。
- `EpisodesPage.vue`：标题旁写故事时间与地点；参与者写成“南嘉鱼（以地狱猫）”；连接的说明放在连接后；接 `jump` 的 `arc`、`episode`。
- `StatsPage.vue` 加三张图，新零件放 `parts/`，各配同名 `.md`：`ChapterBars.vue`（逐章堆叠柱、阅读位置竖线）、`CastHeatmap.vue`（人物乘以章的热力格）、`QuestionCurve.vue`（累计提出与解答两条线）。都用手写 SVG（与 `LedgerChart.vue` 一致，不引图表库），颜色取主题 token，点一章跳原文页的这一章。

### `src/web/graph/`（图）

- **拖动与文字选区**：画布容器与图的工具条 `user-select: none`；`downNode` 时清掉页面的文字选区并阻止原事件的默认行为。
- **点选小卡**：`StoryNetwork.vue` 选中一个点时 emit `select`，由页面在点旁边浮一张小卡（新零件 `graph/NodePopover.vue`），位置在每次 Sigma 渲染后按点的视口坐标更新，出画布时贴边；卡上是名字、类别、出场次数与按钮。抽屉开着时，`RelationsPage`、`BookGraphPage` 在选中变化时换抽屉内容。Escape 与点空白取消选中。
- **视角说明**：`RelationsPage.vue` 的整行改成视角选择旁的标记（nb-ui `Dropdown` 或 `Tooltip` 展开完整说明）。
- **只看周边的局部重排**：勾上时以选中的点为中心算一次放射排布（一跳邻居按联系类别分组、组内按关系说法多少排，均匀分布在一圈上），用现有的动画移过去；取消时动画回到记下的全图坐标。
- **接着排**：`relayout` 区分“从头排”（重新排版按钮、首次显示：现有的确定性做法）与“接着排”（换位置、层、门槛：已有的点用当前坐标起步，新点放在已有邻居的重心附近再加确定的小偏移，FA2 少跑几轮、noverlap 收尾）。`sigma-kit.ts` 的 FA2 设置加边权（关系说法条数，同场与认知取较小的权重）与 `linLogMode`。
- **全书图横向缩放**：`StoryLine.vue` 的横坐标乘以系数 `xScale`（1 到 12），由滑块与 Ctrl 加滚轮改，改的时候保持鼠标所在的章不动；下方新零件 `graph/ChapterRange.vue` 画出全书章节与当前看到的范围，拖动平移、拖两端改范围（换算成镜头位置与 `xScale`）。

### 分栏动画（反馈 9）

先在真实服务加 Chromium 里录一次：关系图页打开抽屉、收起抽屉、收起导航，用 `requestAnimationFrame` 记帧间隔，看掉帧集中在哪里。按结果做：图的尺寸监听在 Splitter 过渡期间（面板带 `data-animating`）只记下要重画，过渡结束（`transitionend`）后 `resize` 并重画一次；抽屉内容在过渡结束后再挂载。改动只在 nb-story；如果瓶颈在 nb-ui Splitter 本身，单独报告开发者。

## Spec 与文档改动

- `docs/specs/story/viewer.md`：输出 1、3（已删除）、4、5、8、11、13、14、15、17、25、26、27、28、30，新增 34、35；时序第 4 条、F5、副作用。
- `docs/specs/story/queries.md`：方法表的 `book.stats`、`secrets.matrix`、`questions.list`、`timeline`、`episodes.list` 五行，输出 2、9、11、12、13。
- `skill/references/commands.md` 与 Skill：命令行输出若带上新字段（时间线的情节、情节的地点），同步写进命令参考。

## 切片

| 切片 | 内容 | 提交 |
|---|---|---|
| P1 | 查询新字段与测试 | 一次提交 |
| P2 | 外壳：明暗、书架、顶栏按钮、默认位置、删页脚 | 一次提交 |
| P3 | 各页：总览、秘密、悬念、时间线、情节、统计图 | 一次提交 |
| P4 | 图：拖动与选区、点选小卡、视角标记、局部重排、接着排与边权、横向缩放 | 一次提交 |
| P5 | 分栏动画：录性能、按结果改 | 一次提交 |
| P6 | e2e 更新与新增、截图、前端审查与处理 | 各一次提交 |

每片自跑 `bun run typecheck`、`bun test`（包内）；P4 起跑 e2e。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| `story.queries` 输出 2、9、11、12、13 的新字段 | `src/core/queries/{books,secrets,questions,timeline,episodes}.test.ts`；`spoiler.test.ts` 在五个位置覆盖新字段 |
| `story.viewer` 输出 1、4、5、34、35 | `e2e/viewer.e2e.ts`：新书第一次打开在最后位置并显示“全部读完”；明暗切到暗色后 `<html>` 的明暗为 dark，刷新后保持；书架入口回到 `/`、书名下拉换书 |
| `story.viewer` 输出 3（已删除） | e2e：没有页脚；保存失败时顶栏出现提示（拦截 `reading.set` 返回 500） |
| `story.viewer` 输出 8 | e2e：总览点主线到情节页且只看这条主线；点秘密行到秘密页 |
| `story.viewer` 输出 25、26、27 | e2e：先选中页面文字再拖点，点的位置变了；点一下只出小卡、不开抽屉，“打开人物卡”打开；抽屉开着时点另一个点，抽屉换人；勾“只看周边”后选中的点在画布中央 |
| `story.viewer` 输出 30 | e2e：横向缩放后章节条的范围变窄、行数不变 |
| 其余各页的展示 | 截图给开发者看，加前端审查 |

## 验证

- 包内 `bun run typecheck`、`bun test`；`bun run test:e2e`（构建后跑）；`docs:check`、`governance:check`。
- 宽屏与平板两档、亮暗两种主题各截一套主要页面，给开发者看。
- 分栏动画用帧间隔的前后对比说明效果。

## 不做与风险

- 拖动过的点不跨“重新排版”保留（Spec 仍规定图的位置不保存）。
- “接着排”让同一位置的结果与到达它的路径有关；确定性只对“从头排”承诺（Spec 输出 25 已改）。现有 e2e 的确定性用例改为经“重新排版”比较。
- 统计图手写 SVG，不做缩放与图例交互。
