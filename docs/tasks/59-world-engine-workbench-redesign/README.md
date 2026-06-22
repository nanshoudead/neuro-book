# World Engine Workbench Redesign

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- [docs/tasks/56-world-engine/README.md](../56-world-engine/README.md)：World Engine 核心模型、API、Preview / Workbench 当前实现记录。
- [app/pages/world-engine.preview.vue](../../../app/pages/world-engine.preview.vue)：当前独立 Preview 页面。
- [app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue](../../../app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue)：当前主 IDE 内嵌 Workbench。
- [app/components/novel-ide/plot/workbench/PlotWorkbenchDialog.vue](../../../app/components/novel-ide/plot/workbench/PlotWorkbenchDialog.vue)：Plot Workbench 三栏与 Inspector 复用参考。
- [app/components/novel-ide/plot/workbench/PlotWorkbenchSidebar.vue](../../../app/components/novel-ide/plot/workbench/PlotWorkbenchSidebar.vue)：Plot 左栏搜索、筛选、列表与上下文菜单参考。
- [app/components/novel-ide/plot/workbench/PlotWorkbenchInspector.vue](../../../app/components/novel-ide/plot/workbench/PlotWorkbenchInspector.vue)：Plot 右侧 Inspector 就地编辑与 patch 事件参考。
- [server/api/projects/world-engine/[...segments].ts](../../../server/api/projects/world-engine/[...segments].ts)：World Engine HTTP API 聚合路由。
- [server/world-engine/world-engine.service.ts](../../../server/world-engine/world-engine.service.ts)：World Engine service 层 subject / slice / state 语义。
- [server/world-engine/world-engine.repository.ts](../../../server/world-engine/world-engine.repository.ts)：World Engine Project SQLite 访问层。

## User Request / Topic

- 停止使用 Open Design 继续设计，回到项目现有 preview / Workbench 页面路线。
- 新建一个 World Engine Workbench 重设计任务。
- 重新设计 Workbench，用户有两个常用视角：
  - 整体查看世界。
  - 对单个 subject 的查看。
- 新建一个预览页面，重新设计这个 workbench。
- 使用三栏布局：
  - 左侧：schema 和 subjects，可收起。
  - 中间：世界切片列表。
  - 右侧：详细 Inspector，可隐藏，参考 Plot Workbench。
- 中间切片列表应支持过滤，例如查看单个 subject、只看某些 subjects。
- 中间上下两行布局：上方切片列表，下方 Mutation Editor，Mutation Editor 可收起。
- 切片卡片应突出 `title` / `summary` / `kind`，并在卡片下按 subject 分组展示 mutations。
- Inspector：
  - 显示当前切片元信息，并能像 Plot Inspector 一样就地修改。
  - 显示当前 State Snapshot，也就是完整 reduce 后的状态，可展开查看各个 subject 的状态。
- Mutation Editor：
  - 能按 subject 切换多个视图。
  - subject 视图下显示当前切片下该 subject 的状态和 mutation 变更。
  - subject 视图支持左右移动：左移到上一个包含该 subject 的切片，右移到下一个包含该 subject 的切片。
  - 总视图查看当前切片全部 mutations。
- 学习 Plot Workbench 的组件复用思想，保持 UI 和代码一致性。

## Goal

设计并落地一个新的 World Engine Workbench 预览页面，以“整体世界视角 + 单 subject 视角”为主心智，验证新的三栏布局、切片过滤、切片卡片 subject 分组、可隐藏 Inspector、State Snapshot 和 Mutation Editor subject 视图是否能支撑后续主 IDE Workbench 重构。

- Outcome：存在一个新的预览页面，可在真实 World Engine API 数据上浏览 subjects / schema、筛选 timeline slice、查看按 subject 分组的 slice 卡片、查看和编辑 selected slice 元信息、查看完整 State Snapshot，并使用新的 Mutation Editor 组织当前 slice mutations。
- Verification surface：前端契约测试覆盖新页面入口、三栏组件拆分、subjects API 调用、slice 过滤、mutation 分组、Inspector 隐藏与 patch 事件；必要时用户确认后再做浏览器实跑。
- Constraints：第一版优先复用现有 `/api/projects/world-engine/**` API，不先改后端；不破坏现有 `/world-engine.preview` 和主 IDE `WorldEngineWorkbenchDialog`；Preview 页面可以并存，后续再决定迁移/替换。
- Boundaries：前端优先落在 `app/pages/` 与 `app/components/novel-ide/world-engine/`；API 只在现有能力无法支撑完整体验时再讨论扩展。
- Iteration policy：先做只读预览与布局，再接入 Inspector 元信息编辑和 Mutation Editor；每轮实现后更新本任务 walkthrough。
- Blocked stop condition：如果现有 API 无法支撑某个核心交互，且前端绕过会制造技术债，则停止实现，报告所缺 API 契约和建议扩展方案。

## Current State

- `docs/tasks/56-world-engine` 已完成 World Engine 后端核心、HTTP API、Agent 工具、独立 Preview 和主 IDE Workbench 的第一轮产品化；当前路线无 re-settle，写入 / 编辑 / 删除 / 查询都通过 `issues` 暴露 E/A 问题。
- 当前 `/world-engine.preview` 是完整 API 调试页，已有 Project 选择、subject 创建、slice 写入 / 编辑 / 删除、state query、E/A issues、Mutation Builder 和一键示例世界。
- 当前 `/world-engine.workbench-preview` 是 mock-only UI / UX 沙盘，用贴近真实 DTO 的 schema / subjects / slices / snapshot 数据验证三栏 Workbench 心智；真实主入口已由 `WorldEngineWorkbenchDialog` 接管，mock preview 不访问真实 API，也不再作为待替换入口。
- 当前主 IDE `WorldEngineWorkbenchDialog` 已替换为真实 API 三栏 Workbench：左侧 schema / subjects / 主体系统 discovery，中间 timeline / Drafts / Slice Composer，右侧 Inspector，底部审查工作台；支持真实 subject timeline 服务端过滤、State Snapshot、metadata/value 显式保存、slice 写入 / 编辑 / 删除、issue 审查和会话草稿保护；删除 slice 返回的 transient issue 会保留被删除 slice 来源，且无选中 slice 的空状态会展示 Review Queue issue 摘要，避免删除后只剩顶部 issue 数量提示。
- Plot Workbench 已形成可复用模式：
  - Dialog 负责顶层状态、选中对象和事件编排。
  - Sidebar / SceneList / Inspector 作为稳定三栏子组件。
  - Inspector 使用 `Transition` + `v-if` 隐藏/显示。
  - Inspector 内部就地编辑，通过 `updateThread` / `updateScene` / `updatePlot` 这类 patch 事件上抛。
  - 表单优先复用 `FormField`、`FormInput`、`FormSelect`、`StructuredTextEditor` 等通用组件。

## Current Subject API

### 读取 subjects

- HTTP 入口：`GET /api/projects/world-engine/subjects`
- 必填 query：
  - `projectPath`：由 `requireProjectPathQuery(event)` 读取，指定 Project Workspace。
- 可选 query：
  - `type`：由 `readOptionalStringQuery(event, "type")` 读取，会 trim，空字符串视为未传。
- 路由层调用：
  - `worldEngineFacade.listWorldSubjects(projectPath, { type })`
- Service 层：
  - `WorldEngineService.listWorldSubjects(query: { type?: string })`
  - 调用 `repository.listSubjects({ type })`
  - 返回 `subjects.map((subject) => ({ id, type, name }))`
