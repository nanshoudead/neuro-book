# t17 实施计划：面板小修

## Context

- **为什么做**：开发者 2026-10-14 让按 autonomous-delivery 处理 [后续清单](../../followups.md) 的第二档，一共三件：
  1. **nb-ui `FormCheckbox` 的根上修法**。t15 阶段 4 第 1 批碰到“多选题点了选项页面变空白”：`FormCheckbox` 根上的 `<label>` 没有 `relative`，里面绝对定位的 `sr-only` input 聚焦时，包含块落到宿主的滚动容器之外，浏览器为了把焦点滚进视野，会滚动外面 `overflow: hidden` 的格子，整页看起来变空。面板这边已经让滚动容器都带 `relative` 绕开了，见 [推迟事项](../../followups.md#推迟事项)；
  2. **1440×650 下会话页的终端偏矮**；
  3. **显示租约的地方带上会话标题**。会话页的标题 t15 阶段 4 第 3 批已经做了（`01dd34201`，`src/server/session-titles.ts`），但首页的 Work 卡片、Task 页、运行页、收件箱的提问者、通知状态仍显示 `claude c38df555` 这样的短键。
- **核实过的事实**（2026-10-14，集成分支 `f31ebe9b4`）：
  - 第 1 件：nb-ui 里另外几处 `sr-only`（`Dialog`、`QuickInput` 的 `DialogTitle`，`FormField` 的错误文字）都不可聚焦，不会触发聚焦滚动，不用改。其他会话的分支（w00025 t02、w00002）都没改 nb-ui；
  - 第 2 件：在真实面板 4400 上用 1440×650 量过。纵向依次是：外壳工具栏 49，页头（面包屑、标题“会话”、herdr 状态一行）约 120，会话信息 67，终端条 43，终端画面约 200，输入区 136。终端只占窗口高度的三成；
  - 第 3 件：`src/server/views.ts` 只在会话页的数据里给 `title`（`titles.titleOf(agent, sessionId)`）；网页端有 13 个文件用 `shortSession(key, label)` 显示会话（计划审查第 6 条），分两类：租约、提问者、运行属主这类“谁”，与通知、会话更换这类“核对发给哪个会话”的句子。
- **工作方式**：autonomous-delivery。计划与实现审查都按对象分：前端（会话页、租约显示的外观与交互、nb-ui 组件）派 Claude Sonnet；后端那一小段（视图带出标题）派 omp。实现交给 opus 编码子代理，在集成分支上逐片提交。

## 关键设计

### `packages/nb-ui/src/components/form/FormCheckbox.vue`：label 加 `relative`

- 根 `<label>` 加 `relative`，让 `sr-only` input 的包含块就是这个 label。input 仍是 `sr-only`，读屏与键盘行为不变。主应用里直接用它的只有 `FilesExplorerView.vue` 一处与 Lab 夹具，样式都不依赖 label 是否定位（计划审查已核实）。
- 同名 `FormCheckbox.md` 的“布局”一节补一句：根节点是定位上下文，隐藏的原生 input 不会让外层的滚动容器跟着滚动。
- **测试**：单元测试环境没有布局引擎，所以用 nb-ui 现有的 Playwright 验收（`packages/nb-ui/e2e/`，宿主是 `playground`）。
  - **新验收夹具** `form-checkbox-focus`：在 `playground/app/pages/acceptance/[name].vue` 的 `FIXTURES` 与 `playground/app/acceptance/definitions.ts` 两处登记，没有事件就给空数组，两处文件头列验收夹具的注释一起改。夹具结构是一个 `overflow: hidden` 的定高格子，里面一个可滚动的列表，列表靠下放一个 `FormCheckbox`。**格子、列表、label 三层都不能是定位上下文**，否则改前也会通过（计划审查第 10 条）。
  - **用例** `e2e/form-checkbox.spec.ts`：
    1. 先滚动列表，让勾选框露出来；
    2. 断言前提成立：列表的 `scrollTop > 0`，input 的静态位置在格子的可见区之外；
    3. 点勾选框，再用 Tab 让它聚焦；
    4. 断言夹具里那个格子（不是外面的 `.acc-canvas`）的 `scrollTop` 一直是 0，勾选框仍在视野里。
  - 先在不改组件的情况下跑，确认用例失败，失败截图存进 Task 的本地 `shots/`。不失败就调整夹具，不改断言；再改组件。

### `packages/dev-panel/src/web/pages/SessionsPage.vue`、`parts/PageShell.vue`、`parts/SessionConsole.vue`：会话页给终端让高度

原计划按窗口高度 760 分档、三处一起收。计划审查指出了三个问题：在 759 与 760 之间终端会突变约 130px；输入框收成一行几乎省不出高度；聚焦时展开会让终端反复调整尺寸。这次改成**不分高度档**的常设紧凑写法，每一处都是在所有窗口高度下省高度，不会出现突变：

1. **页头收成一行**：`PageShell` 加 `compact`，只给会话页这类铺满的工具页用。
   - 标题行就是面包屑，去掉最后一项“会话”，后面跟可见的 `h1`“会话”（字号同正文加粗），焦点与“跳到主内容”照旧落在它上面；
   - meta（herdr 徽章、订阅状态等）放同一行右侧，`min-w-0`，放不下时折行，不截断，因为 herdr 不可用时那是一整句错误；
   - 铺满页在 `compact` 下的内边距从 `1.5rem` 收到 `0.75rem`，页头与正文的间隙同步收小；
   - `bare` 与 `compact` 同时为真时 `bare` 优先。
   - `PageShell.md` 写明：`compact` 的页面标题位置与普通页不同，这是工具页的例外，“换页时标题停在同一处”只对普通页成立。
2. **会话信息合成一行可折行的 flex**：标题、状态徽章、Agent、pane、会话键、各 Task 链接、运行数、标题来源依次排在一行里，`flex-wrap`。宽度放得下时一行，放不下时自然折行。不截断链接，不靠悬停显示全文；会话键沿用现有的 `TruncatedText`。非 Agent 的 pane 保留“不能发消息、不能接管”的原因（计划审查第 4 条）。
3. **输入区**：
   - 字数计数只在超过上限的八成时显示，发送按钮与按键行同在最后一行的右端，输入框独占上面一行。这样右列不再比一行输入框高；
   - 输入框的行数只由内容决定，在 1 到 4 行之间（按草稿的换行数算），聚焦与失焦不改布局，并去掉手动拖高的把手（`resize-none`）；
   - 会话在工作中、输入框禁用时，不再单独占一行提示，提示文字放进禁用输入框的 placeholder。

- **验收目标**：1440×650 下终端画面不低于 320px（原来约 200px）；1440×900 下不比原来矮。截图覆盖 1440×650、1440×900、1280×650（中档）、1100×700（切换档）、390×640（手机），亮色各一张，1440×650 加一张暗色。高度用量取脚本量，记进 Task 证据。
- 横屏手机（例如 844×390）不另做：走文字视图，可视高度本来就容不下终端。写进“不做”。

### `packages/dev-panel/src/server/views.ts`：带出会话标题

- 在 `views.ts` 里加一个辅助函数：收集一份视图里出现的会话键（租约、提问者、运行的属主），按会话键的 Agent 与会话 id 调 `titles.titleOf`，返回 `sessionTitles: Record<会话键, {text, source}>`。认不出 Agent 或会话 id 的不放进去。
- 首页（含收件箱与 Work 卡片）、Work 页、Task 页、运行页这几份数据各带一份 `sessionTitles`。会话页已有逐条的 `title`，不改。产物页只用到通知状态，按下一节通知保留短键，所以不带。
- `titleOf` 已经带缓存：文件没变不重读，找不到的记 60 秒。一份视图里多查几次，不会多读文件。

### `packages/dev-panel/src/web/host/format.ts` 与各零件：显示标题

- **哪些地方换成标题**（计划审查第 6、7 条）：
  - **“谁”这一类显示标题加短键**：`LeaseChip`（`WorkCard`、`WorkPage`、`TaskPage`、`TaskTable` 两处、`InboxList` 的提问者）、`RunsPage` 的会话标题、`ProcList` 的“某会话起”；
  - **“核对发给哪个会话”这一类保留短键，不换**：`NotifyStatus` 的各句（含产物页里的）、`sessionChangeNote`、`DeveloperMessageDialog`、`SessionConsole` 的 `aria-label`、`host/session-console.ts`、`host/sessions-list.ts`。标题不唯一（`--resume` 或 fork 会沿用同一个标题），还能被改成任意文字，不能用来确认身份。
- **形状**：新增 `sessionName(key, label, titles)`，返回 `{title: string | null; short: string}`。显示时标题在前，可截断（最宽约 16rem）；短键在后，用次要色的小字，**始终显示、不截断**。这样两个同名会话靠短键也能区分，不必按整个视图去重（计划审查第 8 条）。没有标题时只显示短键，与现在相同。
- **数据传递**：各页面把自己数据里的 `sessionTitles` 用 `provide` 给下面的零件，零件用 `useSessionTitles()` 取，不必每个零件都加一个 prop。没有提供时按空表处理。
- **`LeaseChip`**：
  - `session` 改收 `sessionName` 的结果；
  - 原来的 `hint` 与标题来源合成一份提示，改用 nb-ui 现有的 `Tooltip`，chip 可以聚焦，键盘也能看到提示（计划审查第 9 条）；
  - 标题来源的文案从 `SessionsPage.vue` 的局部常量 `TITLE_SOURCE` 移到 `host/format.ts`，两处共用。

## Spec 与文档改动

- `packages/dev-panel/docs/panel.md`：
  - 首页、Work 页、Task 页、运行页的数据加 `sessionTitles`；
  - 会话页的紧凑写法；
  - 哪些地方显示标题、哪些保留短键。
- 同名 `.md`（计划审查第 12 条）：`PageShell.md`、`SessionConsole.md`、`LeaseChip.md`、`TaskTable.md`、`ProcList.md`，以及按实际改动涉及的 `WorkCard`、`InboxList`；`packages/nb-ui/src/components/form/FormCheckbox.md`。
- 面板“滚动容器都带 `relative`”的理由（`src/web/app.css`、`src/web/parts/QuestionControl.md`、`tests/web-scroll-containers.test.ts` 的头注释、`docs/panel.md` 的“滚动”一条）改写为：nb-ui 已在 label 上修好，这条留作面板的防御性约定（计划审查第 11 条）。
- [后续清单](../../followups.md)“推迟事项”里 FormCheckbox 那一行写去向。
- 待确认清单：会话页的紧凑写法，以及标题加短键的显示方式（产品取舍）。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S1 | nb-ui `FormCheckbox` 加 `relative`，加验收夹具与 e2e | `bun run --cwd packages/nb-ui test`；`NB_UI_E2E_PORT=<空闲端口> bun run --cwd packages/nb-ui test:e2e -- form-checkbox`，改前失败、改后通过 |
| S2 | 视图带出 `sessionTitles`，网页端显示标题加短键 | dev-panel typecheck；`tests/panel-core.test.ts`（或 `tests/panel-server.test.ts`）的视图用例，`sessionName` 的单元测试 |
| S3 | 会话页的紧凑写法 | dev-panel typecheck、`build:web`；截图与高度测量（见“验收目标”） |

S1 是 nb-ui，与 S2、S3 不重叠，可以交给另一个编码子代理，在独立的 worktree 里并行做，做完合回集成分支。

## 验收映射

| 合同条目 | 覆盖 |
|---|---|
| 勾选框聚焦不滚动外层容器 | `packages/nb-ui/e2e/form-checkbox.spec.ts`，改前失败的截图 |
| 首页、Work 页、Task 页、运行页带 `sessionTitles` | 视图用例：夹具里放一个 Claude 会话文件，断言 `sessionTitles` 里有它的标题 |
| “谁”显示标题加短键；同名的两个会话可区分；“核对身份”的句子保留短键 | `sessionName` 的单元测试（有标题、无标题、同名）；截图 |
| 1440×650 下终端画面不低于 320px，1440×900 下不变矮 | 高度测量脚本与截图，记进 Task 证据 |

## 验证

- 收口跑 dev-panel 全量、typecheck、`build:web`，以及 nb-ui 的 `test`、受影响的 e2e。
- 合入 `master` 后重启面板 4400，用真实面板按“验收目标”的尺寸截图，再看一眼首页、Work 页、Task 页的租约显示。
- 未验证的边界：Codex、omp 会话的标题只靠 t15 第 3 批的单元测试，这次不另测。

## 计划审查

2026-10-14 Claude Sonnet 审前端部分，报告存为 [evidences/plan-review-ui.txt](evidences/plan-review-ui.txt)：阻断 0、重要 9、建议 6，全部成立。

- 会话页一节整体重写，改为不分高度档的紧凑写法（第 1、2、3、4、5、13、15 条）；
- 标题的显示面列全，分“谁”与“核对身份”两类，标题后始终带短键，提示改用 `Tooltip`（第 6、7、8、9 条）；
- 验收夹具的前提写死（第 10 条）；
- 面板绕法的理由改写、同名 `.md` 列全（第 11、12 条）。
- 第 14 条（矮窗口的判断要可测）随“不分高度档”一起消失，会话页的布局以截图与高度测量验收。

服务端一节（`views.ts`）随 t18 的计划一起交 omp 审。

## 不做与风险

- 不删面板里“滚动容器都带 `relative`”的绕法：nb-ui 修好后它没有坏处，删了还要再验一遍所有滚动容器。只改写它的理由。
- 横屏手机不另做，见上。
- 风险：会话页的紧凑写法改的是常设布局，会影响所有窗口高度下的观感。产品取舍记进待确认清单，开发者看截图后可以改回。
