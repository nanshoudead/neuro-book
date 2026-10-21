---
schema: nbook.task/v2
taskId: t08-lab-governance
---

# Lab 治理

## 目标

开发者在 t07 第二轮反馈时问 Lab 还有什么值得规范化的地方。我列了六条，开发者 2026-10-01 全部同意：

1. 夹具宽度规则自相矛盾：Spec 要求“声明最大宽度时加 `mx-auto`”，夹具 README 与测试却禁止固定像素宽度；`defineSubjectFixture` 的 `class` 不受检查。统一成一条规则，测试覆盖到。
2. 夹具控制按钮各自抄一长串样式类。提供共用的 Lab 控制按钮。
3. `window.__nbLab` 读不到事件，smoke 只能切到事件 tab 读面板文字。加只读的 `events()`。
4. 高频事件（每次按键一条 `change`）刷屏。事件 tab 可按事件名隐藏。
5. 加一个 smoke 套件要改 `component-lab.ts` 四处。改成表驱动。
6. 起 Lab 要手动建临时根、跑迁移再启动。加一条 `bun run lab`。

## 合同

[ui.component-lab](../../../../../docs/specs/ui/component-lab.md)（implemented）：改了事件 tab、调试接口、新增 `lab` 命令、夹具舞台规则，新增验收 18、19，实现合同的“调试入口”与证据里的分层 smoke 入口。规则正文在 [`fixtures/README.md`](../../../../../packages/neuro-book/app/component-lab/fixtures/README.md)。

## 非目标

- 修掉规则统一前就有的 46 处夹具偏差：其中不少像是在还原产品宿主，要逐个核对产品后再改或标 `data-lab-host`，并会碰到 workbench、agent-profile 等 smoke 依赖的 DOM。它们逐条登记在测试里，只减不增。
- `workbench-lab.ts` 的事件读取改用调试接口：那组 smoke 有既有失败，改了也验证不了。

## 当前状态（2026-10-01）：已实现，待开发者确认

## 验证

- `bun run test -- app/component-lab`：24 个文件中 23 个通过；失败的 9 条都在未改动的 `WorkbenchShellLayoutFixture.test.ts`（`localStorage.clear` 不存在），与 t07 记录相同。
- `fixtures/index.test.ts` 的舞台规则做了两向变异检查：新夹具根容器加 `max-w-md` 时报出文件与规则；清单里登记了不存在的偏差时报“已经修好”。
- smoke（3002 端口）：`core` 通过（含新加的事件隐藏检查；首次跑在等 `.lab-root` 时超时，是改动后开发服务首次编译慢，重跑通过）、`prompt-editor`、`agent-conversation` 通过。`agent-profile` 在选场景这一步失败，是 Spec 登记过的既有失败（旧场景选择器与超过四个场景时的下拉控件不符），没走到本 Task 改的读事件那几行，这几行未经浏览器验证。
- `bun run lab -- --port 3013`：约 12 秒可访问，`lab:shot` 正常；Ctrl+C（向进程组发 SIGINT）后 1 秒退出、端口关闭、没有残留进程、临时根已删。SIGTERM 同样会删临时根。
- `lab:shot`：`PromptEditor`、`LabControlButton`、`EventLogPanel`、`FormColorField`、`HighlightBox` 的全部场景在手机与 1400×900、昼夜配色下无溢出、无页面问题。
- `bun run typecheck` 0 错误；`scripts:typecheck` 通过；`docs:check` 失败 0。

## 进展记录

已改（`packages/neuro-book` 下，另有仓库根的 Spec）：

- 调试接口：`app/component-lab/lab-debug.ts` 加 `events()` 与 `toDebugEvent`（负载转 JSON 副本，转不了的退回字符串），`LabShell.vue` 接上；单测在 `lab-debug.test.ts`。
- 事件 tab：`LabShell.vue` 在清空那一行下面列出事件名与条数，点一下隐藏或显示这一类；只影响显示，换组件时恢复。`EventLogPanel` 本身不变，它的文档本来就说过滤由使用方做。
- smoke：新增 `scripts/smoke/lab-events.ts`（`labEvents`、`waitForLabEvent`），`prompt-editor.ts`、`agent-profile-nav.ts`、`lab-command-scene.ts` 改用它；`component-lab.ts` 的套件改成 `SUITES` 表（`direct` 与 `shell` 两种），用法文字与参数校验从表生成；core 流程加 `assertEventFilter`。
- `bun run lab`：`scripts/lab/dev.ts`。
- 控制按钮：新增 `app/component-lab/LabControlButton.vue/.md` 与夹具 `LabControlButtonFixture.vue`（三个场景）；`PromptEditorFixture`、`AgentConversationViewFixture` 的 15 个按钮换过去；`EventLogPanelFixture` 原来把按钮放在舞台上，移进控制抽屉。
- 舞台规则：`fixtures/index.test.ts` 用 Vue 模板解析器找出从模板根到 `data-lab-subject` 这一路上的容器，加上 `index.ts` 里的 `class:`，检查固定宽高或最大宽度、`mx-auto`、居中加留白、卡片外壳、`var(--bg-main)`；`data-lab-host` 容器与 `LabFixtureControls` 不查。`FormColorFieldFixture`（`mx-auto max-w-md`）、`HighlightBoxFixture`（居中加 `p-6`）、`PromptEditorFixture` 已改。

