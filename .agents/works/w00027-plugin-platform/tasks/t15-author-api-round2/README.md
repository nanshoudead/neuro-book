---
schema: nbook.task/v2
taskId: t15-author-api-round2
status: done
updated: 2026-10-27
---

# 作者 API 第二轮：作者验收提出的类型与 API 改进

## 目标与范围

按 t14 作者验收报告的 F01、F02 到 F05、F07、F08、F10、F11 评估范围，开发者定范围后实施

来源：[t14 作者验收报告](../t14-plugin-author-api/evidences/author-acceptance-sonnet.txt)里属于新 API 设计的发现（t14 plan.md 第 12 节末行），开发者 2026-10-24 要求先开任务、判断范围。

合同：会改 [plugin-api](../../../../../docs/specs/runtime/plugin-api.md)（作者 API）、[plugin-channel](../../../../../docs/specs/runtime/plugin-channel.md)（调用方的失败类型、事件助手）、[views](../../../../../docs/specs/workbench/views.md) 与 [workbench-shell](../../../../../docs/specs/ui/workbench-shell.md)（打开视图的命令）、[plugin-code-loading](../../../../../docs/specs/runtime/plugin-code-loading.md)（构建报错的格式）；逐项写进计划。

## 范围评估

2026-10-24 按代码核对后的估计。B2、B4 是纯类型改动，难点在 TypeScript 推断：要在 vue-tsc 下实测报错的落点与第一行文字。

| 块 | 发现 | 做什么 | 动哪里 | 大小 |
|---|---|---|---|---|
| B1 打开视图 | F01 | 工作台加命令 `nbook.view.open {viewId}`：找到视图所在容器，选中容器、显示所在的区域、聚焦视图；视图不在布局里时失败并写原因。`statusItem` 的 `command` 收视图助手（点了即打开它）；作者文档列出作者可用的内置命令与参数 | 工作台命令（布局已有选容器、显示区域的动作）、`/browser` 助手、views 与 workbench-shell 的 Spec、一个 e2e | 中 |
| B2 类型报错的落点 | F02、F04、F05 | `fail` 的码与详情写错时报错落在 `fail` 那一行、第一行写清可选的码；入口产出漏写、多写贡献实现时，报错是以问题命名的属性（“缺少贡献实现 ping”“多写了 addComand”）；产出了 `remote` 却没声明 `remoteProvides` 时报错写明去声明哪个合同 | 内核 `define.ts`、`remote/contract.ts` 的类型，SDK `plugin.ts`；编译期反例 | 中 |
| B3 调用方的失败详情 | F03 | 远程调用结果的失败分支改成按码区分的联合，`detail` 随 `code` 收窄成该码的详情类型 | 内核 `remote` 的结果类型；现有调用方可能要改几处收窄写法 | 小到中 |
| B4 规则提前到编辑器 | F08 | 命令参数有必填项又给人用、记录与远程 `input` 写 `additionalProperties: true`、设置项名不合规、合同 id 前缀不对，在类型检查时就报；`context.services.require` 只收入口 `dependencies` 里声明的键 | SDK 助手的条件类型；`require` 要让激活上下文带上入口的依赖类型，内核 `ActivationContext` 与 SDK 入口的泛型都要改 | 中到大（`require` 一项占大半） |
| B5 构建报错的格式 | F07 | 构建时执行作者模块抛出的错误，按“作者文件:行 + 消息”输出，Vite 的堆栈只在 `--verbose` 时打印；摘要里写出错的文件而不是引入它的文件 | 构建预设与作者命令 | 小 |
| B6 推事件的助手 | F10 | 给远程事件一个助手，管订阅集合、停止时清理与 `onStop`，提供方只写 `emit(值)`；示例与作者文档改用它 | 内核或 SDK 的远程助手、示例 | 小 |
| B7 合同 id 从插件拼 | F11 | 合同 id 由插件对象拼出（例如 `plugin.remoteService({name, …})`），不再手写插件 id | SDK 助手、模板与示例 | 小 |

不做：`locations` 从入口推出（F11 的后半）。插件描述先于入口模块声明，宿主按它决定在哪些实例里装哪一侧的定义；构建已核对两者一致（t14 S5）。

合计：比 t14 小一些，约为它的一半到三分之二。B4 里 `require` 的类型一项改动面最大，可以单独拿出来。

开发者 2026-10-24 定：B1 到 B7 按评估全做，先记录。