- Repository 层：
  - `WorldEngineRepository.listSubjects(query: { ids?: string[]; type?: string })`
  - Prisma 查询 `worldSubject.findMany`
  - 支持按 `ids` 和 `type` 过滤，但当前 HTTP subjects endpoint 只暴露 `type` 过滤。
  - 排序为 `type asc`，再 `id asc`。
- 返回 DTO：

```ts
type WorldSubjectDto = {
    id: string;
    type: string;
    name: string;
};
```

### 当前读取行为的产品含义

- `GET /subjects` 只返回 subject 身份列表，不返回状态、attrs、默认值、初始化时间或最后出现时间。
- 如果左侧只需要 subject 列表、计数、按 type 分组、搜索 id/name/type，现有 API 足够。
- 如果左侧要显示“当前状态摘要”“最新位置”“最近参与的 slice”等，需要额外调用 `state/query` 或从 slices/mutations 侧聚合。
- 如果要批量读取某些 subject 的完整 reduce 状态，应使用 `POST /api/projects/world-engine/state/query`，body 可传：

```ts
{
    subjectIds?: string[];
    type?: string;
    attrs?: string[];
    at?: string;
    listLimit?: number;
}
```

- `state/query` 至少需要 `subjectIds` 或 `type`；返回 `subjects` 和 `issues`。
- 如果要读取某时刻全量世界状态，可用 `GET /api/projects/world-engine/state?projectPath=...&at=...`，返回 `time / subjects / issues`。

### 创建 subject

- HTTP 入口：`POST /api/projects/world-engine/subjects`
- body：

```ts
{
    id: string;
    type: string;
    name?: string;
    time: string;
}
```

- 路由层会把 `time` 用 Project calendar 解析成 `Instant`。
- Service 层 `createSubject` 会：
  - 校验 `type` 是否在 schema 声明。
  - 写入 `WorldSubject` 身份记录。
  - 收集该 subject type 的 schema default attrs。
  - 只有 default mutation 非空时才写入初始化切面；default 为空则只注册 subject 身份。
  - 如果 `time` 对应 instant 已有 `kind: "init"` slice，则追加 default mutations；如果已有非 init slice，则返回 409，要求用户显式编辑该 slice 或换初始化时间。
- 返回：

```ts
type CreateWorldSubjectResult = {
    subjectId: string;
    issues: WorldIssue[];
};
```

### 对新 Workbench 的直接影响

- 左侧 `Subjects` 第一版可直接复用 `GET /subjects`。
- 左侧 `Schema` 可并行调用 `GET /schema`，用于 subject type 分组、attr shortcut 和创建 subject 表单。
- 中间 slice 过滤如果只看单个/多个 subject，真实 API 已支持 `GET /slices?subjectIds=erina,moran&subjectMode=any|all&withMutations=true`，避免长 timeline 下只过滤当前页导致漏掉较早切片。
- kind / health / search 仍是当前前端已加载结果上的本地过滤；如果未来 timeline 规模继续变大，再评估是否也进入服务端查询参数。
- State Snapshot 应使用 `state/query` 或 `state`：
  - selected slice 的完整世界快照：`GET /state?at=<slice.time>`。
  - selected slice 触及主体快照：`POST /state/query`，`subjectIds` 为该 slice mutations 分组后的 subject ids，`at` 为 slice time。
  - 单 subject 视图：`POST /state/query`，`subjectIds: [currentSubjectId]`，`at` 为 selected slice time。

## Decisions / Discussion

- `/world-engine.workbench-preview` 继续作为 mock-only 设计沙盘；主 IDE 真实入口已经迁移到 `WorldEngineWorkbenchDialog`。
- `/world-engine.preview` 保留为 API 调试台，负责快速试用 Project / subject / slice / state query。
- mock 数据继续贴近实际 World Engine DTO：subject 使用 `id / type / name`，slice 使用 `time / title / summary / kind / mutations / issues`，state snapshot 使用 reduce 后的 subject attrs。
- 新设计以切片和 subject 为核心，不再以 `Timeline / Edit / State / Schema` 技术 tab 为主心智。
- 左侧可以收起；右侧 Inspector 可以隐藏；中间区域必须在 Inspector 隐藏时自然扩展。
- 中间切片列表的卡片必须按 subject 分组展示 mutations，便于用户从“这一刻影响了谁”理解世界演化。
- Mutation Editor 需要有“总视图”和“subject 视图”。subject 视图不是只筛 mutation，还要显示该 subject 在当前 slice 时刻 reduce 后的状态。
- subject 视图左右移动已基于当前过滤结果或当前 subject 全量轨迹实现；真实 Dialog 的 subject timeline 过滤已接服务端 `GET /slices?subjectIds=...&subjectMode=...`。
- Inspector 就地修改 slice 元信息时，优先学习 Plot Inspector 的 patch 事件风格，但 World Engine 当前 API 是 `editSlice` 整块替换；前端可在保存时合并当前 mutations 后调用 edit API。
- mock preview 的 Inspector 元信息编辑只更新本地状态，按钮文案采用“应用到预览”；真实 Dialog 使用“保存到世界”，并在保存时合并当前 mutations 调 `editSlice`。
- State Snapshot 默认展示当前切片触及 subjects；右侧提供“展开完整世界状态”能力，兼顾整体世界视角和单 subject 视角。
- 左侧 schema 第一版只做 schema 摘要和 type / attr 快捷信息，不做 schema 编辑。
- 底部审查工作台负责问题处理 / subject 视图 / 总变更；复杂新建或整块编辑 slice 通过主 Dialog 内的 Slice Composer 复用 schema-aware Mutation Builder。
- 视觉方向采用 World Engine 专属“技术工作台”：参考冷静、表格式、状态明确的 World Engine 截图；Plot Workbench 只作为分区节奏参考。Preview route 内局部映射主题变量，不修改全局 IDE 主题。
- 第一屏优先服务“浏览世界切片”；Mutation Editor 降为底部辅助区，默认更克制，避免抢占切片列表主画布。

## Proposed Component Shape

- `WorldEngineWorkbenchPreviewPage.vue` 或新的 route 页面：
  - 负责 project 选择 / projectPath query、API load、顶层 selected slice / selected subjects / panel visibility 状态。
- `WorldEngineWorkbenchShell.vue`：
  - 三栏布局、顶部栏、左右栏显隐。
- `WorldEngineWorkbenchSidebar.vue`：
  - schema 摘要、subject 搜索、type 过滤、subject 多选。
- `WorldEngineSliceList.vue`：
  - 切片搜索、subject 过滤、slice 卡片列表。
- `WorldEngineSliceCard.vue`：
  - title / summary / kind / time / issues。
  - 内部按 subject 分组展示 mutations。
- `WorldEngineSliceInspector.vue`：
  - slice 元信息就地编辑。
  - State Snapshot 展示与 raw JSON 展开。
  - 当前 slice issues、State issues 与 Review Queue 定位。
- `WorldEngineMutationEditorPanel.vue`：
  - 可收起。
  - 总视图 / subject 视图切换。
  - subject 视图状态快照 + mutation 变更。
  - subject 上/下一个相关 slice 导航。

## Verification / Test