过程中的取舍：

- 第一版把所有外层留白都算违规，报出 61 处，大多是旧 Agent 夹具根上的 `p-4`。原 README 禁止的只是“居中加留白的展台”，照宿主留的边距并不误导，于是收窄为“居中又留白”才算，剩 51 处；修掉几处后登记 46 处。
- 想拿活动栏 48px 列当“还原宿主”的例子，查产品代码发现宿主是工作台壳树上一格刚性宽度的叶子（卡片加两侧留白），不是固定 48px，也不一定是 `bg-main`，所以文档里改用核实过的 `PromptEditor` `bare` 外框做例子，活动栏留在偏差清单。
- `PromptEditorFixture` 去掉 `min-h-[460px]` 后，紧凑模式下舞台只有 40px 高，菜单被裁掉（smoke 的 `reference-menu` 抓到）。先后试过“撑满”模式加贴底（左下、右下角被画布圆角裁掉）和垂直居中（上下大片空白），开发者都不认可，结论见下面“画布与撑满”。

`bun run dev` 的 Ctrl+C 孤儿进程（开发者 2026-10-01 要求顺手修）：

- 现象：终端按 Ctrl+C 把 SIGINT 发给整个前台进程组，Source Dev 用来托管 `dev:runtime` 的 `owned-process` 监督器也在组里，按默认行为直接退出；Source Dev 报“POSIX监督进程未报告目标终态：code=null signal=SIGINT”后退出，`dev:runtime` 在自己的进程组里没收到信号，继续监听端口。用独立 State Root 直接跑 `bun run dev` 复现过。
- 修复：`packages/owned-process/src/posix-supervisor-source.ts` 里监督器忽略 SIGINT、SIGQUIT、SIGHUP。它的生死本来就跟宿主走：宿主主动终止或 IPC 断开（宿主不处理这些信号而退出时）都会收口目标进程组。
- 测试：`packages/owned-process/tests/owned-process.test.ts` 新增“宿主所在进程组收到SIGINT时，监督器留给宿主收口”（fixture `interrupted-owner.ts`，宿主像 Source Dev 一样收到 SIGINT 后终止 lease）。修复前失败（终止超时并留下孤儿进程），修复后通过；包内测试 16 条通过、3 条 Windows 专用跳过，`typecheck` 通过。
- 实测：`bun run dev`（3014）与 `bun run lab`（3013）向整个进程组发 SIGINT 后都在 1 秒内退出，端口释放，没有残留进程。`scripts/lab/dev.ts` 里关于这个问题的说明随之改掉，单独进程组保留，用来保证先等开发服务退出再删临时根。
- 未处理：Windows 监督器（控制台 Ctrl+C 的语义不同）没有改，也没在 Windows 上验证。Source Dev 的优雅关闭在开发服务上总是失败（“Product graceful shutdown 失败，转为强制收口：The socket connection was closed unexpectedly”，关闭接口在返回 202 前断开连接），随后强制收口成功；修复前就有，与孤儿进程无关，没有追查。

验证环境：开发者在 3002 的开发服务 10:47 前后因 Nuxt 主进程 JS 堆耗尽自行退出（系统日志里有它的 core dump），之后的截图与 smoke 在 `bun run lab -- --port 3013` 上跑。

画布与撑满（开发者 2026-10-01 第二轮要求）：