## 先处理的事（开发者 2026-10-24）

开发者要求 t15 先处理下面几件事，再做 B1 到 B7。第 3、5、6、7、8 条是问题，先回答、需要定的交开发者定；第 9 条只记录，写在 [Work README](../../README.md) 的“后续的插件功能”。

| 编号 | 事项 | 查到的现状 | 待定 |
|---|---|---|---|
| P1 | 文档治理：根 README、`packages/*/README.md` 等 | 根 README 的下载、安装、使用说明还是 master 上旧版本的，写着“新应用尚不可用”；`packages/neuro-book` 有 README，`dev-panel`、`owned-process`、`neuro-book-contracts`、`neuro-book-test-support` 没有 | 按 P2 的结论写新应用的安装与使用 |
| P2 | 发布一个版本，完成插件的闭环 | 本分支没有新应用的发布链（[repository-workflow](../../../../../docs/standards/repository-workflow.md) 的“发布授权”）；应用版本 0.1.0，旧应用发到 0.10.2-canary；SDK 不发布，作者要先拿 tarball；npm 上已有 nb-story 与 8 个包（ADR 0029，`bun publish`） | 发什么、版本号、渠道 |
| P3 | SDK 为什么在 `packages/neuro-book` | [ADR 0030](../../../../../docs/adr/0030-plugin-platform-layering.md) 第 3、4 条（开发者 2026-10-24 定）：SDK 是 NeuroBook 专有的，公开面再导出应用的内置插件合同；拆成独立包要违反“领域包不得依赖应用”、打平类型、复制测试设施；版本等于产品版本 | 回答即可；要独立发布 SDK 时按 ADR 0030 的“后果”搬出 |
| P4 | 只用 Bun：npm 的地方改成 bun | 作者文档、`create` 的提示、模板 README 写 `npm install`、`npx`、`npm run`；打包用 `npm pack`；模板测试用 `node` 跑作者命令；`create` 专门处理 `npm init` 的占位；SDK 的 `engines.node` | 无，照做 |
| P5 | 命令行：`nbook` 与 `nbook-plugin` 要不要合并 | 现有 `nbook-plugin`（SDK 包的 bin：`create`、`build`），`nbstory`（nb-story），`nbdev`（仓库开发工具，不发布）；没有 `nbook`，应用靠 `bun run start` 启动 | 一个还是两个 |
| P6 | 内置插件的版本 | 已同步：内置插件的版本等于产品版本 `PRODUCT_VERSION`（`src/shared/product.ts`，测试核对与 `package.json` 一致；plugin-manifest 的字段表），都是 0.1.0 因为产品是 0.1.0 | 新应用第一个版本的版本号（随 P2） |
| P7 | `defineRecord` 由 SDK 提供，是否耦合 | 不在内核：`defineRecord` 在应用的 `shared/storage.ts`，归内置插件 `nbook.storage`；SDK 根入口把内核的 API 与设置、存储、命令、工作台几个内置插件的合同平铺在一起，看不出哪个归谁 | 是否按内置插件分子路径 |
| P8 | `RecordHandle` 的“轮询” | 没有轮询：`subscribe` 已推送写入；作者文档里的循环是条件保存冲突后的重试 | 是否加 `update(改写函数)` 助手，并在文档里写 `subscribe` |
| P9 | 后续的插件功能 | — | 只记录 |

开发者 2026-10-24 的决定：

- P2：新应用与 SDK 一起发到 npm（`@notnotype/neuro-book`、`@notnotype/nb-plugin-sdk`，同一个版本号，接在旧应用 0.10.x 之后）；改版本与 `bun publish` 按 [repository-workflow](../../../../../docs/standards/repository-workflow.md) 的“npm 包”由开发者授权、执行。
- P5：命令行按受众分两个：`nbook` 给用户与 Agent（启动、建作品、改配置、装与启停插件），随应用发布；作者工具像 VS Code 的 `vsce` 一样另起，名字 `nbooke`（取代 `nbook-plugin`），在 SDK 包里、跟 SDK 版本走。
- P7：SDK 按内置插件分子路径：根入口只留插件框架，`/storage`、`/settings`、`/commands`、`/workbench` 各归一个内置插件。
- P8：记录句柄加 `update(改写函数)` 助手，作者文档补 `subscribe`。

