# t17 实施计划：面板小修

## Context

- **为什么做**：开发者 2026-10-14 让按 autonomous-delivery 处理 [后续清单](../../followups.md) 的第二档，一共三件：
  1. **nb-ui `FormCheckbox` 的根上修法**。t15 阶段 4 第 1 批碰到“多选题点了选项页面变空白”：`FormCheckbox` 根上的 `<label>` 没有 `relative`，里面绝对定位的 `sr-only` input 聚焦时，包含块落到宿主的滚动容器之外，浏览器为了把焦点滚进视野，会滚动外面 `overflow: hidden` 的格子，整页看起来变空。面板这边已经让滚动容器都带 `relative` 绕开了，见 [推迟事项](../../followups.md#推迟事项)；
  2. **1440×650 下会话页的终端偏矮**；
  3. **显示租约的地方带上会话标题**。会话页的标题 t15 阶段 4 第 3 批已经做了（`01dd34201`，`src/server/session-titles.ts`），但首页的 Work 卡片、Task 页、运行页、收件箱的提问者、通知状态仍显示 `claude c38df555` 这样的短键。
- **核实过的事实**（2026-10-14，集成分支 `f31ebe9b4`）：
  - 第 1 件：nb-ui 里另外几处 `sr-only`（`Dialog`、`QuickInput` 的 `DialogTitle`，`FormField` 的错误文字）都不可聚焦，不会触发聚焦滚动，不用改。其他会话的分支（w00025 t02、w00002）都没改 nb-ui；
  - 第 2 件：在真实面板 4400 上用 1440×650 量过。纵向依次是：外壳工具栏 49，页头（面包屑、标题“会话”、herdr 状态一行）约 120，会话信息 67，终端条 43，终端画面约 200，输入区 136。终端只占窗口高度的三成；
  - 第 3 件：`src/server/views.ts` 只在会话页的数据里给 `title`（`titles.titleOf(agent, sessionId)`）；网页端在 `WorkCard.vue`、`TaskPage.vue`、`RunsPage.vue`、`InboxList.vue`、`NotifyStatus.vue` 都用 `shortSession(key, label)` 显示。
- **工作方式**：autonomous-delivery。计划与实现审查都按对象分：前端（会话页、租约显示的外观与交互、nb-ui 组件）派 Claude Sonnet；后端那一小段（视图带出标题）派 omp。实现交给 opus 编码子代理，在集成分支上逐片提交。

## 关键设计

### `packages/nb-ui/src/components/form/FormCheckbox.vue`：label 加 `relative`

- 根 `<label>` 加 `relative`，让 `sr-only` input 的包含块就是这个 label。input 仍是 `sr-only`，读屏与键盘行为不变。
- 同名 `FormCheckbox.md` 的“布局”一节补一句：根节点是定位上下文，隐藏的原生 input 不会让外层的滚动容器跟着滚动。
- **测试**：单元测试环境没有布局引擎，所以用 nb-ui 现有的 Playwright 验收（`packages/nb-ui/e2e/`，宿主是 `playground`）：
  - 新加验收页 `playground/app/acceptance/form-checkbox-focus`：一个 `overflow: hidden` 的定高格子，里面一个可滚动的列表，列表靠下的位置放一个 `FormCheckbox`；
  - 用例 `e2e/form-checkbox.spec.ts`：滚动列表让勾选框露出来，点它、再用 Tab 聚焦它，断言外层格子的 `scrollTop` 一直是 0、勾选框仍在视野里。
  - 先在不改组件的情况下确认这条用例会失败，再改组件。

### `packages/dev-panel/src/web/pages/SessionsPage.vue` 与 `src/web/parts/SessionConsole.vue`：矮窗口下给终端让高度

- 新增一档按窗口高度判断的“矮窗口”：可视高度小于 760px。判断放在现有决定宽度档（`tier`）的同一处，用 `matchMedia('(max-height: 759px)')`。
- 矮窗口下：
  1. **页头收成一行**：面包屑、标题与 herdr 状态并在一行，去掉标题的大字号，只在会话页这样做（`PageShell` 加一个 `compact` 属性，其他页面不受影响）；
  2. **会话信息收成一行**：会话标题与 Agent、pane、会话键、租约同在一行，放不下时截断，悬停显示全文；
  3. **输入框收成一行**：文本框默认一行，聚焦或有内容时展开到现在的高度；按键一行不变。
- 预期 1440×650 下终端画面从约 200px 增加到约 330px。验收以截图为准。
- 宽、中、窄几档的现有布局不变；窗口高度 760 以上不变。

### `packages/dev-panel/src/server/views.ts`：首页、Task 页、运行页带出会话标题

- 在 `views.ts` 里加一个辅助函数：收集一份视图里出现的会话键（租约、提问者、运行的属主、通知的目标），按会话键的 Agent 与会话 id 调 `titles.titleOf`，返回 `sessionTitles: Record<会话键, {text, source}>`。认不出 Agent 或会话 id 的不放进去。
- 首页（含收件箱与 Work 卡片）、Work 页、Task 页、运行页、通知状态这几份数据各带一份 `sessionTitles`。会话页已有逐条的 `title`，不改。
- `titleOf` 已经带缓存（文件没变不重读，找不到的记 60 秒），一份视图多读几次没有额外的文件读取。

### `packages/dev-panel/src/web/host/format.ts` 与几个零件：显示标题

- `shortSession(key, label)` 不变；新增 `sessionName(key, label, titles)`：有标题时返回标题，没有时退回 `shortSession`。
- `LeaseChip` 显示 `sessionName` 的结果，标题过长时截断；悬停提示里写短键和标题来源（例如“标题取自 Claude Code 的会话名”，文案沿用会话页的 `titleNote`）。
- 用到的地方：`WorkCard.vue`、`TaskPage.vue`、`RunsPage.vue`、`InboxList.vue`、`NotifyStatus.vue`。

## Spec 与文档改动

- `packages/dev-panel/docs/panel.md`：
  - 首页、Task 页、运行页的数据加 `sessionTitles`；
  - 会话页加“矮窗口”一档。
- `packages/nb-ui/src/components/form/FormCheckbox.md`：上面那一句。
- [后续清单](../../followups.md)“推迟事项”里 FormCheckbox 那一行写去向。
- 待确认清单：矮窗口下的三处收法（产品取舍）。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S1 | nb-ui `FormCheckbox` 加 `relative`，加验收页与 e2e | `bun run --cwd packages/nb-ui test`；`NB_UI_E2E_PORT=<空闲端口> bun run --cwd packages/nb-ui test:e2e -- form-checkbox`，改前失败、改后通过 |
| S2 | 视图带出 `sessionTitles`，网页端显示 | dev-panel typecheck；`tests/panel-core.test.ts`、`tests/session-titles.test.ts` 与相关 web 测试 |
| S3 | 会话页矮窗口 | dev-panel typecheck、`build:web`；`tests/web-session-console.test.ts`；1440×650、1440×900 截图对照 |

S1 是 nb-ui，与 S2、S3 不重叠，可以交给另一个编码子代理，在独立的 worktree 里并行做，做完合回集成分支。

## 验收映射

| 合同条目 | 覆盖 |
|---|---|
| 勾选框聚焦不滚动外层容器 | `packages/nb-ui/e2e/form-checkbox.spec.ts` |
| 首页、Task 页、运行页带 `sessionTitles`，有标题的显示标题 | `tests/panel-core.test.ts` 或 `tests/panel-server.test.ts` 的视图用例（夹具里放一个 Claude 会话文件）；网页端 `sessionName` 的单元测试 |
| 会话页矮窗口下终端变高，760 以上不变 | 截图（1440×650、1440×900），记进 Task 证据 |

## 验证

- 收口跑 dev-panel 全量、typecheck、`build:web`，以及 nb-ui 的 `test`、受影响的 e2e。
- 合入 `master` 后重启面板 4400，用真实面板在 1440×650 与 1440×900 下各截一张会话页，再看一眼首页与 Task 页的租约显示。
- 未验证的边界：Codex、omp 会话的标题只靠 t15 第 3 批的单元测试，这次不另测。

## 不做与风险

- 不删面板里“滚动容器都带 `relative`”的绕法：nb-ui 修好后它没有坏处，删了还要再验一遍所有滚动容器。
- 矮窗口只按高度判断，不处理浏览器缩放：缩放本来就会改变可视高度。
- 风险：nb-ui 正在被别的会话使用，`FormCheckbox` 改动后主应用的勾选框也会变。只加了 `relative`，不改外观；主应用里如果有依赖“label 不是定位上下文”的样式（例如用绝对定位放在 label 外的东西），会受影响。实施时在主应用里搜一遍 `FormCheckbox` 的用法核对。
