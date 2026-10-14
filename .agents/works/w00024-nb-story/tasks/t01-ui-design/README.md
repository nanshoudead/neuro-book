---
schema: nbook.task/v2
taskId: t01-ui-design
status: active
updated: 2026-10-14
---

# nb-story 第一版界面设计

## 目标与范围

定下 nb-story 第一版网页（查看器加问答）的版式、入口和信息层级，按 [design-review](../../../../../.claude/skills/design-review/SKILL.md) 的流程：先定注意力排序，再在 Lab 里用真实 nb-ui 组件搭静态稿逐轮评审，定稿后把行为写进 `planned` Spec。

- 不写产品代码。Lab 草稿放在单独的草稿 worktree `.worktree/w00024-t01-drafts`（分支 `chore/w00024-t01-drafts`，由 `nbdev worktree new` 建，不合并、不推送；2026-10-14 w00017 合入后开）。
- 设计依据：w00005 的提案 `docs/proposals/novel-story-app.md`（accepted，2026-10-13；随 w00005 落到 master 之前，只在 `.worktree/w00005-novel-understanding-spike/` 里）。
- 数据：w00005 t34 自动抽取的前 100 章。

合同：定稿后写 `planned` Spec（查看器、问答）；本 Task 不改现有 Spec。

## 当前状态

- 现状与参照清单：[reference.md](reference.md)（数据、t28 查看器的问题、要沿用的机制和它防什么、外部参照）。
- 评审板 [artifacts/review/index.html](artifacts/review/index.html)：第 1 轮五道题已答（见下文“决定”）。第 2 轮（2026-10-14）只问一题 `host`，已答：先做独立服务（见下文“决定”第 7 条）。第 3 轮（2026-10-14）是静态稿：五个画面（全书总览、人物名册加人物卡、秘密矩阵、问答页加原文、导航收起），问两题：版式能否往下细化（`draft-layout`），问答答案怎么呈现（`qa-answer-format`）；另列了搭稿时发现的四个问题（矩阵与问答说法不一、化名按读到哪里合并、后面章节标题会剧透、称呼噪音）。
- 第 4 轮（2026-10-14）按决定第 8 条改稿：段落级阅读位置、人物卡分页签与几百条记录的筛选、关系图、全书图（按关联与按章节两种排布）。问两题：全书图怎么排（`data-graph-layout`）、人物卡分页签还是一长页（`card-tabs`）；第 3 轮的 `qa-answer-format` 仍待答。另列三个问题：关系线上的字不是关系（记忆图缺“两人是什么关系”）、同名对象、小关系图太挤。
- 静态稿：草稿 worktree 的 `packages/neuro-book/src/plugins/lab/web/components/drafts/`（`NbStoryDraft.vue`、`StoryGraph.vue`、`StoryLine.vue`），Lab 场景 `NbStoryDraft`（12 个场景），数据 `fixtures/drafts/story-draft-data.json` 由 t34 `dataset-v9.json` 抽“读到第 38 章”的样本；画图库 Cytoscape.js 只装在草稿 worktree；都不提交。截图集在主工作区 `.local/agent/works/w00024-nb-story/tasks/t01-ui-design/shots/`。

## 决定

第 1 轮（评审板 v1，开发者 2026-10-13 在面板上答复，答复 `20261013T140832371Z-8153e139`）：

1. **首页（`home`）**：打开一本书回到上一次的界面（页面、人物、阅读位置）；第一次打开时进入全书总览（主要人物、秘密矩阵、未解悬念数、数值余额）。没有采用推荐的“本章”。
2. **默认收起（`default-collapsed`）**：次要人物、记录编号、原文里夹着的段落块概括、琐碎的悬念、人物卡里的长称呼表默认收起；标了“推断”的记录照常显示。
3. **问答的位置（`qa-place`）**：顶栏常驻提问框，回车后进问答页。
4. **嵌进 NeuroBook 后的尺寸（`embed-size`）**：两种都要。整页是主体；侧栏精简版以后再做；第一版保证整页在窄宽度下不坏。
5. **沿用 t28 的机制（`keep-mechanisms`）**：读到哪里、段落记录条数和点段看记录、名字带底色可点、“明说、推断、角色的说法”标签、“没有记录不等于不知道”的图例，以及“说明与统计”页，六项都沿用。没有采用“去掉统计页”的推荐。
6. **布局（答复备注）**：布局像 IDE，各面板之间要能拖拽改变尺寸，也要能收起；这部分参考 nb-ui 或 NeuroBook 工作台的 grid 代码，看能否复用。