2026-10-25 第二期两项已定：`nbook` 的状态根缺省按平台的数据目录（Linux 遵守 `XDG_DATA_HOME`，缺省 `~/.local/share/neuro-book`；macOS `~/Library/Application Support/NeuroBook`；Windows `%LOCALAPPDATA%\NeuroBook`），`NBOOK_STATE_ROOT` 仍可覆盖；第一版子命令是启动加插件管理（`start`；`plugin list/install/enable/disable/uninstall`，下一次启动生效）。应用的 npm 包发什么、桌面端怎么发，开发者要先讨论。

2026-10-25 发行方向（草稿 [evidences/p2-direction-draft.txt](evidences/p2-direction-draft.txt)，omp 审查 [evidences/p2-direction-review-omp.txt](evidences/p2-direction-review-omp.txt)：重要 7、建议 2，实测服务端运行时不要 Vite、插件登记表多写者安全、作品登记表两进程丢一半登记、单文件的项目子进程与内嵌资源都起不来）。据审查修订、开发者确认：

- 第二期仍只做 npm 包：应用包发构建产物，用单独的发布清单（照 SDK 的暂存目录做法），自带 `nbook`；
- 一个状态根只跑一个服务端实例：启动时拿状态根的锁并写下地址，后来的启动发现已有实例就打开它的页面；要多实例各用一个 `NBOOK_STATE_ROOT`。这改动 projects 与 server-host 里“同一状态根可以有多个服务端进程”的合同；
- 状态根的版本与降级门禁先不做，到桌面端（多渠道）时再定；
- 发行按两个维度：运行时来自用户的 Bun 或捆绑的 Bun（目录包，单文件以后再说），界面在浏览器、浏览器安装的独立窗口或原生窗口；桌面壳在 Electrobun、Tauri、Electron（都把 Bun 当独立进程）里实测后选，窗口直接加载回环的 http 页面；
- Docker 与远端部署另写服务器部署提案，前提是鉴权；不恢复旧 Manager；
- 离线的 `nbook plugin list` 只报登记表里的目标状态，运行时状态未知。

2026-10-27 开发者确认第二期计划 [plan-phase2.md](plan-phase2.md) 的范围：旧应用的作品管理命令（`workspace project`/`node`）以后做成 `nbook` 的子命令，不另做命令，本期不做；GitHub Actions 的整理（旧应用的 `nuxt prepare` 等过时步骤、新应用的构建与打包检查）放进第三期；计划做深度审查：多个 Sonnet 加少量 Opus，另加 omp。

2026-10-27 深度审查（omp、Opus、Sonnet ×3，见 plan-phase2.md 第 9 节）后开发者定：D1 实例认领用状态根的本地套接字；D2 `nbook start` 前台运行，后台运行（注册成系统服务、`nbook service …`）本期不做，记进 Work 的后续事项；D3 本期删插件版本租约；D4 `nbook plugin install` 执行命令即算确认，降级或有插件受阻时要 `--yes`。

顺序：只用 Bun（P4）→ SDK 分子路径与 `update`（P7、P8）→ B1 到 B7 → 命令行（P5）→ 文档治理（P1）→ 发布（P2）。会改作者 API 的都在发布之前做完。

## 当前状态

进展（第一期）：