- 开发者的原则：组件宽高都跟着画布走，拖画布就是改组件尺寸，舞台与组件之间不留空白；圆角由 Lab 给画布留内边距处理。PromptEditor 的夹具前后两次都没做到（先贴底被圆角切角，再居中留出大片空白），开发者指出这类问题经常犯。
- 撑满以后菜单在外框外面没有地方。问了开发者，选的是“Lab 不裁浮层”：组件逻辑不为此改，画布不再裁切组件画到外面的内容。
- `ViewportCanvas`：盒子在标出的尺寸之外加一圈 8px 内边距（标出的尺寸量的是内容层，组件拿到的正好是 390×844 这类尺寸），内容层去掉 `overflow: auto`，不再裁切；盒子带 `data-lab-canvas`。
- `PromptEditor` 新增 `fill`：外框取父元素的高度，正文区占满附件条以外的部分并在内部滚动，`maxHeight` 不起作用；父元素没有确定的高度时仍随内容长高。Lab 场景默认 `fill: true`，“长文”与“展开、无外框”两个场景不撑满，用来看 `minHeight`、`maxHeight`。PromptEditor 回到“紧凑”模式：画布包住编辑器，四周的舞台区留给菜单。
- 规则：`fixtures/README.md` 1.1 节与 Spec 写明“宽高都跟着画布走”，高度由内容决定的组件让画布包住、被拖成固定高度时撑满，只有按钮这类组件才居中。
- `lab:shot`（开发者同时要求优化）：默认截画布加上画到画布外的部分（`--area stage` 只截舞台）；截图前的操作加了 `--type`、`--press`，与 `--click` 按命令行顺序执行；`measure()` 新增 `paint`（截图范围）与 `subjectGap`（组件与舞台四边的空白），`lab:shot` 有空白时打印“组件没撑满舞台”，`--expect-fill` 时算失败。固定画布时给 Lab 外壳留的高度从 260 加到 400，并在截图前把画布滚进视野，手机尺寸才能截全。单测：`lab-debug.test.ts` 加两条，新增 `scripts/lab/shot.test.ts`。
- 验证（`bun run lab -- --port 3013`）：画布标 640×300 时舞台与编辑器外框都是 640×300；`lab:shot --click .ProseMirror --type @` 截到画在画布外的菜单；`prompt-editor`（新增 fill 检查，变异检查：去掉 `fill` 的 `height: 100%` 时报错）、`agent-conversation`、`core` 三组 smoke 通过。
- 顺带修的既有问题：撑满模式（`AgentConversationView` 等）在“随窗口”尺寸下画布会被内容撑得比舞台区还高（原版实测 1263px，舞台区 812px），组件没法在里面滚动。原因是舞台网格只有 `min-height: 100%`，`1fr` 按内容最大高度算；改为撑满模式下网格 `height: 100%`、内容行 `minmax(0, 1fr)`，画布回到 740px。
- 全量扫描（171 个登记名、默认场景、`vp=free`，一次性脚本，不入库）：
  - 不再裁切后画到画布外的有 5 个：`ReferenceSelectorPopover` 的弹层（本该可见）、`HighlightBox` 的框外标签（设计如此）、`AgentSessionDialog` 与 `AgentSessionTreeDialog`（对话框上下超出 12 到 48px）、`WorkbenchShellLayout`（底部超出 24px，像是状态栏一直被画布裁着，未查）。
  - 被测组件没撑满舞台的有 84 个（共 158 个可测），大多是旧夹具根上的 `p-4` 一类边距。现在 `lab:shot` 会逐个提示，未修。
  - 另有 13 条没测到：10 条是从登记里误抓的非组件名，3 条是开头 4 个标签页同时冷编译超时。
- 本轮验证（3013）：`prompt-editor`、`agent-conversation`、`core` 三组 smoke 再次通过；`app/component-lab`、`prompt-editor`、`scripts/lab` 单测除 `WorkbenchShellLayoutFixture.test.ts` 的 9 条既有失败外全部通过；`bun run typecheck` 0 错误。

开发者 2026-10-01 批准的后续：

- 反思回写：`.agents/skills/ui-development/SKILL.md` 的“UI 专属检查”加第 4 条：新建或修改 Lab 夹具后跑 `lab:shot`，出现“组件没撑满舞台”就改夹具或写明理由。
- 类型检查（不属于 Lab，开发者在同一轮要求）：`packages/neuro-book/package.json` 新增 `typecheck:quick`（`nuxt prepare` 加上 `vue-tsc --incremental --assumeChangesOnlyAffectDirectDependencies`，缓存在包内 `node_modules/.cache/neuro-book/`）；`packages/neuro-book/AGENTS.md` 写明开发中用它、交付前跑一次全量。验证门禁本身（`docs/testing/README.md`）已有“只支持全应用检查时运行一次”，未改。
  - 实测：全量 `typecheck` 约 70 秒（`nuxt prepare` 约 3 秒，其余是 vue-tsc 检查 5215 个文件）；快检首次约 83 秒建缓存，之后约 15 到 19 秒。
  - 能抓到改动过的 `.ts`、`.vue` 文件里的错误；改了导出的签名、只影响没改动的文件时抓不到（`findCompletedWriting` 加必填参数后快检通过，全量会报错）。在 vue-tsc 下这个参数实际只重查改动过的文件，不是字面上的“直接引用者”。只开 `--incremental` 时改一个文件仍要约 77 秒。
  - 拆项目引用的实验（临时根配置引用 `.nuxt` 下四份 tsconfig，`vue-tsc -b --noEmit`）：三次都约 87 秒，没有跳过任何项目（有错误的项目每次都重查，`node` 项目不产出文件、永远过期）；前端项目单独约 57 秒；`server/**` 全量纳入后多出 317 个错误。暂不做。