- 已完成 mock milestone 验证：
  - `bun run typecheck`
  - `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
- 当前测试覆盖 mock 数据工具与核心交互契约：
  - slice 按 subject 分组。
  - subject 过滤。
  - 当前 slice 触及 subject 状态筛选。
  - subject 上 / 下一个相关 slice 导航。
- 真实 API 接入契约已迁入 `docs/tasks/61-world-engine-workbench-real-api`，当前窄测试覆盖：
  - 调用 `/api/projects/world-engine/schema`、`subjects`、`slices?withMutations=true`、`state/query` / `state`。
  - Inspector 元信息保存时走 `editSlice` API。
  - subject timeline 使用服务端过滤。
  - Drafts / dirty guard / Project 切换草稿保护等主入口契约。
- 不自动执行浏览器验证；需要浏览器复验时由用户明确允许，并把结果写入 walkthrough。

## Implementation Walkthrough

- 2026-06-19：新增 `/world-engine.workbench-preview` mock 预览页，拆分为左侧 Sidebar、中间 SliceList / SliceCard / MutationEditor、右侧 Inspector。
- 2026-06-19：新增贴近真实 World Engine DTO 的 mock 数据：schema projection、subject 身份列表、world slices、reduce 后 state snapshot。
- 2026-06-19：左侧支持 schema 摘要、type / attr 快捷信息、subject 多选过滤和收起。
- 2026-06-19：中间 slice 列表支持整体世界视角与多 subject 过滤；slice card 突出 `title` / `summary` / `kind`，并按 subject 分组展示 mutations。
- 2026-06-19：Mutation Editor 支持总视图与 subject 视图；subject 视图展示当前 subject 状态、mutation 变更，并能跳到上 / 下一个包含该 subject 的 slice。
- 2026-06-19：Inspector 支持隐藏、slice 元信息本地编辑、当前触及 subject snapshot 与完整世界状态展开；mock 阶段按钮文案为“应用到预览”。
- 2026-06-19：页面顶层的 slice / snapshot 状态使用 `shallowRef`，避免递归 JSON 状态触发 Vue 深层类型展开。
- 2026-06-19：按技术工作台方向优化 preview 视觉：页面内局部映射主题变量，顶栏压实为 project / calendar / sync 状态，左侧 subject-first，切片列表增加时间轴节点，slice card 改为紧凑 subject mutation 表格。
- 2026-06-19：Mutation Editor 降低展开高度并改为数据面板；Inspector 改名为 `Slice Context`，补充 `Schema excerpt`，State Snapshot 和 raw JSON 默认更适合检查流。
- 2026-06-20：完成一轮浏览器 UI/UX 评估与修正：默认选中首个可见 slice，左侧 Schema 摘要避免截断，左右栏宽度在普通桌面与宽屏之间响应式切换，subject 过滤和 Editor 上 / 下一个导航会自动对齐选中 slice，并让列表滚到选中卡片。
- 2026-06-20：补充过滤空状态恢复入口、`backstory` 历史补充 mock 切片、Mutation Editor 折叠态摘要，并限制 Inspector State Snapshot / raw JSON 展开高度。
- 2026-06-20：修正单 subject 查看路径：Slice List 显示 subject filter chips，顶栏使用 subject name，Mutation Editor subject 视图会跟随外部 subject 过滤自动切到对应 subject。
- 2026-06-20：补齐 Inspector 与 Mutation Editor 的 subject 焦点联动：右侧 `Touched Subjects` 可点击聚焦，底部 subject 视图和右侧 State Snapshot 自动同步。
- 2026-06-20：Mutation Editor 默认改为折叠信息条，保留当前 slice / mutation / active subject 摘要；点击 Inspector subject 时自动展开，优先保障首屏 Slice List 浏览空间。
- 2026-06-20：补齐主画布到单 subject 视角的入口：Slice Card 内 subject mutation group 可直接聚焦 subject，并同步选中 slice、底部 Mutation Editor 与右侧 State Snapshot。
- 2026-06-20：Slice Card 内 subject mutation group 增加“只看 subject”入口，可直接从主画布切到单 subject timeline；同时修正 Mutation Editor 顶栏在 1180 桌面视口下的换行 / 竖排问题。
- 2026-06-20：Mutation Editor 从只读检查面板推进到可编辑 mock 面板：subject 视图和总视图均可编辑 mutation value，应用后会更新 slice card、右侧 State Snapshot 和顶栏 notice；非法 JSON 草稿显示局部错误，不污染 mock 数据。
- 2026-06-20：抽出 `world-engine-workbench-preview-state.ts`，将 mutation value patch 和 mock snapshot reduce 从 route 页面移到 util；reduce 现在从 schema default + subject 身份重新构造全量 snapshots，避免第一张 slice 的相对 mutation 被重复叠加。
- 2026-06-20：补充 mock reducer 行为测试，覆盖 schema default、相对 mutation reduce、mutation value patch 后的状态重算和 `collectionAdd` 去重，避免只靠静态字符串契约证明编辑闭环。
- 2026-06-20：抽出 `world-engine-workbench-preview-value.ts`，将 Mutation Editor 的 value parser / formatter 从组件移到 util，并补充 JSON-like 输入、数字、布尔、null、非法 JSON 的行为测试。
- 2026-06-20：新增 `WorldEngineWorkbenchPreviewValueInput`，Mutation Editor value 输入开始按 schema 渲染 text / number / bool select / ref subject select / enum select / JSON textarea，减少用户手写格式的负担。
- 2026-06-20：补齐 `collectionRemove` mock 编辑路径，新增 `艾莉娜把旧剑交给莫然` 切片；Mutation Editor 会从当前 snapshot 的 collection 状态生成已有项下拉，`inventory collectionRemove` 可直接选择 `旧剑 · old-sword`。
- 2026-06-20：Mutation Editor 增加 slice 前后状态对照，subject 视图和总视图都会基于 previous / current snapshot 显示 mutation attr 的 `切片前 / 切片后` 值，降低用户检查变更结果时的推理成本。
- 2026-06-20：Slice List 增加整体世界巡检过滤，支持按 slice `kind` 自动生成 `init / event / backstory` 过滤，并支持 `review / clean` issue 状态过滤；清空状态过滤可恢复完整时间线。
- 2026-06-20：Inspector 增加 `Review Issues` 区块，review slice 会展示 issue level、code、subject、attr 和 message；点击 issue 可聚焦对应 subject 并联动 Mutation Editor 查看 mutation 与切片前后状态。
- 2026-06-20：Inspector issue 点击继续推进到 attr 级定位；Mutation Editor 会高亮命中的 mutation 行并显示 `issue target`，让 review 用户直接看到具体问题变更。
- 2026-06-20：Mutation Editor 增加 `Review Focus` 状态条，展示当前 issue code、subject、attr、message，并提供 `清除定位`，让 issue target 高亮有明确上下文和生命周期。
- 2026-06-20：Preview route 增加浏览器本地 mock 草稿持久化；slice metadata / mutation value / 面板状态会保存到 `localStorage`，刷新后恢复，`重置 mock` 会清除草稿并回到默认数据。
- 2026-06-20：修复 Inspector 草稿同步问题；同一个 slice id 下 reset 或恢复 metadata 时，`time/title/summary/kind` 表单会跟随外部 slice 字段刷新。
- 2026-06-20：左侧 Subjects 增加 activity / review stats；subject 行展示最近出现时间、最近 kind、mutation 数和 issue 数，顶部显示 active / review subject 汇总。
- 2026-06-20：Inspector 增加 `Review Queue`，支持在多个 review issues 之间上 / 下一个跳转；mock 新增 `masked` issue 验证连续检查流程。
- 2026-06-20：`重置 mock` 现在会同步清空 Sidebar / Slice List 的本地过滤，避免 reset 后仍停留在 review 过滤结果。
- 2026-06-20：Inspector 增加 mock-only issue triage，review issue 可标记为 `待处理 / 已确认 / 已忽略`；Review Queue 显示 `open / done / confirmed / ignored` 进度，状态随浏览器 v3 草稿刷新恢复，`重置 mock` 会清空 triage。
- 2026-06-20：Slice List / Slice Card 改为 triage-aware review 状态；status 过滤从 `review / clean` 升级为 `open / done / clean`，卡片显示 `open X/Y` 或 `done X/Y`，让主画布同步反映 issue 处理进度。
- 2026-06-20：Review Queue 默认改为 `只看 open` 的连续处理模式，并保留 `全部 issue` 回看；确认当前 issue 后可直接跳到下一个 open issue，open queue 清空时显示完成状态。
- 2026-06-20：左侧 Subjects stats 改为 triage-aware；顶部显示 `open / done` subject 数，subject 行从 raw `N issue` 改为 `N open` 或 `N done`。
- 2026-06-20：左侧顶部 `active / open / done` stats 改为本地快捷过滤按钮，可快速收窄 subject 列表；该过滤不修改中间 timeline 的 subject 选择，保持左栏查找和主画布世界视角分离。
- 2026-06-20：Review Queue 的 `只看 open / 全部 issue` 模式从 Inspector 内部状态提升到页面顶层，并写入浏览器 mock 草稿；刷新后会保留用户当前的处理 / 回看模式，旧 v3 草稿缺省时默认回到 `open`。
- 2026-06-20：左侧 Sidebar 增加当前状态过滤 chip 和 subject review 分布展示；subject 行会显示 `done / ok / ignored` 紧凑 badge，并在 title 中保留 `total / open / confirmed / ignored` 完整分布。
- 2026-06-20：Mutation Editor subject 视图的上 / 下一个相关 slice 导航增加范围切换；默认按当前 subject 全量轨迹跳转，也可切到当前 subject 过滤组合，并复用 Slice List 的 `任一 / 全部 subject` 语义。
- 2026-06-20：Slice List 的 search / kind / status 过滤状态从组件内部提升到页面顶层，并写入浏览器 mock 草稿；刷新后会恢复当前时间线巡检上下文，`重置 mock` 会同步清空这些过滤。
- 2026-06-20：抽出 `world-engine-workbench-preview-filter.ts` 共享过滤 util；Slice List 和 Mutation Editor 的 `过滤组合` 导航现在共用同一套 subject / kind / status / search 判断，底部上 / 下一个会按当前主画布可见结果跳转。
- 2026-06-20：顶栏和 Slice List 增加当前过滤上下文摘要；`search / kind / status / subject mode` 会显示为可操作 chip，恢复浏览器草稿后用户能直接看到叠加过滤条件，并从主画布快速清除或切换。
- 2026-06-20：Slice List 增加当前结果摘要条，展示 `visible slices / subjects touched / open slices+issues / review done / clean slices`；subject mode 控件改为上下文式，无过滤显示整体世界，单 subject 显示单主体，多 subject 时才显示 `任一 / 全部 subject` 切换。
- 2026-06-20：Inspector 增加当前切片 `Slice Health` 摘要，并调整信息顺序为 metadata -> 当前 slice health -> 当前 slice issues -> 全局 Review Queue -> subjects / snapshot；clean slice 不再让全局队列抢占当前上下文。
- 2026-06-20：Slice List 标题行新增当前可见切片 stepper，显示 `current / visible total`，并可在当前过滤结果内上 / 下一个切片浏览；subject / kind / status / search 过滤后不会跳出主画布可见结果。
- 2026-06-20：Inspector metadata 表单增加 dirty 状态；未修改时显示 `已同步` 并禁用 `应用到预览`，修改后显示 `未应用修改`，提供 `还原` 入口，避免用户重复提交无变化 patch。
- 2026-06-20：Mutation Editor value 草稿增加 dirty 状态；标题栏和内容区会显示未应用 value 数，mutation 行显示 `dirty` badge，并支持 `应用全部 / 还原全部`，批量应用会先校验所有 dirty value 后再写入 mock preview。
- 2026-06-20：Mutation Editor value 草稿改为跨 slice 保留；切到其他 slice 再返回时未应用 value 不会被覆盖，`重置 mock` 会清空这些运行态草稿。Slice Card 同时补充原生 `选择切片` 图标按钮，避免只依赖整卡 article click。
- 2026-06-20：Mutation Editor 增加跨 slice draft queue；切到其他 slice 后会显示 `其他 N` 和 `跳到草稿`，可回到下一个未应用 value 所在 slice。当前 `应用全部 / 还原全部` 仍只作用于当前 slice，避免隐性跨切片提交。
- 2026-06-20：Mutation Editor 的 `Draft Changes` 增加 `清空草稿`，可一次性放弃当前和其他 slice 的未应用 value 草稿；该动作只清运行态草稿，不写入 mock slice，也不重置整个 preview。
- 2026-06-20：Mutation Editor 折叠态标题栏增加 `跳到草稿 / 清空草稿`，面板收起后也能处理跨 slice value 草稿，不必先展开底部面板。
- 2026-06-20：Slice Card 增加 value draft badge；Mutation Editor 将未应用 value 草稿以只读 summary 上报父页面，主画布按 slice 显示 `draft N`，让用户扫时间线时能看到草稿落点。
- 2026-06-20：Slice List status 过滤增加 `draft N`；用户可只看有未应用 value 草稿的 slice，结果摘要显示 `draft slices`，清空草稿后保留 `value drafts` 过滤并进入现有空状态。
- 2026-06-20：左侧 Subjects 增加 value draft badge 和 `draft` 快捷过滤；同一份 draft summary 现在可按 subject 视角显示 `N draft`，并能只看有未应用 value 草稿的 subject。
- 2026-06-20：右侧 Inspector 隐藏时不再卸载组件；未应用的 slice metadata 草稿在关闭 / 重新打开 Inspector 后会保留，避免把布局操作变成隐式放弃输入。
- 2026-06-20：右侧 Inspector metadata 草稿改为按 slice id 暂存；切到其他 slice 再返回时未应用的 `time / title / summary / kind` 不会丢失，`还原` / `应用到预览` / `重置 mock` 会按当前 slice 或全局 reset 清理草稿。
- 2026-06-20：Inspector metadata 草稿接入主画布 draft 可见性；Slice Card 显示 `meta draft`，Slice List 的 `draft` 状态过滤现在同时匹配 metadata 草稿和 value 草稿，顶栏摘要统一显示 `status drafts`。
- 2026-06-20：左侧 Subjects 的 value 草稿入口从泛化 `draft` 改成 `value`；中间 `draft` 表示 slice 级任意草稿，左侧 `value` 表示 subject 级未应用 value 草稿，避免 metadata draft 出现时左右计数语义冲突。
- 2026-06-20：Slice List 顶部新增统一 `Draft Queue`；按时间线顺序合并 metadata draft 与 value draft，队列项显示 `time / title / kind / meta / value N`，点击后进入 `status=draft` 并定位目标 slice。
- 2026-06-20：metadata draft 增加主画布预览；Draft Queue 和 Slice Card 会显示未应用的 `time / title / summary / kind`，卡片保留 `已应用：...` 原标题提示，避免用户只看到抽象 `meta draft` 而看不见草稿内容。
- 2026-06-20：Inspector Metadata 区块新增 `Metadata Draft Diff`；当 slice metadata 有未应用草稿时，右侧显示 `field / applied / draft` 三列差异，提交前可审阅 `time / kind / title / summary` 具体变更。
- 2026-06-20：Draft Queue 增加处理面板路由；点击 metadata draft 会打开右侧 Inspector，点击 value draft 会展开底部 Mutation Editor，让草稿发现、定位和处理面板直达形成闭环。
- 2026-06-20：顶栏 Inspector 开关增加 metadata draft badge；当右侧存在未应用 metadata 草稿时显示 `meta N`，并在 title 中提示打开 / 隐藏 Inspector 时草稿会保留或可处理。
- 2026-06-20：Draft Queue 顶部 `查看草稿切片` 改为完整草稿视角入口；会清空 search / kind / subject 过滤并切到 `status=draft`，避免旧过滤把草稿结果挡成空列表。
- 2026-06-20：顶栏新增全局 `Drafts` 汇总入口，统一显示 metadata / value 草稿所在 slice 数；点击后会清空阻挡过滤、进入 `status=draft`、选中第一个草稿 slice，并按草稿类型自动打开 Inspector / Mutation Editor。
- 2026-06-20：Inspector 视觉顺序调整为优先当前 slice 状态检查；`Touched Subjects` 与 `State Snapshot` 现在排在全局 `Review Queue` 前，避免 clean slice 的状态快照被全局队列挤出第一屏。
- 2026-06-20：左侧 Sidebar 收起态新增 collapsed summary rail，用非交互徽标保留 active / selected / open review / value draft subject 状态，减少收起左栏时的信息损失；本轮浏览器连接超时，已在 walkthrough 记录验证限制。
- 2026-06-20：Slice List 顶部状态统计卡改为快捷过滤入口；`open slices / issues`、`review done`、`clean slices`、`draft slices` 可直接切换 status 过滤，减少从统计到筛选的跳转成本；本轮浏览器连接仍超时，已记录补验项。
- 2026-06-20：Slice List 状态快捷卡计数改为稳定分布语义；卡片计数保留 search / kind / subject 条件，但忽略当前 status 过滤，避免切到 `open` 后其它 status 入口被自身过滤显示为 0。
- 2026-06-20：Slice List 状态统计逻辑收束为 `collectResultStats`；当前完整过滤统计和 status 快捷卡稳定计数共用同一份状态分布计算，减少后续扩展 issue/draft 语义时的重复维护。
- 2026-06-20：Slice List 状态快捷卡增加 toggle 行为；点击 open / done / clean / draft 进入对应 status，再次点击当前状态卡会恢复 `status=all`，并在 title 中提示该行为。
- 2026-06-20：按用户 7 点反馈修正 mock workbench：metadata draft 不再因单纯切换 slice 误入队列，Inspector State Snapshot 改为多层 tree，补齐 `sliceContext` i18n，删除 Schema excerpt 和 Sidebar 顶部 Schema 统计卡，Slice Card subject group 支持整卡点击与键盘聚焦。
- 2026-06-20：Inspector State Snapshot 从本地 `SnapshotTreeView` 临时实现改为复用公共 `JsonViewer`，保留 subject 外层展开结构和 raw JSON 兜底，同时清理本地 tree 类型、构造 helper 与相关静态断言。
- 2026-06-20：Inspector `原始状态 JSON` 也改为公共 `JsonViewer`，Mutation Editor subject 视图的 `此时状态` 从单层 attr/value 表格改为 `JsonViewer`，并删除旧 `stateRows` 与 `WorldWorkbenchPreviewAttrRow`。
- 2026-06-20：重构 issue 审查展示面：Slice Card 增加 compact issue rows 负责主画布发现和定位，Mutation Editor 接管 Review Focus、triage 三段控件和上 / 下一个 issue 导航，Inspector 删除完整 Review Issues / Review Queue，只保留轻量 Slice Health 和“查看问题”入口。
- 2026-06-20：按用户反馈继续收束 issue 审批：Inspector 删除 Slice Health 审查卡，底部区域用户可见名称改为“审查工作台”，新增 `问题处理 / Subject 视图 / 总变更` 模式；Review Focus 增加同 subject + attr 路径相关的前 / 当前 / 后 mutation 三联上下文，并区分 A 通道一次性提醒与 E 通道持续现算语义。
- 2026-06-20：Review Focus 改为人话诊断：根据 issue code、mutation op、subject、attr 和三联上下文生成 A1 / A2 / E1 / E2 可读说明；Mutation Context 三联卡删除 before / after，改为从使用者角度展示动作、依赖 / 覆盖关系、为什么相关和需要确认什么。
- 2026-06-21：Review Focus 增加具体 issue key 焦点；同一 slice / subject / attr 下多条 issue 时，底部审查工作台按用户点击的 issue key 显示 code/message/status，避免只按 attr 找到第一条 issue。
- 本轮详细记录见 [walkthroughs/2026-06-19-mock-preview.md](walkthroughs/2026-06-19-mock-preview.md)。
- 浏览器评估记录见 [walkthroughs/2026-06-20-ux-browser-refinement.md](walkthroughs/2026-06-20-ux-browser-refinement.md)。
- 过滤与空状态修正记录见 [walkthroughs/2026-06-20-filter-empty-state-refinement.md](walkthroughs/2026-06-20-filter-empty-state-refinement.md)。
- subject 过滤上下文同步记录见 [walkthroughs/2026-06-20-subject-filter-context-sync.md](walkthroughs/2026-06-20-subject-filter-context-sync.md)。
- Inspector subject 焦点联动记录见 [walkthroughs/2026-06-20-inspector-subject-focus.md](walkthroughs/2026-06-20-inspector-subject-focus.md)。
- Mutation Editor 折叠信息条记录见 [walkthroughs/2026-06-20-mutation-editor-peek-mode.md](walkthroughs/2026-06-20-mutation-editor-peek-mode.md)。
- Slice Card subject 聚焦入口记录见 [walkthroughs/2026-06-20-slice-card-subject-focus.md](walkthroughs/2026-06-20-slice-card-subject-focus.md)。
- Slice Card subject timeline 筛选记录见 [walkthroughs/2026-06-20-slice-card-subject-filter.md](walkthroughs/2026-06-20-slice-card-subject-filter.md)。
- Mutation Editor value 编辑记录见 [walkthroughs/2026-06-20-mutation-value-editing.md](walkthroughs/2026-06-20-mutation-value-editing.md)。
- mock reducer 重构记录见 [walkthroughs/2026-06-20-mock-reducer-refactor.md](walkthroughs/2026-06-20-mock-reducer-refactor.md)。
- reducer 行为测试记录见 [walkthroughs/2026-06-20-reducer-behavior-tests.md](walkthroughs/2026-06-20-reducer-behavior-tests.md)。
- value parser 抽取记录见 [walkthroughs/2026-06-20-value-parser-refactor.md](walkthroughs/2026-06-20-value-parser-refactor.md)。
- schema-aware value input 记录见 [walkthroughs/2026-06-20-schema-aware-value-input.md](walkthroughs/2026-06-20-schema-aware-value-input.md)。
- collectionRemove value input 记录见 [walkthroughs/2026-06-20-collection-remove-value-input.md](walkthroughs/2026-06-20-collection-remove-value-input.md)。
- slice 前后状态对照记录见 [walkthroughs/2026-06-20-slice-before-after-diff.md](walkthroughs/2026-06-20-slice-before-after-diff.md)。
- slice kind / health 过滤记录见 [walkthroughs/2026-06-20-slice-kind-health-filters.md](walkthroughs/2026-06-20-slice-kind-health-filters.md)。
- Inspector review issue 记录见 [walkthroughs/2026-06-20-inspector-review-issues.md](walkthroughs/2026-06-20-inspector-review-issues.md)。
- Inspector issue target 高亮记录见 [walkthroughs/2026-06-20-issue-target-highlight.md](walkthroughs/2026-06-20-issue-target-highlight.md)。
- Review Focus 状态条记录见 [walkthroughs/2026-06-20-review-focus-strip.md](walkthroughs/2026-06-20-review-focus-strip.md)。
- 浏览器本地草稿持久化记录见 [walkthroughs/2026-06-20-local-draft-persistence.md](walkthroughs/2026-06-20-local-draft-persistence.md)。
- Subject activity stats 记录见 [walkthroughs/2026-06-20-subject-activity-stats.md](walkthroughs/2026-06-20-subject-activity-stats.md)。
- Review Queue 导航记录见 [walkthroughs/2026-06-20-review-queue-navigation.md](walkthroughs/2026-06-20-review-queue-navigation.md)。
- Mock issue triage 记录见 [walkthroughs/2026-06-20-mock-issue-triage.md](walkthroughs/2026-06-20-mock-issue-triage.md)。
- triage-aware slice 过滤记录见 [walkthroughs/2026-06-20-triage-aware-slice-filters.md](walkthroughs/2026-06-20-triage-aware-slice-filters.md)。
- open-only Review Queue 记录见 [walkthroughs/2026-06-20-open-only-review-queue.md](walkthroughs/2026-06-20-open-only-review-queue.md)。
- triage-aware subject stats 记录见 [walkthroughs/2026-06-20-triage-aware-subject-stats.md](walkthroughs/2026-06-20-triage-aware-subject-stats.md)。
- Sidebar stats 快捷过滤记录见 [walkthroughs/2026-06-20-sidebar-stat-filter-shortcuts.md](walkthroughs/2026-06-20-sidebar-stat-filter-shortcuts.md)。
- Review Queue mode 持久化记录见 [walkthroughs/2026-06-20-review-queue-mode-persistence.md](walkthroughs/2026-06-20-review-queue-mode-persistence.md)。
- Sidebar review 分布记录见 [walkthroughs/2026-06-20-sidebar-review-breakdown.md](walkthroughs/2026-06-20-sidebar-review-breakdown.md)。
- Subject navigation scope 记录见 [walkthroughs/2026-06-20-subject-navigation-scope.md](walkthroughs/2026-06-20-subject-navigation-scope.md)。
- Slice List filter persistence 记录见 [walkthroughs/2026-06-20-slice-list-filter-persistence.md](walkthroughs/2026-06-20-slice-list-filter-persistence.md)。
- Visible slice navigation 记录见 [walkthroughs/2026-06-20-visible-slice-navigation.md](walkthroughs/2026-06-20-visible-slice-navigation.md)。
- Filter context summary 记录见 [walkthroughs/2026-06-20-filter-context-summary.md](walkthroughs/2026-06-20-filter-context-summary.md)。
- Filter result summary 记录见 [walkthroughs/2026-06-20-filter-result-summary.md](walkthroughs/2026-06-20-filter-result-summary.md)。
- Inspector slice health 记录见 [walkthroughs/2026-06-20-inspector-slice-health.md](walkthroughs/2026-06-20-inspector-slice-health.md)。
- Visible slice stepper 记录见 [walkthroughs/2026-06-20-visible-slice-stepper.md](walkthroughs/2026-06-20-visible-slice-stepper.md)。
- Inspector metadata dirty state 记录见 [walkthroughs/2026-06-20-inspector-metadata-dirty-state.md](walkthroughs/2026-06-20-inspector-metadata-dirty-state.md)。
- Mutation Editor dirty state 记录见 [walkthroughs/2026-06-20-mutation-editor-dirty-state.md](walkthroughs/2026-06-20-mutation-editor-dirty-state.md)。
- Mutation Editor cross-slice draft 记录见 [walkthroughs/2026-06-20-mutation-editor-cross-slice-drafts.md](walkthroughs/2026-06-20-mutation-editor-cross-slice-drafts.md)。
- Mutation Editor draft queue 记录见 [walkthroughs/2026-06-20-mutation-editor-draft-queue.md](walkthroughs/2026-06-20-mutation-editor-draft-queue.md)。
- Mutation Editor clear drafts 记录见 [walkthroughs/2026-06-20-mutation-editor-clear-drafts.md](walkthroughs/2026-06-20-mutation-editor-clear-drafts.md)。
- Mutation Editor collapsed draft toolbar 记录见 [walkthroughs/2026-06-20-mutation-editor-collapsed-draft-toolbar.md](walkthroughs/2026-06-20-mutation-editor-collapsed-draft-toolbar.md)。
- Slice Card draft badge 记录见 [walkthroughs/2026-06-20-slice-card-draft-badge.md](walkthroughs/2026-06-20-slice-card-draft-badge.md)。
- Slice List draft filter 记录见 [walkthroughs/2026-06-20-slice-list-draft-filter.md](walkthroughs/2026-06-20-slice-list-draft-filter.md)。
- Sidebar subject draft badge 记录见 [walkthroughs/2026-06-20-sidebar-subject-draft-badge.md](walkthroughs/2026-06-20-sidebar-subject-draft-badge.md)。
- Inspector hide preserves metadata draft 记录见 [walkthroughs/2026-06-20-inspector-hide-preserves-metadata-draft.md](walkthroughs/2026-06-20-inspector-hide-preserves-metadata-draft.md)。
- Inspector cross-slice metadata draft 记录见 [walkthroughs/2026-06-20-inspector-cross-slice-metadata-drafts.md](walkthroughs/2026-06-20-inspector-cross-slice-metadata-drafts.md)。
- Metadata draft visibility 记录见 [walkthroughs/2026-06-20-metadata-draft-visibility.md](walkthroughs/2026-06-20-metadata-draft-visibility.md)。
- Sidebar value draft label 记录见 [walkthroughs/2026-06-20-sidebar-value-draft-label.md](walkthroughs/2026-06-20-sidebar-value-draft-label.md)。
- Slice List draft queue 记录见 [walkthroughs/2026-06-20-slice-list-draft-queue.md](walkthroughs/2026-06-20-slice-list-draft-queue.md)。
- Metadata draft preview 记录见 [walkthroughs/2026-06-20-metadata-draft-preview.md](walkthroughs/2026-06-20-metadata-draft-preview.md)。
- Inspector metadata draft diff 记录见 [walkthroughs/2026-06-20-inspector-metadata-draft-diff.md](walkthroughs/2026-06-20-inspector-metadata-draft-diff.md)。
- Draft Queue surface routing 记录见 [walkthroughs/2026-06-20-draft-queue-surface-routing.md](walkthroughs/2026-06-20-draft-queue-surface-routing.md)。
- Inspector toggle draft badge 记录见 [walkthroughs/2026-06-20-inspector-toggle-draft-badge.md](walkthroughs/2026-06-20-inspector-toggle-draft-badge.md)。
- Draft Queue show drafts filter reset 记录见 [walkthroughs/2026-06-20-draft-queue-show-drafts-filter-reset.md](walkthroughs/2026-06-20-draft-queue-show-drafts-filter-reset.md)。
- Topbar Drafts 汇总入口记录见 [walkthroughs/2026-06-20-topbar-draft-summary.md](walkthroughs/2026-06-20-topbar-draft-summary.md)。
- Inspector State Snapshot 优先级记录见 [walkthroughs/2026-06-20-inspector-snapshot-priority.md](walkthroughs/2026-06-20-inspector-snapshot-priority.md)。
- Sidebar collapsed summary 记录见 [walkthroughs/2026-06-20-sidebar-collapsed-summary.md](walkthroughs/2026-06-20-sidebar-collapsed-summary.md)。
- Slice stat filter shortcuts 记录见 [walkthroughs/2026-06-20-slice-stat-filter-shortcuts.md](walkthroughs/2026-06-20-slice-stat-filter-shortcuts.md)。
- Slice stat stable counts 记录见 [walkthroughs/2026-06-20-slice-stat-stable-counts.md](walkthroughs/2026-06-20-slice-stat-stable-counts.md)。
- Slice stat stats refactor 记录见 [walkthroughs/2026-06-20-slice-stat-stats-refactor.md](walkthroughs/2026-06-20-slice-stat-stats-refactor.md)。
- Slice stat toggle filter 记录见 [walkthroughs/2026-06-20-slice-stat-toggle-filter.md](walkthroughs/2026-06-20-slice-stat-toggle-filter.md)。
- Slice status aria pressed 记录见 [walkthroughs/2026-06-20-slice-status-aria-pressed.md](walkthroughs/2026-06-20-slice-status-aria-pressed.md)。
- Slice status context counts 记录见 [walkthroughs/2026-06-20-slice-status-context-counts.md](walkthroughs/2026-06-20-slice-status-context-counts.md)。
- Slice kind context counts 记录见 [walkthroughs/2026-06-20-slice-kind-context-counts.md](walkthroughs/2026-06-20-slice-kind-context-counts.md)。
- Filter toggle aria pressed 记录见 [walkthroughs/2026-06-20-filter-toggle-aria-pressed.md](walkthroughs/2026-06-20-filter-toggle-aria-pressed.md)。
- Editor / Inspector aria pressed 记录见 [walkthroughs/2026-06-20-editor-inspector-aria-pressed.md](walkthroughs/2026-06-20-editor-inspector-aria-pressed.md)。
- 可调面板与 triage 三段控件记录见 [walkthroughs/2026-06-20-resizable-panels-and-triage-segment.md](walkthroughs/2026-06-20-resizable-panels-and-triage-segment.md)。
- Snapshot tree 与草稿误入队列修正记录见 [walkthroughs/2026-06-20-snapshot-tree-and-draft-fixes.md](walkthroughs/2026-06-20-snapshot-tree-and-draft-fixes.md)。
- Snapshot JsonViewer 复用记录见 [walkthroughs/2026-06-20-snapshot-json-viewer.md](walkthroughs/2026-06-20-snapshot-json-viewer.md)。
- Raw JSON 与 Mutation Editor 状态 JsonViewer 记录见 [walkthroughs/2026-06-20-json-viewer-raw-and-editor-state.md](walkthroughs/2026-06-20-json-viewer-raw-and-editor-state.md)。
- Issue 审查展示面重构记录见 [walkthroughs/2026-06-20-issue-review-surface-refactor.md](walkthroughs/2026-06-20-issue-review-surface-refactor.md)。
- Issue 审批三联上下文记录见 [walkthroughs/2026-06-20-issue-review-panel-context.md](walkthroughs/2026-06-20-issue-review-panel-context.md)。
- Issue 人话诊断记录见 [walkthroughs/2026-06-20-issue-human-explanation.md](walkthroughs/2026-06-20-issue-human-explanation.md)。
- Review Focus issue key 精确定位记录见 [../56-world-engine/walkthroughs/2026-06-21-round-218-review-focus-issue-key.md](../56-world-engine/walkthroughs/2026-06-21-round-218-review-focus-issue-key.md)。
- SegmentedControl 抽取与重复选择器收敛记录见 [walkthroughs/2026-06-20-segmented-control-refactor.md](walkthroughs/2026-06-20-segmented-control-refactor.md)。
- 当前视角 subject 模式文案同步记录见 [../56-world-engine/walkthroughs/2026-06-21-round-238-world-view-subject-mode-label.md](../56-world-engine/walkthroughs/2026-06-21-round-238-world-view-subject-mode-label.md)。
- 清空 subject 过滤复位模式记录见 [../56-world-engine/walkthroughs/2026-06-21-round-240-clear-subject-filter-resets-mode.md](../56-world-engine/walkthroughs/2026-06-21-round-240-clear-subject-filter-resets-mode.md)。
- 空 subject 过滤 mode guard 记录见 [../56-world-engine/walkthroughs/2026-06-21-round-241-empty-subject-filter-mode-guards.md](../56-world-engine/walkthroughs/2026-06-21-round-241-empty-subject-filter-mode-guards.md)。
- Current State 文档对账记录见 [walkthroughs/2026-06-22-current-state-doc-sync.md](walkthroughs/2026-06-22-current-state-doc-sync.md)。
- 主 Workbench 顶部提示互斥记录见 [../56-world-engine/walkthroughs/2026-06-22-round-264-workbench-banner-exclusive.md](../56-world-engine/walkthroughs/2026-06-22-round-264-workbench-banner-exclusive.md)。
- route/query 切换 Project 草稿保护记录见 [../56-world-engine/walkthroughs/2026-06-22-round-265-route-switch-draft-guard.md](../56-world-engine/walkthroughs/2026-06-22-round-265-route-switch-draft-guard.md)。
- Project 切换草稿确认副作用收口记录见 [../56-world-engine/walkthroughs/2026-06-22-round-266-switch-confirm-side-effect.md](../56-world-engine/walkthroughs/2026-06-22-round-266-switch-confirm-side-effect.md)。
- route/query 切换取消 URL 回滚记录见 [../56-world-engine/walkthroughs/2026-06-22-round-267-route-cancel-url-restore.md](../56-world-engine/walkthroughs/2026-06-22-round-267-route-cancel-url-restore.md)。
- Slice Composer busy 期间上下文切换保护记录见 [../56-world-engine/walkthroughs/2026-06-22-round-268-composer-context-switch-busy-guard.md](../56-world-engine/walkthroughs/2026-06-22-round-268-composer-context-switch-busy-guard.md)。
- Slice Composer 保存中关闭保护记录见 [../56-world-engine/walkthroughs/2026-06-22-round-269-composer-saving-close-guard.md](../56-world-engine/walkthroughs/2026-06-22-round-269-composer-saving-close-guard.md)。
- Slice Composer 保存中 Project 切换保护记录见 [../56-world-engine/walkthroughs/2026-06-22-round-270-saving-project-switch-guard.md](../56-world-engine/walkthroughs/2026-06-22-round-270-saving-project-switch-guard.md)。
- Slice Composer 保存中顶栏动作保护记录见 [../56-world-engine/walkthroughs/2026-06-22-round-271-saving-topbar-action-guard.md](../56-world-engine/walkthroughs/2026-06-22-round-271-saving-topbar-action-guard.md)。
- Slice Composer 保存中函数层入口保护记录见 [../56-world-engine/walkthroughs/2026-06-22-round-272-saving-function-guard.md](../56-world-engine/walkthroughs/2026-06-22-round-272-saving-function-guard.md)。
- Slice List 保存中上下文保护记录见 [../56-world-engine/walkthroughs/2026-06-22-round-273-slice-list-busy-guard.md](../56-world-engine/walkthroughs/2026-06-22-round-273-slice-list-busy-guard.md)。
- Slice Composer 保存中表单 / Builder 保护记录见 [../56-world-engine/walkthroughs/2026-06-22-round-274-composer-saving-form-guard.md](../56-world-engine/walkthroughs/2026-06-22-round-274-composer-saving-form-guard.md)。
- 空状态主体系统同步入口记录见 [../56-world-engine/walkthroughs/2026-06-22-round-275-empty-state-subject-sync-action.md](../56-world-engine/walkthroughs/2026-06-22-round-275-empty-state-subject-sync-action.md)。
- 手动创建 subject 连续录入保护记录见 [../56-world-engine/walkthroughs/2026-06-22-round-276-subject-creator-continuous-entry.md](../56-world-engine/walkthroughs/2026-06-22-round-276-subject-creator-continuous-entry.md)。
- 空 Project 创建 Subject 主画布入口记录见 [../56-world-engine/walkthroughs/2026-06-22-round-277-empty-state-create-subject-action.md](../56-world-engine/walkthroughs/2026-06-22-round-277-empty-state-create-subject-action.md)。
- 编辑 Slice 时 Builder 自动同步记录见 [../56-world-engine/walkthroughs/2026-06-22-round-278-edit-slice-builder-sync.md](../56-world-engine/walkthroughs/2026-06-22-round-278-edit-slice-builder-sync.md)。
- Slice time 必填前端校验记录见 [../56-world-engine/walkthroughs/2026-06-22-round-279-slice-time-required-validation.md](../56-world-engine/walkthroughs/2026-06-22-round-279-slice-time-required-validation.md)。
- 连续写入 Composer 内保存回执记录见 [../56-world-engine/walkthroughs/2026-06-22-round-280-continue-save-visible-receipt.md](../56-world-engine/walkthroughs/2026-06-22-round-280-continue-save-visible-receipt.md)。
- 删除 slice 返回 issue 来源归因记录见 [../56-world-engine/walkthroughs/2026-06-22-round-281-delete-issue-source-slice.md](../56-world-engine/walkthroughs/2026-06-22-round-281-delete-issue-source-slice.md)。
- 无选中 slice 空状态 issue 摘要记录见 [../56-world-engine/walkthroughs/2026-06-22-round-282-empty-state-review-issues.md](../56-world-engine/walkthroughs/2026-06-22-round-282-empty-state-review-issues.md)。
- 下一条默认 slice 时间跨日 / 月 / 年进位记录见 [../56-world-engine/walkthroughs/2026-06-22-round-283-next-slice-time-date-rollover.md](../56-world-engine/walkthroughs/2026-06-22-round-283-next-slice-time-date-rollover.md)。
- Subject Creator Project 默认值重置记录见 [../56-world-engine/walkthroughs/2026-06-22-round-284-subject-creator-project-defaults.md](../56-world-engine/walkthroughs/2026-06-22-round-284-subject-creator-project-defaults.md)。
- Schema / Calendar 来源路径展示记录见 [../56-world-engine/walkthroughs/2026-06-22-round-285-schema-source-path-surface.md](../56-world-engine/walkthroughs/2026-06-22-round-285-schema-source-path-surface.md)。
- Schema / Calendar 来源文件打开入口记录见 [../56-world-engine/walkthroughs/2026-06-22-round-286-open-schema-source-path.md](../56-world-engine/walkthroughs/2026-06-22-round-286-open-schema-source-path.md)。
- 内置示例世界 schema 不匹配时的入口降级记录见 [../56-world-engine/walkthroughs/2026-06-22-round-287-demo-schema-guard.md](../56-world-engine/walkthroughs/2026-06-22-round-287-demo-schema-guard.md)。
- 连续推演 subject 语境保持记录见 [../56-world-engine/walkthroughs/2026-06-22-round-288-continue-subject-context.md](../56-world-engine/walkthroughs/2026-06-22-round-288-continue-subject-context.md)。
- State Snapshot 前态时间补读记录见 [../56-world-engine/walkthroughs/2026-06-22-round-289-snapshot-previous-time-detail.md](../56-world-engine/walkthroughs/2026-06-22-round-289-snapshot-previous-time-detail.md)。
- Snapshot detail 原位替换记录见 [../56-world-engine/walkthroughs/2026-06-22-round-290-snapshot-detail-in-place.md](../56-world-engine/walkthroughs/2026-06-22-round-290-snapshot-detail-in-place.md)。
- Mutation Editor value 草稿绑定 mutation 身份记录见 [../56-world-engine/walkthroughs/2026-06-22-round-291-value-draft-mutation-identity.md](../56-world-engine/walkthroughs/2026-06-22-round-291-value-draft-mutation-identity.md)。
- 顶栏 `新建 Slice` 请求已打开 Composer 切回新建模式记录见 [../56-world-engine/walkthroughs/2026-06-22-round-292-composer-new-slice-request.md](../56-world-engine/walkthroughs/2026-06-22-round-292-composer-new-slice-request.md)。
- Review Queue 已消失 issue 自动清理焦点记录见 [../56-world-engine/walkthroughs/2026-06-22-round-293-review-focus-clears-missing-issue.md](../56-world-engine/walkthroughs/2026-06-22-round-293-review-focus-clears-missing-issue.md)。
- Composer 整块编辑保存后清理同 slice 会话草稿记录见 [../56-world-engine/walkthroughs/2026-06-22-round-294-composer-edit-clears-drafts.md](../56-world-engine/walkthroughs/2026-06-22-round-294-composer-edit-clears-drafts.md)。
- 独立 Preview slice time 必填校验记录见 [../56-world-engine/walkthroughs/2026-06-22-round-295-preview-slice-time-required.md](../56-world-engine/walkthroughs/2026-06-22-round-295-preview-slice-time-required.md)。
- 独立 Preview 错误 / 成功反馈互斥记录见 [../56-world-engine/walkthroughs/2026-06-22-round-296-preview-feedback-mutual-exclusive.md](../56-world-engine/walkthroughs/2026-06-22-round-296-preview-feedback-mutual-exclusive.md)。
- 独立 Preview Schema / Calendar 深链打开主 IDE 文件记录见 [../56-world-engine/walkthroughs/2026-06-22-round-297-preview-schema-openpath-deeplink.md](../56-world-engine/walkthroughs/2026-06-22-round-297-preview-schema-openpath-deeplink.md)。
- 主 IDE `openPath` 深链先消费再规范 URL 的顺序修正记录见 [../56-world-engine/walkthroughs/2026-06-22-round-298-openpath-consume-before-normalize.md](../56-world-engine/walkthroughs/2026-06-22-round-298-openpath-consume-before-normalize.md)。
- 独立 Preview 创建 subject 必填校验与连续录入保护记录见 [../56-world-engine/walkthroughs/2026-06-22-round-299-preview-subject-create-guard.md](../56-world-engine/walkthroughs/2026-06-22-round-299-preview-subject-create-guard.md)。
- 独立 Preview 已存在 subject 重复创建保护记录见 [../56-world-engine/walkthroughs/2026-06-22-round-300-preview-subject-duplicate-guard.md](../56-world-engine/walkthroughs/2026-06-22-round-300-preview-subject-duplicate-guard.md)。
- 独立 Preview Schema attr 快捷填充尊重当前 subject 记录见 [../56-world-engine/walkthroughs/2026-06-22-round-301-preview-schema-fill-current-subject.md](../56-world-engine/walkthroughs/2026-06-22-round-301-preview-schema-fill-current-subject.md)。
- 独立 Preview 写入 / 编辑 slice time 为空时按钮禁用记录见 [../56-world-engine/walkthroughs/2026-06-22-round-302-preview-write-slice-time-disabled.md](../56-world-engine/walkthroughs/2026-06-22-round-302-preview-write-slice-time-disabled.md)。

## TODO / Follow-ups

- `GET /slices` 已支持 `subjectIds` + `subjectMode=any|all` 服务端过滤；后续只在 kind / health / search 也出现规模问题时再设计对应 API。
- State Snapshot 的性能策略仍需继续观察：真实 Dialog 默认展示触及 subjects，完整世界状态显式展开；如果 Project 状态继续变大，再设计分页 / 投影 / 后端摘要。
- 真实 issue triage 当前仍是前端会话态；后续如果要跨会话保留“已确认 / 已忽略”，需要单独设计用户审阅状态存储，不要和 re-settle 或 slice 派生状态混在一起。