- S1 `e48e57ec8`：作者工具只用 Bun（`bun pm pack`、`engines.bun`、`cli.js` 的抬头行、文档与提示）；作者命令改名 `nbooke`；`create` 不再处理 `npm init` 的占位。类型检查例外：`vue-tsc` 在 Bun 的运行时里认不出 `.vue`，模板的 `typecheck` 按它的抬头行用 Node（plan.md 第 10 节）。验证：`plugin-sdk/` 70 例、类型检查、`plugin-authoring` e2e。
- S2 `4d7a9c084`：SDK 按内置插件分子路径（根入口是插件框架；`/state`、`/storage`、`/settings`、`/settings/browser`、`/commands`、`/workbench`、`/components`），贡献助手改成所属子路径的函数，`/commands` 公开 `commandServiceKey`，低层组合函数不再公开；宿主模块表、打包、闭包与导出测试按子路径；服务端导入浏览器子路径时报错附原因；打包生成 `docs/exports.md`。验证：类型检查，Bun 1474 例、Vitest 372 例，插件 e2e 8 例。
- S3 `616fdd635`：记录句柄加 `update`（读改写，冲突时重算，坏记录与别的版本写下的返回同名失败与 revision）；作者文档改用它并写 `subscribe`。验证：storage 真实三端测试 3 例（含冲突重算与 attempts 用完）。
- S4 `f2e414c70`：调用方的远程结果按方法定型（`RemoteResultFor`）；事件助手 `eventSource`；`remoteService(plugin, {name})`；counter 示例改用 `eventSource`，三个示例的合同改用 `remoteService`。验证：内核 401 例（含 `eventSource` 的真实路由测试与调用方收窄的编译期反例）、应用 Bun 1477 例、Vitest 372 例、类型检查。
- S5 `611c9c49e`：远程方法的上下文带按方法定型的 `ok`、`fail`；作者入口产出了远程服务或服务却没声明时报错写明去声明；短名、设置项名、要参数又给人用的命令、`require` 没声明的服务在类型检查时就报（实测记录见 plan.md 第 10 节）。验证：编译期反例、仓库外作者项目的 vue-tsc 诊断（`pack.test.ts`）、内核 401 例、应用 Bun 1477 例。
- S6 `cac4532d1`：命令 `nbook.view.open`；状态栏条目收视图助手；`/workbench` 导出 `OPEN_VIEW_COMMAND`；作者文档加“作者可用的内置命令”。验证：真实布局 store 的命令测试 4 例、工作台 e2e 42 例（含新的一例）。
- S7 `651724c3e`：构建时执行入口定义出错报作者文件:行:列，`--verbose` 附日志与堆栈。验证：构建测试、`plugin-sdk/` 71 例。
- 收口（合入 master 后的 `29c69bdb6`）：全量 e2e 293 例，292 例通过；`editor-area` 的“重新打开回到上次的光标”在全量负载下等光标保存超时，单独重跑该文件 30 例全过，属既有的负载时序问题，本 Task 未改这一块。实现审查已启动：后端 omp、前端 Sonnet、空白上下文的 Sonnet 作者验收（对照 t14 的报告）。
- 实现审查与作者验收（[evidences](evidences/)）：omp 重要 2、建议 1；Sonnet 前端重要 3、建议 4；作者验收重要 6、建议 17，对照 t14 的 16 条已解决 10、部分解决 3、仍然存在 3。逐条处理见 [plan.md 第 11 节](plan.md)，修正 `fc530652d`；留下的作者体验项记进 Work README 的“后续的插件功能”。验证：类型检查，plugin-sdk、SDK、命令、设置、架构测试 153 例，内核 remote 93 例，插件与工作台视图 e2e 35 例。

进展（第二期，计划 [plan-phase2.md](plan-phase2.md)；代码在 Work 分支，Spec 在 master）：