第 2 轮（评审板 v2，开发者 2026-10-14 在面板上答复，答复 `20261014T154304622Z-544e762e`）：

7. **跑在哪里（`host`）**：按提案原计划，先做独立服务，再做插件接入。没有采用推荐的“做成 NeuroBook 插件”。三栏用 nb-ui 的分栏组件搭，规则照工作台外壳（见下文“面板布局能复用什么”）；页面组件只用注入的 client，以后插件复用同一批组件。

第 3 轮（评审板 v3，开发者 2026-10-14 在会话里口头答复，Agent 代录为答复 `20261014T160710419Z-2337330a`；`qa-answer-format` 还没答）：

8. **版式（`draft-layout`）**：可以往下细化。另提三点：
   1. 读到哪里的最小单位不是章：章节滑块之外再加一个段落级的滑块，不常用，默认收起。
   2. 很多地方是成百上千条，不是几十条（例如人物卡里知道的秘密、参与的情节），稿子要按这个量级设计。
   3. 最主要的是图：可以引入画图的依赖库；关系题适合用图展示，整个数据结构也可以用一张图展示。同一份数据既能看图，也能看人物卡这样的条目。

## 面板布局能复用什么（2026-10-13 调研，只读）

- **nb-ui 已有通用的面板布局**（master 与 w00017 都有，`packages/nb-ui/src/components/layout/`）：`createGrid` 管嵌套的左右、上下分栏；`GridRenderer` 把它渲染出来；`Splitter` 的分隔条可拖拽、可用键盘调整，拖过阈值吸附收起、反向拖回展开，取消手势不提交；快照 v2 只存结构和尺寸意图，保存由宿主负责。行为合同是 `docs/specs/ui/nested-grid.md`（`planned`）。w00017 另加了 `useGridLayout`，把“树、容器尺寸、一次手势提交”装配好给宿主用。nb-story 的左侧导航、主区、右侧抽屉直接用这些搭，不另写分栏。
- **工作台外壳的规则可以照搬**（w00017 `packages/neuro-book/src/plugins/workbench/web/shell/layout.ts`，纯模块，从旧应用已验证的外壳搬来）：侧栏、右栏的偏好只存绝对宽度，主区吸收余量；放不下时先保住主区最小宽度，再按比例压侧栏，仍放不下就进入紧凑呈现；拖过阈值收起。这份代码带着工作台的词表（标题栏、活动栏、编辑器、面板），不能原样引用，规则照着做。
- **还有一条路，等 w00017 合入后评估**：单独使用时，nb-story 直接跑在“NeuroBook 运行时加工作台插件加 nb-story 插件”上，整套 IDE 外壳（拖拽、收起、布局保存）全部复用，单独使用和嵌进 NeuroBook 只有一套界面。代价是单独使用也要带上插件运行时，而插件系统的 Spec 大部分还是 `planned`。提案原定先做独立服务、以后再接插件；要不要改，等看过合入后的工作台再交开发者定。

## 跑在哪里（2026-10-14 w00017 合入后评估，只读）

- **已经能用的**（`implemented`）：插件描述与激活（`runtime/plugins.md`）、工作台外壳（`ui/workbench-shell.md`，七个 Part、拖拽、收起、布局记录）、视图贡献点 `workbench.views`（侧栏、右栏、面板）、标题栏与状态栏与活动栏底部的条目贡献点、页面浮层、项目（一本书可以是一个项目，在书架上打开）。
- **要等的**：编辑区里开 nb-story 自己的页签，要靠 w00025 t02 正在做的编辑器贡献点（按文件类型选编辑器，计划已定，S2 进行中）。
- **暂时做不到的**（`planned`）：插件登记自己的地址方案（`workspace/resources.md`；没有它，每个人物卡不能各开一个页签）、第三方插件安装（`runtime/plugin-install.md`；nb-story 先作内置插件放在 `packages/neuro-book/src/plugins/` 下）、插件的密钥接口（`runtime/plugin-api.md`；问答调模型先读环境变量或用户设置）。
- **不受影响的**：核心库、命令行、Skill 不依赖 NeuroBook，两条路一样。
- 当时推荐做成插件；开发者定先做独立服务（决定第 7 条）。上面几条留作以后接插件时的起点。

## 下一步

1. 等开发者答第 4 轮两题和第 3 轮的 `qa-answer-format`；之后补数值、悬念、时间线、情节、原文五页、“在主区打开”的记录表和手机、平板宽度的稿子。
