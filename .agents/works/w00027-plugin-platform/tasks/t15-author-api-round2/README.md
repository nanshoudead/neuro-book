---
schema: nbook.task/v2
taskId: t15-author-api-round2
status: planned
updated: 2026-10-24
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

顺序：只用 Bun（P4）→ SDK 分子路径与 `update`（P7、P8）→ B1 到 B7 → 命令行（P5）→ 文档治理（P1）→ 发布（P2）。会改作者 API 的都在发布之前做完。

## 当前状态

进展（第一期）：

- S1 `e48e57ec8`：作者工具只用 Bun（`bun pm pack`、`engines.bun`、`cli.js` 的抬头行、文档与提示）；作者命令改名 `nbooke`；`create` 不再处理 `npm init` 的占位。类型检查例外：`vue-tsc` 在 Bun 的运行时里认不出 `.vue`，模板的 `typecheck` 按它的抬头行用 Node（plan.md 第 10 节）。验证：`plugin-sdk/` 70 例、类型检查、`plugin-authoring` e2e。
- S2 `4d7a9c084`：SDK 按内置插件分子路径（根入口是插件框架；`/state`、`/storage`、`/settings`、`/settings/browser`、`/commands`、`/workbench`、`/components`），贡献助手改成所属子路径的函数，`/commands` 公开 `commandServiceKey`，低层组合函数不再公开；宿主模块表、打包、闭包与导出测试按子路径；服务端导入浏览器子路径时报错附原因；打包生成 `docs/exports.md`。验证：类型检查，Bun 1474 例、Vitest 372 例，插件 e2e 8 例。

2026-10-24 P2、P5、P7、P8 已定。第一期（发布前改完作者 API）的计划见 [plan.md](plan.md)，开发者 2026-10-24 确认（含助手都改成所属子路径的函数、子路径表、`nbook.view.open`、作者命令名 `nbooke`）。计划审查两份（omp 阻断 5、重要 8、建议 1；Sonnet 重要 6、建议 15）逐条处理见 plan.md 第 9 节，开始实施 S1。

## 下一步

开发者确认第一期计划后：计划审查（后端 omp、前端 Sonnet）、实施、实现审查。第二期（`nbook` 命令行与应用的 npm 包，先写 ADR）、第三期（文档治理与发布）在前一期合入后再写计划。