- S1 `4a7078310`：实例认领（状态根的本地套接字，`src/server/instance.ts`），`startServer` 必须收已认领的状态根，三个入口先认领；SIGHUP 有序停止（项目子进程忽略它）；`project.js` 被更换时不起项目子进程；Lab 场景 22 改成先停再起；`smoke:server` 加 S10。Spec `84c87cf59`（server-host、projects、stall-watchdog）。验证：类型检查，`src/server`、`src/project`、web host 189 例，`instance.test.ts` 9 例，Lab e2e 15 例，`smoke:server` 10 个场景。
- S2 `da83a19fb`：删插件版本租约（`pins.ts`）与 `version-in-use`（单实例下运行中的服务端只用登记表的 `version`，安装碰不到在用的目录）；场景 15 改成服务端与命令行同时写；focus 示例改成单服务端（两个窗口同时开始、换版本先重启、断线期间的变化重连后补上），场地加 `disconnect`。Spec `a761d7783`（plugin-install、application）。验证：类型检查（含 vue-tsc），plugin-platform 与插件文件 47 例，插件页 DOM 16 例，plugin-sdk 72 例；focus 并发场景做了变异检查。
- S3 `c021fb143`：`nbook start`（`src/cli/`：commander、中文帮助与错误、退出码 0/1/2、`--json` 结果对象、平台数据目录作缺省状态根、已有实例时报告并打开、启动中或停止中等它、版本不同与开发服务时失败、SSH 与无图形会话不打开浏览器、`--safe-mode`）；`build:server` 另出 `dist/server/nbook.js`；`BUN_ENGINE` 进 `src/shared/product.ts`。Spec `0955e239a`（新 `runtime/cli.md`，planned）。
- S4 `fbeb2a7d2`、`fe007743d`：`nbook plugin list/install/enable/disable/uninstall`（离线、与插件页同一套插件管理；有实例时用它应答里的启动集合算待生效变化，没有时用 `previewInstalledPlugins`；install 打印信任说明与预览，降级或有受阻时要 `--yes`；诊断写 `logs/cli.jsonl`）；实例应答带没有登记的原因；作者文档与 `nbooke create` 改成先写命令行。Spec `ea6a3a345`（plugin-install）。验证：`src/cli` 18 例（真实进程，构建到临时目录）。
- S5 `da7e7d7ee`：`scripts/pack-app.ts` 与 `build:app-package`（tarball 3.2 MB、221 个文件，没有依赖；THIRD-PARTY-NOTICES 由 Bun metafile 与 Vite 的 `build.license` 生成，95 个包加 Fraunces 的 OFL）；`e2e/app-package.e2e.ts` 从 tarball `bun add -g` 装上 `nbook`，打开作品、装插件、重启后生效。ADR 0033 `56bd02982`，monorepo-boundaries 同提交；cli Spec 的 Smoke `59f85b381`。验证：`pack-app.test.ts` 4 例，应用包 e2e 1 例，`bun run typecheck`，`check:dist`。
- 第二期收口（Work 分支合入 master 后的 `eb9633c3f`）：Bun 1515 例、Vitest 373 例全过；全量 e2e 294 例，293 例通过；`workbench-shell` 的“换位置、最大化……滚动保留”在另一个会话的 omp 审查占着 CPU 时失败（滚动位置 60，应为 300），在无改动的 base worktree 上对照、负载降下来后本分支单跑两次与整个文件各通过，属负载下的时序问题，本 Task 没碰工作台布局。实现审查已启动（后端 omp，插件页、Lab 与命令行使用 Sonnet），处理完再合入 master。
- 第二期实现审查（plan-phase2.md 第 10 节）：Sonnet 重要 3、建议 10，修正 `ede24f850`；omp 重要 12、建议 3（5 条与 Sonnet 重复），修正 `15f4e029d`；Spec `71f14b613`、`1084b02d8`。验证：类型检查，`src/server`、`src/project`、`src/plugin-platform` 199 例，`src/cli` 与打包、认领 36 例，e2e 的 dev、lab、plugins、projects 24 例与应用包 1 例。2026-10-27 合入 master（`ade830d0b`）。

进展（第三期，计划 [plan-phase3.md](plan-phase3.md)；代码在 Work 分支，Spec 在 master）：

- S0 `2b062cd23`：应用包按当前目录解析 Bun metafile 的路径（第二期在 worktree 里碰巧解析到主工作区的 `node_modules`，主工作区里 `pack-app.test.ts` 5 例 3 败），先写标记再写内容；加从无关目录运行的用例，变异检查有效。
- S1 `0cfb56add`：产品版本 0.11.0。
- S4 `3176bd437`、`1f734d72f`：三份旧 workflow 换成一份 `ci.yml`（推 master、PR、手动；按 `merge-base` 定基准，取不到就 `--all`；PR 才取消旧轮；`check` 跑 governance、docs、`test:affected --typecheck`，`app-package` 跑应用包、SDK 与 `smoke:server`）；Issue 表单与标签的检查并进 `governance:check`，只留“YAML 能解析、引用的标签已登记”（开发者说原 CI 过度防御，逐字核对表单字段与指南措辞的删掉）；删逐字核对 workflow 的元测试与写死的包矩阵，依赖图挪到 `workspace-graph.ts` 并补测试；`test:affected` 跳过退役的 llmlint；test-support 的长度用例只在 Windows 上跑（master 上一直失败，旧 CI 不跑全量没发现）。干净克隆里照 ci.yml 跑一遍：各步通过，`--all` 23 分钟（负载 11），时限定 60 分钟。
- S3 `a8328f17d`：`BUILT_PACKAGES`；`release:smoke` 生成两个包、11 个包过发布清单检查、tarball 与带 SHA-256 的清单放 `dist/release/`，加用户与作者的闭环（`bun add -g` 应用、`nbook` 打开书架、`bunx -p` SDK 生成插件并构建与类型检查、`nbook plugin install` 后重启已加载）；`release:publish` 门禁查清单的提交与摘要、HEAD 在 origin/master，`bun publish <tarball>`。干净克隆里 `prox bun run release:smoke` 全部通过。
- S2 `299250d1f`：`nbooke create` 不再提示装 tarball（结果字段与判断函数一起删），作者文档改用 `bunx -p`；SDK 包补 license、files、repository、publishConfig、LICENSE 与第三方许可（实际打进 reka-ui、@floating-ui、@vueuse 等 13 个 MIT 包），许可清单的生成与应用包共用 `scripts/third-party-notices.ts`。Spec `ce37859c7`（plugin-api）。验证：plugin-sdk 与应用包测试 79 例。
- S5 `8d962cb82`、`65c64c40e`：根 README 中英按 v2 重写（字标、看板娘、心情小猫、书架与工作台截图、安装、能做什么、写插件、路线图、旧版本一行）；补 dev-panel、owned-process、neuro-book-contracts、neuro-book-test-support 的 README（旧应用只读，不加），重写 `packages/neuro-book/README.md`；PROJECT-STATUS、repository-workflow 的发布步骤。

- 实现审查（Claude Opus，[evidences/p3-impl-review.txt](evidences/p3-impl-review.txt)）：阻断 1、重要 4、建议 7，逐条处理见 plan-phase3.md 第 11 节，修正 `a3b314ac2`，Spec `936670bd2`。
- 收口：干净克隆里 `release:smoke` 全部通过（[evidences/p3-release-smoke.txt](evidences/p3-release-smoke.txt)）；全量 e2e 在另一个项目的视频渲染占满 CPU 时（负载 17 到 30）跑到第 264 例被时限截停，246 例通过，Lab 一组超时失败；负载降下来后失败与没跑到的文件重跑全过（lab-nb-form 13、lab 15、lab-nb-ui、settings、workbench-titlebar、workbench-views 共 61）。同负载下基线一次通过、本分支一次失败，负载降下后本分支全过，属负载下的时序问题；两者之间运行代码只差版本号。

- 发布（开发者 2026-10-27 授权并执行 npm 登录与两步验证）：`@notnotype/nb-plugin-sdk@0.11.0`、`@notnotype/neuro-book@0.11.0` 发到 npm（`latest`），9 个源码包已在 registry 上、跳过；`release:smoke --from registry` 全部通过。发布中按 master 被几个会话共用的实际情况修了三处门禁（`138eff711` 只对要发的包跑 typecheck；冒烟与发布核对“会发布的目录自冒烟以来没变”而不是 HEAD 不变；看冒烟用的提交是否已推送；已发版本与验过的字节不同时只在要发的包依赖它时拦下）。`npm deprecate` 旧 Manager 被权限拦下，交开发者执行。
- 发布后的真实用户冒烟：[evidences/p3-user-smoke.md](evidences/p3-user-smoke.md)，缺陷 5 条（重启不恢复打开的章节与“最近打开”、整页切换时控制台报 error、作者构建打印 PLUGIN_TIMINGS、帮助列不对齐、nb-story 的 typecheck 在 master 上坏了）、可改进 9 条，记进 Work 的后续事项。

2026-10-24 P2、P5、P7、P8 已定。第一期（发布前改完作者 API）的计划见 [plan.md](plan.md)，开发者 2026-10-24 确认（含助手都改成所属子路径的函数、子路径表、`nbook.view.open`、作者命令名 `nbooke`）。计划审查两份（omp 阻断 5、重要 8、建议 1；Sonnet 重要 6、建议 15）逐条处理见 plan.md 第 9 节，开始实施 S1。

## 下一步

第一期、第二期完成并合入。开发者 2026-10-27 批准 `runtime.cli` 晋升为 `implemented`，追认待确认清单里第二期的 7 条，要求开始写第三期（文档治理、GitHub Actions 整理与发布）的计划，开发者参与规划。第三期计划 [plan-phase3.md](plan-phase3.md)：开发者 2026-10-27 定 E1 到 E6（0.11.0 打 latest；README 只写 v2 已有的、愿景改路线图；旧安装方式删掉、留一行指向旧版 Releases；CI 参考着重建、推 master 也跑、不跑 e2e；作者入口 `bunx -p`、不建 GitHub Release、两张截图；文档用上字标与看板娘）。计划审查（omp 写到 F11 时额度用完，Claude Opus 接手补完，[evidences/p3-plan-review.txt](evidences/p3-plan-review.txt)）阻断 1、重要 11、建议 4，处理见 plan-phase3.md 第 10 节；阻断的 F16 是第二期漏下的打包路径错误（主工作区里 `pack-app.test.ts` 5 例 3 败），新增 S0 先修。等开发者定第 9 节两项后实施。
